/**
 * Conference Certificate Routes
 * Leena EMS v402
 *
 * Hostess scans visitor QR at conference sessions.
 * System records check-in + sends certificate email.
 * Session registration validation with force override.
 *
 * Endpoints:
 *   POST /api/conference-certificates/checkin-and-certify  (terminalAuth)
 *   GET  /api/conference-certificates/verify/:token        (public)
 *   GET  /api/conference-certificates/topics               (terminalAuth)
 *   GET  /api/conference-certificates/stats                (JWT auth)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../utils/db');
const terminalAuth = require('../middleware/terminalAuth');
const authMiddleware = require('../middleware/authMiddleware');
const { processEmailTemplate } = require('../utils/email');

// --- Certificate email template (inline, no DB template needed) ---
const CERT_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#4a6fa5;color:#ffffff;padding:40px 30px;text-align:center;">
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;">Conference Certificate</h1>
      <p style="margin:0;font-size:15px;opacity:0.9;">{{expo_name}}</p>
    </div>
    <div style="padding:40px 30px;text-align:center;">
      <p style="font-size:16px;color:#334155;margin:0 0 8px;">Dear <strong>{{name}} {{last_name}}</strong>,</p>
      <p style="font-size:15px;color:#475569;margin:0 0 24px;">Thank you for attending the conference session:</p>
      <div style="background:#eef2f7;border-radius:12px;padding:20px;margin:0 0 24px;">
        <h2 style="margin:0;color:#4a6fa5;font-size:20px;font-weight:700;">{{conference_topic}}</h2>
      </div>
      <p style="font-size:15px;color:#475569;margin:0 0 28px;">Your certificate of attendance is ready. Click below to view and save it.</p>
      <a href="{{certificate_url}}" style="display:inline-block;padding:16px 32px;background:#4a6fa5;color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:600;">View Certificate</a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">You can save your certificate as PDF using your browser's Print function.</p>
    </div>
    <div style="padding:20px 30px;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:12px;">Powered by Leena EMS</p>
    </div>
  </div>
</body>
</html>
`;

/**
 * Helper: Check if visitor is registered for the given conference topic.
 * custom_fields.conference_topic is a plain string (from Excel import).
 * It may contain comma-separated topics like "HVAC Basics, Green Building".
 * Comparison is case-insensitive with trim to handle data inconsistencies.
 * Returns true if the selected topic matches any of the visitor's topics.
 */
function isVisitorRegisteredForTopic(customFields, selectedTopic) {
  if (!customFields || !customFields.conference_topic) return false;

  const visitorRaw = String(customFields.conference_topic).trim();
  const selectedRaw = String(selectedTopic).trim();

  // Exact match (case-insensitive)
  if (visitorRaw.toLowerCase() === selectedRaw.toLowerCase()) return true;

  // Split both by comma — handles "Topic A, Topic B" in either direction
  const visitorTopics = visitorRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const selectedTopics = selectedRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

  // Check if ANY visitor topic matches ANY selected topic
  return visitorTopics.some(vt => selectedTopics.some(st => vt === st));
}

/**
 * Helper: Add a topic to visitor's custom_fields.conference_topic.
 * Preserves existing topics, adds new one comma-separated.
 */
async function addTopicToVisitor(client, visitorId, customFields, newTopic) {
  const existing = customFields && customFields.conference_topic
    ? String(customFields.conference_topic).trim()
    : '';

  const updatedTopic = existing ? `${existing}, ${newTopic}` : newTopic;

  await client.query(
    `UPDATE visitors
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('conference_topic', $1::text)
     WHERE id = $2`,
    [updatedTopic, visitorId]
  );
}

/**
 * Core logic: issue certificate, create check-in, queue email.
 * Extracted to reuse for both normal and force flows.
 */
async function issueCertificate(client, visitor, expoId, organizerId, hall, terminalNo, conference_topic, expoName) {
  const certToken = crypto.randomBytes(32).toString('hex');

  const certRes = await client.query(
    `INSERT INTO conference_certificates
       (visitor_id, expo_id, organizer_id, conference_topic, certificate_token, email_sent, created_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
     ON CONFLICT (visitor_id, expo_id, conference_topic) DO NOTHING
     RETURNING id, certificate_token`,
    [visitor.id, expoId, organizerId, conference_topic, certToken]
  );

  // Duplicate check
  if (certRes.rows.length === 0) {
    return { duplicate: true };
  }

  const certificate = certRes.rows[0];

  // Create check-in record
  await client.query(
    `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, notes, checkin_type, staff_id, source, checkin_time)
     VALUES ($1, $2, $3, $4, $5, 'entry', $6, 'conference-cert', NOW())`,
    [visitor.id, expoId, terminalNo || 'conf', hall || 'conference', `Conference: ${conference_topic}`, organizerId]
  );

  // Upsert visitor_event_status
  await client.query(
    `INSERT INTO visitor_event_status (visitor_id, expo_id, status, created_at, updated_at)
     VALUES ($1, $2, 'checked_in', NOW(), NOW())
     ON CONFLICT (visitor_id, expo_id)
     DO UPDATE SET status = 'checked_in', updated_at = NOW()`,
    [visitor.id, expoId]
  );

  // Build certificate email
  const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
  const certificateUrl = `${baseUrl}/certificate.html?token=${certificate.certificate_token}`;

  const emailData = {
    name: visitor.name || '',
    last_name: visitor.last_name || '',
    conference_topic: conference_topic,
    expo_name: expoName,
    certificate_url: certificateUrl,
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  };

  const emailSubject = `Your Conference Certificate — ${conference_topic}`;
  const emailHtml = processEmailTemplate(CERT_EMAIL_TEMPLATE, emailData);

  // Queue email (Mode 1: pre-processed HTML)
  await client.query(
    `INSERT INTO email_queue (recipient_email, subject, html_content, expo_id, visitor_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [visitor.email, emailSubject, emailHtml, expoId, visitor.id]
  );

  // Log to email_logs
  try {
    await client.query(
      `INSERT INTO email_logs (organizer_id, expo_id, visitor_id, email, status, message, sent_at)
       VALUES ($1, $2, $3, $4, 'queued', $5, NOW())`,
      [organizerId, expoId, visitor.id, visitor.email, `Certificate: ${conference_topic} | To: ${visitor.email}`]
    );
  } catch (logErr) {
    console.warn('[CONF_CERT] email_logs insert failed (non-fatal):', logErr.message);
  }

  return {
    duplicate: false,
    certificate: {
      id: certificate.id,
      token: certificate.certificate_token,
      url: certificateUrl,
      visitor_name: [visitor.name, visitor.last_name].filter(Boolean).join(' '),
      visitor_email: visitor.email,
      topic: conference_topic
    }
  };
}

/**
 * POST /api/conference-certificates/checkin-and-certify
 *
 * Core endpoint: hostess scanner calls this after QR scan.
 * Validates session registration, creates check-in + certificate + email.
 *
 * Auth: terminalAuth (x-terminal-key)
 * Body: { visitor_id, conference_topic, force?: boolean }
 *
 * Response includes `registered` flag:
 *   registered: true  → normal flow (check-in + certificate)
 *   registered: false → visitor not registered for this topic (no action taken)
 *   force: true       → override: add topic + issue certificate regardless
 */
router.post('/checkin-and-certify', terminalAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const { visitor_id, conference_topic, force } = req.body;
    const { expoId, organizerId, hall, terminalNo } = req.terminal;

    if (!visitor_id || !conference_topic) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'visitor_id and conference_topic are required'
      });
    }

    // 1. Validate visitor exists for this expo
    // Extract conference_topic directly in SQL to bypass JS JSON parsing issues
    const visitorRes = await client.query(
      `SELECT id, name, last_name, email, company, job_title, qr_code, custom_fields,
              custom_fields->>'conference_topic' as db_conference_topic
       FROM visitors
       WHERE id = $1 AND expo_id = $2 AND organizer_id = $3`,
      [visitor_id, expoId, organizerId]
    );

    if (visitorRes.rows.length === 0) {
      client.release();
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    const visitor = visitorRes.rows[0];

    if (!visitor.email) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Visitor has no email address'
      });
    }

    // Parse custom_fields for addTopicToVisitor (force flow)
    let customFields = visitor.custom_fields || {};
    if (typeof customFields === 'string') {
      try { customFields = JSON.parse(customFields); } catch (e) { customFields = {}; }
    }

    // Get expo name for certificate
    const expoRes = await client.query(
      `SELECT name FROM expos WHERE id = $1`,
      [expoId]
    );
    const expoName = expoRes.rows.length > 0 ? expoRes.rows[0].name : '';

    // 2. Check session registration using SQL-extracted value (reliable)
    const dbTopic = visitor.db_conference_topic; // Direct from PostgreSQL ->>' extraction
    console.log(`[CONF_CERT] Registration check: visitor=${visitor.id}, dbTopic="${dbTopic}", selectedTopic="${conference_topic}", cfType=${typeof visitor.custom_fields}`);
    const isRegistered = dbTopic ? isVisitorRegisteredForTopic({ conference_topic: dbTopic }, conference_topic) : false;

    // If NOT registered and NOT force → return warning, don't issue certificate
    if (!isRegistered && !force) {
      client.release();
      return res.json({
        success: true,
        registered: false,
        duplicate: false,
        visitor_name: [visitor.name, visitor.last_name].filter(Boolean).join(' '),
        visitor_company: visitor.company || '',
        message: 'Visitor is not registered for this session'
      });
    }

    // 3. If force and not registered → add topic to visitor's custom_fields
    await client.query('BEGIN');

    if (!isRegistered && force) {
      await addTopicToVisitor(client, visitor.id, customFields, conference_topic);
      console.log(`[CONF_CERT] Force: added topic "${conference_topic}" to visitor ${visitor.id}`);
    }

    // 4. Issue certificate (check-in + cert + email)
    const result = await issueCertificate(client, visitor, expoId, organizerId, hall, terminalNo, conference_topic, expoName);

    if (result.duplicate) {
      await client.query('ROLLBACK');
      client.release();

      // Fetch existing certificate token for the URL
      const existingRes = await pool.query(
        `SELECT certificate_token FROM conference_certificates
         WHERE visitor_id = $1 AND expo_id = $2 AND conference_topic = $3`,
        [visitor_id, expoId, conference_topic]
      );
      const existingToken = existingRes.rows.length > 0 ? existingRes.rows[0].certificate_token : '';
      const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';

      return res.json({
        success: true,
        registered: true,
        duplicate: true,
        message: 'Certificate already issued for this session',
        certificate: {
          visitor_name: [visitor.name, visitor.last_name].filter(Boolean).join(' '),
          topic: conference_topic,
          url: `${baseUrl}/certificate.html?token=${existingToken}`
        }
      });
    }

    await client.query('COMMIT');
    console.log(`[CONF_CERT] Certificate issued: ${visitor.email} — ${conference_topic}${force ? ' (FORCED)' : ''}`);

    return res.json({
      success: true,
      registered: isRegistered,
      forced: !isRegistered && !!force,
      duplicate: false,
      certificate: result.certificate
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[CONF_CERT] checkin-and-certify error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to process conference check-in'
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/conference-certificates/verify/:token
 *
 * Public endpoint: certificate.html calls this to render certificate.
 * No auth required (token-based access).
 */
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }

    const result = await pool.query(
      `SELECT cc.conference_topic, cc.created_at,
              v.name, v.last_name, v.company, v.job_title, v.country,
              e.name as expo_name
       FROM conference_certificates cc
       JOIN visitors v ON cc.visitor_id = v.id
       JOIN expos e ON cc.expo_id = e.id
       WHERE cc.certificate_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }

    const cert = result.rows[0];

    return res.json({
      success: true,
      certificate: {
        name: cert.name || '',
        last_name: cert.last_name || '',
        company: cert.company || '',
        job_title: cert.job_title || '',
        country: cert.country || '',
        conference_topic: cert.conference_topic,
        expo_name: cert.expo_name || '',
        date: new Date(cert.created_at).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric'
        })
      }
    });
  } catch (err) {
    console.error('[CONF_CERT] verify error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to verify certificate' });
  }
});

/**
 * GET /api/conference-certificates/topics
 *
 * Terminal auth endpoint: returns conference topics for hostess dropdown.
 * Same data as /api/visitors/conference-topics but accessible with terminal auth.
 */
router.get('/topics', terminalAuth, async (req, res) => {
  try {
    const { expoId } = req.terminal;

    const result = await pool.query(
      `SELECT
         custom_fields->>'conference_topic' as topic,
         COUNT(*) as registered_count
       FROM visitors
       WHERE expo_id = $1
         AND custom_fields->>'conference_topic' IS NOT NULL
         AND custom_fields->>'conference_topic' != ''
       GROUP BY custom_fields->>'conference_topic'
       ORDER BY registered_count DESC`,
      [expoId]
    );

    // Also get certificate counts per topic
    const certResult = await pool.query(
      `SELECT conference_topic as topic, COUNT(*) as cert_count
       FROM conference_certificates
       WHERE expo_id = $1
       GROUP BY conference_topic`,
      [expoId]
    );

    // Unnest comma-separated topics into individual entries
    // e.g. "HVAC, Green Building" → counts for both "HVAC" and "Green Building"
    const topicMap = {};
    result.rows.forEach(r => {
      const raw = String(r.topic).trim();
      const parts = raw.includes(',') ? raw.split(',').map(t => t.trim()).filter(Boolean) : [raw];
      parts.forEach(t => { topicMap[t] = (topicMap[t] || 0) + parseInt(r.registered_count, 10); });
    });

    const certMapNorm = {};
    certResult.rows.forEach(r => {
      const raw = String(r.topic).trim();
      const parts = raw.includes(',') ? raw.split(',').map(t => t.trim()).filter(Boolean) : [raw];
      parts.forEach(t => { certMapNorm[t] = (certMapNorm[t] || 0) + parseInt(r.cert_count, 10); });
    });

    const topics = Object.entries(topicMap)
      .map(([topic, registered_count]) => ({
        topic,
        registered_count,
        certificates_issued: certMapNorm[topic] || 0
      }))
      .sort((a, b) => b.registered_count - a.registered_count);

    return res.json({ success: true, topics });
  } catch (err) {
    console.error('[CONF_CERT] topics error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load topics' });
  }
});

/**
 * GET /api/conference-certificates/stats
 *
 * JWT auth endpoint: certificate stats for admin conference-sessions page.
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const { expo_id } = req.query;

    if (!expo_id) {
      return res.status(400).json({ success: false, error: 'expo_id is required' });
    }

    const result = await pool.query(
      `SELECT conference_topic, COUNT(*) as certificates_issued
       FROM conference_certificates
       WHERE expo_id = $1 AND organizer_id = $2
       GROUP BY conference_topic
       ORDER BY certificates_issued DESC`,
      [expo_id, req.organizer_id]
    );

    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM conference_certificates WHERE expo_id = $1 AND organizer_id = $2`,
      [expo_id, req.organizer_id]
    );

    return res.json({
      success: true,
      total_certificates: parseInt(totalResult.rows[0].total, 10),
      stats: result.rows.map(r => ({
        conference_topic: r.conference_topic,
        certificates_issued: parseInt(r.certificates_issued, 10)
      }))
    });
  } catch (err) {
    console.error('[CONF_CERT] stats error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

module.exports = router;
