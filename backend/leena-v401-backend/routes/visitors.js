const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, processEmailTemplate } = require('../utils/email');
const authMiddleware = require('../middleware/authMiddleware');

// Delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Multer config
const upload = multer({ storage: multer.memoryStorage() });

// ✅ IMPORT - POST /api/visitors/import
router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const {
            expo_id,
            visitor_type = 'visitor',
            origin = 'massimport',
            source_override,
            send_email,
            template_id
        } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        if (!expo_id) {
            return res.status(400).json({ success: false, message: 'Expo ID is required' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const imported = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                const name = row.name || row.full_name || 'Unknown';
                const email = row.email;
                if (!email) throw new Error('Email is required');

                const company = row.company || '';
                const phone = row.phone || '';
                const country = row.country || '';
                const job_title = row.job_title || '';

                const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                const qr_code = uuidv4();
                const badge_url = generateBadgeUrl(qr_code);
                const source = source_override || row.source || 'manual';

                const insertQuery = `
                    INSERT INTO visitors (
                        name, email, company, phone, country, job_title,
                        badge_id, qr_code, badge_url,
                        expo_id, organizer_id,
                        visitor_type, origin, source,
                        created_at
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,
                        $7,$8,$9,
                        $10,$11,
                        $12,$13,$14,
                        NOW()
                    ) RETURNING *
                `;

                const values = [
                    name, email, company, phone, country, job_title,
                    badge_id, qr_code, badge_url,
                    expo_id, organizerId,
                    visitor_type, origin, source
                ];

                const result = await pool.query(insertQuery, values);
                const visitor = result.rows[0];

                imported.push({
                    id: visitor.id,
                    name,
                    email,
                    badge_id
                });

                // ✅ Delay email if needed
                if (send_email && template_id) {
                    const tmpl = await pool.query(`
                        SELECT * FROM email_templates
                        WHERE id = $1 AND organizer_id = $2
                    `, [template_id, organizerId]);

                    if (tmpl.rows.length > 0) {
                        const template = tmpl.rows[0];
                        const data = {
                            name,
                            email,
                            company,
                            phone,
                            country,
                            job_title,
                            badge_id,
                            badge_url,
                            expo_name: '',
                            qr_code: `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qr_code}" alt="QR Code" style="max-width: 200px;">`
                        };

                        const html = processEmailTemplate(template.html_content, data);
                        const subject = processEmailTemplate(template.subject || 'Your Badge', data);
                        await sendEmail(email, subject, html);

                        // SendGrid spam koruması için gecikme
                        await delay(750);
                    }
                }

            } catch (err) {
                errors.push({ row: i + 2, message: err.message });
            }
        }

        return res.status(200).json({
            success: true,
            success_count: imported.length,
            failed_count: errors.length,
            imported,
            errors
        });
    } catch (err) {
        console.error('❌ Import error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ GET /api/visitors?expo_id=...
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { expo_id } = req.query;

        if (!expo_id) {
            return res.status(400).json({
                success: false,
                message: 'expo_id is required'
            });
        }

        const result = await pool.query(`
            SELECT id, name, email, company, country, badge_id, qr_code, created_at, source
            FROM visitors
            WHERE expo_id = $1
            ORDER BY created_at DESC
        `, [expo_id]);

        res.json({
            success: true,
            visitors: result.rows
        });
    } catch (error) {
        console.error('❌ Error fetching visitors:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load visitors'
        });
    }
});

// ✅ Paginated visitor log endpoint
router.get('/paginated', authMiddleware, async (req, res) => {
    try {
        const { expo_id, page = 1, limit = 100, search, startDate, endDate, source, origin } = req.query;
        
        if (!expo_id) {
            return res.status(400).json({ success: false, message: 'expo_id is required' });
        }
        
        const offset = (page - 1) * limit;
        const filters = ['expo_id = $1'];
        const values = [expo_id];
        let idx = 2;
        
        if (search) {
            filters.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(company) LIKE $${idx})`);
            values.push(`%${search.toLowerCase()}%`);
            idx++;
        }
        
        if (startDate) {
            filters.push(`created_at >= $${idx}`);
            values.push(startDate);
            idx++;
        }
        
        if (endDate) {
            filters.push(`created_at <= $${idx}`);
            values.push(endDate + ' 23:59:59');
            idx++;
        }
        
        if (source) {
            const sourceList = source.split(',');
            filters.push(`source = ANY($${idx})`);
            values.push(sourceList);
            idx++;
        }
        
        if (origin) {
            const originList = origin.split(',');
            filters.push(`origin = ANY($${idx})`);
            values.push(originList);
            idx++;
        }
        
        const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        
        const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
        const total = parseInt(totalResult.rows[0].count);
        
        const dataResult = await pool.query(`
            SELECT id, name, last_name, company, country, email, source, origin, created_at
            FROM visitors
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${idx} OFFSET $${idx + 1}
        `, [...values, limit, offset]);
        
        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            visitors: dataResult.rows
        });
        
    } catch (err) {
        console.error('❌ Paginated visitor fetch error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ NEW: GET /api/visitors/badge/:qr_code
router.get('/badge/:qr_code', async (req, res) => {
    const { qr_code } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, name, last_name, company, email, badge_id, qr_code
             FROM visitors
             WHERE qr_code = $1`,
            [qr_code]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Visitor not found' });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('❌ Error fetching visitor by QR:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ✅ Add this at the bottom of the file (before module.exports)
router.post('/public', async (req, res) => {
  try {
    const {
      name,
      lastName,
      email,
      company,
      country,
      jobTitle,
      source,
      origin = 'public',
      expoName
    } = req.body;
    if (!name || !email || !company || !expoName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const badgeID = `B-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const qrCode = uuidv4();
    const badgeURL = `${process.env.BASE_BADGE_URL}/badge-print.html?qr=${qrCode}`;
    const insertQuery = `
      INSERT INTO visitors (
        badge_id, qr_code, badge_url,
        custom_fields, email, expo_id, organizer_id, created_at, source, origin
      )
      VALUES (
        $1, $2, $3,
        $4, $5, 
        (SELECT id FROM expos WHERE name = $6 LIMIT 1),
        (SELECT organizer_id FROM expos WHERE name = $6 LIMIT 1),
        CURRENT_TIMESTAMP, $7, $8
      )
      RETURNING *
    `;
    const customFields = {
      name,
      last_name: lastName,
      company,
      country,
      job_title: jobTitle
    };
    const values = [
      badgeID,
      qrCode,
      badgeURL,
      customFields,
      email,
      expoName,
      source,
      origin
    ];
    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];
    // Send confirmation email (if template exists)
    const subject = 'Your Badge for the Expo';
    const html = `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Thank you for registering. Below is your badge QR code:</p>
      <img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qrCode}" alt="QR Code" />
      <p>You can print your badge at the entrance by scanning this code.</p>
    `;
    await sendEmail(email, subject, html);
    res.status(201).json({
      message: 'Visitor created and email sent',
      badge_url: badgeURL,
      qr_code: qrCode
    });
  } catch (err) {
    console.error('Error in /public:', err);
    res.status(500).json({ error: 'Failed to create visitor' });
  }
});

module.exports = router;
