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

    if (req.query.visitor_type) {
      const typeList = req.query.visitor_type.split(',');
      filters.push(`visitor_type = ANY($${idx})`);
      values.push(typeList);
      idx++;
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataResult = await pool.query(
      `
      SELECT id, name, last_name, company, country, email, source, origin, visitor_type, booth_number, phone, job_title, created_at, qr_code
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
      `SELECT id, qr_code, badge_id, badge_url FROM visitors
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

    // Send email for both new and existing visitors
    if (emailTemplateId) {
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
        const emailData = {
          ...visitorData,
          ...(custom_fields || {}),
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
      message: isExisting
        ? 'You are already registered. Your information has been updated and a confirmation email has been resent.'
        : 'Registration successful',
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
          updated_at = NOW()
        WHERE id = $6`,
        [name || '', last_name || '', company || '', job_title || '', country || '', ex.id]
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

    const { expo_id, visitor_type, source_override, send_email, template_id } = req.body;
    const origin = 'massimport';

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

        // Check for duplicate email in this expo - UPDATE if exists, keep QR
        const duplicateCheck = await pool.query(
          `SELECT id, qr_code, badge_id FROM visitors WHERE email = $1 AND expo_id = $2 LIMIT 1`,
          [email.toLowerCase().trim(), expo_id]
        );

        if (duplicateCheck.rows.length > 0) {
          const existing = duplicateCheck.rows[0];
          // Update existing visitor info but keep QR code
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
              updated_at = NOW()
            WHERE id = $10`,
            [name.trim(), last_name.trim(), company.trim(), country.trim(),
             job_title.trim(), phone.trim(), visitor_type_val, sector.trim(),
             (row.booth_number || row['Booth Number'] || row.booth || row.Booth || '').toString().trim(),
             existing.id]
          );
          results.imported.push({
            id: existing.id,
            name: name || last_name || email,
            email: email,
            qr_code: existing.qr_code,
            badge_id: existing.badge_id
          });
          results.success_count++;
          console.log(`🔄 Updated existing visitor: ${email} (ID: ${existing.id})`);
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
          qr_code: visitor.qr_code,
          badge_id: badgeId
        });
        results.success_count++;

        // Send email if enabled
        if (emailTemplate) {
          try {
            // Generate QR code image tag (same as webhook.js)
            const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
            const qrImageTag = `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width:200px;">`;
            
            const templateData = {
              name: name || 'Guest',
              last_name: last_name,
              email: email,
              company: company,
              country: country,
              job_title: job_title,
              phone: phone,
              qr_code: qrImageTag,  // Now sends img tag instead of UUID
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
