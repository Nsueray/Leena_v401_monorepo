const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate } = require('../utils/email');

const ZOHO_TOKEN = '98uy237fbiweuhr8h23g9rg239';

// ✅ POST /api/webhook/zoho/:organizer_id/:expo_id/:form_id
// With duplicate email handling (upsert logic)
router.post('/zoho/:organizer_id/:expo_id/:form_id', async (req, res) => {
  try {
    const token = req.headers['x-webhook-token'];
    if (token !== ZOHO_TOKEN) {
      return res.status(403).json({ success: false, message: 'Invalid token' });
    }

    const { organizer_id, expo_id, form_id } = req.params;

    const name = req.body.name ?? '';
    const lastName = req.body.lastName ?? req.body.last_name ?? '';
    const email = req.body.email;
    const company = req.body.company ?? '';
    const badgeNumber = req.body.badgeNumber ?? req.body.badge_id ?? '';
    const sector = req.body.sector ?? '';
    const visitorCategory = req.body.visitorCategory ?? req.body.visitor_category ?? '';
    const visitorStatus = req.body.visitorStatus ?? req.body.visitor_status ?? '';
    const visitorType = req.body.visitorType ?? req.body.visitor_type ?? '';
    const visitorSource = req.body.visitorSource ?? req.body.source ?? 'zoho';
    const jobTitle = req.body.jobTitle ?? req.body.job_title ?? '';
    const country = req.body.country ?? '';
    const phone = req.body.phone ?? '';
    const website = req.body.website ?? '';
    const origin = req.body.origin ?? '';

    console.log('📥 Incoming Zoho webhook:', req.body);

    // Validate email
    if (!email || email.trim() === '') {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Get expo info
    const expoResult = await pool.query(
      `SELECT name FROM expos WHERE id = $1 AND organizer_id = $2`,
      [expo_id, organizer_id]
    );
    if (expoResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Expo not found' });
    }
    const expo_name = expoResult.rows[0].name;

    // 🔍 Check for existing visitor with same email in this expo
    const existingResult = await pool.query(
      `SELECT id, qr_code, badge_id, badge_url, name, email
       FROM visitors 
       WHERE lower(email) = lower($1) 
         AND expo_id = $2 
         AND organizer_id = $3
       LIMIT 1`,
      [email.trim(), expo_id, organizer_id]
    );

    let visitor;
    let isNewVisitor = false;

    if (existingResult.rows.length > 0) {
      // ✅ Existing visitor found - UPDATE with new data
      const existingId = existingResult.rows[0].id;
      console.log('ℹ️ Existing visitor found:', email, '- updating with new data');
      
      // Update existing record with new information
      const updateResult = await pool.query(
        `UPDATE visitors SET
           name = $1,
           last_name = $2,
           company = $3,
           phone = $4,
           job_title = $5,
           country = $6,
           sector = $7,
           website = $8,
           visitor_category = $9,
           visitor_status = $10,
           visitor_type = $11,
           badge_id = CASE WHEN $12 != '' THEN $12 ELSE badge_id END
         WHERE id = $13
         RETURNING *`,
        [
          name || 'No Name',
          lastName || '',
          company,
          phone,
          jobTitle,
          country,
          sector,
          website,
          visitorCategory,
          visitorStatus,
          visitorType || 'visitor',
          badgeNumber,
          existingId
        ]
      );
      visitor = updateResult.rows[0];
      console.log('✅ Existing visitor updated:', visitor.email);
    } else {
      // ✅ New visitor - create record
      isNewVisitor = true;
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
        email.trim(),
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
      visitor = result.rows[0];
      console.log('✅ New visitor created:', visitor.email);
    }

    // ✉️ Send email only for NEW visitors
    if (isNewVisitor && form_id && email) {
      const templateResult = await pool.query(`
        SELECT et.subject, et.html_content
        FROM forms f
        JOIN email_templates et ON et.id = f.email_template_id
        WHERE f.id = $1 AND f.organizer_id = $2
      `, [form_id, organizer_id]);

      if (templateResult.rows.length > 0) {
        const { subject, html_content } = templateResult.rows[0];

        const emailData = {
          name: visitor.name || name,
          last_name: visitor.last_name || lastName,
          company: visitor.company || company,
          email: visitor.email,
          badge_id: visitor.badge_id,
          expo_name,
          qr_code: `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${visitor.qr_code}" alt="QR Code" style="max-width:200px;">`,
          badge_url: visitor.badge_url
        };

        const html = processEmailTemplate(html_content, emailData);
        const subjectLine = processEmailTemplate(subject || 'Your Badge', emailData);

        await sendEmailWithReplyTo(email, subjectLine, html, 'reply@replies.leena.app');
        console.log('📧 Email sent to:', email, '(reply-to: reply@replies.leena.app)');
      } else {
        console.log('ℹ️ No template found for form', form_id);
      }
    } else if (!isNewVisitor) {
      console.log('ℹ️ Skipping email - existing visitor');
    }

    res.status(200).json({ 
      success: true, 
      message: isNewVisitor ? 'Visitor saved from Zoho' : 'Existing visitor returned',
      isNewVisitor: isNewVisitor,
      visitorId: visitor.id
    });

  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
