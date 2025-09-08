// routes/visitors.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, processEmailTemplate } = require('../utils/email');
const authMiddleware = require('../middleware/authMiddleware');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const upload = multer({ storage: multer.memoryStorage() });

// ✅ IMPORT - POST /api/visitors/import
router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
  // (bozulmamış hali korunuyor)
});

// ✅ GET /api/visitors?expo_id=...
router.get('/', authMiddleware, async (req, res) => {
  // (bozulmamış hali korunuyor)
});

// ✅ Paginated visitor log endpoint
router.get('/paginated', authMiddleware, async (req, res) => {
  // (bozulmamış hali korunuyor)
});

// ✅ GET visitor by QR (düzenlendi)
router.get('/badge/:qr_code', async (req, res) => {
  const { qr_code } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, name, last_name, company, email, badge_id, qr_code, custom_fields
       FROM visitors
       WHERE qr_code = $1`,
      [qr_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }

    const visitor = result.rows[0];

    // Eğer name veya last_name eksikse custom_fields içinden doldur
    if ((!visitor.name || !visitor.last_name || !visitor.company) && visitor.custom_fields) {
      const cf = visitor.custom_fields;
      visitor.name = visitor.name || cf.name || '';
      visitor.last_name = visitor.last_name || cf.last_name || '';
      visitor.company = visitor.company || cf.company || '';
    }

    res.json(visitor);

  } catch (error) {
    console.error('❌ Error fetching visitor by QR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ POST /api/visitors/public
router.post('/public', async (req, res) => {
  try {
    const {
      name,
      lastName,
      email,
      company,
      country,
      jobTitle,
      source = 'public_form',
      origin = 'form-public',
      form_id,
      custom_fields = {}
    } = req.body;

    if (!name || !email || !company || !form_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ✅ Formdan expo_id ve organizer_id çek
    const formResult = await pool.query(
      `SELECT expo_id, organizer_id FROM forms WHERE id = $1 LIMIT 1`,
      [form_id]
    );

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const expo_id = formResult.rows[0].expo_id;
    const organizer_id = formResult.rows[0].organizer_id;

    const badge_id = `B-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const qr_code = uuidv4();
    const badge_url = `${process.env.BASE_BADGE_URL}/badge-print.html?qr=${qr_code}`;

    const insertQuery = `
      INSERT INTO visitors (
        badge_id, qr_code, badge_url,
        custom_fields, email, expo_id, organizer_id,
        created_at, source, origin, name, last_name, company, country, job_title, form_id
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        CURRENT_TIMESTAMP, $8, $9, $10, $11, $12, $13, $14, $15
      )
      RETURNING *
    `;

    const values = [
      badge_id,
      qr_code,
      badge_url,
      custom_fields,
      email,
      expo_id,
      organizer_id,
      source,
      origin,
      name,
      lastName || '',
      company,
      country || '',
      jobTitle || '',
      form_id
    ];

    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];

    const subject = 'Your Badge for the Expo';
    const html = `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Thank you for registering. Below is your badge QR code:</p>
      <img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qr_code}" alt="QR Code" />
      <p>You can print your badge at the entrance by scanning this code.</p>
    `;
    await sendEmail(email, subject, html);

    res.status(201).json({
      message: 'Visitor created and email sent',
      badge_url,
      qr_code
    });
  } catch (err) {
    console.error('Error in /public:', err);
    res.status(500).json({ error: 'Failed to create visitor' });
  }
});

module.exports = router;
