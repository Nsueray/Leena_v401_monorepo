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

    // Search
    if (req.query.search) {
      filters.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(company) LIKE $${idx})`);
      values.push(`%${req.query.search.toLowerCase()}%`);
      idx++;
    }

    // Date Filters
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

    // Source
    if (req.query.source) {
      const sourceList = req.query.source.split(',');
      filters.push(`source = ANY($${idx})`);
      values.push(sourceList);
      idx++;
    }

    // Origin
    if (req.query.origin) {
      const originList = req.query.origin.split(',');
      filters.push(`origin = ANY($${idx})`);
      values.push(originList);
      idx++;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const totalResult = await pool.query(`SELECT COUNT(*) FROM visitors ${whereClause}`, values);
    const total = parseInt(totalResult.rows[0].count);

    const dataResult = await pool.query(`
      SELECT id, name, last_name, company, country, email, source, origin, created_at, qr_code
      FROM visitors
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...values, limit, offset]);

    return res.json({
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
    
    // Extract visitor data from custom_fields
    const visitorData = {
      name: custom_fields?.full_name 
          || (custom_fields?.name && custom_fields?.last_name ? `${custom_fields.name} ${custom_fields.last_name}` : null)
          || custom_fields?.name 
          || '',
      last_name: custom_fields?.last_name || '',
      email: custom_fields?.email || '',
      company: custom_fields?.company || '',
      country: custom_fields?.country || '',
      job_title: custom_fields?.job_title || '',
      phone: custom_fields?.phone || '',
      source: source || 'public_form',
      origin: 'public',
      expo_id: expo_id,
      custom_fields: JSON.stringify(custom_fields || {})
    };

    // Validate required fields
    if (!visitorData.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Get form details to check email template
    let emailTemplateId = null;
    let organizerId = null;
    
    if (form_id) {
      const formResult = await pool.query(
        `SELECT email_template_id, organizer_id FROM forms WHERE id = $1`,
        [form_id]
      );
      
      if (formResult.rows.length > 0) {
        emailTemplateId = formResult.rows[0].email_template_id;
        organizerId = formResult.rows[0].organizer_id;
      }
    }

    // If no organizer_id from form, get from expo
    if (!organizerId && expo_id) {
      const expoResult = await pool.query(
        `SELECT organizer_id FROM expos WHERE id = $1`,
        [expo_id]
      );
      
      if (expoResult.rows.length > 0) {
        organizerId = expoResult.rows[0].organizer_id;
      }
    }

    // Generate QR code and badge ID
    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    // Insert visitor
    const insertQuery = `
      INSERT INTO visitors (
        name, last_name, email, company, country, job_title, phone,
        source, origin, expo_id, organizer_id, 
        qr_code, badge_id, badge_url, custom_fields, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
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
      organizerId || 1, // Default to 1 if not found
      qrCode,
      badgeId,
      badgeUrl,
      visitorData.custom_fields
    ];

    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];

    // Send email if template is configured
    if (emailTemplateId) {
      try {
        // Get email template
        const templateResult = await pool.query(
          `SELECT * FROM email_templates WHERE id = $1`,
          [emailTemplateId]
        );

        if (templateResult.rows.length > 0) {
          const template = templateResult.rows[0];
          
          // Get expo name
          let expoName = 'Our Event';
          if (expo_id) {
            const expoResult = await pool.query(
              `SELECT name FROM expos WHERE id = $1`,
              [expo_id]
            );
            if (expoResult.rows.length > 0) {
              expoName = expoResult.rows[0].name;
            }
          }

          // Prepare email data
          const emailData = {
            name: visitorData.name || 'Guest',
            email: visitorData.email,
            company: visitorData.company || '',
            country: visitorData.country || '',
            expo_name: expoName,
            qr_code: `<img src="https://leena.app/api/qr-image/${qrCode}" alt="QR Code" style="max-width:200px;">`,
            badge_id: badgeId,
            badge_url: badgeUrl,
            date: new Date().toLocaleDateString()
          };

          // Process template
          const emailHtml = processEmailTemplate(template.html_content || template.content, emailData);
          const emailSubject = processEmailTemplate(template.subject || 'Registration Confirmation', emailData);

          // Send email
          await sendEmail(visitorData.email, emailSubject, emailHtml);
          
          console.log(`✅ Email sent to ${visitorData.email}`);
        }
      } catch (emailError) {
        console.error('⚠️ Email send error (non-blocking):', emailError);
        // Don't fail the registration if email fails
      }
    } else {
      // Send default confirmation email if no template specified
      try {
        const defaultHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .badge-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
              .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Registration Confirmed!</h1>
              </div>
              <div class="content">
                <p>Dear ${visitorData.name || 'Guest'},</p>
                <p>Thank you for registering. Your badge is ready!</p>
                <div class="badge-info">
                  <strong>Badge ID:</strong> ${badgeId}<br>
                  <strong>QR Code:</strong> ${qrCode}
                </div>
                <p style="text-align: center;">
                  <a href="${badgeUrl}" class="button">View Your Badge</a>
                </p>
              </div>
            </div>
          </body>
          </html>
        `;

        await sendEmail(
          visitorData.email,
          'Your Event Badge - Registration Confirmed',
          defaultHtml
        );
        
        console.log(`✅ Default email sent to ${visitorData.email}`);
      } catch (emailError) {
        console.error('⚠️ Default email error (non-blocking):', emailError);
      }
    }

    return res.json({
      success: true,
      message: 'Registration successful',
      visitor: visitor,
      qr_code: qrCode,
      badge_id: badgeId,
      badge_url: badgeUrl
    });

  } catch (err) {
    console.error('❌ Public form submission error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Registration failed. Please try again.' 
    });
  }
});

// ✅ MANUAL REGISTRATION (from scanner)
router.post('/manual', async (req, res) => {
  try {
    const {
      name,
      last_name,
      email,
      company,
      country,
      job_title,
      phone,
      source,
      origin,
      expo_id,
      organizer_id,
      hall,
      terminal
    } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    const insertQuery = `
      INSERT INTO visitors (
        name, last_name, email, company, country, job_title, phone,
        source, origin, expo_id, organizer_id,
        qr_code, badge_id, badge_url, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
      ) RETURNING *
    `;

    const values = [
      name || '',
      last_name || '',
      email,
      company || '',
      country || '',
      job_title || '',
      phone || '',
      source || 'manual',
      origin || 'onsite',
      expo_id || 1,
      organizer_id || 1,
      qrCode,
      badgeId,
      badgeUrl
    ];

    const result = await pool.query(insertQuery, values);
    const visitor = result.rows[0];

    // Send confirmation email
    try {
      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #667eea; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f8f9fa; padding: 30px; }
            .badge-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome!</h1>
            </div>
            <div class="content">
              <p>Dear ${name || 'Guest'},</p>
              <p>Your registration is complete. Here are your badge details:</p>
              <div class="badge-info">
                <strong>Badge ID:</strong> ${badgeId}<br>
                <strong>Company:</strong> ${company || 'N/A'}
              </div>
              <p>Please keep this email for your records.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      await sendEmail(email, 'Registration Confirmation', emailHtml);
    } catch (emailError) {
      console.error('⚠️ Email error (non-blocking):', emailError);
    }

    return res.json({
      success: true,
      message: 'Registration successful',
      visitor_id: visitor.id,
      qr_code: qrCode,
      badge_id: badgeId,
      badge_url: badgeUrl
    });

  } catch (err) {
    console.error('❌ Manual registration error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Registration failed' 
    });
  }
});

module.exports = router;
