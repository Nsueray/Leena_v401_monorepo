/**
 * Email Tracking Routes (Public — NO auth)
 * Leena EMS v403 — Email Campaigns
 *
 * Endpoints:
 *   GET  /api/email-track/open/:eventId       — Tracking pixel (1x1 PNG)
 *   GET  /api/email-track/unsubscribe/:token  — Unsubscribe landing page
 *   POST /api/email-track/unsubscribe/:token  — Confirm unsubscribe
 *
 * These endpoints are hit by email clients (Gmail, Outlook, Apple Mail)
 * and must NEVER return errors or require authentication.
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const { TRANSPARENT_PIXEL, verifyUnsubscribeToken } = require('../utils/trackingPixel');

// Fail-fast: UNSUBSCRIBE_SECRET must be set
if (!process.env.UNSUBSCRIBE_SECRET) {
  console.error('FATAL: UNSUBSCRIBE_SECRET env var is required for email tracking');
  process.exit(1);
}

// ============================================================
// GET /open/:eventId — Tracking pixel
// ============================================================

router.get('/open/:eventId', async (req, res) => {
  // ALWAYS return pixel — never 404, never error
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': TRANSPARENT_PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(TRANSPARENT_PIXEL);

  // Async: log the open event (don't await — response already sent)
  const eventId = parseInt(req.params.eventId);
  if (isNaN(eventId)) return;

  const userAgent = req.headers['user-agent'] || '';
  const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

  try {
    // Look up the sent event to get campaign/recipient/step info
    const eventRes = await pool.query(
      `SELECT campaign_id, recipient_id, step_id, email FROM email_events WHERE id = $1 AND event_type = 'sent'`,
      [eventId]
    );

    if (eventRes.rows.length === 0) {
      console.log(`[TRACKING] Pixel hit for unknown event ${eventId} — ignored`);
      return;
    }

    const sentEvent = eventRes.rows[0];

    // Check for existing open event (dedup per recipient+step)
    const existingOpen = await pool.query(
      `SELECT id FROM email_events WHERE recipient_id = $1 AND step_id = $2 AND event_type = 'opened' LIMIT 1`,
      [sentEvent.recipient_id, sentEvent.step_id]
    );

    const isDuplicate = existingOpen.rows.length > 0;

    await pool.query(
      `INSERT INTO email_events (campaign_id, recipient_id, step_id, email, event_type, user_agent, ip_address, metadata)
       VALUES ($1, $2, $3, $4, 'opened', $5, $6, $7)`,
      [
        sentEvent.campaign_id,
        sentEvent.recipient_id,
        sentEvent.step_id,
        sentEvent.email,
        userAgent.substring(0, 500),
        ipAddress.substring(0, 64),
        JSON.stringify({ source_event_id: eventId, duplicate: isDuplicate })
      ]
    );

    if (!isDuplicate) {
      console.log(`[TRACKING] Open recorded: event=${eventId}, email=${sentEvent.email}`);
    }
  } catch (err) {
    // Silent — never let tracking errors affect email client behavior
    console.warn(`[TRACKING] Open log error (non-fatal): ${err.message}`);
  }
});

// ============================================================
// GET /click/:eventId — Click redirect
// ============================================================

router.get('/click/:eventId', async (req, res) => {
  const eventId = parseInt(req.params.eventId);
  let targetUrl = 'https://leena.app/';

  // Decode the original URL
  try {
    const encoded = req.query.url;
    if (encoded) {
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        targetUrl = decoded;
      }
    }
  } catch (e) { /* keep default */ }

  // Always redirect first — don't block on logging
  res.redirect(302, targetUrl);

  // Async: log click event
  if (isNaN(eventId)) return;

  try {
    const eventRes = await pool.query(
      `SELECT campaign_id, recipient_id, step_id, email FROM email_events WHERE id = $1 AND event_type = 'sent'`,
      [eventId]
    );
    if (eventRes.rows.length === 0) return;

    const sentEvent = eventRes.rows[0];
    const userAgent = (req.headers['user-agent'] || '').substring(0, 500);
    const ipAddress = (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '').substring(0, 64);

    const existingClick = await pool.query(
      `SELECT id FROM email_events WHERE recipient_id = $1 AND step_id = $2 AND event_type = 'clicked' LIMIT 1`,
      [sentEvent.recipient_id, sentEvent.step_id]
    );
    const isDuplicate = existingClick.rows.length > 0;

    await pool.query(
      `INSERT INTO email_events (campaign_id, recipient_id, step_id, email, event_type, user_agent, ip_address, metadata)
       VALUES ($1, $2, $3, $4, 'clicked', $5, $6, $7)`,
      [sentEvent.campaign_id, sentEvent.recipient_id, sentEvent.step_id, sentEvent.email,
       userAgent, ipAddress, JSON.stringify({ source_event_id: eventId, original_url: targetUrl, duplicate: isDuplicate })]
    );

    if (!isDuplicate) {
      console.log(`[TRACKING] Click recorded: event=${eventId}, email=${sentEvent.email}, url=${targetUrl.substring(0, 80)}`);
    }
  } catch (err) {
    console.warn(`[TRACKING] Click log error (non-fatal): ${err.message}`);
  }
});

// ============================================================
// GET /unsubscribe/:token — Landing page
// ============================================================

router.get('/unsubscribe/:token', async (req, res) => {
  const parsed = verifyUnsubscribeToken(req.params.token);

  if (!parsed) {
    return res.status(400).send(renderPage('Invalid Link',
      '<p>This unsubscribe link is invalid or has expired.</p>'));
  }

  // Look up organizer name for display
  let organizerName = 'this organizer';
  try {
    const orgRes = await pool.query(
      `SELECT o.name FROM email_campaigns c JOIN organizers o ON c.organizer_id = o.id WHERE c.id = $1`,
      [parsed.campaignId]
    );
    if (orgRes.rows.length > 0) organizerName = orgRes.rows[0].name;
  } catch (e) { /* non-critical */ }

  res.send(renderPage('Unsubscribe', `
    <p style="margin-bottom:24px;">You are about to unsubscribe <strong>${escapeHtml(parsed.email)}</strong> from marketing emails from <strong>${escapeHtml(organizerName)}</strong>.</p>
    <form method="POST" action="/api/email-track/unsubscribe/${req.params.token}">
      <button type="submit" style="background:#ef4444;color:white;border:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;width:100%;">Confirm Unsubscribe</button>
    </form>
    <p style="margin-top:20px;font-size:12px;color:#9ca3af;">You will still receive transactional emails (registration confirmations, badges, certificates).</p>
  `));
});

// ============================================================
// POST /unsubscribe/:token — Confirm unsubscribe
// ============================================================

router.post('/unsubscribe/:token', async (req, res) => {
  const parsed = verifyUnsubscribeToken(req.params.token);

  if (!parsed) {
    return res.status(400).send(renderPage('Invalid Link',
      '<p>This unsubscribe link is invalid or has expired.</p>'));
  }

  try {
    // Get organizer_id from campaign
    const campRes = await pool.query(
      'SELECT organizer_id, expo_id FROM email_campaigns WHERE id = $1',
      [parsed.campaignId]
    );

    if (campRes.rows.length === 0) {
      return res.status(400).send(renderPage('Error', '<p>Campaign not found.</p>'));
    }

    const { organizer_id, expo_id } = campRes.rows[0];

    // Insert into email_unsubscribes (ON CONFLICT = already unsubscribed, fine)
    await pool.query(
      `INSERT INTO email_unsubscribes (email, organizer_id, expo_id, campaign_id, reason)
       VALUES ($1, $2, $3, $4, 'user_unsubscribed')
       ON CONFLICT (email, organizer_id) DO NOTHING`,
      [parsed.email, organizer_id, expo_id, parsed.campaignId]
    );

    // Mark this recipient as unsubscribed in ALL active campaigns from this organizer
    await pool.query(
      `UPDATE campaign_recipients SET status = 'unsubscribed', updated_at = NOW()
       WHERE email = $1 AND status = 'active'
         AND campaign_id IN (SELECT id FROM email_campaigns WHERE organizer_id = $2)`,
      [parsed.email, organizer_id]
    );

    // Log unsubscribe event
    await pool.query(
      `INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata)
       VALUES ($1, $2, $3, 'unsubscribed', '{}')`,
      [parsed.campaignId, parsed.recipientId, parsed.email]
    );

    console.log(`[TRACKING] Unsubscribed: ${parsed.email} (campaign=${parsed.campaignId}, organizer=${organizer_id})`);

    res.send(renderPage('Unsubscribed', `
      <div style="text-align:center;margin-bottom:24px;">
        <div style="width:64px;height:64px;background:#d1fae5;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <span style="font-size:32px;">✓</span>
        </div>
      </div>
      <p>You have been unsubscribed. You will no longer receive marketing emails from this organizer.</p>
      <p style="margin-top:16px;font-size:12px;color:#9ca3af;">Transactional emails (registration confirmations, badges, certificates) will continue as normal.</p>
    `));
  } catch (err) {
    console.error(`[TRACKING] Unsubscribe error: ${err.message}`);
    res.status(500).send(renderPage('Error', '<p>Something went wrong. Please try again later.</p>'));
  }
});

// ============================================================
// HTML helpers
// ============================================================

function renderPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Leena EMS</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',system-ui,sans-serif; background:#f8fafc; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:white; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,0.08); max-width:480px; width:100%; padding:40px; text-align:center; }
    h1 { font-size:22px; font-weight:700; color:#1e293b; margin-bottom:16px; }
    p { font-size:14px; color:#475569; line-height:1.6; }
    strong { color:#1e293b; }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = router;
