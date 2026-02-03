const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate } = require('../utils/email');

const ZOHO_TOKEN = '98uy237fbiweuhr8h23g9rg239';

// ✅ Yeni endpoint: POST /api/webhook/zoho/:organizer_id/:expo_id/:form_id
router.post('/zoho/:organizer_id/:expo_id/:form_id', async (req, res) => {
  try {
    const token = req.headers['x-webhook-token'];
    if (token !== ZOHO_TOKEN) {
      return res.status(403).json({ success: false, message: 'Invalid token' });
    }

    const { organizer_id, expo_id, form_id } = req.params;

    const name =
      req.body.name ??
      '';
    const lastName =
      req.body.lastName ??
      req.body.last_name ??
      '';
    const email = req.body.email;
    const company =
      req.body.company ??
      '';
    const badgeNumber =
      req.body.badgeNumber ??
      req.body.badge_id ??
      '';
    const sector =
      req.body.sector ??
      '';
    const visitorCategory =
      req.body.visitorCategory ??
      req.body.visitor_category ??
      '';
    const visitorStatus =
      req.body.visitorStatus ??
      req.body.visitor_status ??
      '';
    const visitorType =
      req.body.visitorType ??
      req.body.visitor_type ??
      '';
    const visitorSource =
      req.body.visitorSource ??
      req.body.source ??
      'zoho';
    const jobTitle =
      req.body.jobTitle ??
      req.body.job_title ??
      '';
    const country =
      req.body.country ??
      '';
    const phone =
      req.body.phone ??
      '';
    const website =
      req.body.website ??
      '';
    const origin =
      req.body.origin ??
      '';

    console.log('📥 Incoming Zoho webhook:', req.body);

    // Expo adı için bilgi çek
    const expoResult = await pool.query(`SELECT name FROM expos WHERE id = $1 AND organizer_id = $2`, [expo_id, organizer_id]);
    if (expoResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Expo not found' });
    }
    const expo_name = expoResult.rows[0].name;

    const badge_id = badgeNumber || `BADGE-${Date.now()}`;
    const qr_code = uuidv4();
    const badge_url = generateBadgeUrl(qr_code);

    const insertQuery = `
      INSERT INTO visitors (
        name, last_name, email, company, badge_id, expo_name,
        sector, visitor_category, visitor_status, visitor_type,
        job_title, country, phone, website,
        source, origin, form_id,
        qr_code, badge_url, expo_id, organizer_id, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,$21,NOW()
      )
      RETURNING *
    `;

    const values = [
      name || 'No Name',
      lastName || '',
      email,
      company,
      badge_id,
      expo_name,
      sector,
      visitorCategory,
      visitorStatus,
      visitorType || 'visitor',
      jobTitle,
      country,
      phone,
      website,
      visitorSource,
      origin || 'zohoform',
      form_id,
      qr_code,
      badge_url,
      expo_id,
      organizer_id
    ];

    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];

    // ✉️ Email gönderimi
    if (form_id && email) {
      const templateResult = await pool.query(`
        SELECT et.subject, et.html_content
        FROM forms f
        JOIN email_templates et ON et.id = f.email_template_id
        WHERE f.id = $1 AND f.organizer_id = $2
      `, [form_id, organizer_id]);

      if (templateResult.rows.length > 0) {
        const { subject, html_content } = templateResult.rows[0];

        const emailData = {
          name,
          last_name: lastName,
          company,
          email,
          badge_id,
          expo_name,
          qr_code: `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${qr_code}" alt="QR Code" style="max-width:200px;">`,
          badge_url: badge_url
        };

        const html = processEmailTemplate(html_content, emailData);
        const subjectLine = processEmailTemplate(subject || 'Your Badge', emailData);

        await sendEmailWithReplyTo(email, subjectLine, html, 'reply@replies.leena.app');
        console.log('📧 Email sent to:', email);
      } else {
        console.log('ℹ️ No template found for form', form_id);
      }
    }

    res.status(200).json({ success: true, message: 'Visitor saved from Zoho' });

  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
