/**
 * Call-Center Dialer — routes
 * Leena EMS (Stage 3, 7 Sep 2026)
 *
 * Endpoint surface per docs/sessions/CALLCENTER_DESIGN_20260907.md §2.
 *
 * Auth model:
 *   Agent routes       → middleware/callCenterAgentAuth (x-callcenter-key + ?agent=)
 *   Supervisor routes  → middleware/callCenterSupervisorAuth (x-callcenter-supervisor-key)
 *   Admin routes       → middleware/authMiddleware (JWT — Suer only)
 *
 * Isolated module: zero cross-imports from other route files. All writes go
 * to callcenter_leads (Stage 2 migration 030) plus email_queue Mode 1 for
 * transactional email (resend + daily report). No writes to visitors /
 * checkins / reactivation_tokens / email_campaigns anywhere in this file.
 */

const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');

const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const agentAuth = require('../middleware/callCenterAgentAuth');
const supervisorAuth = require('../middleware/callCenterSupervisorAuth');
const { processEmailTemplate } = require('../utils/email');

const router = express.Router();

// Multer setup for xlsx import — mirrors routes/visitors.js:22 shape
// (memory storage; the file buffer is passed straight to XLSX.read).
// 25 MB cap — the largest known SIEMA call-center xlsx is ~10.8 MB
// (yesterday's SIEMA26_callcenter_20260907.xlsx dump); 25 MB gives 2× headroom.
const uploadCallcenter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================================================
// Constants + small helpers
// ============================================================

// Segment A "attended in 2025" — sourced from checkins on expo 1 (Morocco
// Siema Expo 2025). Confirmed 7 Sep: expos.id=1, start_date=2025-09-09..11.
const ATTENDED_2025_EXPO_ID = 1;

// SIEMA re-activation template (Yaprak's template 74 = 01_invitation).
// Hardcoded for Stage 3 — parameterise once we have a second expo needing
// call-center resend. Kept in one place for future search.
const SIEMA_ACTIVATE_TEMPLATE_ID = 74;

// Segment → campaign_id mapping for mail-status enrichment (Stage 3b).
// SIEMA campaigns: 78 = activate wave (segment A), 79 = register wave
// (segment C). Segment B is transactional (badge/QR mail on expo_id, no
// campaign). Keyed by `${expo_id}|${segment}` so future expos add without
// touching the lookup.
const CAMPAIGN_BY_EXPO_SEGMENT = {
  '9|A': 78,
  '9|C': 79
};

// Stuck-claim reaper — if an agent's browser closed on an open card, the
// lead sits in status='claimed' forever unless we recover it. /next
// includes rows whose claim is older than this in its pool.
const STUCK_CLAIM_TTL_MINUTES = 30;

// Max recursion depth for auto-close on registered_meanwhile at /next
// time. Prevents an infinite loop if every remaining lead somehow has a
// visitor row (they were all imported after registration by mistake).
const NEXT_MAX_ATTEMPTS = 10;

// Per-lead resend cooldown — an agent (or a race) can't spam a lead's inbox.
const RESEND_COOLDOWN_MINUTES = 2;

// Supervisor /stats/live cache — 15 s (design R-6). Module-scope Map keyed
// on a query-shape hash. Cleared on every /outcome, /skip, /next completion
// so live activity shows up quickly rather than waiting for the TTL.
const STATS_CACHE_TTL_MS = 15 * 1000;
const _statsCache = new Map();
function _cacheGet(key) {
  const e = _statsCache.get(key);
  if (!e || (Date.now() - e.ts) > STATS_CACHE_TTL_MS) return null;
  return e.body;
}
function _cachePut(key, body) {
  _statsCache.set(key, { ts: Date.now(), body });
}
function _cacheBust() { _statsCache.clear(); }

// ── Window parsing for /stats/live (Suer 11 Sep) ──────────────────────────
// Accepts ?date=YYYY-MM-DD or ?range=today|yesterday|7d|all. Default = today.
// Every section of /stats/live honors the SAME window; frontend labels it.
// Cache is keyed by the window so different windows don't collide.
function parseWindow(query) {
  const raw = String((query && (query.date || query.range)) || 'today').trim().toLowerCase();
  const casaToday = casaTodayStartUtc();          // UTC ts of Casa midnight today
  const dayMs = 24 * 60 * 60 * 1000;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Specific Casablanca date. Casablanca is UTC+1 fixed → local midnight
    // of a given YYYY-MM-DD == UTC (YYYY-MM-DD 23:00 of the previous day).
    const [y, m, d] = raw.split('-').map(Number);
    const utcMid = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const start = new Date(utcMid.getTime() - 60 * 60 * 1000).toISOString();
    const end   = new Date(new Date(start).getTime() + dayMs).toISOString();
    return { start, end, label: raw, key: `date:${raw}` };
  }
  if (raw === 'today') {
    return { start: casaToday, end: null, label: 'today', key: 'today' };
  }
  if (raw === 'yesterday') {
    const start = new Date(new Date(casaToday).getTime() - dayMs).toISOString();
    return { start, end: casaToday, label: 'yesterday', key: 'yesterday' };
  }
  if (raw === '7d' || raw === 'last7d') {
    const start = new Date(new Date(casaToday).getTime() - 6 * dayMs).toISOString();
    return { start, end: null, label: 'last 7 days', key: '7d' };
  }
  if (raw === 'all') {
    return { start: null, end: null, label: 'all time', key: 'all' };
  }
  return { start: casaToday, end: null, label: 'today', key: 'today' };
}

// Casablanca-day boundary — "today" for stats. Returns an ISO UTC
// timestamp of midnight-Casablanca that started the current day.
function casaTodayStartUtc() {
  const now = new Date();
  const casa = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now); // "2026-09-07"
  // Africa/Casablanca is UTC+1 year-round (no DST since 2018) — but derive
  // the offset programmatically anyway in case that ever changes.
  const midnightUtc = new Date(`${casa}T00:00:00Z`);
  // Casablanca 00:00 == UTC 23:00 the previous day (UTC+1). Compute the
  // wall-clock UTC that corresponds to Casablanca-midnight-today.
  const casaMidnightStr = new Date(midnightUtc.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
  const offsetMs = midnightUtc.getTime() - casaMidnightStr.getTime();
  return new Date(midnightUtc.getTime() + offsetMs).toISOString();
}

// HTML-escape for report/name rendering. Same shape as form-public.html:esc.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Fetch attended_2025 for one email (checkins on expo 1). Fast — indexed
// via visitors(email) + checkins(visitor_id).
async function attendedIn2025(client, email) {
  if (!email) return false;
  const r = await client.query(
    `SELECT 1 FROM checkins c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.expo_id = $1 AND lower(v.email) = lower($2) LIMIT 1`,
    [ATTENDED_2025_EXPO_ID, email]
  );
  return r.rows.length > 0;
}

// Per-lead mail status for the agent card (Stage 3b). One query per lead,
// indexed columns only. Returns:
//   mail_sent_at         ISO or null — latest email_queue row for this
//                         lead's email on its campaign (A/C) or expo (B),
//                         status='sent'. Delivery-truth timestamp.
//   mail_status          'sent'|'pending'|'failed'|'cancelled'|'processing'|'none'
//                         from the most recent email_queue row (any status).
//   opened_at            ISO or null — first opened event for this email
//                         (campaign only; null for B). email_events.
//   clicked_at           ISO or null — first clicked event; same source.
//   badge_mail_sent_at   ISO or null — for segment B only; same value as
//                         mail_sent_at (badge/QR mail is transactional on
//                         expo 9). null for A/C.
//
// Index usage (both new in migration 031):
//   A/C mail lookup → idx_queue_campaign_email (campaign_id, lower(email))
//   B   mail lookup → idx_queue_expo_email_txn (expo_id, lower(email))
//   opened/clicked  → idx_events_email_type (email, event_type) — existing
//
// A/C shape uses one CTE + two subqueries; B shape uses one subquery only
// (no campaign_events for transactional mails per email_worker.js:651
// which INSERTs email_events INSIDE enqueueStepEmail — campaign-only).
async function enrichMailStatus(client, lead) {
  const emptyRes = {
    mail_sent_at: null,
    mail_status: 'none',
    opened_at: null,
    clicked_at: null,
    badge_mail_sent_at: null
  };
  if (!lead || !lead.email) return emptyRes;
  const emailLc = String(lead.email).toLowerCase();

  if (lead.segment === 'B') {
    // Transactional (badge/QR) mail on the lead's expo. No campaign_id.
    const r = await client.query(
      `SELECT status, sent_at
       FROM email_queue
       WHERE expo_id = $1
         AND campaign_id IS NULL
         AND lower(recipient_email) = $2
       ORDER BY id DESC
       LIMIT 1`,
      [lead.expo_id, emailLc]
    );
    if (r.rows.length === 0) return emptyRes;
    const row = r.rows[0];
    const sentAt = (row.status === 'sent') ? row.sent_at : null;
    return {
      mail_sent_at: sentAt,
      mail_status: row.status || 'none',
      opened_at: null,
      clicked_at: null,
      badge_mail_sent_at: sentAt
    };
  }

  // Segment A or C — campaign-based.
  const campaignId = CAMPAIGN_BY_EXPO_SEGMENT[`${lead.expo_id}|${lead.segment}`];
  if (!campaignId) {
    // Unknown mapping (e.g. future expo without a CAMPAIGN_BY_EXPO_SEGMENT
    // entry). Fall through with empty response — safer than guessing.
    return emptyRes;
  }

  // One combined query — one email_events aggregation + one email_queue
  // top-1. LEFT JOIN against a dummy row guarantees exactly one output
  // row so JS reads .rows[0] unconditionally.
  const r = await client.query(
    `WITH ev AS (
       SELECT
         MAX(created_at) FILTER (WHERE event_type = 'opened')  AS opened_at,
         MAX(created_at) FILTER (WHERE event_type = 'clicked') AS clicked_at
       FROM email_events
       WHERE email = $1
         AND event_type IN ('opened','clicked')
     ),
     q AS (
       SELECT status, sent_at
       FROM email_queue
       WHERE campaign_id = $2
         AND lower(recipient_email) = $1
       ORDER BY id DESC
       LIMIT 1
     )
     SELECT ev.opened_at, ev.clicked_at, q.status AS mail_status, q.sent_at AS queue_sent_at
     FROM ev
     LEFT JOIN q ON TRUE`,
    [emailLc, campaignId]
  );
  const row = r.rows[0] || {};
  return {
    mail_sent_at: (row.mail_status === 'sent') ? row.queue_sent_at : null,
    mail_status: row.mail_status || 'none',
    opened_at: row.opened_at || null,
    clicked_at: row.clicked_at || null,
    badge_mail_sent_at: null
  };
}

// ============================================================
// GET /api/callcenter/health — unauth Stage-2 probe (kept for post-deploy sanity)
// ============================================================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    module: 'callcenter',
    stage: '3b',
    endpoints: [
      'POST /next  (agent)  — returns lead + attended_2025 + mail_sent_at/mail_status/opened_at/clicked_at/badge_mail_sent_at',
      'POST /outcome/:id  (agent)',
      'POST /skip/:id  (agent)',
      'POST /resend/:id  (agent, segment A only)',
      'GET  /stats/me  (agent)',
      'GET  /stats/live  (supervisor)',
      'GET  /stats/agent/:name  (supervisor)',
      'GET  /admin/dump  (JWT)',
      'POST /admin/import  (JWT, multipart xlsx) — dry_run=true|false, expo_id',
      'POST /report/send-now  (JWT)'
    ]
  });
});

// ============================================================
// POST /api/callcenter/next — atomic claim + registered_meanwhile auto-close
// ============================================================
// Body: { segment: 'A' | 'B' | 'C' | 'any' } (default 'any')
//
// Contract:
//   - Picks ONE eligible lead (status='new', or status='callback' with
//     callback_at <= NOW(), or status='claimed' with stuck-claim TTL past)
//   - Filters by segment if not 'any'.
//   - FOR UPDATE SKIP LOCKED — two agents pressing "Next" at the same time
//     get different rows, no lock wait.
//   - Random ordering so agents don't compete for the top-id row.
//   - BEFORE returning: check if the lead's email now has a visitor row on
//     the lead's expo. If yes, auto-close as 'registered_meanwhile' and
//     recurse (up to NEXT_MAX_ATTEMPTS). This is the design's R7 rule.
//
// Response: { success, lead: {...} | null, remaining_pool: N, attempts_used }
router.post('/next', agentAuth, async (req, res) => {
  const segment = String((req.body && req.body.segment) || 'any').trim();
  if (!['A', 'B', 'C', 'any'].includes(segment)) {
    return res.status(400).json({ success: false, error: 'segment must be A, B, C, or any' });
  }

  const client = await pool.connect();
  try {
    let attempts = 0;
    let lead = null;

    while (attempts < NEXT_MAX_ATTEMPTS) {
      attempts++;
      await client.query('BEGIN');

      const claimRes = await client.query(
        `WITH candidate AS (
           SELECT id FROM callcenter_leads
           WHERE (
                   status = 'new'
                   OR (status = 'callback' AND callback_at <= NOW())
                   OR (status = 'claimed' AND claimed_at < NOW() - INTERVAL '${STUCK_CLAIM_TTL_MINUTES} minutes')
                 )
             AND ($1 = 'any' OR segment = $1)
           ORDER BY random()
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE callcenter_leads l
         SET status = 'claimed',
             claimed_by = $2,
             claimed_at = NOW(),
             updated_at = NOW()
         FROM candidate
         WHERE l.id = candidate.id
         RETURNING l.*`,
        [segment, req.agent]
      );

      if (claimRes.rows.length === 0) {
        await client.query('COMMIT');
        break; // Pool empty — return {lead: null}
      }

      const cand = claimRes.rows[0];

      // Registered_meanwhile pre-check on the freshly claimed lead.
      const regRes = await client.query(
        `SELECT 1 FROM visitors WHERE expo_id = $1 AND lower(email) = lower($2) LIMIT 1`,
        [cand.expo_id, cand.email]
      );

      if (regRes.rows.length > 0) {
        // Already registered — auto-close and try again.
        await client.query(
          `UPDATE callcenter_leads
           SET status = 'done',
               outcome = 'registered_meanwhile',
               done_at = NOW(),
               note = COALESCE(NULLIF(note,'') || E'\n', '') || $2,
               updated_at = NOW()
           WHERE id = $1`,
          [cand.id, `Auto-closed by /next: visitor row exists on expo ${cand.expo_id} (claimed_by=${req.agent}, attempt ${attempts}).`]
        );
        await client.query('COMMIT');
        continue; // Loop and try to grab another lead.
      }

      // Segment A: also compute attended_2025 for the agent card.
      let attended = false;
      if (cand.segment === 'A') {
        attended = await attendedIn2025(client, cand.email);
      }

      // Stage 3b — enrich with per-lead mail status for the agent card's
      // status strip. Read-only (email_events + email_queue). One indexed
      // query per lead. Runs inside the transaction, but doesn't take any
      // locks — pure SELECT. If the enrichment throws, log and return
      // empty defaults rather than failing the whole /next call (the
      // agent still needs a lead to work).
      let mailStatus = {
        mail_sent_at: null, mail_status: 'none',
        opened_at: null, clicked_at: null, badge_mail_sent_at: null
      };
      try {
        mailStatus = await enrichMailStatus(client, cand);
      } catch (mailErr) {
        console.error(`[callcenter /next] mail enrichment failed for lead ${cand.id}:`, mailErr.message);
      }

      await client.query('COMMIT');
      lead = { ...cand, attended_2025: attended ? 'yes' : 'no', ...mailStatus };
      break;
    }

    // Pool remaining (approximate — no lock, purely informational)
    const poolRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM callcenter_leads
       WHERE (status = 'new' OR (status = 'callback' AND callback_at <= NOW()))
         AND ($1 = 'any' OR segment = $1)`,
      [segment]
    );

    _cacheBust();
    return res.json({
      success: true,
      lead,
      remaining_pool: poolRes.rows[0].n,
      attempts_used: attempts
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[callcenter /next] Error:', err.message);
    return res.status(500).json({ success: false, error: 'next failed', code: 'NEXT_ERROR' });
  } finally {
    client.release();
  }
});

// ============================================================
// POST /api/callcenter/skip/:id — release claim, back to pool
// ============================================================
// Guard: only the current claimer can release. Anyone else → 409.
router.post('/skip/:id', agentAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, error: 'id must be an integer' });
  }
  try {
    const r = await pool.query(
      `UPDATE callcenter_leads
       SET status = 'new',
           claimed_by = NULL,
           claimed_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND claimed_by = $2 AND status = 'claimed'
       RETURNING id`,
      [id, req.agent]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'lead not claimed by you (may have been taken or already resolved)',
        code: 'SKIP_NOT_OWNED'
      });
    }
    _cacheBust();
    res.json({ success: true, id });
  } catch (err) {
    console.error('[callcenter /skip] Error:', err.message);
    res.status(500).json({ success: false, error: 'skip failed', code: 'SKIP_ERROR' });
  }
});

// ============================================================
// POST /api/callcenter/outcome/:id — record outcome + optional data-fix patch
// ============================================================
// Body: {
//   outcome: <one of the CHECK constraint values, matched to segment in UI>,
//   note?: string,
//   callback_hours?: number (only meaningful for outcome === 'callback'),
//   patch?: { phone, first_name, last_name, company, email } (all optional)
// }
// Guard: WHERE id=$1 AND claimed_by=$agent AND status='claimed' — 409 if 0
//        rows updated (someone else took over, or lead is already done).
const VALID_OUTCOMES = new Set([
  'mail_will_come','mail_wont_come','no_mail_whatsapp_sent',
  'callback','no_answer','wrong_number','not_interested','registered_meanwhile'
]);
router.post('/outcome/:id', agentAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, error: 'id must be an integer' });
  }
  const { outcome, note, callback_hours, patch } = (req.body || {});
  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return res.status(400).json({
      success: false,
      error: 'outcome must be one of: ' + [...VALID_OUTCOMES].join(', ')
    });
  }

  // Normalise patch — only 5 columns are agent-editable; anything else is
  // silently dropped (never sent to the DB).
  const p = (patch && typeof patch === 'object') ? patch : {};
  const patchCols = ['phone','first_name','last_name','company','email'];
  const patchValues = {};
  for (const k of patchCols) {
    if (Object.prototype.hasOwnProperty.call(p, k) && p[k] != null) {
      const v = String(p[k]).trim();
      if (v.length > 0 && v.length <= 500) patchValues[k] = v;
    }
  }

  // Callback timing
  let callbackAtExpr = null;
  if (outcome === 'callback') {
    const hours = Math.max(1, Math.min(72, parseInt(callback_hours, 10) || 1));
    callbackAtExpr = `NOW() + INTERVAL '${hours} hours'`;
  }

  // Build the UPDATE dynamically. Whitelist columns only.
  const sets = [];
  const params = [];
  let idx = 1;
  for (const k of patchCols) {
    if (patchValues[k] !== undefined) {
      sets.push(`${k} = $${idx++}`);
      params.push(patchValues[k]);
    }
  }
  sets.push(`outcome = $${idx++}`); params.push(outcome);
  if (typeof note === 'string' && note.length > 0) {
    sets.push(`note = COALESCE(NULLIF(note,'') || E'\\n', '') || $${idx++}`);
    params.push(`[${req.agent} @ ${new Date().toISOString()}] ${note.slice(0, 1000)}`);
  }
  if (outcome === 'callback') {
    sets.push(`status = 'callback'`);
    sets.push(`callback_at = ${callbackAtExpr}`);
  } else {
    sets.push(`status = 'done'`);
    sets.push(`done_at = NOW()`);
  }
  sets.push(`updated_at = NOW()`);

  params.push(id, req.agent);
  const idParam = `$${idx++}`;
  const agentParam = `$${idx++}`;

  const sql = `UPDATE callcenter_leads
               SET ${sets.join(', ')}
               WHERE id = ${idParam}
                 AND claimed_by = ${agentParam}
                 AND status = 'claimed'
               RETURNING id, status, outcome, done_at, callback_at`;

  try {
    const r = await pool.query(sql, params);
    if (r.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'lead not claimed by you or already resolved',
        code: 'OUTCOME_NOT_OWNED'
      });
    }
    _cacheBust();
    res.json({ success: true, lead: r.rows[0] });
  } catch (err) {
    console.error('[callcenter /outcome] Error:', err.message);
    res.status(500).json({ success: false, error: 'outcome failed', code: 'OUTCOME_ERROR' });
  }
});

// ============================================================
// POST /api/callcenter/resend/:id — segment A only, per-lead email_queue Mode 1
// ============================================================
// Builds one email_queue Mode 1 INSERT for the lead's reactivation_token,
// reusing template 74 (SIEMA activate). Mirrors the shape of the resend-
// pending path (routes/reactivation.js:1005-1021) but per-token instead
// of per-expo. Rate-limited to one resend per lead per 2 minutes.
router.post('/resend/:id', agentAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, error: 'id must be an integer' });
  }

  const client = await pool.connect();
  try {
    // Load lead + guard: must be claimed by this agent, segment A, has token
    const leadRes = await client.query(
      `SELECT id, segment, email, reactivation_token, expo_id, first_name, last_name,
              company, country
       FROM callcenter_leads
       WHERE id = $1 AND claimed_by = $2 AND status = 'claimed' LIMIT 1`,
      [id, req.agent]
    );
    if (leadRes.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'lead not claimed by you or already resolved',
        code: 'RESEND_NOT_OWNED'
      });
    }
    const lead = leadRes.rows[0];
    if (lead.segment !== 'A') {
      return res.status(400).json({
        success: false,
        error: 'resend is only available for segment A leads',
        code: 'RESEND_WRONG_SEGMENT'
      });
    }
    if (!lead.reactivation_token) {
      return res.status(400).json({
        success: false,
        error: 'lead has no reactivation_token (was it imported with one?)',
        code: 'RESEND_NO_TOKEN'
      });
    }

    // Verify the token is still pending on reactivation_tokens (may have
    // been activated or expired since import). Read-only. Also fetch the
    // token's own email — resend sends to THAT address, never the lead's
    // (possibly agent-patched) email. Reason: the activation link is
    // bound to the token, which is bound to the recipient's original
    // address on reactivation_tokens.email; sending the same link to a
    // different address just means the wrong person activates the wrong
    // token. Suer's rule 7 Sep: for a mistyped-email case, agents click
    // Register now (form 59) instead of Resend.
    const tokRes = await client.query(
      `SELECT status, expires_at, organizer_id, target_expo_id, email
       FROM reactivation_tokens WHERE token = $1 LIMIT 1`,
      [lead.reactivation_token]
    );
    if (tokRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'reactivation token not found',
        code: 'RESEND_TOKEN_MISSING'
      });
    }
    const tok = tokRes.rows[0];
    if (tok.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `token status is '${tok.status}', cannot resend`,
        code: 'RESEND_TOKEN_NOT_PENDING'
      });
    }
    if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'token has expired, cannot resend',
        code: 'RESEND_TOKEN_EXPIRED'
      });
    }

    // Cooldown: don't queue another mail for the same recipient within N min.
    // Keyed on the TOKEN'S email (the address the resend actually goes to)
    // so an agent can't bypass the cooldown by patching the lead email.
    const cdRes = await client.query(
      `SELECT 1 FROM email_queue
       WHERE lower(recipient_email) = lower($1)
         AND created_at > NOW() - INTERVAL '${RESEND_COOLDOWN_MINUTES} minutes' LIMIT 1`,
      [tok.email]
    );
    if (cdRes.rows.length > 0) {
      return res.status(429).json({
        success: false,
        error: `resend cooldown (${RESEND_COOLDOWN_MINUTES} min per lead) — try again shortly`,
        code: 'RESEND_COOLDOWN'
      });
    }

    // Load template 74. Fail if template is missing or inactive.
    const tplRes = await client.query(
      `SELECT id, subject, html_content, organizer_id
       FROM email_templates WHERE id = $1 LIMIT 1`,
      [SIEMA_ACTIVATE_TEMPLATE_ID]
    );
    if (tplRes.rows.length === 0) {
      return res.status(500).json({
        success: false,
        error: `template ${SIEMA_ACTIVATE_TEMPLATE_ID} not found`,
        code: 'RESEND_TEMPLATE_MISSING'
      });
    }
    const template = tplRes.rows[0];

    // Resolve expo name (for the {{expo_name}} placeholder).
    const expoRes = await client.query(
      `SELECT name, country_code FROM expos WHERE id = $1 LIMIT 1`,
      [tok.target_expo_id]
    );
    const expoName = (expoRes.rows[0] && expoRes.rows[0].name) || '';
    const expoCountryCode = (expoRes.rows[0] && expoRes.rows[0].country_code) || '';

    // Activation URL — canonical shape from campaignBuilder.js:1186 +
    // 1157 (language rule). Morocco → reactivate-fr.html; else EN.
    const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
    const activationPage = expoCountryCode === 'MA' ? 'reactivate-fr.html' : 'reactivate.html';
    const activationUrl = `${baseUrl}/${activationPage}?token=${lead.reactivation_token}`;

    // Template placeholders use the TOKEN'S email (destination address) —
    // consistent with how the campaign worker fills these keys against
    // the actual recipient row, not a lead's patched value.
    const templateData = {
      name: lead.first_name || '',
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: tok.email,
      company: lead.company || '',
      country: lead.country || '',
      activation_url: activationUrl,
      expo_name: expoName,
      date: new Date().toLocaleDateString()
    };

    const htmlContent = processEmailTemplate(template.html_content || '', templateData);
    const subject = processEmailTemplate(template.subject || 'Reminder: Activate Your Visitor Pass', templateData);

    // Queue Mode 1 — same shape as the resend-pending path. Worker drains
    // it in one PROCESS_INTERVAL cycle (2 s).
    await client.query(
      `INSERT INTO email_queue (
         organizer_id, expo_id, visitor_id, template_id,
         recipient_email, subject, html_content,
         status, created_at
       ) VALUES ($1, $2, NULL, $3, $4, $5, $6, 'pending', NOW())`,
      [tok.organizer_id, tok.target_expo_id, SIEMA_ACTIVATE_TEMPLATE_ID,
       tok.email, subject, htmlContent]
    );

    // Audit note on the lead — record BOTH addresses when they differ so
    // supervisors can see the agent tried to patch and the resend still
    // went to the token's address (matches the client-side hint).
    const emailNote = (tok.email.toLowerCase() === (lead.email || '').toLowerCase())
      ? tok.email
      : `${tok.email} (lead email is ${lead.email} — resend uses token's address)`;
    await client.query(
      `UPDATE callcenter_leads
       SET note = COALESCE(NULLIF(note,'') || E'\\n', '') || $2,
           updated_at = NOW()
       WHERE id = $1`,
      [id, `[${req.agent}] Resent activation email to ${emailNote} at ${new Date().toISOString()}.`]
    );

    _cacheBust();
    res.json({
      success: true,
      id,
      queued: 1,
      template_id: SIEMA_ACTIVATE_TEMPLATE_ID,
      sent_to: tok.email     // client shows this in a toast so the agent sees where the mail went
    });
  } catch (err) {
    console.error('[callcenter /resend] Error:', err.message);
    res.status(500).json({ success: false, error: 'resend failed', code: 'RESEND_ERROR' });
  } finally {
    client.release();
  }
});

// ============================================================
// GET /api/callcenter/stats/me — personal per-agent stats today
// ============================================================
router.get('/stats/me', agentAuth, async (req, res) => {
  try {
    const todayStart = casaTodayStartUtc();

    const [callsRes, outcomesRes, poolRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS calls
         FROM callcenter_leads
         WHERE claimed_by = $1 AND done_at >= $2`,
        [req.agent, todayStart]
      ),
      pool.query(
        `SELECT outcome, COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE claimed_by = $1 AND done_at >= $2
         GROUP BY outcome ORDER BY n DESC`,
        [req.agent, todayStart]
      ),
      pool.query(
        `SELECT segment, COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE status = 'new' OR (status = 'callback' AND callback_at <= NOW())
         GROUP BY segment ORDER BY segment`
      )
    ]);

    const outcomes = {};
    for (const r of outcomesRes.rows) outcomes[r.outcome] = r.n;
    const pool_by_segment = {};
    let pool_total = 0;
    for (const r of poolRes.rows) { pool_by_segment[r.segment] = r.n; pool_total += r.n; }

    res.json({
      success: true,
      agent: req.agent,
      today_casa_start: todayStart,
      calls_today: callsRes.rows[0].calls,
      outcomes,
      pool: { total: pool_total, by_segment: pool_by_segment }
    });
  } catch (err) {
    console.error('[callcenter /stats/me] Error:', err.message);
    res.status(500).json({ success: false, error: 'stats failed', code: 'STATS_ME_ERROR' });
  }
});

// ============================================================
// GET /api/callcenter/stats/live — supervisor dashboard, 15 s cache
// ============================================================
// Per-agent table, hourly line (last 24 h Casablanca), last 20 calls,
// registered-after-call, checked-in. Design R-6 caching.
router.get('/stats/live', supervisorAuth, async (req, res) => {
  const win = parseWindow(req.query);
  const cacheKey = `live:${win.key}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  // Every query threads $1 (start) and $2 (end). NULL start = no lower bound;
  // NULL end = no upper bound. The predicate is inline: pass NULL and the
  // OR-branch short-circuits it. Same $-positions in every query below.
  const wParams = [win.start, win.end];
  const W = '($1::timestamptz IS NULL OR done_at >= $1) AND ($2::timestamptz IS NULL OR done_at < $2)';

  try {
    const [perAgent, outcomeBars, hourly, last20, regAfter] = await Promise.all([
      pool.query(
        `SELECT COALESCE(claimed_by, '(unclaimed)') AS agent,
                COUNT(*) FILTER (WHERE ${W})::int AS calls_today,
                COUNT(*) FILTER (WHERE done_at IS NOT NULL)::int AS calls_all_time,
                COUNT(*) FILTER (WHERE outcome = 'mail_will_come'    AND ${W})::int AS mail_will,
                COUNT(*) FILTER (WHERE outcome = 'mail_wont_come'    AND ${W})::int AS mail_wont,
                COUNT(*) FILTER (WHERE outcome = 'no_mail_whatsapp_sent' AND ${W})::int AS whatsapp,
                COUNT(*) FILTER (WHERE outcome = 'callback'          AND ${W})::int AS callback_cnt,
                COUNT(*) FILTER (WHERE outcome = 'no_answer'         AND ${W})::int AS no_answer,
                COUNT(*) FILTER (WHERE outcome = 'wrong_number'      AND ${W})::int AS wrong_num,
                COUNT(*) FILTER (WHERE outcome = 'not_interested'    AND ${W})::int AS not_interested,
                COUNT(*) FILTER (WHERE outcome = 'registered_meanwhile' AND ${W})::int AS reg_meanwhile,
                MAX(done_at)                                                                   AS last_call
         FROM callcenter_leads
         WHERE claimed_by IS NOT NULL
         GROUP BY agent
         ORDER BY calls_today DESC, agent ASC`,
        wParams
      ),
      pool.query(
        `SELECT COALESCE(outcome, '(none)') AS outcome, COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE ${W}
         GROUP BY outcome ORDER BY n DESC`,
        wParams
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM (done_at AT TIME ZONE 'Africa/Casablanca'))::int AS hour,
                COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE ${W}
         GROUP BY hour ORDER BY hour`,
        wParams
      ),
      pool.query(
        // A1 (Suer 11 Sep): explicit `done_at IS NOT NULL` here — under
        // range=all the window predicate is TRUE, and DESC ordering would
        // surface still-open cards (claimed/new, done_at=NULL) at the top.
        `SELECT id, segment, claimed_by, outcome, done_at, email, phone, first_name, last_name
         FROM callcenter_leads
         WHERE ${W} AND done_at IS NOT NULL
         ORDER BY done_at DESC LIMIT 20`,
        wParams
      ),
      // registered-after-call — visitor row created after done_at, matched
      // on email + expo_id. Grouped by agent for the supervisor's table.
      pool.query(
        `SELECT l.claimed_by AS agent,
                COUNT(*)::int AS registered_after,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM checkins c
                  WHERE c.visitor_id = v.id
                ))::int AS checked_in
         FROM callcenter_leads l
         JOIN visitors v
           ON v.expo_id = l.expo_id AND lower(v.email) = lower(l.email)
         WHERE ($1::timestamptz IS NULL OR l.done_at >= $1)
           AND ($2::timestamptz IS NULL OR l.done_at <  $2)
           AND l.done_at IS NOT NULL
           AND v.created_at > l.done_at
         GROUP BY l.claimed_by
         ORDER BY registered_after DESC`,
        wParams
      )
    ]);

    // Merge registered/checked-in into per-agent by name.
    const regByAgent = {};
    for (const r of regAfter.rows) {
      regByAgent[r.agent] = { registered_after: r.registered_after, checked_in: r.checked_in };
    }
    const perAgentEnriched = perAgent.rows.map(r => ({
      ...r,
      registered_after: (regByAgent[r.agent] && regByAgent[r.agent].registered_after) || 0,
      checked_in:       (regByAgent[r.agent] && regByAgent[r.agent].checked_in) || 0
    }));

    const body = {
      success: true,
      generated_at: new Date().toISOString(),
      window: { start: win.start, end: win.end, label: win.label, key: win.key },
      per_agent: perAgentEnriched,
      outcome_bars: outcomeBars.rows,
      hourly: hourly.rows,           // [{hour: 0..23, n}]
      last_20: last20.rows,
      totals: {
        calls_today: perAgentEnriched.reduce((s, r) => s + r.calls_today, 0),
        agents_active_today: perAgentEnriched.filter(r => r.calls_today > 0).length,
        registered_after_total: perAgentEnriched.reduce((s, r) => s + r.registered_after, 0),
        checked_in_total: perAgentEnriched.reduce((s, r) => s + r.checked_in, 0)
      }
    };
    _cachePut(cacheKey, body);
    res.json({ ...body, cached: false });
  } catch (err) {
    console.error('[callcenter /stats/live] Error:', err.message);
    res.status(500).json({ success: false, error: 'stats/live failed', code: 'STATS_LIVE_ERROR' });
  }
});

// ============================================================
// GET /api/callcenter/stats/agent/:name — per-agent drill-down (supervisor)
// ============================================================
router.get('/stats/agent/:name', supervisorAuth, async (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'name required' });
  try {
    const todayStart = casaTodayStartUtc();

    const [summary, last100, outcomes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE done_at >= $2)::int AS calls_today,
           COUNT(*) FILTER (WHERE done_at IS NOT NULL)::int AS calls_all_time,
           MAX(done_at) AS last_call
         FROM callcenter_leads WHERE claimed_by = $1`,
        [name, todayStart]
      ),
      pool.query(
        `SELECT id, segment, outcome, done_at, callback_at, email, phone,
                first_name, last_name, LEFT(note, 400) AS note_head
         FROM callcenter_leads
         WHERE claimed_by = $1 AND done_at IS NOT NULL
         ORDER BY done_at DESC LIMIT 100`,
        [name]
      ),
      pool.query(
        `SELECT outcome, COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE claimed_by = $1 AND done_at >= $2
         GROUP BY outcome ORDER BY n DESC`,
        [name, todayStart]
      )
    ]);

    res.json({
      success: true,
      agent: name,
      today_casa_start: todayStart,
      summary: summary.rows[0],
      outcomes_today: outcomes.rows,
      last_100: last100.rows
    });
  } catch (err) {
    console.error('[callcenter /stats/agent] Error:', err.message);
    res.status(500).json({ success: false, error: 'stats/agent failed', code: 'STATS_AGENT_ERROR' });
  }
});

// ============================================================
// GET /api/callcenter/admin/dump — export current state as xlsx (JWT)
// ============================================================
// Sensitive columns excluded: reactivation_token (per-recipient secret).
// Returns application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
router.get('/admin/dump', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, segment, source, list_id, expo_id,
              email, phone, first_name, last_name, company, country,
              status, claimed_by, claimed_at, done_at, outcome, note, callback_at,
              created_at, updated_at
       FROM callcenter_leads
       ORDER BY id`
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(r.rows);
    XLSX.utils.book_append_sheet(wb, ws, 'callcenter_leads');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fname = `callcenter_dump_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (err) {
    console.error('[callcenter /admin/dump] Error:', err.message);
    res.status(500).json({ success: false, error: 'dump failed', code: 'DUMP_ERROR' });
  }
});

// ============================================================
// POST /api/callcenter/report/send-now — daily report → email_queue Mode 1
// ============================================================
// Reads CALLCENTER_REPORT_TO env var. Builds an HTML body with today's
// per-agent numbers + outcome breakdown + totals + registered-after-call.
// Queues one Mode 1 email_queue row. Worker drains it in one cycle.
// ============================================================
// POST /api/callcenter/admin/import — xlsx bulk import (JWT)
// ============================================================
// Two-step:
//   dry_run=true (default)  → returns per-sheet counts, missing-phone, dupes
//                               against existing callcenter_leads on (expo_id, phone).
//                               No writes.
//   dry_run=false           → INSERT rows. source = original filename.
//                               Phones already present on (expo_id, phone-key) skipped.
//
// Sheet name convention (from Stage-1 design + the 7 Sep dump script):
//   A_activate   → segment='A'
//   B_registered → segment='B'
//   C_register   → segment='C'
// Any other sheet is ignored.
//
// Column names accepted, case-insensitive:
//   email | name / first_name | last_name | company | country | phone
// A rows additionally get reactivation_token looked up from
// reactivation_tokens where email+target_expo_id match.
//
// Mirrors routes/visitors.js:606 upload+XLSX shape (line 22 multer +
// 631-634 sheet read). Same memory-buffer pattern; no on-disk temp file.
router.post('/admin/import', authMiddleware, uploadCallcenter.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded', code: 'NO_FILE' });
    }
    const expoId = parseInt(req.body.expo_id, 10);
    if (!expoId || isNaN(expoId)) {
      return res.status(400).json({ success: false, error: 'expo_id is required (integer)', code: 'NO_EXPO' });
    }
    const dryRun = String(req.body.dry_run || 'true') !== 'false';
    const sourceName = String(req.file.originalname || 'unknown.xlsx').slice(0, 50);

    // Parse workbook
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const SHEET_TO_SEGMENT = { 'A_activate': 'A', 'B_registered': 'B', 'C_register': 'C' };

    // Row normaliser — case-insensitive header lookup, first non-empty match wins.
    // Preserves the ordering + trimming discipline used by the 7 Sep export.
    const rowGet = (row, ...keys) => {
      const lowerMap = {};
      for (const k of Object.keys(row)) lowerMap[k.toLowerCase().trim()] = row[k];
      for (const key of keys) {
        const v = lowerMap[key.toLowerCase()];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
      return '';
    };
    // Phone key for dedupe — digits-only. Matches the wa.me/normalisation
    // shape and keeps "+212..." vs "00212..." from being counted as different.
    const phoneKey = raw => String(raw || '').replace(/[^\d]/g, '');

    // Collect + shape rows
    const perSheet = {};        // { A: {read, no_phone, dupe, valid}, ... }
    const validRowsBySegment = { A: [], B: [], C: [] };

    // Pre-load existing (expo_id, phone-digit-key) so dedupe is O(1) per row.
    // Small enough on any single expo (SIEMA-scale = ~32k leads).
    const existingRes = await pool.query(
      `SELECT phone FROM callcenter_leads WHERE expo_id = $1 AND COALESCE(phone,'') <> ''`,
      [expoId]
    );
    const existingKeys = new Set(existingRes.rows.map(r => phoneKey(r.phone)));

    for (const sheetName of wb.SheetNames) {
      const segment = SHEET_TO_SEGMENT[sheetName];
      if (!segment) continue; // skip Summary + anything else
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      const stats = { read: rows.length, no_phone: 0, dupe: 0, valid: 0 };

      // Per-sheet dedupe (in case the same phone appears twice inside the file itself)
      const sheetSeen = new Set();

      for (const row of rows) {
        const email = rowGet(row, 'email').toLowerCase();
        const phoneRaw = rowGet(row, 'phone');
        const key = phoneKey(phoneRaw);
        if (!key) { stats.no_phone++; continue; }
        if (existingKeys.has(key) || sheetSeen.has(key)) { stats.dupe++; continue; }
        sheetSeen.add(key);
        stats.valid++;
        validRowsBySegment[segment].push({
          email,
          phone: phoneRaw,
          first_name: rowGet(row, 'first_name', 'name'),
          last_name: rowGet(row, 'last_name'),
          company: rowGet(row, 'company'),
          country: rowGet(row, 'country')
        });
      }
      perSheet[sheetName] = { segment, ...stats };
    }

    // Dry-run — return counts, no writes
    const summary = {
      source: sourceName,
      expo_id: expoId,
      per_sheet: perSheet,
      totals: {
        read:     Object.values(perSheet).reduce((s, x) => s + x.read, 0),
        no_phone: Object.values(perSheet).reduce((s, x) => s + x.no_phone, 0),
        dupe:     Object.values(perSheet).reduce((s, x) => s + x.dupe, 0),
        valid:    Object.values(perSheet).reduce((s, x) => s + x.valid, 0)
      },
      existing_leads_on_expo: existingKeys.size
    };

    if (dryRun) {
      return res.json({ success: true, dry_run: true, ...summary });
    }

    // Real import — batch INSERT per segment, chunked at 500 rows per statement.
    // Segment A rows also fetch reactivation_token by email + target_expo_id
    // (read-only lookup on reactivation_tokens; not written).
    const client = await pool.connect();
    const insertedBySegment = { A: 0, B: 0, C: 0 };
    try {
      await client.query('BEGIN');

      for (const segment of ['A', 'B', 'C']) {
        const rows = validRowsBySegment[segment];
        if (rows.length === 0) continue;

        // For A: fetch existing tokens for these emails in bulk.
        const tokenByEmail = new Map();
        if (segment === 'A') {
          const emails = rows.map(r => r.email).filter(Boolean);
          if (emails.length > 0) {
            const tr = await client.query(
              `SELECT lower(email) AS email, token
               FROM reactivation_tokens
               WHERE target_expo_id = $1 AND lower(email) = ANY($2)`,
              [expoId, emails]
            );
            for (const r of tr.rows) tokenByEmail.set(r.email, r.token);
          }
        }

        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const values = [];
          const params = [];
          let p = 1;
          for (const r of chunk) {
            values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'new')`);
            params.push(
              segment, sourceName, expoId,
              r.email || '', r.phone || '',
              r.first_name || null, r.last_name || null,
              r.company || null, r.country || null,
              segment === 'A' ? (tokenByEmail.get(r.email) || null) : null
            );
          }
          const q = `INSERT INTO callcenter_leads
                       (segment, source, expo_id, email, phone,
                        first_name, last_name, company, country,
                        reactivation_token, status)
                     VALUES ${values.join(',')}`;
          const ins = await client.query(q, params);
          insertedBySegment[segment] += ins.rowCount || 0;
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      client.release();
      console.error('[callcenter /admin/import] tx error:', txErr.message);
      return res.status(500).json({ success: false, error: 'import failed: ' + txErr.message, code: 'IMPORT_TX_ERROR' });
    }
    client.release();

    _cacheBust();
    return res.json({
      success: true,
      dry_run: false,
      inserted_by_segment: insertedBySegment,
      inserted_total: insertedBySegment.A + insertedBySegment.B + insertedBySegment.C,
      ...summary
    });
  } catch (err) {
    console.error('[callcenter /admin/import] Error:', err.message);
    return res.status(500).json({ success: false, error: 'import failed', code: 'IMPORT_ERROR' });
  }
});

router.post('/report/send-now', authMiddleware, async (req, res) => {
  // CALLCENTER_REPORT_TO may be a single email or a comma-separated list.
  // Split, trim, drop empties + non-emails, dedupe (case-insensitive).
  // One email_queue Mode 1 row per recipient. Response lists them so
  // the admin sees exactly who was queued.
  const raw = process.env.CALLCENTER_REPORT_TO || '';
  const seen = new Set();
  const recipients = raw
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (recipients.length === 0) {
    return res.status(503).json({
      success: false,
      error: 'CALLCENTER_REPORT_TO env var not set or has no valid addresses',
      code: 'REPORT_TO_NOT_SET'
    });
  }

  try {
    const todayStart = casaTodayStartUtc();
    const casaDate = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date());

    const [perAgent, outcomes, regAfter, poolLeft] = await Promise.all([
      pool.query(
        `SELECT COALESCE(claimed_by, '(unclaimed)') AS agent,
                COUNT(*) FILTER (WHERE done_at >= $1)::int AS calls_today,
                COUNT(*) FILTER (WHERE outcome = 'mail_will_come'    AND done_at >= $1)::int AS mail_will,
                COUNT(*) FILTER (WHERE outcome = 'mail_wont_come'    AND done_at >= $1)::int AS mail_wont,
                COUNT(*) FILTER (WHERE outcome = 'no_mail_whatsapp_sent' AND done_at >= $1)::int AS whatsapp,
                COUNT(*) FILTER (WHERE outcome = 'callback'          AND done_at >= $1)::int AS callback_cnt,
                COUNT(*) FILTER (WHERE outcome = 'no_answer'         AND done_at >= $1)::int AS no_answer,
                COUNT(*) FILTER (WHERE outcome = 'wrong_number'      AND done_at >= $1)::int AS wrong_num,
                COUNT(*) FILTER (WHERE outcome = 'not_interested'    AND done_at >= $1)::int AS not_interested,
                COUNT(*) FILTER (WHERE outcome = 'registered_meanwhile' AND done_at >= $1)::int AS reg_meanwhile
         FROM callcenter_leads
         WHERE claimed_by IS NOT NULL AND done_at >= $1
         GROUP BY agent ORDER BY calls_today DESC`,
        [todayStart]
      ),
      pool.query(
        `SELECT COALESCE(outcome,'(none)') AS outcome, COUNT(*)::int AS n
         FROM callcenter_leads WHERE done_at >= $1
         GROUP BY outcome ORDER BY n DESC`,
        [todayStart]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS reg_after,
                COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id))::int AS checked_in
         FROM callcenter_leads l
         JOIN visitors v ON v.expo_id = l.expo_id AND lower(v.email) = lower(l.email)
         WHERE l.done_at >= $1 AND v.created_at > l.done_at`,
        [todayStart]
      ),
      pool.query(
        `SELECT segment, COUNT(*)::int AS n
         FROM callcenter_leads
         WHERE status = 'new' OR (status = 'callback' AND callback_at <= NOW())
         GROUP BY segment ORDER BY segment`
      )
    ]);

    // HTML — plain, table-based, no external CSS.
    const agentRows = perAgent.rows.map(r => `
      <tr>
        <td>${esc(r.agent)}</td>
        <td style="text-align:right;">${r.calls_today}</td>
        <td style="text-align:right;">${r.mail_will}</td>
        <td style="text-align:right;">${r.mail_wont}</td>
        <td style="text-align:right;">${r.whatsapp}</td>
        <td style="text-align:right;">${r.callback_cnt}</td>
        <td style="text-align:right;">${r.no_answer}</td>
        <td style="text-align:right;">${r.wrong_num}</td>
        <td style="text-align:right;">${r.not_interested}</td>
        <td style="text-align:right;">${r.reg_meanwhile}</td>
      </tr>`).join('');

    const outcomeRows = outcomes.rows.map(r => `
      <tr><td>${esc(r.outcome)}</td><td style="text-align:right;">${r.n}</td></tr>`).join('');

    const poolRows = poolLeft.rows.map(r => `
      <tr><td>Segment ${esc(r.segment)}</td><td style="text-align:right;">${r.n}</td></tr>`).join('');

    const reg = regAfter.rows[0] || { reg_after: 0, checked_in: 0 };
    const totalCalls = perAgent.rows.reduce((s, r) => s + r.calls_today, 0);

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;">
<h2>SIEMA Call-Center — Daily Report</h2>
<p><strong>${esc(casaDate)}</strong> (Africa/Casablanca)</p>
<p>Total calls today: <strong>${totalCalls}</strong> · Agents active: <strong>${perAgent.rows.length}</strong> · Registered after call: <strong>${reg.reg_after}</strong> · Checked in at fair: <strong>${reg.checked_in}</strong></p>
<h3>Per agent</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <thead style="background:#f3f4f6;">
    <tr><th>Agent</th><th>Calls</th><th>Will come</th><th>Won't come</th><th>WhatsApp</th><th>Callback</th><th>No answer</th><th>Wrong #</th><th>Not int.</th><th>Reg. meanwhile</th></tr>
  </thead>
  <tbody>${agentRows || '<tr><td colspan="10" style="text-align:center;color:#888;">No calls today.</td></tr>'}</tbody>
</table>
<h3 style="margin-top:24px;">Outcome breakdown</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <thead style="background:#f3f4f6;"><tr><th>Outcome</th><th>Count</th></tr></thead>
  <tbody>${outcomeRows || '<tr><td colspan="2" style="text-align:center;color:#888;">—</td></tr>'}</tbody>
</table>
<h3 style="margin-top:24px;">Pool remaining</h3>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:13px;">
  <tbody>${poolRows || '<tr><td colspan="2" style="text-align:center;color:#888;">Pool empty.</td></tr>'}</tbody>
</table>
<p style="color:#888;font-size:12px;margin-top:24px;">Automated report from Leena call-center module. Sent to <code>${esc(to)}</code>.</p>
</body></html>`;

    const subject = `SIEMA Call-Center — ${casaDate} — ${totalCalls} calls`;

    // One Mode 1 row per recipient. Loop is cheap (recipients count is
    // ops-controlled — a handful of stakeholder emails, not campaign scale).
    for (const rcpt of recipients) {
      await pool.query(
        `INSERT INTO email_queue (
           organizer_id, expo_id, visitor_id, template_id,
           recipient_email, subject, html_content,
           status, created_at
         ) VALUES (1, 9, NULL, NULL, $1, $2, $3, 'pending', NOW())`,
        [rcpt, subject, html]
      );
    }

    res.json({
      success: true,
      queued: recipients.length,
      to: recipients,           // array — the admin page can show all addresses
      subject,
      totals: { calls_today: totalCalls, agents: perAgent.rows.length, registered_after: reg.reg_after, checked_in: reg.checked_in }
    });
  } catch (err) {
    console.error('[callcenter /report/send-now] Error:', err.message);
    res.status(500).json({ success: false, error: 'report send failed', code: 'REPORT_ERROR' });
  }
});

module.exports = router;
