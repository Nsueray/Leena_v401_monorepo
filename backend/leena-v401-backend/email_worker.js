// email_worker.js
// Leena EMS v403 - Email Queue Worker
// Supports both visitor+template mode and direct html_content mode
// v403: Batch processing support via EMAIL_WORKER_BATCH_SIZE env var

const { Pool } = require('pg');
require('dotenv').config();
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate, formatConferenceTopic } = require('./utils/email');
const { injectTrackingPixel, injectUnsubscribeLink, generateUnsubscribeToken, wrapClickLinks, appendCampaignTokenToFormLinks, getListUnsubscribeHeaders } = require('./utils/trackingPixel');

// --- Database pool (ENV-based SSL handling) ---
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const PROCESS_INTERVAL = 2000;
const MAX_RETRIES = 5;
const BATCH_SIZE = Math.max(1, parseInt(process.env.EMAIL_WORKER_BATCH_SIZE || '1', 10));
const TRANSACTIONAL_BATCH_SIZE = 10;
let isProcessing = false;

// ============================================================
// FETCH: Two-tier priority queue
// Priority 1: Transactional emails (campaign_id IS NULL) — up to 10
// Priority 2: Campaign emails (campaign_id IS NOT NULL) — up to BATCH_SIZE
// Each cycle picks ONE category, never mixes.
// ============================================================

async function fetchNextBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Priority 1: Transactional emails (registration, badge, reactivation, etc.)
    let lockRes = await client.query(`
      UPDATE email_queue SET status = 'processing'
      WHERE id IN (
        SELECT id FROM email_queue
        WHERE status = 'pending' AND try_count < $1 AND campaign_id IS NULL
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `, [MAX_RETRIES, TRANSACTIONAL_BATCH_SIZE]);

    let batchType = 'transactional';

    // Priority 2: Campaign emails (only if no transactional pending)
    if (lockRes.rows.length === 0) {
      lockRes = await client.query(`
        UPDATE email_queue SET status = 'processing'
        WHERE id IN (
          SELECT id FROM email_queue
          WHERE status = 'pending' AND try_count < $1 AND campaign_id IS NOT NULL
          ORDER BY created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `, [MAX_RETRIES, BATCH_SIZE]);
      batchType = 'campaign';
    }

    if (lockRes.rows.length === 0) {
      await client.query('COMMIT');
      return { tasks: [], type: 'none' };
    }

    const taskIds = lockRes.rows.map(r => r.id);

    // Fetch full details for all locked rows
    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
    const res = await client.query(`
      SELECT
        eq.*,
        v.name as visitor_name,
        v.last_name as visitor_last_name,
        v.email as visitor_email,
        v.company as visitor_company,
        v.country as visitor_country,
        v.job_title as visitor_job_title,
        v.badge_id,
        v.qr_code,
        v.badge_url,
        v.custom_fields,
        et.subject as template_subject,
        et.html_content as template_html,
        e.name as expo_name,
        e.organizer_id as expo_organizer_id
      FROM email_queue eq
      LEFT JOIN visitors v ON v.id = eq.visitor_id
      LEFT JOIN email_templates et ON et.id = eq.template_id
      LEFT JOIN expos e ON e.id = eq.expo_id
      WHERE eq.id IN (${placeholders})
    `, taskIds);

    await client.query('COMMIT');
    return { tasks: res.rows, type: batchType };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EMAIL_WORKER] fetchNextBatch error:', err.message);
    return { tasks: [], type: 'none' };
  } finally {
    client.release();
  }
}

// ============================================================
// STATUS UPDATES (per-email, not batched)
// ============================================================

async function markAsSent(id) {
  await pool.query(`UPDATE email_queue SET status='sent', sent_at=NOW() WHERE id=$1`, [id]);
}

async function markAsFailed(id, message) {
  await pool.query(`
    UPDATE email_queue
    SET status='failed', try_count = try_count + 1, last_try=NOW(), error_message=$2
    WHERE id=$1
  `, [id, message]);
}

// Log send result to email_logs (non-fatal)
async function logToEmailLogs(task, status, recipientEmail, emailSubject) {
  try {
    const organizerId = task.expo_organizer_id || null;
    const email = recipientEmail || task.recipient_email || task.visitor_email || null;
    const message = `Subject: ${emailSubject || 'N/A'} | To: ${email || 'N/A'}`;

    await pool.query(
      `INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [organizerId, task.expo_id || null, task.visitor_id || null, task.template_id || null, email, status, message]
    );
  } catch (err) {
    console.warn(`[EMAIL_WORKER] email_logs insert failed (non-fatal): ${err.message}`);
  }
}

// ============================================================
// PROCESS: Single email task (unchanged logic, extracted for batch use)
// ============================================================

// Suer 3 Sep — safety-net fallback for the campaign From display name.
// Small module-scoped cache: campaign_id → expo name (or '' when the
// campaign has no expo_id, so we don't re-query on every task). Cache
// entries live until worker restart; fine because campaign→expo binding
// never changes after creation.
const _expoNameByCampaign = new Map();
async function _getExpoNameForCampaign(campaignId) {
  if (_expoNameByCampaign.has(campaignId)) return _expoNameByCampaign.get(campaignId);
  try {
    const r = await pool.query(
      `SELECT e.name FROM email_campaigns c LEFT JOIN expos e ON e.id = c.expo_id WHERE c.id = $1`,
      [campaignId]
    );
    const name = (r.rows[0] && r.rows[0].name) || '';
    _expoNameByCampaign.set(campaignId, name);
    return name;
  } catch (_) {
    return ''; // non-fatal — falls through to null in the caller
  }
}

// Peer cache for transactional (non-campaign) tasks (Suer 5 Sep): Map<expo_id, expo_name>.
// Non-campaign tasks carry expo_id directly on the email_queue row; there is
// no campaign_id to resolve. Same one-query-per-new-id pattern as the
// campaign cache above. Both caches live until process restart.
const _expoNameByExpoId = new Map();
async function _getExpoNameByExpoId(expoId) {
  if (!expoId) return '';
  if (_expoNameByExpoId.has(expoId)) return _expoNameByExpoId.get(expoId);
  try {
    const r = await pool.query('SELECT name FROM expos WHERE id = $1', [expoId]);
    const name = (r.rows[0] && r.rows[0].name) || '';
    _expoNameByExpoId.set(expoId, name);
    return name;
  } catch (err) {
    console.error(`[fromName] expo lookup by expo_id failed for ${expoId}:`, err.message);
    return '';
  }
}

async function processTask(task) {
  try {
    let recipientEmail, emailSubject, emailHtml;

    // MODE 1: Direct html_content (for reactivation campaigns, etc.)
    if (task.html_content && task.recipient_email) {
      recipientEmail = task.recipient_email;
      emailSubject = task.subject || 'Notification';
      emailHtml = task.html_content;
    }
    // MODE 2: Visitor + Template (traditional mode)
    else if (task.visitor_id && task.template_id) {
      recipientEmail = task.visitor_email;

      if (!recipientEmail) {
        throw new Error('No visitor email found');
      }

      // Parse custom_fields
      let custom_fields = {};
      try {
        if (task.custom_fields) {
          custom_fields = typeof task.custom_fields === 'string'
            ? JSON.parse(task.custom_fields)
            : task.custom_fields;
        }
      } catch (e) {
        console.warn('⚠️ Error parsing custom_fields:', e.message);
      }

      // Build QR code image tag
      const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
      const qrImageTag = task.qr_code
        ? `<img src="${baseUrl}/api/qr-image/${task.qr_code}" alt="QR Code" style="max-width:200px;">`
        : '';

      // Format conference_topic for multi-topic display
      if (custom_fields.conference_topic) {
        custom_fields.conference_topic = formatConferenceTopic(custom_fields.conference_topic);
      }

      // Template data
      const data = {
        name: task.visitor_name || 'Guest',
        last_name: task.visitor_last_name || '',
        email: task.visitor_email || '',
        company: task.visitor_company || '',
        country: task.visitor_country || '',
        job_title: task.visitor_job_title || '',
        badge_id: task.badge_id || '',
        badge_url: task.badge_url || '',
        expo_name: task.expo_name || '',
        qr_code: qrImageTag,
        date: new Date().toLocaleDateString(),
        ...custom_fields
      };

      emailSubject = processEmailTemplate(task.template_subject || 'Your Badge', data);
      emailHtml = processEmailTemplate(task.template_html || '', data);
    }
    // MODE 3: Fallback - just recipient_email without html_content
    else if (task.recipient_email && task.template_id) {
      recipientEmail = task.recipient_email;

      const data = {
        name: 'Guest',
        email: task.recipient_email,
        expo_name: task.expo_name || '',
        date: new Date().toLocaleDateString()
      };

      emailSubject = processEmailTemplate(task.template_subject || 'Notification', data);
      emailHtml = processEmailTemplate(task.template_html || '', data);
    }
    else {
      throw new Error('Invalid task: missing required fields (need html_content+recipient_email OR visitor_id+template_id)');
    }

    // Build List-Unsubscribe headers for campaign emails (RFC 8058)
    const isCampaignTask = task.campaign_id && task.campaign_recipient_id;
    const extraHeaders = isCampaignTask
      ? getListUnsubscribeHeaders(task.campaign_id, task.campaign_recipient_id, recipientEmail)
      : undefined;

    // From display name (Suer 3 Sep for campaigns; extended 5 Sep to
    // transactional). Same fallback chain for every task:
    //   env CAMPAIGN_SENDER_NAME → expo name (from campaign_id if campaign,
    //   else task.expo_id) → null (bare noreply@leena.app).
    // CAMPAIGN_SENDER_NAME env var reused as-is (name is now a misnomer —
    // it covers transactional too); scope widened via G34-safe path since
    // every send here already runs on the worker service where the var
    // lives. If distinct campaign vs transactional names are ever needed,
    // introduce a TRANSACTIONAL_SENDER_NAME override on the worker.
    let fromName = process.env.CAMPAIGN_SENDER_NAME
      || (isCampaignTask
          ? (await _getExpoNameForCampaign(task.campaign_id))
          : (await _getExpoNameByExpoId(task.expo_id)))
      || null;

    // Send email
    const sent = await sendEmailWithReplyTo(
      recipientEmail,
      emailSubject,
      emailHtml,
      'reply@replies.leena.app',
      extraHeaders,
      fromName
    );

    if (sent) {
      await markAsSent(task.id);
      await logToEmailLogs(task, 'sent', recipientEmail, emailSubject);
      return { id: task.id, status: 'sent' };
    } else {
      await markAsFailed(task.id, 'sendEmail returned false');
      await logToEmailLogs(task, 'failed', recipientEmail, emailSubject);
      return { id: task.id, status: 'failed' };
    }
  } catch (err) {
    await markAsFailed(task.id, err.message || 'Unknown error');
    await logToEmailLogs(task, 'failed', task.recipient_email || task.visitor_email, err.message);
    return { id: task.id, status: 'failed', error: err.message };
  }
}

// ============================================================
// CAMPAIGN SCHEDULER (v403)
// Runs every 60 seconds alongside the 2-second queue processor.
// Scans active campaigns, evaluates step conditions, enqueues emails.
// Does NOT send — just writes to email_queue for processQueueLoop to handle.
// ============================================================

const CAMPAIGN_SCHEDULER_INTERVAL_MS = Math.max(10, parseInt(process.env.CAMPAIGN_SCHEDULER_INTERVAL_SECONDS || '60', 10)) * 1000;
const CAMPAIGN_SCHEDULER_BATCH_LIMIT = Math.max(1, parseInt(process.env.CAMPAIGN_SCHEDULER_BATCH_LIMIT || '500', 10));
let isSchedulerRunning = false;

async function runCampaignScheduler() {
  if (isSchedulerRunning) return; // Prevent re-entrancy
  isSchedulerRunning = true;
  const cycleStart = Date.now();
  let totalEnqueued = 0;
  let totalCampaigns = 0;

  try {
    // Find active campaigns
    const campaignsRes = await pool.query(
      `SELECT id, organizer_id, expo_id FROM email_campaigns WHERE status = 'active'`
    );

    if (campaignsRes.rows.length === 0) {
      return; // No active campaigns, skip silently
    }

    console.log(`[CAMPAIGN SCHEDULER] Cycle start: ${campaignsRes.rows.length} active campaign(s)`);

    for (const campaign of campaignsRes.rows) {
      try {
        const enqueued = await processCampaign(campaign);
        totalEnqueued += enqueued;
        totalCampaigns++;
      } catch (err) {
        console.error(`[CAMPAIGN SCHEDULER] Campaign ${campaign.id} error: ${err.message}`);
      }
    }

    const elapsed = Date.now() - cycleStart;
    if (totalEnqueued > 0 || totalCampaigns > 0) {
      console.log(`[CAMPAIGN SCHEDULER] Cycle end: ${totalEnqueued} emails enqueued across ${totalCampaigns} campaigns in ${elapsed}ms`);
    }
  } catch (err) {
    console.error(`[CAMPAIGN SCHEDULER] Fatal cycle error: ${err.message}`);
  } finally {
    isSchedulerRunning = false;
  }
}

async function processCampaign(campaign) {
  let enqueued = 0;

  // Cache sender display name for unsubscribe link (expo name > organizer name)
  // + country_code for footer language branching (Suer 3 Sep, audit §8).
  let organizerName = 'Organizer';
  let expoCountryCode = null;
  try {
    if (campaign.expo_id) {
      const expoRes = await pool.query('SELECT name, country_code FROM expos WHERE id = $1', [campaign.expo_id]);
      if (expoRes.rows.length > 0) {
        if (expoRes.rows[0].name) organizerName = expoRes.rows[0].name;
        expoCountryCode = expoRes.rows[0].country_code || null;
      }
    }
    if (organizerName === 'Organizer') {
      const orgRes = await pool.query('SELECT name FROM organizers WHERE id = $1', [campaign.organizer_id]);
      if (orgRes.rows.length > 0) organizerName = orgRes.rows[0].name;
    }
  } catch (e) { /* non-critical */ }

  // Pre-fetch all steps for this campaign (small set, cached for the loop)
  const stepsRes = await pool.query(
    'SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_number ASC',
    [campaign.id]
  );
  const steps = stepsRes.rows;
  if (steps.length === 0) return 0;

  const stepsMap = {};
  for (const s of steps) stepsMap[s.step_number] = s;

  // Process recipients in batches with lock+clear pattern
  // Lock → clear next_step_due_at (marks "in progress") → release lock → process
  // This prevents double-pickup during Render deploy overlaps
  while (true) {
    const client = await pool.connect();
    let recipients = [];
    try {
      await client.query('BEGIN');

      const recipientsRes = await client.query(`
        SELECT * FROM campaign_recipients
        WHERE campaign_id = $1 AND status = 'active' AND next_step_due_at IS NOT NULL AND next_step_due_at <= NOW()
        ORDER BY next_step_due_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      `, [campaign.id, CAMPAIGN_SCHEDULER_BATCH_LIMIT]);

      recipients = recipientsRes.rows;

      if (recipients.length === 0) {
        await client.query('COMMIT');
        break; // No more eligible recipients in this batch
      }

      // Clear next_step_due_at to mark as "in progress" BEFORE releasing lock
      const ids = recipients.map(r => r.id);
      await client.query(
        `UPDATE campaign_recipients SET next_step_due_at = NULL WHERE id = ANY($1::int[])`,
        [ids]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw err;
    } finally {
      client.release();
    }

    // Process outside the lock — rows are safe (next_step_due_at=NULL, won't be re-picked)
    console.log(`[CAMPAIGN SCHEDULER] Campaign ${campaign.id}: found ${recipients.length} eligible recipients`);

    for (const recipient of recipients) {
      try {
        const result = await processRecipient(campaign, recipient, stepsMap, organizerName, expoCountryCode);
        if (result === 'enqueued') enqueued++;
      } catch (err) {
        console.error(`[CAMPAIGN SCHEDULER] Recipient ${recipient.email} error: ${err.message}`);
        // Restore next_step_due_at so recipient can be retried on next cycle
        try {
          await pool.query(
            `UPDATE campaign_recipients SET next_step_due_at = NOW() WHERE id = $1 AND status = 'active'`,
            [recipient.id]
          );
        } catch (restoreErr) {
          console.error(`[CAMPAIGN SCHEDULER] Failed to restore recipient ${recipient.id}: ${restoreErr.message}`);
        }
      }
    }
  }

  // Check completion after all batches processed
  await checkCampaignCompletion(campaign.id);

  return enqueued;
}

async function processRecipient(campaign, recipient, stepsMap, organizerName, expoCountryCode) {
  const nextStepNum = recipient.current_step + 1;
  const step = stepsMap[nextStepNum];

  // No more steps → mark completed
  if (!step) {
    await pool.query(
      `UPDATE campaign_recipients SET status = 'completed', next_step_due_at = NULL, updated_at = NOW() WHERE id = $1`,
      [recipient.id]
    );
    return 'completed';
  }

  // Evaluate condition
  const conditionPassed = await evaluateCondition(step.condition, recipient, stepsMap, campaign);

  if (!conditionPassed) {
    // Condition failed → skip this step, advance, compute next due
    console.log(`[CAMPAIGN SCHEDULER] Skipped step ${nextStepNum} for ${recipient.email} (condition '${step.condition}' failed)`);
    await advanceRecipient(campaign.id, recipient.id, nextStepNum, stepsMap);
    return 'skipped';
  }

  // Condition passed → enqueue email
  await enqueueStepEmail(campaign, recipient, step, organizerName, expoCountryCode);
  console.log(`[CAMPAIGN SCHEDULER] Enqueued step ${nextStepNum} for ${recipient.email} (campaign ${campaign.id})`);

  // Compute next_step_due_at for step after this one
  await computeNextDue(campaign.id, recipient.id, nextStepNum, stepsMap);

  return 'enqueued';
}

async function evaluateCondition(condition, recipient, stepsMap, campaign) {
  if (condition === 'all') return true;

  // Find the previous step's ID (only needed by open/click checks).
  // The registration check further down is self-contained on recipient +
  // campaign, so it MUST NOT be short-circuited by a missing prevStep —
  // otherwise 'not_registered' on step 1 (current_step = 0) silently
  // no-ops. See wizard step-1 change (3 Sep) + docs/sessions deploy doc.
  const prevStepNum = recipient.current_step;
  const prevStep = stepsMap[prevStepNum];

  // Check open events
  if (condition === 'not_opened' || condition === 'opened') {
    if (!prevStep) return true;
    const openRes = await pool.query(
      `SELECT id FROM email_events WHERE recipient_id = $1 AND step_id = $2 AND event_type = 'opened' LIMIT 1`,
      [recipient.id, prevStep.id]
    );
    const wasOpened = openRes.rows.length > 0;
    if (condition === 'not_opened') return !wasOpened;
    if (condition === 'opened') return wasOpened;
  }

  // Check click events
  if (condition === 'not_clicked' || condition === 'clicked') {
    if (!prevStep) return true;
    const clickRes = await pool.query(
      `SELECT id FROM email_events WHERE recipient_id = $1 AND step_id = $2 AND event_type = 'clicked' LIMIT 1`,
      [recipient.id, prevStep.id]
    );
    const wasClicked = clickRes.rows.length > 0;
    if (condition === 'not_clicked') return !wasClicked;
    if (condition === 'clicked') return wasClicked;
  }

  // Check registration events (any registration AFTER previous step was sent)
  if (condition === 'not_registered' || condition === 'registered') {
    // "Registered" means registered BY ANY ROUTE, not merely via a campaign click.
    //
    // The campaign 'registered' event only fires when the visitor arrives carrying an
    // _lc token (routes/visitors.js:452-468 for the public form, and
    // recordCampaignRegistration in routes/reactivation.js for token activation).
    // Someone who registers through organic Zoho traffic never carries one and is
    // therefore invisible to it. Measured on 19 Aug across campaigns 16/17: 66 active
    // recipients were already visitors on the target expo yet still evaluated as
    // not_registered, every one of them origin='zohoform', and the set was growing
    // ~50/day. Without check (a) they would receive a "last chance to register" email
    // days after they had registered.
    //
    // (b) is currently redundant — measured 0 activated tokens lacking a campaign
    // event, i.e. the bridge is at 100%. It is kept as insurance because
    // recordCampaignRegistration is deliberately non-fatal: a swallowed tracking error
    // would leave that recipient permanently not_registered. At 0.09ms it is free.
    //
    // Predicates are index-aligned on purpose:
    //   - rt.email = $3 uses idx_reactivation_tokens_email_target; wrapping it in
    //     trim() drops the plan to a parallel Gather (0.09ms -> 21ms).
    //   - campaign_recipients.email is normalised on upload (normalizeEmail), and
    //     production holds 0 untrimmed emails in visitors/reactivation_tokens, so
    //     comparing without trim() is safe here. See gotcha G11.
    // Measured combined cost: 2.99ms per recipient (server-side EXPLAIN ANALYZE).
    //
    // This is one-way: it can only ever SUPPRESS a send, never cause an extra one.
    const regRes = await pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM email_events
                  WHERE recipient_id = $1 AND event_type = 'registered'
                    AND created_at >= $2)                       AS via_campaign,
         EXISTS (SELECT 1 FROM visitors v
                  WHERE v.organizer_id = $5 AND v.expo_id = $4
                    AND lower(v.email) = lower($3))             AS via_visitor_row,
         EXISTS (SELECT 1 FROM reactivation_tokens rt
                  WHERE rt.email = $3 AND rt.target_expo_id = $4
                    AND rt.status = 'activated')                AS via_token`,
      [
        recipient.id,
        recipient.last_step_sent_at || new Date(0),
        recipient.email,
        campaign ? campaign.expo_id : null,
        campaign ? campaign.organizer_id : null
      ]
    );

    const r = regRes.rows[0] || {};
    const wasRegistered = !!(r.via_campaign || r.via_visitor_row || r.via_token);

    if (wasRegistered && !r.via_campaign) {
      console.log(`[CAMPAIGN SCHEDULER] ${recipient.email} registered outside the campaign `
        + `(visitor_row=${!!r.via_visitor_row} token=${!!r.via_token}) — treating as registered`);
    }

    if (condition === 'not_registered') return !wasRegistered;
    if (condition === 'registered') return wasRegistered;
  }

  return true; // Unknown condition → proceed
}

async function enqueueStepEmail(campaign, recipient, step, organizerName, expoCountryCode) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check unsubscribe list before enqueuing (defensive — may have unsubscribed between pickup and now)
    const unsubCheck = await client.query(
      'SELECT 1 FROM email_unsubscribes WHERE email = $1 AND organizer_id = $2 LIMIT 1',
      [recipient.email, campaign.organizer_id]
    );
    if (unsubCheck.rows.length > 0) {
      await client.query(
        `UPDATE campaign_recipients SET status = 'unsubscribed', next_step_due_at = NULL, updated_at = NOW() WHERE id = $1`,
        [recipient.id]
      );
      await client.query('COMMIT');
      console.log(`[CAMPAIGN SCHEDULER] Skipped ${recipient.email} (unsubscribed)`);
      return;
    }

    // Fetch template
    const tplRes = await client.query(
      'SELECT subject, html_content FROM email_templates WHERE id = $1',
      [step.template_id]
    );
    if (tplRes.rows.length === 0) throw new Error(`Template ${step.template_id} not found`);
    const template = tplRes.rows[0];

    // Parse extra_fields
    let extraFields = {};
    try {
      if (recipient.extra_fields) {
        extraFields = typeof recipient.extra_fields === 'string'
          ? JSON.parse(recipient.extra_fields) : recipient.extra_fields;
      }
    } catch (e) { /* ignore parse errors */ }

    // Build template data
    const data = {
      name: recipient.first_name || 'Guest',
      first_name: recipient.first_name || '',
      last_name: recipient.last_name || '',
      email: recipient.email,
      company: recipient.company || '',
      date: new Date().toLocaleDateString(),
      ...extraFields
    };

    // Process template
    const subject = processEmailTemplate(template.subject || 'Notification', data);
    let html = processEmailTemplate(template.html_content || '', data);

    // INSERT sent event FIRST (we need the event_id for the tracking pixel)
    const eventRes = await client.query(
      `INSERT INTO email_events (campaign_id, recipient_id, step_id, email, event_type, metadata)
       VALUES ($1, $2, $3, $4, 'sent', '{}') RETURNING id`,
      [campaign.id, recipient.id, step.id, recipient.email]
    );
    const emailEventId = eventRes.rows[0].id;

    // Inject tracking pixel
    html = injectTrackingPixel(html, emailEventId);

    // Inject unsubscribe link
    const unsubToken = generateUnsubscribeToken(campaign.id, recipient.id, recipient.email);
    html = injectUnsubscribeLink(html, unsubToken, organizerName, expoCountryCode);

    // Append _lc campaign token to Leena form links FIRST (before click wrap)
    html = appendCampaignTokenToFormLinks(html, unsubToken);

    // Wrap <a href> links for click tracking LAST (so wrap engulfs the _lc URL)
    html = wrapClickLinks(html, emailEventId);

    // INSERT into email_queue (Mode 1 — pre-processed HTML)
    await client.query(
      `INSERT INTO email_queue (
        recipient_email, subject, html_content,
        campaign_id, campaign_step_id, campaign_recipient_id, email_event_id,
        status, try_count, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 0, NOW())`,
      [recipient.email, subject, html, campaign.id, step.id, recipient.id, emailEventId]
    );

    // Update recipient
    await client.query(
      `UPDATE campaign_recipients
       SET current_step = $1, last_step_sent_at = NOW(), next_step_due_at = NULL, updated_at = NOW()
       WHERE id = $2`,
      [step.step_number, recipient.id]
    );

    // Update campaign total_sent counter
    await client.query(
      `UPDATE email_campaigns SET total_sent = total_sent + 1, updated_at = NOW() WHERE id = $1`,
      [campaign.id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function advanceRecipient(campaignId, recipientId, skippedStepNum, stepsMap) {
  // Advance current_step to the skipped step, then compute due for step after that
  await pool.query(
    `UPDATE campaign_recipients SET current_step = $1, updated_at = NOW() WHERE id = $2`,
    [skippedStepNum, recipientId]
  );
  await computeNextDue(campaignId, recipientId, skippedStepNum, stepsMap);
}

async function computeNextDue(campaignId, recipientId, currentStepNum, stepsMap) {
  const nextStep = stepsMap[currentStepNum + 1];

  if (!nextStep) {
    // No more steps — mark recipient completed
    await pool.query(
      `UPDATE campaign_recipients
       SET status = 'completed',
           next_step_due_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [recipientId]
    );
    return;
  }

  // Compute due time based on next step's delay_hours
  const delayHours = parseInt(nextStep.delay_hours) || 0;
  await pool.query(
    `UPDATE campaign_recipients SET next_step_due_at = NOW() + $1 * INTERVAL '1 hour', updated_at = NOW() WHERE id = $2`,
    [delayHours, recipientId]
  );
}

async function checkCampaignCompletion(campaignId) {
  const result = await pool.query(
    `UPDATE email_campaigns SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM campaign_recipients WHERE campaign_id = $1 AND status = 'active')
     RETURNING id`,
    [campaignId]
  );
  if (result.rows.length > 0) {
    console.log(`[CAMPAIGN SCHEDULER] Campaign ${campaignId} completed (all recipients done)`);

    // Snapshot delivered_count, THEN clean up sent queue rows to prevent email_queue
    // bloat (55K+ rows per step). Both in ONE transaction: the purge destroys the only
    // source of the delivered figure, so if the snapshot does not persist neither must
    // the delete. Without this, a completed campaign's funnel silently collapses toward
    // zero — measured on campaign 15, which reported 4 delivered against 5 opens.
    // Requires migration 029 (email_campaigns.delivered_count).
    const cleanupClient = await pool.connect();
    try {
      await cleanupClient.query('BEGIN');

      const snapRes = await cleanupClient.query(
        `UPDATE email_campaigns
            SET delivered_count = (
                  SELECT COUNT(*) FROM email_queue
                   WHERE campaign_id = $1 AND status = 'sent'
                )
          WHERE id = $1
          RETURNING delivered_count`,
        [campaignId]
      );

      const delRes = await cleanupClient.query(
        `DELETE FROM email_queue WHERE campaign_id = $1 AND status = 'sent' AND sent_at < NOW() - INTERVAL '1 hour'`,
        [campaignId]
      );

      await cleanupClient.query('COMMIT');

      const snapshot = snapRes.rows[0] ? snapRes.rows[0].delivered_count : null;
      console.log(`[CAMPAIGN SCHEDULER] Campaign ${campaignId} delivered_count snapshot: ${snapshot}`);
      if (delRes.rowCount > 0) {
        console.log(`[CAMPAIGN SCHEDULER] Cleaned up ${delRes.rowCount} sent queue rows for campaign ${campaignId}`);
      }
    } catch (err) {
      await cleanupClient.query('ROLLBACK').catch(() => {});
      // Non-fatal, as before: the campaign is already marked completed by the UPDATE
      // above. Rolling back leaves the queue rows in place, so delivered stays readable
      // from the live count and the next completion pass can retry.
      console.warn(`[CAMPAIGN SCHEDULER] Snapshot/cleanup error (non-fatal): ${err.message}`);
    } finally {
      cleanupClient.release();
    }
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function runWorker() {
  console.log(`🚀 Email worker started (v403). Polling every ${PROCESS_INTERVAL}ms, campaign batch: ${BATCH_SIZE}, transactional batch: ${TRANSACTIONAL_BATCH_SIZE}`);
  console.log('📧 Supports: visitor+template mode AND direct html_content mode');
  console.log(`📋 Campaign scheduler: every ${CAMPAIGN_SCHEDULER_INTERVAL_MS / 1000}s, batch limit: ${CAMPAIGN_SCHEDULER_BATCH_LIMIT}`);

  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to database');
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }

  // Start campaign scheduler (independent from queue processor)
  setInterval(runCampaignScheduler, CAMPAIGN_SCHEDULER_INTERVAL_MS);
  runCampaignScheduler(); // Run once immediately on startup

  while (true) {
    if (!isProcessing) {
      isProcessing = true;
      const cycleStart = Date.now();
      try {
        const { tasks, type } = await fetchNextBatch();
        if (tasks.length > 0) {
          // Process all tasks in parallel — each has its own error handling
          const results = await Promise.allSettled(tasks.map(t => processTask(t)));

          const sent = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'sent').length;
          const failed = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'failed').length;
          const errors = results.filter(r => r.status === 'rejected').length;
          const elapsed = Date.now() - cycleStart;

          if (tasks.length > 1) {
            console.log(`[CYCLE] Processed ${tasks.length} ${type} emails (${sent} sent, ${failed + errors} failed) in ${elapsed}ms`);
          } else {
            // Single email — keep original log style
            const r = results[0];
            if (r.status === 'fulfilled') {
              console.log(`[EMAIL_WORKER] ${r.value?.status === 'sent' ? '✅' : '❌'} Task ${tasks[0].id} ${r.value?.status} (${type})`);
            }
          }
        }
      } catch (e) {
        console.error('[EMAIL_WORKER] loop error:', e.message);
      } finally {
        isProcessing = false;
      }
    }
    await new Promise((r) => setTimeout(r, PROCESS_INTERVAL));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down email worker...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down...');
  await pool.end();
  process.exit(0);
});

runWorker().catch(err => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});
