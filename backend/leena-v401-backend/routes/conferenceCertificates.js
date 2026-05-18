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
<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">

    <!-- Header: Red banner with logo -->
    <div style="background:#d6232a;padding:28px 30px;text-align:center;">
      <img src="https://www.megaclimaexpo.com/ghana/newsletter/mc-ghana-logo.png" alt="Mega Clima Ghana" style="max-height:48px;margin-bottom:14px;display:inline-block;" />
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">Certificate of Participation</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#ffffff;opacity:0.9;">3&ndash;5 March 2026 &bull; The Palms Convention Centre, Accra, Ghana</p>
    </div>

    <!-- Content -->
    <div style="padding:36px 30px;text-align:center;">
      <p style="font-size:16px;color:#1a1a1a;margin:0 0 6px;">Dear</p>
      <p style="font-size:22px;color:#1a1a1a;margin:0 0 20px;font-weight:700;">{{name}} {{last_name}}</p>

      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
        Thank you for attending the <strong>{{expo_name}}</strong> &mdash; HVAC+R Technical Conference &amp; Exhibition.
        Your certificate of participation is ready.
      </p>

      <div style="background:#fef2f2;border-left:4px solid #d6232a;border-radius:6px;padding:16px 20px;margin:0 0 8px;text-align:left;">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Session attended</p>
        <p style="margin:0;color:#d6232a;font-size:17px;font-weight:700;">{{conference_topic}}</p>
      </div>

      <p style="font-size:14px;color:#888;margin:0 0 28px;text-align:left;">Click the button below to view and download your certificate as PDF.</p>

      <a href="{{certificate_url}}" style="display:inline-block;padding:14px 36px;background:#d6232a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">View Certificate</a>

      <p style="margin:20px 0 0;color:#aaa;font-size:12px;">Use &ldquo;Save as PDF&rdquo; in the print dialog to download.</p>
    </div>

    <!-- Footer: Organizer logos + contact -->
    <div style="padding:20px 30px;text-align:center;border-top:1px solid #eee;background:#fafafa;">
      <table style="margin:0 auto 10px;border:0;border-spacing:16px 0;" cellpadding="0" cellspacing="16">
        <tr>
          <td style="text-align:center;vertical-align:middle;">
            <img src="https://www.megaclimaexpo.com/ghana/newsletter/organized.png" alt="Elan Expo" style="height:28px;display:inline-block;" />
          </td>
          <td style="text-align:center;vertical-align:middle;">
            <img src="https://www.megaclimaexpo.com/ghana/newsletter/ashrae.png" alt="ASHRAE" style="height:28px;display:inline-block;" />
          </td>
        </tr>
      </table>
      <p style="margin:0 0 4px;color:#999;font-size:12px;">info@megaclimaexpo.com &bull; www.megaclimaexpo.com</p>
      <p style="margin:0;color:#ccc;font-size:11px;">Powered by Leena EMS</p>
    </div>

  </div>
</body>
</html>
`;

// --- Certificate email template — Mega Clima Nigeria 2026 (expo_id=7) ---
// Same structure as CERT_EMAIL_TEMPLATE (tested email-client layout) —
// only branding swapped (logo, dates, venue, theme text, green theme, footer).
const CERT_EMAIL_TEMPLATE_NG = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">

    <!-- Header: Green banner with logo -->
    <div style="background:#54AF3A;padding:28px 30px;text-align:center;">
      <img src="https://westafricahvacexpo.com/newsletter/mc-nigeria-logo.png" alt="Mega Clima Nigeria" style="max-height:48px;margin-bottom:14px;display:inline-block;" />
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Georgia,'Times New Roman',serif;">Certificate of Participation</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#ffffff;opacity:0.9;">19&ndash;21 May 2026 &bull; Landmark Centre, Lagos, Nigeria</p>
    </div>

    <!-- Content -->
    <div style="padding:36px 30px;text-align:center;">
      <p style="font-size:16px;color:#1a1a1a;margin:0 0 6px;">Dear</p>
      <p style="font-size:22px;color:#1a1a1a;margin:0 0 20px;font-weight:700;">{{name}} {{last_name}}</p>

      <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 24px;">
        Thank you for attending the <strong>{{expo_name}}</strong> &mdash; Cooling Africa Responsibly: Performance Excellence, People and Sustainable HVAC&amp;R.
        Your certificate of participation is ready.
      </p>

      <div style="background:#eef7ea;border-left:4px solid #54AF3A;border-radius:6px;padding:16px 20px;margin:0 0 8px;text-align:left;">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;">Session attended</p>
        <p style="margin:0;color:#54AF3A;font-size:17px;font-weight:700;">{{conference_topic}}</p>
      </div>

      <p style="font-size:14px;color:#888;margin:0 0 28px;text-align:left;">Click the button below to view and download your certificate as PDF.</p>

      <a href="{{certificate_url}}" style="display:inline-block;padding:14px 36px;background:#54AF3A;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">View Certificate</a>

      <p style="margin:20px 0 0;color:#aaa;font-size:12px;">Use &ldquo;Save as PDF&rdquo; in the print dialog to download.</p>
    </div>

    <!-- Footer: Organizer logos + contact -->
    <div style="padding:20px 30px;text-align:center;border-top:1px solid #eee;background:#fafafa;">
      <table style="margin:0 auto 10px;border:0;border-spacing:16px 0;" cellpadding="0" cellspacing="16">
        <tr>
          <td style="text-align:center;vertical-align:middle;">
            <img src="https://westafricahvacexpo.com/newsletter/supporter/elanexpo.png" alt="Organized by Elan Expo" style="height:28px;display:inline-block;" />
          </td>
          <td style="text-align:center;vertical-align:middle;">
            <img src="https://westafricahvacexpo.com/newsletter/supporter/ashrae-logo.png" alt="In Collaboration With ASHRAE" style="height:28px;display:inline-block;" />
          </td>
        </tr>
      </table>
      <p style="margin:0 0 4px;color:#999;font-size:12px;">info@westafricahvacexpo.com &bull; www.westafricahvacexpo.com</p>
      <p style="margin:0;color:#ccc;font-size:11px;">Powered by Leena EMS</p>
    </div>

  </div>
</body>
</html>
`;

/**
 * Helper: Split conference_topic string into individual topics.
 * ONLY splits by " || " (double pipe with spaces).
 * Comma is NOT a separator — topic names themselves contain commas
 * (e.g. "Introduction | Opening Remarks: Engineering for a Healthy Buildings, Designing for Life").
 * Returns array of trimmed, non-empty topic strings.
 */
function splitTopics(raw) {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  return str.split(' || ').map(t => t.trim()).filter(Boolean);
}

/**
 * Helper: Check if visitor is registered for the given conference topic.
 * custom_fields.conference_topic may contain " || "-separated topics.
 * Comparison is case-insensitive with trim to handle data inconsistencies.
 * Returns true if the selected topic matches any of the visitor's topics.
 */
function isVisitorRegisteredForTopic(customFields, selectedTopic) {
  if (!customFields || !customFields.conference_topic) return false;

  const visitorTopics = splitTopics(customFields.conference_topic).map(t => t.toLowerCase());
  const selectedTopics = splitTopics(selectedTopic).map(t => t.toLowerCase());

  // Check if ANY visitor topic matches ANY selected topic
  return visitorTopics.some(vt => selectedTopics.some(st => vt === st));
}

/**
 * Helper: Add a topic to visitor's custom_fields.conference_topic.
 * Preserves existing topics, appends new one with " || " separator.
 * Duplicate-safe: won't add if topic already present (case-insensitive).
 */
async function addTopicToVisitor(client, visitorId, customFields, newTopic) {
  const existing = customFields && customFields.conference_topic
    ? String(customFields.conference_topic).trim()
    : '';

  // Check duplicate before appending
  const existingTopics = splitTopics(existing).map(t => t.toLowerCase());
  const newTopicTrimmed = String(newTopic).trim();

  if (existingTopics.includes(newTopicTrimmed.toLowerCase())) {
    return; // Already present, skip
  }

  const updatedTopic = existing ? `${existing} || ${newTopicTrimmed}` : newTopicTrimmed;

  await client.query(
    `UPDATE visitors
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('conference_topic', $1::text)
     WHERE id = $2`,
    [updatedTopic, visitorId]
  );
}

// --- Cool Plus Limited certificate block (Mega Clima Nigeria 2026, expo_id=7) ---
// Topics 1, 5, 11 are run by Cool Plus Limited, who issue their own certificates.
// Leena still records check-in (attendance) but skips certificate + email for these.
// Block strings are derived LIVE from form 39 options [0,4,10] (M1, byte-exact),
// cached in-memory until process restart. Scope: expo_id=7 only.
// Refs: COOL_PLUS_BLOCK_ANALYSIS_20260518.md (Option A1 + M1)
const COOL_PLUS_EXPO_ID = 7;
let coolPlusCache = null; // Set<string> of normalized blocked topics (expo 7), lazy-loaded

function normalizeTopic(s) {
  return String(s == null ? '' : s).normalize('NFKC').trim().toLowerCase();
}

async function getCoolPlusBlockedTopics(expoId) {
  if (Number(expoId) !== COOL_PLUS_EXPO_ID) return new Set();
  if (coolPlusCache) return coolPlusCache;
  try {
    const res = await pool.query(
      `SELECT fld->'options'->>0  AS t1,
              fld->'options'->>4  AS t5,
              fld->'options'->>10 AS t11
       FROM forms, jsonb_array_elements(fields::jsonb) AS fld
       WHERE id = 39 AND fld->>'name' = 'conference_topic'
       LIMIT 1`
    );
    const row = res.rows[0] || {};
    const set = new Set(
      [row.t1, row.t5, row.t11].filter(Boolean).map(normalizeTopic).filter(Boolean)
    );
    coolPlusCache = set; // cache only the expo-7 set (process-lifetime)
    return set;
  } catch (err) {
    // fail-OPEN: on DB error do NOT block — certificate flow must not halt during the fair
    console.error('[Cool Plus Block] getCoolPlusBlockedTopics failed (fail-open, no block applied):', err.message);
    return new Set();
  }
}

async function isTopicBlocked(topicString, expoId) {
  if (Number(expoId) !== COOL_PLUS_EXPO_ID) return false;
  if (!topicString) return false;
  const blocked = await getCoolPlusBlockedTopics(expoId);
  if (blocked.size === 0) return false;
  // Multi-topic safe: split by " || " (reuses splitTopics), normalize each segment
  return splitTopics(topicString).some(seg => blocked.has(normalizeTopic(seg)));
}

function coolPlusBlockResponse(blockedTopic) {
  return {
    success: false,
    error: 'Certificate not issued — Cool Plus Limited will issue the certificate for this session',
    code: 'COOL_PLUS_BLOCKED',
    blocked_topic: blockedTopic
  };
}

/**
 * Core logic: issue certificate, create check-in, queue email.
 * Extracted to reuse for both normal and force flows.
 */
async function issueCertificate(client, visitor, expoId, organizerId, hall, terminalNo, conference_topic, expoName) {
  // Cool Plus block (expo 7, Topics 1/5/11): still record check-in (attendance, A1)
  // but skip certificate + email. Non-blocked path below stays byte-identical.
  if (await isTopicBlocked(conference_topic, expoId)) {
    // Same check-in INSERT + visitor_event_status upsert as the normal flow (copied verbatim)
    await client.query(
      `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, notes, checkin_type, staff_id, source, checkin_time)
       VALUES ($1, $2, $3, $4, $5, 'entry', $6, 'conference-cert', NOW())`,
      [visitor.id, expoId, terminalNo || 'conf', hall || 'conference', `Conference: ${conference_topic}`, organizerId]
    );
    await client.query(
      `INSERT INTO visitor_event_status (visitor_id, expo_id, status, created_at, updated_at)
       VALUES ($1, $2, 'checked_in', NOW(), NOW())
       ON CONFLICT (visitor_id, expo_id)
       DO UPDATE SET status = 'checked_in', updated_at = NOW()`,
      [visitor.id, expoId]
    );
    console.log('[Cool Plus Block]', { visitor_id: visitor.id, topic: conference_topic, expo_id: expoId });
    return { blocked: true, blocked_topic: conference_topic };
  }

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
  const emailTemplate = (Number(expoId) === 7) ? CERT_EMAIL_TEMPLATE_NG : CERT_EMAIL_TEMPLATE;
  const emailHtml = processEmailTemplate(emailTemplate, emailData);

  // Queue email (Mode 1: pre-processed HTML)
  await client.query(
    `INSERT INTO email_queue (recipient_email, subject, html_content, expo_id, visitor_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [visitor.email, emailSubject, emailHtml, expoId, visitor.id]
  );

  // email_logs is now handled by email_worker after actual send

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
      return res.status(404).json({
        success: false,
        error: 'Visitor not found'
      });
    }

    const visitor = visitorRes.rows[0];

    if (!visitor.email) {
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

    if (result.blocked) {
      await client.query('COMMIT'); // persist check-in (A1) — no cert, no email
      return res.json(coolPlusBlockResponse(result.blocked_topic));
    }

    if (result.duplicate) {
      await client.query('ROLLBACK');

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
          token: existingToken,
          visitor_name: [visitor.name, visitor.last_name].filter(Boolean).join(' '),
          visitor_company: visitor.company || '',
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
      `SELECT cc.conference_topic, cc.created_at, cc.expo_id,
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
        expo_id: cert.expo_id,
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
 * POST /api/conference-certificates/resend
 *
 * Resend certificate email for an existing certificate.
 * Uses existing certificate_token — does NOT create a new certificate.
 *
 * Auth: terminalAuth (x-terminal-key)
 * Body: { certificate_token }
 */
router.post('/resend', terminalAuth, async (req, res) => {
  try {
    const { certificate_token } = req.body;

    if (!certificate_token) {
      return res.status(400).json({ success: false, error: 'certificate_token is required' });
    }

    // Fetch certificate + visitor + expo data
    const result = await pool.query(
      `SELECT cc.id, cc.certificate_token, cc.conference_topic, cc.expo_id, cc.organizer_id,
              v.id as visitor_id, v.name, v.last_name, v.email,
              e.name as expo_name
       FROM conference_certificates cc
       JOIN visitors v ON cc.visitor_id = v.id
       JOIN expos e ON cc.expo_id = e.id
       WHERE cc.certificate_token = $1`,
      [certificate_token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }

    const cert = result.rows[0];

    if (!cert.email) {
      return res.status(400).json({ success: false, error: 'Visitor has no email address' });
    }

    // Cool Plus block (expo 7, Topics 1/5/11): never resend a Leena certificate
    if (await isTopicBlocked(cert.conference_topic, cert.expo_id)) {
      console.log('[Cool Plus Block]', { visitor_id: cert.visitor_id, topic: cert.conference_topic, expo_id: cert.expo_id });
      return res.json(coolPlusBlockResponse(cert.conference_topic));
    }

    // Build and queue the same certificate email
    const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
    const certificateUrl = `${baseUrl}/certificate.html?token=${cert.certificate_token}`;

    const emailData = {
      name: cert.name || '',
      last_name: cert.last_name || '',
      conference_topic: cert.conference_topic,
      expo_name: cert.expo_name || '',
      certificate_url: certificateUrl,
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    };

    const emailSubject = `Your Conference Certificate — ${cert.conference_topic} (Resent)`;
    const emailTemplate = (Number(cert.expo_id) === 7) ? CERT_EMAIL_TEMPLATE_NG : CERT_EMAIL_TEMPLATE;
    const emailHtml = processEmailTemplate(emailTemplate, emailData);

    // Queue email (Mode 1)
    await pool.query(
      `INSERT INTO email_queue (recipient_email, subject, html_content, expo_id, visitor_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
      [cert.email, emailSubject, emailHtml, cert.expo_id, cert.visitor_id]
    );

    // email_logs is now handled by email_worker after actual send

    console.log(`[CONF_CERT] Certificate resent: ${cert.email} — ${cert.conference_topic}`);

    return res.json({
      success: true,
      message: 'Certificate email resent',
      email: cert.email
    });

  } catch (err) {
    console.error('[CONF_CERT] resend error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to resend certificate' });
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

    // Unnest " || "-separated topics into individual entries
    // e.g. "HVAC || Green Building" → counts for both "HVAC" and "Green Building"
    const topicMap = {};
    result.rows.forEach(r => {
      const parts = splitTopics(r.topic);
      parts.forEach(t => { topicMap[t] = (topicMap[t] || 0) + parseInt(r.registered_count, 10); });
    });

    const certMapNorm = {};
    certResult.rows.forEach(r => {
      const parts = splitTopics(r.topic);
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
