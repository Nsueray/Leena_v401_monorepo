const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate } = require('../utils/email');

const ZOHO_TOKEN = process.env.ZOHO_WEBHOOK_TOKEN || '98uy237fbiweuhr8h23g9rg239';

// ✅ POST /api/webhook/zoho/:organizer_id/:expo_id/:form_id
// With duplicate email handling (upsert logic) + resend email for existing visitors
router.post('/zoho/:organizer_id/:expo_id/:form_id', async (req, res) => {
  try {
    const token = req.headers['x-webhook-token'];
    if (token !== ZOHO_TOKEN) {
      console.log('❌ [WEBHOOK] Invalid token received - rejecting request');
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

    // Extract custom fields: everything in req.body that is NOT a known field
    const knownFields = new Set([
      'name', 'lastName', 'last_name', 'email', 'company',
      'badgeNumber', 'badge_id', 'sector', 'visitorCategory', 'visitor_category',
      'visitorStatus', 'visitor_status', 'visitorType', 'visitor_type',
      'visitorSource', 'source', 'jobTitle', 'job_title',
      'country', 'phone', 'website', 'origin'
    ]);
    const customFields = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (!knownFields.has(key) && value !== null && value !== undefined && value !== '') {
        customFields[key] = value;
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📥 [WEBHOOK] Incoming Zoho Form Submission');
    console.log(`   📧 Email: ${email}`);
    console.log(`   👤 Name: ${name} ${lastName}`);
    console.log(`   🏢 Company: ${company}`);
    console.log(`   🌍 Country: ${country}`);
    console.log(`   💼 Job Title: ${jobTitle}`);
    console.log(`   📱 Phone: ${phone}`);
    console.log(`   🎯 Expo ID: ${expo_id} | Form ID: ${form_id}`);
    if (Object.keys(customFields).length > 0) {
      console.log(`   📋 Custom Fields: ${JSON.stringify(customFields)}`);
    }
    console.log('═══════════════════════════════════════════════════════════');

    // Validate email
    if (!email || email.trim() === '') {
      console.log('❌ [WEBHOOK] Rejected - No email provided');
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Get expo info
    const expoResult = await pool.query(
      `SELECT name FROM expos WHERE id = $1 AND organizer_id = $2`,
      [expo_id, organizer_id]
    );
    if (expoResult.rows.length === 0) {
      console.log(`❌ [WEBHOOK] Rejected - Expo ${expo_id} not found for organizer ${organizer_id}`);
      return res.status(400).json({ success: false, message: 'Expo not found' });
    }
    const expo_name = expoResult.rows[0].name;
    console.log(`✓ [WEBHOOK] Expo found: "${expo_name}"`);

    // Get visitor_type from form (authoritative source) if not provided by Zoho
    let resolvedVisitorType = visitorType;
    if (!resolvedVisitorType && form_id) {
      const formResult = await pool.query(
        `SELECT visitor_type FROM forms WHERE id = $1`,
        [form_id]
      );
      if (formResult.rows.length > 0 && formResult.rows[0].visitor_type) {
        resolvedVisitorType = formResult.rows[0].visitor_type;
        console.log(`✓ [WEBHOOK] visitor_type from form: "${resolvedVisitorType}"`);
      }
    }

    // 🔍 Check for existing visitor with same email in this expo
    const existingResult = await pool.query(
      `SELECT id, qr_code, badge_id, badge_url, name, last_name, email, company,
              custom_fields->>'conference_topic' as existing_conference_topic
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
      // ✅ Existing visitor found - UPDATE with new data but KEEP existing QR code
      const existingVisitor = existingResult.rows[0];
      console.log('');
      console.log('🔄 [WEBHOOK] EXISTING VISITOR DETECTED');
      console.log(`   📋 Existing Record ID: ${existingVisitor.id}`);
      console.log(`   📧 Email: ${existingVisitor.email}`);
      console.log(`   👤 Previous Name: ${existingVisitor.name} ${existingVisitor.last_name || ''}`);
      console.log(`   🏢 Previous Company: ${existingVisitor.company}`);
      console.log(`   🔑 Existing QR Code: ${existingVisitor.qr_code}`);
      console.log(`   🎫 Existing Badge ID: ${existingVisitor.badge_id}`);
      console.log('   ➡️  Updating info but KEEPING existing QR code...');
      
      // Merge conference_topic: append new topic if not already present (separator: " || ")
      // NOTE: comma is NOT a separator — topic names contain commas (e.g. "Engineering for a Healthy Buildings, Designing for Life")
      if (customFields.conference_topic && existingVisitor.existing_conference_topic) {
        const existingTopics = existingVisitor.existing_conference_topic.split(' || ').map(t => t.trim().toLowerCase()).filter(Boolean);
        const newTopic = String(customFields.conference_topic).trim();
        if (newTopic && !existingTopics.includes(newTopic.toLowerCase())) {
          customFields.conference_topic = `${existingVisitor.existing_conference_topic} || ${newTopic}`;
          console.log(`✓ [WEBHOOK] conference_topic merged: "${customFields.conference_topic}"`);
        } else {
          customFields.conference_topic = existingVisitor.existing_conference_topic;
          console.log(`✓ [WEBHOOK] conference_topic unchanged (already registered): "${customFields.conference_topic}"`);
        }
      }

      // Update existing record with new information (keep QR code!)
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
           badge_id = CASE WHEN $12 != '' THEN $12 ELSE badge_id END,
           custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $13::jsonb,
           updated_at = NOW()
         WHERE id = $14
         RETURNING *`,
        [
          name || existingVisitor.name || 'No Name',
          lastName || existingVisitor.last_name || '',
          company || existingVisitor.company || '',
          phone,
          jobTitle,
          country,
          sector,
          website,
          visitorCategory,
          visitorStatus,
          resolvedVisitorType || 'visitor',
          badgeNumber,
          JSON.stringify(customFields),
          existingVisitor.id
        ]
      );
      visitor = updateResult.rows[0];
      console.log(`✅ [WEBHOOK] Existing visitor UPDATED: ${visitor.email}`);
      console.log(`   👤 New Name: ${visitor.name} ${visitor.last_name || ''}`);
      console.log(`   🏢 New Company: ${visitor.company}`);
      
    } else {
      // ✅ New visitor - create record with new QR code
      isNewVisitor = true;
      const badge_id = badgeNumber || `BADGE-${Date.now()}`;
      const qr_code = uuidv4();
      const badge_url = generateBadgeUrl(qr_code);

      console.log('');
      console.log('🆕 [WEBHOOK] NEW VISITOR - Creating record...');
      console.log(`   🔑 Generated QR Code: ${qr_code}`);
      console.log(`   🎫 Generated Badge ID: ${badge_id}`);

      const insertQuery = `
        INSERT INTO visitors (
          name, last_name, email, company, badge_id, expo_name,
          sector, visitor_category, visitor_status, visitor_type,
          job_title, country, phone, website,
          source, origin, form_id,
          qr_code, badge_url, expo_id, organizer_id, custom_fields, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,
          $11,$12,$13,$14,
          $15,$16,$17,
          $18,$19,$20,$21,$22,NOW()
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
        resolvedVisitorType || 'visitor',
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
        organizer_id,
        JSON.stringify(customFields)
      ];

      const result = await pool.query(insertQuery, values);
      visitor = result.rows[0];
      console.log(`✅ [WEBHOOK] New visitor CREATED: ${visitor.email} (ID: ${visitor.id})`);
    }

    // ✉️ Send email for BOTH new and existing visitors
    if (form_id && email) {
      const templateResult = await pool.query(`
        SELECT et.id as template_id, et.subject, et.html_content
        FROM forms f
        JOIN email_templates et ON et.id = f.email_template_id
        WHERE f.id = $1 AND f.organizer_id = $2
      `, [form_id, organizer_id]);

      if (templateResult.rows.length > 0) {
        const { template_id: emailTplId, subject, html_content } = templateResult.rows[0];

        // ========== EMAIL QUEUE MIGRATION (was: direct SendGrid) ==========
        // OLD CODE (kept for rollback):
        // const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
        // const qrImageTag = `<img src="${baseUrl}/api/qr-image/${visitor.qr_code}" alt="QR Code" style="max-width:200px;">`;
        // const emailData = {
        //   ...customFields,
        //   name: visitor.name || name, last_name: visitor.last_name || lastName,
        //   company: visitor.company || company, email: visitor.email,
        //   badge_id: visitor.badge_id, expo_name,
        //   qr_code: qrImageTag, badge_url: visitor.badge_url,
        //   date: new Date().toLocaleDateString()
        // };
        // let emailSubject = subject || 'Your Badge';
        // if (!isNewVisitor) {
        //   if (!emailSubject.toLowerCase().includes('reminder') &&
        //       !emailSubject.toLowerCase().includes('again') &&
        //       !emailSubject.toLowerCase().includes('resend')) {
        //     emailSubject = `${emailSubject} (Resent)`;
        //   }
        // }
        // const html = processEmailTemplate(html_content, emailData);
        // const subjectLine = processEmailTemplate(emailSubject, emailData);
        // await sendEmailWithReplyTo(email, subjectLine, html, 'reply@replies.leena.app');

        // NEW CODE: email_queue Mode 2 (email_worker processes template + custom_fields)
        try {
          await pool.query(`
            INSERT INTO email_queue (visitor_id, template_id, expo_id, organizer_id, status, created_at)
            VALUES ($1, $2, $3, $4, 'pending', NOW())
          `, [visitor.id, emailTplId, expo_id, organizer_id]);

          console.log('');
          console.log('📧 [WEBHOOK] Email queued successfully');
          console.log(`   📬 To: ${email}`);
          console.log(`   📝 Template: ${emailTplId}`);
          console.log(`   🔑 QR Code: ${visitor.qr_code}`);
          console.log(`   📨 Type: ${isNewVisitor ? 'NEW REGISTRATION' : 'RESEND (existing visitor)'}`);
        } catch (queueErr) {
          console.error('📧 [WEBHOOK] Email queue failed:', queueErr.message);
        }
        // ========== END EMAIL QUEUE MIGRATION ==========

      } else {
        console.log(`⚠️ [WEBHOOK] No email template found for form ${form_id} - skipping email`);
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`✅ [WEBHOOK] COMPLETED - ${isNewVisitor ? 'NEW VISITOR' : 'EXISTING VISITOR UPDATED'}`);
    console.log(`   🆔 Visitor ID: ${visitor.id}`);
    console.log(`   📧 Email: ${visitor.email}`);
    console.log(`   🎫 Badge ID: ${visitor.badge_id}`);
    console.log(`   🔑 QR Code: ${visitor.qr_code}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    res.status(200).json({ 
      success: true, 
      message: isNewVisitor ? 'New visitor registered' : 'Existing visitor updated and QR code resent',
      isNewVisitor: isNewVisitor,
      visitorId: visitor.id,
      badgeId: visitor.badge_id,
      qrCode: visitor.qr_code
    });

  } catch (err) {
    console.error('');
    console.error('❌❌❌ [WEBHOOK] ERROR ❌❌❌');
    console.error(`   Message: ${err.message}`);
    console.error(`   Stack: ${err.stack}`);
    console.error('');
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
