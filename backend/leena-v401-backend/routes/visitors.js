const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate, formatConferenceTopic } = require('../utils/email');
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
      filters.push(`source ILIKE $${idx}`);
      values.push(`%${req.query.source}%`);
      idx++;
    }

    if (req.query.origin) {
      const originList = req.query.origin.split(',');
      filters.push(`origin = ANY($${idx})`);
      values.push(originList);
      idx++;
    }

    if (req.query.visitor_type) {
      const typeList = req.query.visitor_type.split(',');
      filters.push(`visitor_type = ANY($${idx})`);
      values.push(typeList);
      idx++;
    }

    if (req.query.conference_topic) {
      // Support " || "-separated multi-topic values: use ILIKE to match substring
      filters.push(`custom_fields->>'conference_topic' ILIKE $${idx}`);
      values.push(`%${req.query.conference_topic}%`);
      idx++;
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataResult = await pool.query(
      `
      SELECT id, name, last_name, company, country, email, source, origin, visitor_type,
             booth_number, phone, job_title, created_at, qr_code, badge_id,
             custom_fields->>'conference_topic' as conference_topic
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

// ✅ Get distinct source values for filter dropdown
router.get('/sources', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });

    const result = await pool.query(
      `SELECT DISTINCT source FROM visitors
       WHERE expo_id = $1 AND organizer_id = $2 AND source IS NOT NULL AND source != ''
       ORDER BY source ASC`,
      [expo_id, req.organizer_id]
    );

    res.json({ sources: result.rows.map(r => r.source) });
  } catch (err) {
    console.error('❌ Sources fetch error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ Get visitor by QR code (PII restricted — no email/phone exposed)
router.get('/badge/:qr_code', async (req, res) => {
  try {
    const qrCode = req.params.qr_code;
    const result = await pool.query(
      `SELECT id, name, last_name, company, country, job_title, visitor_type,
              badge_id, qr_code, booth_number, badge_url, expo_id
       FROM visitors WHERE qr_code = $1 LIMIT 1`,
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

// ✅ UPDATE VISITOR (admin edit — qr_code/badge_id never change)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, last_name, email, company, job_title, phone, country, visitor_type, booth_number, conference_topic } = req.body;

    // Email duplicate check (if email is being changed)
    if (email && email.trim()) {
      const dupCheck = await pool.query(
        `SELECT id FROM visitors
         WHERE lower(email) = lower($1)
           AND expo_id = (SELECT expo_id FROM visitors WHERE id = $2)
           AND id != $2
         LIMIT 1`,
        [email.trim(), id]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Another visitor with this email already exists in this expo' });
      }
    }

    const result = await pool.query(
      `UPDATE visitors SET
        name = COALESCE(NULLIF($1, ''), name),
        last_name = COALESCE(NULLIF($2, ''), last_name),
        email = COALESCE(NULLIF($3, ''), email),
        company = COALESCE(NULLIF($4, ''), company),
        job_title = COALESCE(NULLIF($5, ''), job_title),
        phone = COALESCE(NULLIF($6, ''), phone),
        country = COALESCE(NULLIF($7, ''), country),
        visitor_type = COALESCE(NULLIF($8, ''), visitor_type),
        booth_number = COALESCE(NULLIF($9, ''), booth_number),
        custom_fields = jsonb_set(
          COALESCE(custom_fields, '{}'::jsonb),
          '{conference_topic}',
          to_jsonb(COALESCE(NULLIF($10, ''), custom_fields->>'conference_topic', ''))
        ),
        updated_at = NOW()
      WHERE id = $11 AND organizer_id = $12
      RETURNING id, name, last_name, email, company, job_title, phone, country,
                visitor_type, booth_number, qr_code, badge_id, source, created_at,
                custom_fields->>'conference_topic' as conference_topic`,
      [name || '', last_name || '', email || '', company || '', job_title || '',
       phone || '', country || '', visitor_type || '', booth_number || '',
       conference_topic || '', id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }

    res.json({ success: true, visitor: result.rows[0] });
  } catch (err) {
    console.error('❌ Visitor update error:', err);
    res.status(500).json({ success: false, message: 'Update failed' });
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
    let formVisitorType = 'visitor';
    let expoName = '';

    if (form_id) {
      const formResult = await pool.query(
        `SELECT email_template_id, organizer_id, visitor_type FROM forms WHERE id = $1`,
        [form_id]
      );
      if (formResult.rows.length) {
        emailTemplateId = formResult.rows[0].email_template_id;
        organizerId = formResult.rows[0].organizer_id;
        formVisitorType = formResult.rows[0].visitor_type || 'visitor';
      }
    }

    if (expo_id) {
      const expoResult = await pool.query(`SELECT name FROM expos WHERE id = $1`, [expo_id]);
      if (expoResult.rows.length) expoName = expoResult.rows[0].name;
    }

    // Check for existing visitor with same email in this expo
    const existingResult = await pool.query(
      `SELECT id, qr_code, badge_id, badge_url,
              custom_fields->>'conference_topic' as existing_conference_topic
       FROM visitors
       WHERE lower(email) = lower($1) AND expo_id = $2
       LIMIT 1`,
      [visitorData.email.trim(), expo_id]
    );

    let visitor;
    let qrCode, badgeId, badgeUrl;
    let isExisting = false;

    if (existingResult.rows.length > 0) {
      // Existing visitor — update info, keep QR code
      isExisting = true;
      const ex = existingResult.rows[0];
      qrCode = ex.qr_code;
      badgeId = ex.badge_id;
      badgeUrl = ex.badge_url;

      // Merge conference_topic: append new topic if not already present (separator: " || ")
      // NOTE: comma is NOT a separator — topic names contain commas
      if (custom_fields?.conference_topic && ex.existing_conference_topic) {
        const existingTopics = ex.existing_conference_topic.split(' || ').map(t => t.trim().toLowerCase()).filter(Boolean);
        const newTopic = String(custom_fields.conference_topic).trim();
        if (newTopic && !existingTopics.includes(newTopic.toLowerCase())) {
          custom_fields.conference_topic = `${ex.existing_conference_topic} || ${newTopic}`;
        } else {
          custom_fields.conference_topic = ex.existing_conference_topic;
        }
        visitorData.custom_fields = JSON.stringify(custom_fields);
        console.log(`[PUBLIC FORM] conference_topic merged: "${custom_fields.conference_topic}"`);
      }

      const updateResult = await pool.query(
        `UPDATE visitors SET
          name = COALESCE(NULLIF($1, ''), name),
          last_name = COALESCE(NULLIF($2, ''), last_name),
          company = COALESCE(NULLIF($3, ''), company),
          country = COALESCE(NULLIF($4, ''), country),
          job_title = COALESCE(NULLIF($5, ''), job_title),
          phone = COALESCE(NULLIF($6, ''), phone),
          custom_fields = COALESCE($7::jsonb, custom_fields),
          visitor_type = COALESCE(NULLIF($8, ''), visitor_type),
          updated_at = NOW()
        WHERE id = $9
        RETURNING *`,
        [
          visitorData.name,
          visitorData.last_name,
          visitorData.company,
          visitorData.country,
          visitorData.job_title,
          visitorData.phone,
          visitorData.custom_fields,
          formVisitorType,
          ex.id
        ]
      );
      visitor = updateResult.rows[0];
      console.log(`🔄 [PUBLIC FORM] Updated existing visitor: ${visitorData.email} (ID: ${ex.id})`);

    } else {
      // New visitor — create with new QR
      qrCode = uuidv4();
      badgeId = qrCode.substring(0, 8).toUpperCase();
      badgeUrl = generateBadgeUrl(qrCode);

      const insertQuery = `
        INSERT INTO visitors (
          name, last_name, email, company, country, job_title, phone,
          source, origin, expo_id, organizer_id,
          qr_code, badge_id, badge_url, custom_fields,
          visitor_type, form_id, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()
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
        visitorData.custom_fields,
        formVisitorType,
        form_id || null
      ];

      const result = await pool.query(insertQuery, values);
      visitor = result.rows[0];
    }

    // ========== EMAIL QUEUE MIGRATION (was: direct SendGrid) ==========
    // Send email for both new and existing visitors
    let emailSent = false;
    if (emailTemplateId) {
      try {
        const templateResult = await pool.query(
          `SELECT * FROM email_templates WHERE id = $1`,
          [emailTemplateId]
        );

        if (templateResult.rows.length) {
          const template = templateResult.rows[0];

          // Generate QR code image tag for email (uses existing QR for returning visitors)
          const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
          const qrImageTag = `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width:200px;">`;

          // Build email data with QR image
          // Spread custom_fields as top-level keys so {{conference_topic}} etc. work in templates
          const cfSpread = { ...(custom_fields || {}) };
          if (cfSpread.conference_topic) {
            cfSpread.conference_topic = formatConferenceTopic(cfSpread.conference_topic);
          }
          const emailData = {
            ...visitorData,
            ...cfSpread,
            qr_code: qrImageTag,
            badge_id: badgeId,
            badge_url: badgeUrl,
            expo_name: expoName,
            date: new Date().toLocaleDateString()
          };

          const emailHtml = processEmailTemplate(template.html_content || template.content, emailData);
          let emailSubject = processEmailTemplate(template.subject || 'Registration Confirmation', emailData);
          if (isExisting) {
            emailSubject = `${emailSubject} (Resent)`;
          }

          // OLD CODE (kept for rollback):
          // await sendEmailWithReplyTo(
          //   visitorData.email,
          //   emailSubject,
          //   emailHtml,
          //   'reply@replies.leena.app'
          // );

          // NEW CODE: email_queue Mode 1 (pre-processed HTML, preserves Resent logic + custom_fields)
          await pool.query(`
            INSERT INTO email_queue (recipient_email, subject, html_content, status, created_at)
            VALUES ($1, $2, $3, 'pending', NOW())
          `, [visitorData.email, emailSubject, emailHtml]);

          emailSent = true;

          // Log to email_logs for history tracking
          try {
            await pool.query(`
              INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            `, [organizerId, expo_id, visitor.id, emailTemplateId, visitorData.email, 'queued', `Subject: ${emailSubject} | To: ${visitorData.email}`]);
          } catch (logErr) {
            console.error('email_logs INSERT failed:', logErr.message);
          }
        }
      } catch (emailErr) {
        console.error('⚠️ [PUBLIC FORM] Email queue failed but visitor saved:', emailErr.message);
      }
    }
    // ========== END EMAIL QUEUE MIGRATION ==========

    // Campaign registration tracking: if _lc token present, log 'registered' event
    try {
      const lcToken = req.body._lc;
      if (lcToken) {
        const { verifyUnsubscribeToken } = require('../utils/trackingPixel');
        const parsed = verifyUnsubscribeToken(lcToken);
        if (parsed) {
          await pool.query(
            `INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata)
             VALUES ($1, $2, $3, 'registered', $4)`,
            [parsed.campaignId, parsed.recipientId, parsed.email,
             JSON.stringify({ form_id: form_id, visitor_id: visitor?.id, via: 'public_form_submission' })]
          );
          console.log(`[TRACKING] Registration recorded: campaign=${parsed.campaignId}, email=${parsed.email}`);
        }
      }
    } catch (trackErr) {
      console.warn(`[TRACKING] Registration tracking failed (non-fatal): ${trackErr.message}`);
    }

    res.json({
      success: true,
      message: isExisting
        ? 'You are already registered. Your information has been updated and a confirmation email has been resent.'
        : (emailSent ? 'Registration successful' : 'Registration successful (email will be sent shortly)'),
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

// ✅ MANUAL REGISTRATION (authMiddleware added — Sprint 1 security fix)
router.post('/manual', authMiddleware, async (req, res) => {
  try {
    const { name, last_name, email, company, job_title, country, expo_id, organizer_id, visitor_type, origin, source } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check for existing visitor with same email in this expo
    const existing = await pool.query(
      'SELECT id, qr_code, badge_id FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1',
      [email.toLowerCase().trim(), expo_id]
    );

    if (existing.rows.length > 0) {
      // Update existing visitor, keep QR code
      const ex = existing.rows[0];
      await pool.query(
        `UPDATE visitors SET
          name = COALESCE(NULLIF($1, ''), name),
          last_name = COALESCE(NULLIF($2, ''), last_name),
          company = COALESCE(NULLIF($3, ''), company),
          job_title = COALESCE(NULLIF($4, ''), job_title),
          country = COALESCE(NULLIF($5, ''), country),
          visitor_type = COALESCE(NULLIF($7, ''), visitor_type),
          updated_at = NOW()
        WHERE id = $6`,
        [name || '', last_name || '', company || '', job_title || '', country || '', ex.id, visitor_type || '']
      );
      console.log('🔄 [MANUAL] Updated existing visitor:', email, 'ID:', ex.id);
      return res.json({
        success: true,
        qr_code: ex.qr_code,
        badge_id: ex.badge_id,
        visitor_id: ex.id
      });
    }

    // New visitor - create with QR
    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    const result = await pool.query(
      `INSERT INTO visitors (name, last_name, email, company, job_title, country,
        expo_id, organizer_id, visitor_type, origin, source,
        qr_code, badge_id, badge_url, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING id, qr_code, badge_id`,
      [name || '', last_name || '', email, company || '',
       job_title || '', country || '',
       expo_id || null, organizer_id || null,
       visitor_type || 'visitor', origin || 'onsite', source || 'manual',
       qrCode, badgeId, badgeUrl]
    );

    const visitor = result.rows[0];

    res.json({
      success: true,
      qr_code: visitor.qr_code,
      badge_id: visitor.badge_id,
      visitor_id: visitor.id
    });

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

    const { expo_id, visitor_type, source_override, send_email, template_id,
            existing_email_option, existing_qr_option, existing_template_id, skip_existing } = req.body;
    const origin = 'massimport';
    const effectiveExistingEmailOption = existing_email_option || 'none';
    const effectiveExistingQrOption = existing_qr_option || 'keep';

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    // Get organizer_id from token (authMiddleware sets req.organizer_id)
    const organizerId = req.organizer_id || 1;

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    console.log(`📊 Parsed ${rows.length} rows from Excel`);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel file is empty' });
    }

    // Fetch expo name once (used in email templates)
    let expoName = '';
    if (expo_id) {
      const expoResult = await pool.query(`SELECT name FROM expos WHERE id = $1`, [expo_id]);
      if (expoResult.rows.length) expoName = expoResult.rows[0].name;
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

    // Get email template for existing visitors if needed
    let existingEmailTemplate = null;
    if (effectiveExistingEmailOption !== 'none') {
      const eid = existing_template_id;
      if (eid) {
        const tRes = await pool.query(`SELECT * FROM email_templates WHERE id = $1`, [eid]);
        if (tRes.rows.length) existingEmailTemplate = tRes.rows[0];
      }
    }

    // Known Excel columns — anything NOT in this set becomes a custom field
    const knownColumns = new Set([
      'name', 'Name', 'first_name', 'First Name', 'full_name', 'Full Name',
      'last_name', 'Last Name', 'surname', 'Surname', 'lastname',
      'email', 'Email', 'EMAIL', 'e_mail',
      'company', 'Company', 'COMPANY', 'organization', 'Organisation',
      'country', 'Country', 'COUNTRY',
      'phone', 'Phone', 'PHONE', 'mobile', 'Mobile', 'tel',
      'job_title', 'Job Title', 'title', 'Title', 'position', 'Position',
      'website', 'Website', 'web', 'url',
      'visitor_type', 'Visitor Type', 'type',
      'visitor_category', 'Visitor Category', 'category',
      'sector', 'Sector', 'industry', 'Industry',
      'source', 'Source',
      'booth_number', 'Booth Number', 'booth', 'Booth'
    ]);

    // Process each row
    const results = {
      success_count: 0,
      new_count: 0,
      updated_count: 0,
      skipped_count: 0,
      failed_count: 0,
      email_sent_count: 0,
      qr_regenerated_count: 0,
      custom_fields_updated_count: 0,
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

        // Extract custom fields: columns NOT in the known set
        const customFields = {};
        for (const [key, value] of Object.entries(row)) {
          if (!knownColumns.has(key) && value !== null && value !== undefined && value !== '') {
            customFields[key] = String(value).trim();
          }
        }

        // Validate email
        if (!email || !email.includes('@')) {
          results.errors.push({ row: rowNum, message: `Invalid or missing email: "${email}"` });
          results.failed_count++;
          continue;
        }

        // Check for duplicate email in this expo - UPDATE if exists, keep QR
        const duplicateCheck = await pool.query(
          `SELECT id, qr_code, badge_id FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1`,
          [email.toLowerCase().trim(), expo_id]
        );

        if (duplicateCheck.rows.length > 0) {
          // Skip entirely if requested
          if (skip_existing === 'true' || skip_existing === true) {
            results.skipped_count++;
            console.log(`⏭️ Skipped existing visitor: ${email}`);
            continue;
          }

          const existing = duplicateCheck.rows[0];
          let currentQrCode = existing.qr_code;
          let currentBadgeId = existing.badge_id;

          // QR regeneration if requested
          if (effectiveExistingQrOption === 'regenerate') {
            currentQrCode = uuidv4();
            currentBadgeId = currentQrCode.substring(0, 8).toUpperCase();
            results.qr_regenerated_count++;
          }

          // Build custom_fields merge value
          const hasCustomFields = Object.keys(customFields).length > 0;
          const mergedCustomFields = hasCustomFields
            ? JSON.stringify(customFields) : null;
          if (hasCustomFields) results.custom_fields_updated_count++;

          // Update existing visitor — COALESCE keeps old values when new is empty
          await pool.query(
            `UPDATE visitors SET
              name = COALESCE(NULLIF($1, ''), name),
              last_name = COALESCE(NULLIF($2, ''), last_name),
              company = COALESCE(NULLIF($3, ''), company),
              country = COALESCE(NULLIF($4, ''), country),
              job_title = COALESCE(NULLIF($5, ''), job_title),
              phone = COALESCE(NULLIF($6, ''), phone),
              visitor_type = COALESCE(NULLIF($7, ''), visitor_type),
              sector = COALESCE(NULLIF($8, ''), sector),
              booth_number = COALESCE(NULLIF($9, ''), booth_number),
              custom_fields = CASE
                WHEN $10::jsonb IS NOT NULL
                THEN COALESCE(custom_fields, '{}'::jsonb) || $10::jsonb
                ELSE custom_fields
              END,
              qr_code = $11,
              badge_id = $12,
              updated_at = NOW()
            WHERE id = $13`,
            [name.trim(), last_name.trim(), company.trim(), country.trim(),
             job_title.trim(), phone.trim(), visitor_type_val, sector.trim(),
             (row.booth_number || row['Booth Number'] || row.booth || row.Booth || '').toString().trim(),
             mergedCustomFields,
             currentQrCode,
             currentBadgeId,
             existing.id]
          );

          results.imported.push({
            id: existing.id,
            name: name || last_name || email,
            email: email,
            qr_code: currentQrCode,
            badge_id: currentBadgeId
          });
          results.success_count++;
          results.updated_count++;
          console.log(`🔄 Updated existing visitor: ${email} (ID: ${existing.id})${effectiveExistingQrOption === 'regenerate' ? ' [NEW QR]' : ''}`);

          // ========== EMAIL QUEUE MIGRATION (was: direct SendGrid) ==========
          // Email for existing visitors (if option selected)
          if (effectiveExistingEmailOption !== 'none' && existingEmailTemplate) {
            try {
              const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
              const qrImageTag = `<img src="${baseUrl}/api/qr-image/${currentQrCode}" alt="QR Code" style="max-width:200px;">`;
              const currentBadgeUrl = generateBadgeUrl(currentQrCode);

              const templateData = {
                ...customFields,
                name: name || 'Guest',
                last_name, email, company, country, job_title, phone,
                qr_code: qrImageTag,
                badge_id: currentBadgeId,
                badge_url: currentBadgeUrl,
                expo_name: expoName,
                date: new Date().toLocaleDateString()
              };

              const emailHtml = processEmailTemplate(
                existingEmailTemplate.html_content || existingEmailTemplate.body || '',
                templateData
              );
              let emailSubject = processEmailTemplate(
                existingEmailTemplate.subject || 'Registration Confirmation',
                templateData
              );
              if (effectiveExistingEmailOption === 'resent') {
                emailSubject = `${emailSubject} (Resent)`;
              }

              // OLD CODE (kept for rollback):
              // await sendEmailWithReplyTo(email, emailSubject, emailHtml, 'reply@replies.leena.app');
              // await delay(100);

              // NEW CODE: email_queue Mode 1 (pre-processed HTML)
              await pool.query(`
                INSERT INTO email_queue (recipient_email, subject, html_content, status, created_at)
                VALUES ($1, $2, $3, 'pending', NOW())
              `, [email, emailSubject, emailHtml]);

              results.email_sent_count++;
              console.log(`📧 Email queued for existing visitor: ${email}`);

              // Log to email_logs for history tracking
              try {
                await pool.query(`
                  INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                `, [organizerId, expo_id, existing.id, existing_template_id, email, 'queued', `Subject: ${emailSubject} | To: ${email}`]);
              } catch (logErr) {
                console.error('email_logs INSERT failed:', logErr.message);
              }
            } catch (emailErr) {
              console.error(`❌ Email queue failed for existing ${email}:`, emailErr.message);
            }
          }
          // ========== END EMAIL QUEUE MIGRATION ==========

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
          JSON.stringify(customFields) // Store only custom fields (non-standard columns)
        ];

        const insertResult = await pool.query(insertQuery, values);
        const visitor = insertResult.rows[0];

        results.imported.push({
          id: visitor.id,
          name: name || last_name || email,
          email: email,
          qr_code: visitor.qr_code,
          badge_id: badgeId
        });
        results.success_count++;
        results.new_count++;
        if (Object.keys(customFields).length > 0) results.custom_fields_updated_count++;

        // ========== EMAIL QUEUE MIGRATION (was: direct SendGrid) ==========
        // Send email if enabled
        if (emailTemplate) {
          try {
            // Generate QR code image tag (same as webhook.js)
            const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
            const qrImageTag = `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width:200px;">`;

            const templateData = {
              ...customFields,
              name: name || 'Guest',
              last_name: last_name,
              email: email,
              company: company,
              country: country,
              job_title: job_title,
              phone: phone,
              qr_code: qrImageTag,
              badge_id: badgeId,
              badge_url: badgeUrl,
              expo_name: expoName,
              date: new Date().toLocaleDateString()
            };

            const emailHtml = processEmailTemplate(
              emailTemplate.html_content || emailTemplate.body || '',
              templateData
            );
            const emailSubject = processEmailTemplate(
              emailTemplate.subject || 'Registration Confirmation',
              templateData
            );

            // OLD CODE (kept for rollback):
            // await sendEmailWithReplyTo(email, emailSubject, emailHtml, 'reply@replies.leena.app');
            // await delay(100);

            // NEW CODE: email_queue Mode 1 (pre-processed HTML)
            await pool.query(`
              INSERT INTO email_queue (recipient_email, subject, html_content, status, created_at)
              VALUES ($1, $2, $3, 'pending', NOW())
            `, [email, emailSubject, emailHtml]);

            results.email_sent_count++;
            console.log(`📧 Email queued for: ${email}`);

            // Log to email_logs for history tracking
            try {
              await pool.query(`
                INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
              `, [organizerId, expo_id, visitor.id, template_id, email, 'queued', `Subject: ${emailSubject} | To: ${email}`]);
            } catch (logErr) {
              console.error('email_logs INSERT failed:', logErr.message);
            }
          } catch (emailErr) {
            console.error(`❌ Email queue failed for ${email}:`, emailErr.message);
            // Don't fail the import, just log the queue error
          }
        // ========== END EMAIL QUEUE MIGRATION ==========
        }

      } catch (rowErr) {
        console.error(`❌ Row ${rowNum} error:`, rowErr.message);
        results.errors.push({ row: rowNum, message: rowErr.message });
        results.failed_count++;
      }
    }

    console.log(`✅ Import complete: ${results.success_count} success, ${results.failed_count} failed`);

    // Save import log
    try {
      await pool.query(
        `INSERT INTO import_logs (organizer_id, expo_id, expo_name, filename,
          total_rows, new_count, updated_count, failed_count,
          email_sent_count, qr_regenerated_count, custom_fields_updated,
          visitor_type, options, errors)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [organizerId, expo_id, expoName, req.file.originalname || 'unknown.xlsx',
         rows.length, results.new_count, results.updated_count, results.failed_count,
         results.email_sent_count, results.qr_regenerated_count, results.custom_fields_updated_count,
         visitor_type || 'visitor',
         JSON.stringify({ existing_email_option: effectiveExistingEmailOption, existing_qr_option: effectiveExistingQrOption, send_email: send_email || 'false' }),
         JSON.stringify(results.errors.slice(0, 50))]
      );
      console.log('📋 Import log saved');
    } catch (logErr) {
      console.error('⚠️ Failed to save import log:', logErr.message);
    }

    res.json({
      success: true,
      message: `Import completed: ${results.new_count} new, ${results.updated_count} updated, ${results.failed_count} failed${results.email_sent_count ? ', ' + results.email_sent_count + ' emails sent' : ''}${results.custom_fields_updated_count ? ', ' + results.custom_fields_updated_count + ' custom fields updated' : ''}`,
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

// ✅ GET IMPORT HISTORY LOGS (paginated)
router.get('/import-logs', authMiddleware, async (req, res) => {
  try {
    const organizerId = req.organizer_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const expoId = req.query.expo_id;

    let whereClause = 'WHERE organizer_id = $1';
    const params = [organizerId];

    if (expoId) {
      whereClause += ` AND expo_id = $${params.length + 1}`;
      params.push(expoId);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM import_logs ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const logsResult = await pool.query(
      `SELECT id, expo_id, expo_name, filename, total_rows,
              new_count, updated_count, failed_count,
              email_sent_count, qr_regenerated_count, custom_fields_updated,
              visitor_type, options, errors, created_at
       FROM import_logs ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      logs: logsResult.rows,
      total,
      page,
      totalPages
    });
  } catch (err) {
    console.error('❌ Import logs error:', err);
    res.status(500).json({ success: false, message: 'Failed to load import logs' });
  }
});

// ✅ EXPORT FILTERED VISITORS AS EXCEL
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });

    const filters = ['expo_id = $1'];
    const values = [expo_id];
    let idx = 2;

    if (req.query.search) {
      filters.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(company) LIKE $${idx})`);
      values.push(`%${req.query.search.toLowerCase()}%`);
      idx++;
    }
    if (req.query.startDate) { filters.push(`created_at >= $${idx}`); values.push(req.query.startDate); idx++; }
    if (req.query.endDate) { filters.push(`created_at <= $${idx}`); values.push(req.query.endDate + ' 23:59:59'); idx++; }
    if (req.query.source) { filters.push(`source ILIKE $${idx}`); values.push(`%${req.query.source}%`); idx++; }
    if (req.query.origin) { filters.push(`origin = ANY($${idx})`); values.push(req.query.origin.split(',')); idx++; }
    if (req.query.visitor_type) { filters.push(`visitor_type = ANY($${idx})`); values.push(req.query.visitor_type.split(',')); idx++; }
    if (req.query.conference_topic) { filters.push(`custom_fields->>'conference_topic' ILIKE $${idx}`); values.push(`%${req.query.conference_topic}%`); idx++; }

    const whereClause = `WHERE ${filters.join(' AND ')}`;
    const result = await pool.query(
      `SELECT name, last_name, email, company, country, phone, job_title, visitor_type,
              source, origin, booth_number, custom_fields->>'conference_topic' as conference_topic,
              badge_id, qr_code, created_at
       FROM visitors ${whereClause} ORDER BY created_at DESC`,
      values
    );

    const rows = result.rows.map(r => ({
      'Name': r.name || '',
      'Last Name': r.last_name || '',
      'Email': r.email || '',
      'Company': r.company || '',
      'Country': r.country || '',
      'Phone': r.phone || '',
      'Job Title': r.job_title || '',
      'Visitor Type': r.visitor_type || 'visitor',
      'Source': r.source || '',
      'Origin': r.origin || '',
      'Booth Number': r.booth_number || '',
      'Conference Topic': r.conference_topic || '',
      'Badge ID': r.badge_id || '',
      'QR Code': r.qr_code || '',
      'Registered': r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Visitors');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="visitors_export_${Date.now()}.xlsx"`);
    res.send(buf);

    console.log(`📊 Exported ${rows.length} visitors for expo ${expo_id}`);
  } catch (err) {
    console.error('❌ Export error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

// ✅ GET CONFERENCE TOPICS WITH COUNTS
router.get('/conference-topics', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });

    const result = await pool.query(`
      SELECT
        v.topic,
        v.registered_count,
        COALESCE(c.checked_in_count, 0) as checked_in_count
      FROM (
        SELECT custom_fields->>'conference_topic' as topic,
               COUNT(*) as registered_count
        FROM visitors
        WHERE expo_id = $1 AND custom_fields->>'conference_topic' IS NOT NULL
          AND custom_fields->>'conference_topic' != ''
        GROUP BY topic
      ) v
      LEFT JOIN (
        SELECT v2.custom_fields->>'conference_topic' as topic,
               COUNT(DISTINCT ch.visitor_id) as checked_in_count
        FROM checkins ch
        JOIN visitors v2 ON ch.visitor_id = v2.id
        WHERE ch.expo_id = $1 AND v2.custom_fields->>'conference_topic' IS NOT NULL
        GROUP BY topic
      ) c ON v.topic = c.topic
      ORDER BY v.registered_count DESC
    `, [expo_id]);

    // Unnest " || "-separated topics into individual entries
    const topicMap = {};
    const checkinMap = {};
    result.rows.forEach(r => {
      const raw = String(r.topic || '').trim();
      if (!raw) return;
      // Split ONLY by " || " — comma is NOT a separator (topic names contain commas)
      const parts = raw.split(' || ').map(t => t.trim()).filter(Boolean);
      parts.forEach(t => {
        topicMap[t] = (topicMap[t] || 0) + parseInt(r.registered_count, 10);
        checkinMap[t] = (checkinMap[t] || 0) + parseInt(r.checked_in_count, 10);
      });
    });

    const topics = Object.entries(topicMap)
      .map(([topic, registered_count]) => ({
        topic,
        registered_count,
        checked_in_count: checkinMap[topic] || 0
      }))
      .sort((a, b) => b.registered_count - a.registered_count);

    res.json({
      success: true,
      topics
    });
  } catch (err) {
    console.error('❌ Conference topics error:', err);
    res.status(500).json({ success: false, message: 'Failed to load conference topics' });
  }
});

// GET /api/visitors/:id/emails — Email history for a specific visitor
router.get('/:id/emails', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const organizer_id = req.organizer_id;

    const visitor = await pool.query(
      'SELECT id, email FROM visitors WHERE id = $1 AND organizer_id = $2',
      [id, organizer_id]
    );
    if (visitor.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }

    const visitorEmail = visitor.rows[0].email;

    const queueHistory = await pool.query(`
      SELECT id, status, subject, created_at, sent_at, error_message, recipient_email
      FROM email_queue
      WHERE visitor_id = $1 OR recipient_email = $2
      ORDER BY created_at DESC LIMIT 50
    `, [id, visitorEmail]);

    const logHistory = await pool.query(`
      SELECT id, status, message, sent_at, email
      FROM email_logs
      WHERE visitor_id = $1 OR email = $2
      ORDER BY sent_at DESC LIMIT 50
    `, [id, visitorEmail]);

    res.json({
      success: true,
      queue_history: queueHistory.rows,
      log_history: logHistory.rows
    });
  } catch (err) {
    console.error('Visitor email history error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch email history' });
  }
});

module.exports = router;
