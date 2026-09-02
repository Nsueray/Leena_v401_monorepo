/**
 * Reactivation Campaign Routes
 * Leena EMS v402
 * 
 * Re-activate previous year visitors for new expo
 * Uses email_queue for async email sending (no timeout/rate limit issues)
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { generateBadgeUrl } = require('../utils/qrcode');
const { processEmailTemplate } = require('../utils/email');
const { normalizePhone } = require('../utils/phoneNormalize');
const authMiddleware = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Generate secure token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Record a campaign 'registered' event when an activation arrives from a campaign email.
 *
 * reactivate.html forwards the _lc token it was opened with (appended by
 * appendCampaignTokenToFormLinks in the worker). Without this, the campaign
 * scheduler's 'not_registered' condition can never see a reactivation activation,
 * so follow-up steps would keep firing at people who already activated.
 *
 * Mirrors routes/visitors.js:452-468. Non-fatal by design: a tracking failure must
 * never break an activation.
 */
async function recordCampaignRegistration(lcToken, ctx) {
  if (!lcToken) return;
  try {
    const { verifyUnsubscribeToken } = require('../utils/trackingPixel');
    const parsed = verifyUnsubscribeToken(lcToken);
    if (!parsed) return;
    await pool.query(
      `INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata)
       VALUES ($1, $2, $3, 'registered', $4)`,
      [parsed.campaignId, parsed.recipientId, parsed.email, JSON.stringify(ctx)]
    );
    console.log(`[TRACKING] Reactivation registration recorded: campaign=${parsed.campaignId}, email=${parsed.email}`);
  } catch (trackErr) {
    console.warn(`[TRACKING] Reactivation registration tracking failed (non-fatal): ${trackErr.message}`);
  }
}

// ============================================================
// BACKGROUND JOB HELPERS (async, called via setImmediate)
// ============================================================

async function processReactivationChunks(jobId, validRows, ctx) {
  const { target_expo_id, organizerId, template_id, form_id, emailTemplate, targetExpo, source_expo_id } = ctx;
  const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
  const CHUNK_SIZE = 1000;
  const isExpo = !!source_expo_id;
  let created = 0;

  // Token expiry is anchored to the TARGET FAIR, not a fixed duration.
  // Campaigns can start six months out, so the previous hardcoded
  // NOW() + 30 days produced tokens that died before the fair opened
  // (e.g. generated 2026-08-18 for a fair on 2026-09-22 → expired 09-17).
  //
  //   end_date + 1 day  → valid through the whole final fair day (end_date is a DATE,
  //                       so +1 day is 00:00 the morning after).
  //   COALESCE(…, +90d) → expos.end_date is nullable (1 such row in production).
  //   GREATEST(…, +30d) → floor. Never shorter than the previous behaviour, and stops
  //                       a past-dated expo (10 in production) minting a dead token.
  const FALLBACK_EXPIRY_DAYS = 90;
  const MIN_EXPIRY_DAYS = 30;
  let expiresAt;
  try {
    const expRes = await pool.query(
      `SELECT GREATEST(
                COALESCE(end_date + INTERVAL '1 day', NOW() + INTERVAL '${FALLBACK_EXPIRY_DAYS} days'),
                NOW() + INTERVAL '${MIN_EXPIRY_DAYS} days'
              ) AS expires_at
       FROM expos WHERE id = $1`,
      [target_expo_id]
    );
    expiresAt = expRes.rows[0] && expRes.rows[0].expires_at;
  } catch (expErr) {
    console.error(`[reactivation-job-${jobId}] expiry lookup failed, using ${MIN_EXPIRY_DAYS}d fallback:`, expErr.message);
  }
  if (!expiresAt) {
    expiresAt = new Date(Date.now() + MIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  }
  console.log(`[reactivation-job-${jobId}] token expiry set to ${new Date(expiresAt).toISOString()} (expo ${target_expo_id})`);

  const client = await pool.connect();
  try {
    for (let c = 0; c < validRows.length; c += CHUNK_SIZE) {
      const chunk = validRows.slice(c, c + CHUNK_SIZE);
      await client.query('BEGIN');
      try {
        // Batch INSERT reactivation_tokens
        const tokenClauses = [];
        const tokenParams = [];
        // One shared placeholder for expires_at, reused by every row tuple.
        const expiresIdx = chunk.length * (isExpo ? 13 : 11) + 1;
        if (isExpo) {
          chunk.forEach((r, j) => {
            const base = j * 13;
            tokenClauses.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},'pending',NOW(),$${expiresIdx})`);
            tokenParams.push(r.token, r.id, source_expo_id, target_expo_id, organizerId, r.email, r.name, r.last_name, r.company, r.country, r.job_title, r.phone, form_id || null);
          });
          tokenParams.push(expiresAt);
          await client.query(
            `INSERT INTO reactivation_tokens (token, source_visitor_id, source_expo_id, target_expo_id, organizer_id, email, name, last_name, company, country, job_title, phone, form_id, status, created_at, expires_at) VALUES ${tokenClauses.join(',')}`,
            tokenParams
          );
        } else {
          chunk.forEach((r, j) => {
            const base = j * 11;
            tokenClauses.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},'pending',NOW(),$${expiresIdx})`);
            tokenParams.push(r.token, target_expo_id, organizerId, r.email, r.name, r.last_name, r.company, r.country, r.job_title, r.phone, form_id || null);
          });
          tokenParams.push(expiresAt);
          await client.query(
            `INSERT INTO reactivation_tokens (token, target_expo_id, organizer_id, email, name, last_name, company, country, job_title, phone, form_id, status, created_at, expires_at) VALUES ${tokenClauses.join(',')}`,
            tokenParams
          );
        }

        // Queue emails (per-row: unique rendered HTML)
        if (emailTemplate) {
          for (const r of chunk) {
            const activationUrl = `${baseUrl}/reactivate.html?token=${r.token}`;
            const templateData = {
              name: r.name || 'Valued Guest', last_name: r.last_name || '', email: r.email,
              company: r.company || '', country: r.country || '', job_title: r.job_title || '',
              activation_url: activationUrl, expo_name: targetExpo.name,
              date: new Date().toLocaleDateString()
            };
            const htmlContent = processEmailTemplate(emailTemplate.html_content || emailTemplate.body || '', templateData);
            const subject = processEmailTemplate(emailTemplate.subject || 'Activate Your Visitor Pass', templateData);
            await client.query(
              `INSERT INTO email_queue (organizer_id, expo_id, visitor_id, template_id, recipient_email, subject, html_content, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW())`,
              [organizerId, target_expo_id, isExpo ? r.id : null, template_id, r.email, subject, htmlContent]
            );
          }
        }

        await client.query('COMMIT');
        created += chunk.length;

        // Update progress
        await pool.query(
          'UPDATE import_jobs SET processed_count = $1, updated_at = NOW() WHERE id = $2',
          [created, jobId]
        );
      } catch (chunkErr) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[reactivation-job-${jobId}] chunk ${Math.floor(c/CHUNK_SIZE)+1} error:`, chunkErr.message);
        await pool.query(
          'UPDATE import_jobs SET failed_count = failed_count + $1, updated_at = NOW() WHERE id = $2',
          [chunk.length, jobId]
        ).catch(() => {});
      }
    }
  } finally {
    client.release();
  }

  // Mark completed
  await pool.query(
    `UPDATE import_jobs SET status='completed', processed_count=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [created, jobId]
  );
  console.log(`[reactivation-job-${jobId}] ✅ COMPLETED: ${created} tokens created`);
}

function prepareExcelRows(rows, existingVisitorEmails, existingTokenEmails, unsubscribedEmails, defaultCountry) {
  // Sep 2026 — phones normalised to E.164 via libphonenumber-js with defaultCountry
  // (from the target expo's country_code). Empty phones preserved.
  // Unfixable phones → the ROW is rejected (skipped_invalid_phone), consistent with
  // the primary import path in visitors.js.
  // Samples: first 3 rejects, each with the Excel row number (1-indexed + header row).
  const results = { skipped_no_email: 0, skipped_already_registered: 0, skipped_duplicate: 0, skipped_unsubscribed: 0, skipped_invalid_phone: 0, invalid_phone_samples: [] };
  const validRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // Excel row (data starts at row 2 after the header)
    const email = (row.email || row.Email || row.EMAIL || '').toString().trim().toLowerCase();
    if (!email) { results.skipped_no_email++; continue; }
    if (unsubscribedEmails.has(email)) { results.skipped_unsubscribed++; continue; }
    if (existingVisitorEmails.has(email)) { results.skipped_already_registered++; continue; }
    if (existingTokenEmails.has(email)) { results.skipped_duplicate++; continue; }
    const rawPhone = row.phone || row.Phone || row.mobile || '';
    const phoneResult = normalizePhone(rawPhone, defaultCountry);
    if (!phoneResult.ok) {
      results.skipped_invalid_phone++;
      if (results.invalid_phone_samples.length < 3) {
        results.invalid_phone_samples.push({ row: rowNumber, email, raw: String(rawPhone).slice(0, 100), reason: phoneResult.reason });
      }
      continue;
    }
    existingTokenEmails.add(email);
    validRows.push({
      email,
      name: (row.name || row.Name || row.first_name || row['First Name'] || '').toString().trim(),
      last_name: (row.last_name || row['Last Name'] || row.surname || '').toString().trim(),
      company: (row.company || row.Company || row.organization || '').toString().trim(),
      country: (row.country || row.Country || '').toString().trim(),
      job_title: (row.job_title || row['Job Title'] || row.title || '').toString().trim(),
      phone: phoneResult.e164,
      token: generateToken()
    });
  }
  return { validRows, ...results };
}

async function prefetchEmails(target_expo_id, organizerId) {
  const existingVisitorsRes = await pool.query(
    'SELECT LOWER(email) AS email FROM visitors WHERE expo_id = $1 AND email IS NOT NULL', [target_expo_id]);
  const existingVisitorEmails = new Set(existingVisitorsRes.rows.map(r => r.email));
  const existingTokensRes = await pool.query(
    'SELECT LOWER(email) AS email FROM reactivation_tokens WHERE target_expo_id = $1', [target_expo_id]);
  const existingTokenEmails = new Set(existingTokensRes.rows.map(r => r.email));
  const unsubscribedRes = await pool.query(
    'SELECT LOWER(email) AS email FROM email_unsubscribes WHERE organizer_id = $1', [organizerId]);
  const unsubscribedEmails = new Set(unsubscribedRes.rows.map(r => r.email));
  return { existingVisitorEmails, existingTokenEmails, unsubscribedEmails };
}

/**
 * GET /api/reactivation/campaigns
 * List all reactivation campaigns (grouped by target_expo)
 */
router.get('/campaigns', authMiddleware, async (req, res) => {
  try {
    let result;
    // Try the augmented query first (post-migration 006); fall back to the
    // legacy query if the new columns don't exist yet.
    try {
      result = await pool.query(`
        SELECT
          target_expo_id,
          e.name as expo_name,
          e.reactivation_closed_at,
          e.reactivation_closed_by,
          o.name as closed_by_name,
          COUNT(*) as total_tokens,
          COUNT(*) FILTER (WHERE rt.status = 'pending') as pending,
          COUNT(*) FILTER (WHERE rt.status = 'activated') as activated,
          COUNT(*) FILTER (WHERE rt.status = 'expired') as expired,
          MIN(rt.created_at) as campaign_started,
          MAX(rt.created_at) as last_added
        FROM reactivation_tokens rt
        JOIN expos e ON rt.target_expo_id = e.id
        LEFT JOIN organizers o ON o.id = e.reactivation_closed_by
        WHERE rt.organizer_id = $1
        GROUP BY target_expo_id, e.name, e.reactivation_closed_at, e.reactivation_closed_by, o.name
        ORDER BY campaign_started DESC
      `, [req.organizer_id]);
    } catch (err) {
      if (err.code !== '42703') throw err; // 42703 = undefined_column
      // Pre-migration fallback — keep dashboard functional until ALTER TABLE runs
      result = await pool.query(`
        SELECT
          target_expo_id,
          e.name as expo_name,
          NULL::timestamptz as reactivation_closed_at,
          NULL::int as reactivation_closed_by,
          NULL::text as closed_by_name,
          COUNT(*) as total_tokens,
          COUNT(*) FILTER (WHERE rt.status = 'pending') as pending,
          COUNT(*) FILTER (WHERE rt.status = 'activated') as activated,
          COUNT(*) FILTER (WHERE rt.status = 'expired') as expired,
          MIN(rt.created_at) as campaign_started,
          MAX(rt.created_at) as last_added
        FROM reactivation_tokens rt
        JOIN expos e ON rt.target_expo_id = e.id
        WHERE rt.organizer_id = $1
        GROUP BY target_expo_id, e.name
        ORDER BY campaign_started DESC
      `, [req.organizer_id]);
    }

    res.json({ success: true, campaigns: result.rows });
  } catch (err) {
    console.error('[reactivation] List campaigns error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list campaigns' });
  }
});

/**
 * GET /api/reactivation/campaign/:expoId
 * Get details of a specific campaign
 */
router.get('/campaign/:expoId', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get tokens
    const result = await pool.query(`
      SELECT id, token, email, name, last_name, company, status, created_at, activated_at
      FROM reactivation_tokens
      WHERE target_expo_id = $1 AND organizer_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `, [expoId, req.organizer_id, limit, offset]);

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM reactivation_tokens
      WHERE target_expo_id = $1 AND organizer_id = $2
    `, [expoId, req.organizer_id]);

    res.json({
      success: true,
      tokens: result.rows,
      total: parseInt(countResult.rows[0].total),
      page,
      limit
    });
  } catch (err) {
    console.error('[reactivation] Campaign details error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get campaign details' });
  }
});

/**
 * POST /api/reactivation/create-from-excel
 * Create reactivation campaign from Excel file
 */
router.post('/create-from-excel', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { target_expo_id, template_id, form_id } = req.body;
    const organizerId = req.organizer_id;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Excel file is required' });
    }

    if (!target_expo_id) {
      return res.status(400).json({ success: false, error: 'Target expo is required' });
    }

    // Verify target expo belongs to organizer
    const expoCheck = await pool.query(
      'SELECT id, name, country_code FROM expos WHERE id = $1 AND organizer_id = $2',
      [target_expo_id, organizerId]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Target expo not found' });
    }
    const targetExpo = expoCheck.rows[0];

    // Get email template
    let emailTemplate = null;
    if (template_id) {
      const templateResult = await pool.query(
        'SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2',
        [template_id, organizerId]
      );
      if (templateResult.rows.length) {
        emailTemplate = templateResult.rows[0];
      }
    }

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Excel file is empty' });
    }

    console.log(`📊 Processing ${rows.length} rows for reactivation campaign`);

    // Pre-fetch existing emails + unsubscribes for O(1) dedup
    const { existingVisitorEmails, existingTokenEmails, unsubscribedEmails } = await prefetchEmails(target_expo_id, organizerId);

    // Filter valid rows (no DB calls) — pass expo country_code for phone normalisation
    const { validRows, skipped_no_email, skipped_already_registered, skipped_duplicate, skipped_unsubscribed, skipped_invalid_phone, invalid_phone_samples } = prepareExcelRows(rows, existingVisitorEmails, existingTokenEmails, unsubscribedEmails, targetExpo.country_code);
    const totalSkipped = skipped_no_email + skipped_already_registered + skipped_duplicate + skipped_unsubscribed + skipped_invalid_phone;

    console.log(`📊 ${validRows.length} valid rows after filtering (${skipped_no_email} no email, ${skipped_already_registered} already registered, ${skipped_duplicate} duplicate, ${skipped_unsubscribed} unsubscribed, ${skipped_invalid_phone} invalid phone)`);
    if (skipped_invalid_phone > 0 && invalid_phone_samples.length > 0) {
      console.log(`   invalid phone samples (up to 3):`, JSON.stringify(invalid_phone_samples));
    }

    // Create import job
    const jobRes = await pool.query(
      `INSERT INTO import_jobs (organizer_id, job_type, target_expo_id, template_id, form_id, total_count, skipped_count, status)
       VALUES ($1, 'reactivation_excel', $2, $3, $4, $5, $6, 'processing') RETURNING id`,
      [organizerId, target_expo_id, template_id || null, form_id || null, rows.length, totalSkipped]
    );
    const jobId = jobRes.rows[0].id;

    // Start background processing
    setImmediate(() => {
      processReactivationChunks(jobId, validRows, {
        target_expo_id, organizerId, template_id, form_id, emailTemplate, targetExpo
      }).catch(err => {
        console.error(`[reactivation-job-${jobId}] FATAL:`, err);
        pool.query(`UPDATE import_jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`, [err.message, jobId]).catch(() => {});
      });
    });

    // Return immediately
    res.status(202).json({
      success: true,
      job_id: jobId,
      total: rows.length,
      valid: validRows.length,
      skipped: totalSkipped,
      skipped_invalid_phone,
      invalid_phone_samples,
      message: 'Campaign processing started. Poll /api/reactivation/job/' + jobId + ' for status.'
    });

  } catch (err) {
    console.error('[reactivation] Create from Excel error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

/**
 * POST /api/reactivation/create-from-expo
 * Create reactivation campaign from existing expo visitors
 */
router.post('/create-from-expo', authMiddleware, async (req, res) => {
  try {
    const { source_expo_id, target_expo_id, template_id, filter, form_id } = req.body;
    const organizerId = req.organizer_id;

    if (!source_expo_id || !target_expo_id) {
      return res.status(400).json({ success: false, error: 'Source and target expo are required' });
    }

    if (source_expo_id === target_expo_id) {
      return res.status(400).json({ success: false, error: 'Source and target expo must be different' });
    }

    // Verify expos belong to organizer
    const expoCheck = await pool.query(
      'SELECT id, name FROM expos WHERE id IN ($1, $2) AND organizer_id = $3',
      [source_expo_id, target_expo_id, organizerId]
    );
    if (expoCheck.rows.length !== 2) {
      return res.status(404).json({ success: false, error: 'Expo not found' });
    }

    const targetExpo = expoCheck.rows.find(e => e.id == target_expo_id);

    // Get email template
    let emailTemplate = null;
    if (template_id) {
      const templateResult = await pool.query(
        'SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2',
        [template_id, organizerId]
      );
      if (templateResult.rows.length) {
        emailTemplate = templateResult.rows[0];
      }
    }

    // Build query based on filter
    let visitorQuery = `
      SELECT v.id, v.email, v.name, v.last_name, v.company, v.country, v.job_title, v.phone
      FROM visitors v
      WHERE v.expo_id = $1 AND v.organizer_id = $2 AND v.email IS NOT NULL AND v.email != ''
    `;

    // Filter: checked_in_only, no_shows_only, all
    if (filter === 'checked_in_only') {
      visitorQuery += ` AND EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id)`;
    } else if (filter === 'no_shows_only') {
      visitorQuery += ` AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id)`;
    }

    const visitors = await pool.query(visitorQuery, [source_expo_id, organizerId]);

    console.log(`📊 Found ${visitors.rows.length} visitors from source expo (filter: ${filter || 'all'})`);

    // Pre-fetch existing emails + unsubscribes for O(1) dedup
    const { existingVisitorEmails, existingTokenEmails, unsubscribedEmails } = await prefetchEmails(target_expo_id, organizerId);

    // Filter valid rows
    let skipped_already = 0, skipped_dup = 0, skipped_unsub = 0;
    const validRows = [];
    for (const visitor of visitors.rows) {
      const email = visitor.email.toLowerCase().trim();
      if (unsubscribedEmails.has(email)) { skipped_unsub++; continue; }
      if (existingVisitorEmails.has(email)) { skipped_already++; continue; }
      if (existingTokenEmails.has(email)) { skipped_dup++; continue; }
      existingTokenEmails.add(email);
      validRows.push({ ...visitor, email, token: generateToken() });
    }
    const totalSkipped = skipped_already + skipped_dup + skipped_unsub;

    console.log(`📊 ${validRows.length} valid rows after filtering (${skipped_already} already, ${skipped_dup} dup, ${skipped_unsub} unsubscribed)`);

    // Create import job
    const jobRes = await pool.query(
      `INSERT INTO import_jobs (organizer_id, job_type, target_expo_id, source_expo_id, template_id, form_id, total_count, skipped_count, status)
       VALUES ($1, 'reactivation_expo', $2, $3, $4, $5, $6, $7, 'processing') RETURNING id`,
      [organizerId, target_expo_id, source_expo_id, template_id || null, form_id || null, visitors.rows.length, totalSkipped]
    );
    const jobId = jobRes.rows[0].id;

    // Start background processing
    setImmediate(() => {
      processReactivationChunks(jobId, validRows, {
        target_expo_id, source_expo_id, organizerId, template_id, form_id, emailTemplate, targetExpo
      }).catch(err => {
        console.error(`[reactivation-job-${jobId}] FATAL:`, err);
        pool.query(`UPDATE import_jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`, [err.message, jobId]).catch(() => {});
      });
    });

    res.status(202).json({
      success: true,
      job_id: jobId,
      total: visitors.rows.length,
      valid: validRows.length,
      skipped: totalSkipped,
      message: 'Campaign processing started. Poll /api/reactivation/job/' + jobId + ' for status.'
    });

  } catch (err) {
    console.error('[reactivation] Create from expo error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

/**
 * GET /api/reactivation/verify/:token
 * Verify token and return visitor data (PUBLIC - no auth)
 */
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(`
      SELECT
        rt.*,
        e.name as expo_name,
        e.location as expo_location,
        e.start_date,
        e.end_date,
        f.config as form_config
      FROM reactivation_tokens rt
      JOIN expos e ON rt.target_expo_id = e.id
      LEFT JOIN forms f ON rt.form_id = f.id
      WHERE rt.token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or expired token' });
    }

    const tokenData = result.rows[0];

    // Check if expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'This activation link has expired' });
    }

    // Check if already activated
    if (tokenData.status === 'activated') {
      return res.status(409).json({ 
        success: false, 
        error: 'This visitor pass has already been activated',
        already_activated: true 
      });
    }

    res.json({
      success: true,
      visitor: {
        name: tokenData.name,
        last_name: tokenData.last_name,
        email: tokenData.email,
        company: tokenData.company,
        country: tokenData.country,
        job_title: tokenData.job_title,
        phone: tokenData.phone
      },
      expo: {
        id: tokenData.target_expo_id,
        name: tokenData.expo_name,
        location: tokenData.expo_location,
        start_date: tokenData.start_date,
        end_date: tokenData.end_date
      },
      form_config: tokenData.form_config || null
    });

  } catch (err) {
    console.error('[reactivation] Verify error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

/**
 * POST /api/reactivation/activate
 * Activate visitor pass - create visitor record (PUBLIC - no auth)
 */
router.post('/activate', async (req, res) => {
  try {
    const { token, name, last_name, company, country, job_title, phone, _lc } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    // Get and validate token
    const tokenResult = await pool.query(`
      SELECT * FROM reactivation_tokens WHERE token = $1
    `, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid token' });
    }

    const tokenData = tokenResult.rows[0];

    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'Token expired' });
    }

    if (tokenData.status === 'activated') {
      return res.status(409).json({ success: false, error: 'Already activated' });
    }

    // Check if email already registered in target expo
    const existingCheck = await pool.query(
      'SELECT id, qr_code, badge_id FROM visitors WHERE LOWER(email) = $1 AND expo_id = $2',
      [tokenData.email.toLowerCase(), tokenData.target_expo_id]
    );

    if (existingCheck.rows.length > 0) {
      // Already registered - mark token as activated
      await pool.query(
        'UPDATE reactivation_tokens SET status = $1, activated_at = NOW(), new_visitor_id = $2 WHERE id = $3',
        ['activated', existingCheck.rows[0].id, tokenData.id]
      );

      await recordCampaignRegistration(_lc, {
        visitor_id: existingCheck.rows[0].id,
        target_expo_id: tokenData.target_expo_id,
        via: 'reactivation_activate_existing'
      });

      return res.json({
        success: true,
        message: 'You are already registered for this event',
        visitor: existingCheck.rows[0],
        already_exists: true
      });
    }

    // Create new visitor
    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    // Normalise phone against the target expo's country_code (Sep 2026).
    // Fetches the country once — activate is a single-row endpoint, not a loop.
    // FAIL-OPEN per 2 Sep 2026 decision A-1: if the number can't be parsed,
    // still complete the activation — store phone as '' AND drop a reject
    // trace into custom_fields (JSONB), atomically with the INSERT. The
    // visitor gets in; ops can fix the phone later via the detail panel and
    // the trace tells them what came in and why it was refused.
    const expoCcRes = await pool.query(
      `SELECT country_code FROM expos WHERE id = $1`, [tokenData.target_expo_id]
    );
    const activateCountry = expoCcRes.rows[0]?.country_code || null;
    const rawPhoneInput = phone || tokenData.phone || '';
    const phoneResult = normalizePhone(rawPhoneInput, activateCountry);
    if (!phoneResult.ok) {
      console.warn(`[reactivation/activate] phone unfixable for token ${tokenData.id} — storing '' as phone. raw=${String(rawPhoneInput).slice(0,80)} reason=${phoneResult.reason}`);
    }
    const phoneToStore = phoneResult.ok ? phoneResult.e164 : '';
    // custom_fields payload: NULL on success (INSERT stays clean); JSON blob on
    // reject with raw input (≤80 chars), the reason string, and an ISO timestamp.
    // Cast in-query as $16::jsonb so pg driver serialises correctly.
    const rejectTrace = phoneResult.ok ? null : JSON.stringify({
      phone_raw: String(rawPhoneInput).slice(0, 80),
      phone_reject_reason: phoneResult.reason,
      phone_rejected_at: new Date().toISOString()
    });

    const visitorResult = await pool.query(`
      INSERT INTO visitors (
        organizer_id, expo_id,
        name, last_name, email, company, country, job_title, phone,
        source, origin, visitor_type,
        qr_code, badge_id, badge_url,
        custom_fields,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, NOW())
      RETURNING *
    `, [
      tokenData.organizer_id,
      tokenData.target_expo_id,
      name || tokenData.name,
      last_name || tokenData.last_name,
      tokenData.email,
      company || tokenData.company,
      country || tokenData.country,
      job_title || tokenData.job_title,
      phoneToStore,
      'reactivation',
      'reactivation_campaign',
      'visitor',
      qrCode,
      badgeId,
      badgeUrl,
      rejectTrace
    ]);

    const newVisitor = visitorResult.rows[0];

    // Update token status
    await pool.query(
      'UPDATE reactivation_tokens SET status = $1, activated_at = NOW(), new_visitor_id = $2 WHERE id = $3',
      ['activated', newVisitor.id, tokenData.id]
    );

    await recordCampaignRegistration(_lc, {
      visitor_id: newVisitor.id,
      target_expo_id: tokenData.target_expo_id,
      via: 'reactivation_activate_new'
    });

    // Get form's email template for badge email
    // Use token's form_id (set during campaign creation) for correct template selection
    // Fallback: legacy tokens without form_id → first visitor-type form for this expo
    let formQuery, formParams;
    if (tokenData.form_id) {
      formQuery = `
        SELECT f.email_template_id, et.html_content, et.subject
        FROM forms f
        JOIN email_templates et ON f.email_template_id = et.id
        WHERE f.id = $1 AND f.email_template_id IS NOT NULL
      `;
      formParams = [tokenData.form_id];
    } else {
      formQuery = `
        SELECT f.email_template_id, et.html_content, et.subject
        FROM forms f
        JOIN email_templates et ON f.email_template_id = et.id
        WHERE f.expo_id = $1 AND f.visitor_type = 'visitor' AND f.email_template_id IS NOT NULL
        ORDER BY f.id ASC LIMIT 1
      `;
      formParams = [tokenData.target_expo_id];
    }
    const formResult = await pool.query(formQuery, formParams);
    console.log(`[reactivation] Activate template selection: form_id=${tokenData.form_id || 'NULL'}, template_id=${formResult.rows[0]?.email_template_id || 'NONE'}`);

    // Queue badge email
    if (formResult.rows.length > 0) {
      const template = formResult.rows[0];
      const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
      const qrImageTag = `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width:200px;">`;

      // Fetch expo name for template
      let expoName = '';
      const expoResult = await pool.query(`SELECT name FROM expos WHERE id = $1`, [tokenData.target_expo_id]);
      if (expoResult.rows.length) expoName = expoResult.rows[0].name;

      const templateData = {
        name: newVisitor.name || 'Guest',
        last_name: newVisitor.last_name || '',
        email: newVisitor.email,
        company: newVisitor.company || '',
        country: newVisitor.country || '',
        job_title: newVisitor.job_title || '',
        qr_code: qrImageTag,
        badge_id: badgeId,
        badge_url: badgeUrl,
        expo_name: expoName,
        date: new Date().toLocaleDateString()
      };

      const htmlContent = processEmailTemplate(template.html_content, templateData);
      const subject = processEmailTemplate(template.subject || 'Your Badge', templateData);

      await pool.query(`
        INSERT INTO email_queue (
          organizer_id, expo_id, visitor_id, template_id,
          recipient_email, subject, html_content,
          status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
      `, [
        tokenData.organizer_id,
        tokenData.target_expo_id,
        newVisitor.id,
        template.email_template_id,
        newVisitor.email,
        subject,
        htmlContent
      ]);
    }

    console.log(`✅ Visitor reactivated: ${newVisitor.email} for expo ${tokenData.target_expo_id}`);

    res.json({
      success: true,
      message: 'Your visitor pass has been activated!',
      visitor: {
        id: newVisitor.id,
        name: newVisitor.name,
        email: newVisitor.email,
        badge_id: badgeId,
        qr_code: qrCode
      }
    });

  } catch (err) {
    console.error('[reactivation] Activate error:', err.message);
    res.status(500).json({ success: false, error: 'Activation failed' });
  }
});

/**
 * GET /api/reactivation/job/:id
 * Poll background import job status
 */
router.get('/job/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, job_type, status, total_count, processed_count, skipped_count, failed_count, error_message, created_at, completed_at
       FROM import_jobs WHERE id = $1 AND organizer_id = $2`,
      [req.params.id, req.organizer_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[reactivation] Job status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get job status' });
  }
});

/**
 * GET /api/reactivation/stats/:expoId
 * Get campaign statistics
 */
router.get('/stats/:expoId', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;

    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'activated') as activated,
        COUNT(*) FILTER (WHERE status = 'expired') as expired
      FROM reactivation_tokens
      WHERE target_expo_id = $1 AND organizer_id = $2
    `, [expoId, req.organizer_id]);

    // Email queue stats
    const emailStats = await pool.query(`
      SELECT 
        COUNT(*) as total_emails,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_emails,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_emails,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_emails
      FROM email_queue
      WHERE expo_id = $1 AND organizer_id = $2
    `, [expoId, req.organizer_id]);

    res.json({
      success: true,
      tokens: result.rows[0],
      emails: emailStats.rows[0]
    });

  } catch (err) {
    console.error('[reactivation] Stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});


/**
 * POST /api/reactivation/resend-pending
 * Resend emails to pending (non-activated) tokens for a target expo
 * Optionally with a different email template
 */
router.post('/resend-pending', authMiddleware, async (req, res) => {
  try {
    const { target_expo_id, template_id } = req.body;
    const organizerId = req.organizer_id;

    if (!target_expo_id || !template_id) {
      return res.status(400).json({ success: false, error: 'target_expo_id and template_id are required' });
    }

    // Get email template
    const templateResult = await pool.query(
      'SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2',
      [template_id, organizerId]
    );
    if (templateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Email template not found' });
    }
    const emailTemplate = templateResult.rows[0];

    // Get target expo name
    const expoResult = await pool.query('SELECT name FROM expos WHERE id = $1', [target_expo_id]);
    const expoName = expoResult.rows.length > 0 ? expoResult.rows[0].name : '';

    // Get all pending tokens for this expo
    const pendingTokens = await pool.query(
      `SELECT token, email, name, last_name, company, country, job_title
       FROM reactivation_tokens
       WHERE target_expo_id = $1 AND organizer_id = $2 AND status = 'pending'`,
      [target_expo_id, organizerId]
    );

    if (pendingTokens.rows.length === 0) {
      return res.json({ success: true, message: 'No pending tokens to resend', sent: 0 });
    }

    const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
    let queuedCount = 0;

    for (const row of pendingTokens.rows) {
      try {
        const activationUrl = baseUrl + '/reactivate.html?token=' + row.token;

        const templateData = {
          name: row.name || 'Valued Guest',
          last_name: row.last_name || '',
          email: row.email,
          company: row.company || '',
          country: row.country || '',
          job_title: row.job_title || '',
          activation_url: activationUrl,
          expo_name: expoName,
          date: new Date().toLocaleDateString()
        };

        const htmlContent = processEmailTemplate(
          emailTemplate.html_content || emailTemplate.body || '',
          templateData
        );
        const subject = processEmailTemplate(
          emailTemplate.subject || 'Reminder: Activate Your Visitor Pass',
          templateData
        );

        await pool.query(
          `INSERT INTO email_queue (
            organizer_id, expo_id, visitor_id, template_id,
            recipient_email, subject, html_content,
            status, created_at
          ) VALUES ($1, $2, NULL, $3, $4, $5, $6, 'pending', NOW())`,
          [organizerId, target_expo_id, template_id, row.email, subject, htmlContent]
        );
        queuedCount++;
      } catch (rowErr) {
        console.error('[reactivation] Resend row error:', rowErr.message);
      }
    }

    console.log('[reactivation] Resend queued:', queuedCount, 'emails for expo', target_expo_id);

    res.json({
      success: true,
      message: queuedCount + ' emails queued for sending',
      sent: queuedCount,
      total_pending: pendingTokens.rows.length
    });

  } catch (err) {
    console.error('[reactivation] Resend error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to resend' });
  }
});

/**
 * GET /api/reactivation/campaign/:expoId/stats
 * Per-status email_queue breakdown for this expo (last 24h window)
 * Read-only: SELECT only, no writes
 */
router.get('/campaign/:expoId/stats', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;
    const organizerId = req.organizer_id;

    // Verify expo belongs to organizer
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, organizerId]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Expo not found' });
    }

    const result = await pool.query(`
      SELECT
        status,
        COUNT(*)::int AS count,
        MIN(created_at) AS oldest,
        MAX(sent_at) FILTER (WHERE status = 'sent') AS latest_sent
      FROM email_queue
      WHERE expo_id = $1
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY status
    `, [expoId]);

    const stats = {};
    let lastGlobalSentAt = null;
    for (const row of result.rows) {
      stats[row.status] = {
        count: row.count,
        oldest: row.oldest,
        latest_sent: row.latest_sent
      };
      if (row.latest_sent && (!lastGlobalSentAt || new Date(row.latest_sent) > new Date(lastGlobalSentAt))) {
        lastGlobalSentAt = row.latest_sent;
      }
    }

    res.json({
      expo_id: parseInt(expoId, 10),
      stats,
      last_global_sent_at: lastGlobalSentAt
    });
  } catch (err) {
    console.error('[reactivation] Stats breakdown error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get stats breakdown' });
  }
});

/**
 * GET /api/reactivation/campaign/:expoId/is-active
 * Used by the View Campaigns UI to decide whether the Resend button can
 * fire. is_active = (pending+processing count > 0) OR (anything queued in
 * the last 10 minutes). Same SELECT-only contract as /stats.
 */
router.get('/campaign/:expoId/is-active', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;
    const organizerId = req.organizer_id;

    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, organizerId]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Expo not found' });
    }

    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS pending_count,
        MAX(created_at) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') AS last_queued_at
      FROM email_queue
      WHERE expo_id = $1
        AND created_at > NOW() - INTERVAL '24 hours'
    `, [expoId]);

    const row = result.rows[0];
    const isActive = row.pending_count > 0 || row.last_queued_at !== null;

    res.json({
      is_active: isActive,
      pending_count: row.pending_count,
      last_queued_at: row.last_queued_at
    });
  } catch (err) {
    console.error('[reactivation] is-active check error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to check campaign state' });
  }
});

/**
 * POST /api/reactivation/campaign/:expoId/close
 * Marks the reactivation campaign as closed. Does NOT cancel in-flight queued
 * emails — the worker keeps draining whatever is already in email_queue.
 * Closing is a UI/intent signal: no further activations are expected, the
 * Resend button is disabled, and the card moves to Past Campaigns.
 *
 * Idempotent surface: 409 if already closed.
 * Requires migration 006_reactivation_closed_at.sql; returns 503 otherwise.
 */
router.post('/campaign/:expoId/close', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;
    const organizerId = req.organizer_id;

    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, organizerId]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Expo not found' });
    }

    let result;
    try {
      result = await pool.query(`
        UPDATE expos
        SET reactivation_closed_at = NOW(),
            reactivation_closed_by = $1
        WHERE id = $2 AND reactivation_closed_at IS NULL
        RETURNING reactivation_closed_at
      `, [organizerId, expoId]);
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          success: false,
          error: 'Close feature not yet enabled (migration 006 pending)'
        });
      }
      throw err;
    }

    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: 'Campaign is already closed' });
    }

    console.log(`[reactivation] Campaign closed: expo ${expoId} by organizer ${organizerId}`);
    res.json({ success: true, closed_at: result.rows[0].reactivation_closed_at });
  } catch (err) {
    console.error('[reactivation] Close error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to close campaign' });
  }
});

/**
 * POST /api/reactivation/campaign/:expoId/reopen
 * Clears the closed flag. Idempotent: 409 if not currently closed.
 * Requires migration 006_reactivation_closed_at.sql; returns 503 otherwise.
 */
router.post('/campaign/:expoId/reopen', authMiddleware, async (req, res) => {
  try {
    const { expoId } = req.params;
    const organizerId = req.organizer_id;

    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, organizerId]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Expo not found' });
    }

    let result;
    try {
      result = await pool.query(`
        UPDATE expos
        SET reactivation_closed_at = NULL,
            reactivation_closed_by = NULL
        WHERE id = $1 AND reactivation_closed_at IS NOT NULL
        RETURNING id
      `, [expoId]);
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          success: false,
          error: 'Close feature not yet enabled (migration 006 pending)'
        });
      }
      throw err;
    }

    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: 'Campaign is not closed' });
    }

    console.log(`[reactivation] Campaign reopened: expo ${expoId} by organizer ${organizerId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[reactivation] Reopen error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to reopen campaign' });
  }
});

module.exports = router;
