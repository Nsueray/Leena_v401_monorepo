const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate } = require('../utils/email');
const authMiddleware = require('../middleware/authMiddleware');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Get paginated visitors
router.get('/paginated', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    const filters = ['expo_id = $1'];
    const values = [expo_id];
    let idx = 2;

    if (req.query.search) {
      filters.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(company) LIKE $${idx})`);
      values.push(`%${req.query.search.toLowerCase()}%`);
      idx++;
    }

    if (req.query.startDate) {
      filters.push(`created_at >= $${idx}`);
      values.push(req.query.startDate);
      idx++;
    }

    if (req.query.endDate) {
      filters.push(`created_at <= $${idx}`);
      values.push(req.query.endDate + ' 23:59:59');
      idx++;
    }

    if (req.query.source) {
      const sourceList = req.query.source.split(',');
      filters.push(`source = ANY($${idx})`);
      values.push(sourceList);
      idx++;
    }

    if (req.query.origin) {
      const originList = req.query.origin.split(',');
      filters.push(`origin = ANY($${idx})`);
      values.push(originList);
      idx++;
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataResult = await pool.query(
      `
      SELECT id, name, last_name, company, country, email, source, origin, created_at, qr_code
      FROM visitors
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
      `,
      [...values, limit, offset]
    );

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

// ✅ Get visitor by QR code
router.get('/badge/:qr_code', async (req, res) => {
  try {
    const qrCode = req.params.qr_code;
    const result = await pool.query(
      `SELECT * FROM visitors WHERE qr_code = $1 LIMIT 1`,
      [qrCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }

    return res.json({ success: true, visitor: result.rows[0] });
  } catch (err) {
    console.error('❌ QR Code lookup error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ PUBLIC FORM SUBMISSION WITH EMAIL
router.post('/public', async (req, res) => {
  try {
    const { form_id, expo_id, source, custom_fields } = req.body;

    const visitorData = {
      name: custom_fields?.full_name || custom_fields?.name || '',
      last_name: custom_fields?.last_name || '',
      email: custom_fields?.email || '',
      company: custom_fields?.company || '',
      country: custom_fields?.country || '',
      job_title: custom_fields?.job_title || '',
      phone: custom_fields?.phone || '',
      source: source || 'public_form',
      origin: 'public',
      expo_id,
      custom_fields: JSON.stringify(custom_fields || {})
    };

    if (!visitorData.email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    let emailTemplateId = null;
    let organizerId = null;

    if (form_id) {
      const formResult = await pool.query(
        `SELECT email_template_id, organizer_id FROM forms WHERE id = $1`,
        [form_id]
      );
      if (formResult.rows.length) {
        emailTemplateId = formResult.rows[0].email_template_id;
        organizerId = formResult.rows[0].organizer_id;
      }
    }

    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    const insertQuery = `
      INSERT INTO visitors (
        name, last_name, email, company, country, job_title, phone,
        source, origin, expo_id, organizer_id,
        qr_code, badge_id, badge_url, custom_fields, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()
      ) RETURNING *
    `;

    const values = [
      visitorData.name,
      visitorData.last_name,
      visitorData.email,
      visitorData.company,
      visitorData.country,
      visitorData.job_title,
      visitorData.phone,
      visitorData.source,
      visitorData.origin,
      expo_id,
      organizerId || 1,
      qrCode,
      badgeId,
      badgeUrl,
      visitorData.custom_fields
    ];

    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];

    if (emailTemplateId) {
      const templateResult = await pool.query(
        `SELECT * FROM email_templates WHERE id = $1`,
        [emailTemplateId]
      );

      if (templateResult.rows.length) {
        const template = templateResult.rows[0];
        const emailHtml = processEmailTemplate(template.html_content || template.content, visitorData);
        const emailSubject = processEmailTemplate(template.subject || 'Registration Confirmation', visitorData);

        await sendEmailWithReplyTo(
          visitorData.email,
          emailSubject,
          emailHtml,
          'reply@replies.leena.app'
        );
      }
    }

    res.json({
      success: true,
      message: 'Registration successful',
      visitor,
      qr_code: qrCode,
      badge_id: badgeId,
      badge_url: badgeUrl
    });

  } catch (err) {
    console.error('❌ Public form submission error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ✅ MANUAL REGISTRATION
router.post('/manual', async (req, res) => {
  try {
    const { name, last_name, email, company } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    await pool.query(
      `
      INSERT INTO visitors (name,last_name,email,company,qr_code,badge_id,badge_url,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [name || '', last_name || '', email, company || '', qrCode, badgeId, badgeUrl]
    );

    const emailHtml = `<p>Your registration is confirmed.</p>`;

    await sendEmailWithReplyTo(
      email,
      'Registration Confirmation',
      emailHtml,
      'reply@replies.leena.app'
    );

    res.json({ success: true });

  } catch (err) {
    console.error('❌ Manual registration error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ✅ IMPORT VISITORS FROM EXCEL
router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
  console.log('📥 Import request received');
  
  try {
    // Validate file
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { expo_id, visitor_type, source_override, send_email, template_id } = req.body;
    const origin = 'massimport';

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    // Get organizer_id from token
    const organizerId = req.user?.id || req.user?.organizer_id || 1;

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    console.log(`📊 Parsed ${rows.length} rows from Excel`);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel file is empty' });
    }

    // Get email template if needed
    let emailTemplate = null;
    if (send_email === 'true' && template_id) {
      const templateResult = await pool.query(
        `SELECT * FROM email_templates WHERE id = $1`,
        [template_id]
      );
      if (templateResult.rows.length) {
        emailTemplate = templateResult.rows[0];
      }
    }

    // Process each row
    const results = {
      success_count: 0,
      failed_count: 0,
      imported: [],
      errors: []
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      try {
        // Map Excel columns (flexible mapping)
        const name = row.name || row.Name || row.first_name || row['First Name'] || row.full_name || row['Full Name'] || '';
        const last_name = row.last_name || row['Last Name'] || row.surname || row.Surname || row.lastname || '';
        const email = row.email || row.Email || row.EMAIL || row.e_mail || '';
        const company = row.company || row.Company || row.COMPANY || row.organization || row.Organisation || '';
        const country = row.country || row.Country || row.COUNTRY || '';
        const phone = row.phone || row.Phone || row.PHONE || row.mobile || row.Mobile || row.tel || '';
        const job_title = row.job_title || row['Job Title'] || row.title || row.Title || row.position || row.Position || '';
        const website = row.website || row.Website || row.web || row.url || '';
        const visitor_type_val = visitor_type || row.visitor_type || row['Visitor Type'] || row.type || 'visitor';
        const visitor_category = row.visitor_category || row['Visitor Category'] || row.category || '';
        const sector = row.sector || row.Sector || row.industry || row.Industry || '';
        const source = source_override || row.source || row.Source || 'import';

        // Validate email
        if (!email || !email.includes('@')) {
          results.errors.push({ row: rowNum, message: `Invalid or missing email: "${email}"` });
          results.failed_count++;
          continue;
        }

        // Check for duplicate email in this expo
        const duplicateCheck = await pool.query(
          `SELECT id FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1`,
          [email.toLowerCase().trim(), expo_id]
        );

        if (duplicateCheck.rows.length > 0) {
          results.errors.push({ row: rowNum, message: `Duplicate email: ${email}` });
          results.failed_count++;
          continue;
        }

        // Generate QR code and badge
        const qrCode = uuidv4();
        const badgeId = qrCode.substring(0, 8).toUpperCase();
        const badgeUrl = generateBadgeUrl(qrCode);

        // Insert visitor
        const insertQuery = `
          INSERT INTO visitors (
            organizer_id, expo_id, name, last_name, email, company, country, 
            job_title, phone, website, source, origin, visitor_type, visitor_category, sector,
            qr_code, badge_id, custom_fields, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()
          ) RETURNING id, name, email, qr_code, badge_id
        `;

        const values = [
          organizerId,
          expo_id,
          name.trim(),
          last_name.trim(),
          email.toLowerCase().trim(),
          company.trim(),
          country.trim(),
          job_title.trim(),
          phone.trim(),
          website.trim(),
          source,
          origin,
          visitor_type_val,
          visitor_category.trim(),
          sector.trim(),
          qrCode,
          badgeId,
          JSON.stringify(row) // Store original row as custom_fields
        ];

        const insertResult = await pool.query(insertQuery, values);
        const visitor = insertResult.rows[0];

        results.imported.push({
          id: visitor.id,
          name: name || last_name || email,
          email: email,
          badge_id: badgeId
        });
        results.success_count++;

        // Send email if enabled
        if (emailTemplate) {
          try {
            const templateData = {
              name: name || 'Guest',
              last_name: last_name,
              email: email,
              company: company,
              country: country,
              job_title: job_title,
              phone: phone,
              qr_code: qrCode,
              badge_id: badgeId,
              badge_url: badgeUrl
            };

            const emailHtml = processEmailTemplate(
              emailTemplate.html_content || emailTemplate.body || '',
              templateData
            );
            const emailSubject = processEmailTemplate(
              emailTemplate.subject || 'Registration Confirmation',
              templateData
            );

            await sendEmailWithReplyTo(
              email,
              emailSubject,
              emailHtml,
              'reply@replies.leena.app'
            );

            console.log(`📧 Email sent to: ${email}`);

            // Small delay to avoid rate limits
            await delay(100);
          } catch (emailErr) {
            console.error(`❌ Email failed for ${email}:`, emailErr.message);
            // Don't fail the import, just log the email error
          }
        }

      } catch (rowErr) {
        console.error(`❌ Row ${rowNum} error:`, rowErr.message);
        results.errors.push({ row: rowNum, message: rowErr.message });
        results.failed_count++;
      }
    }

    console.log(`✅ Import complete: ${results.success_count} success, ${results.failed_count} failed`);

    res.json({
      success: true,
      message: `Import completed: ${results.success_count} visitors imported`,
      ...results
    });

  } catch (err) {
    console.error('❌ Import error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Import failed: ' + err.message 
    });
  }
});

module.exports = router;
