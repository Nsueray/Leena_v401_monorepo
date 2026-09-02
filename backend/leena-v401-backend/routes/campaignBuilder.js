/**
 * routes/campaignBuilder.js — Campaign Wizard backend
 *
 * G1 (this file, first pass): segment preview endpoint + orchestrator skeleton.
 * G2 (next commit): full orchestrator phases + validate-template endpoint.
 *
 * Mounted at /api/campaigns alongside routes/campaigns.js (Express supports
 * multiple routers on the same prefix). Endpoints exposed here:
 *
 *   POST /api/campaigns/reactivation/segment    G1 — read-only counts + preview_token
 *   POST /api/campaigns/reactivation/build      G1 skeleton, G2 fills phases
 *   GET  /api/campaigns/reactivation/job/:id    G1 skeleton, phase reporting in G2
 *
 * Scope note (Suer, 2 Sep): the wizard MUST mint tokens through the
 * create-from-excel silent path only (no template_id). Never pass template_id
 * from the wizard into the token-minting call. Enforced by construction — the
 * orchestrator phases in G2 will call processReactivationChunks with
 * emailTemplate=null. Verified live 2 Sep on jobs 35 + 36 (tokens created,
 * 0 email_queue rows).
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// Match reactivation.js:20 file-size limit (50 MB — 70k-row-agency headroom).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authMiddleware);

// ============================================================
// PREVIEW CACHE — short-lived in-memory Map keyed by preview_token.
// The orchestrator (G2) reads back the same segmented set the preview
// showed the user, avoiding a re-segment during build.
// TTL 30 min: covers a wizard session; expires cleanly so we don't
// leak memory on long-running Node processes.
// Sweeper runs opportunistically on every set() — no interval needed.
// ============================================================
const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes
const previewCache = new Map();        // preview_token → { expiresAt, payload }

function _sweepExpired() {
    const now = Date.now();
    for (const [key, entry] of previewCache) {
        if (entry.expiresAt < now) previewCache.delete(key);
    }
}

function cachePreview(payload) {
    _sweepExpired();
    const token = crypto.randomBytes(16).toString('hex');
    previewCache.set(token, { expiresAt: Date.now() + PREVIEW_TTL_MS, payload });
    return token;
}

function readPreview(token) {
    _sweepExpired();
    const entry = previewCache.get(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.payload;
}

// ============================================================
// EMAIL HELPERS — mirror routes/reactivation.js:184 exactly.
// prefetchEmails at reactivation.js:222-232 uses LOWER(email) without TRIM
// on the DB side; here we TRIM on the Node side after read for symmetry
// with prepareExcelRows' .toLowerCase().trim() pattern.
// ============================================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(e) {
    return String(e == null ? '' : e).toLowerCase().trim();
}

// ============================================================
// SEGMENT — POST /api/campaigns/reactivation/segment
// ============================================================
//
// Input (multipart/form-data): file (xlsx), target_expo_id
// OR (application/json — future G2): { target_expo_id, source_expo_ids: [] }
//
// Output:
// {
//   success: true,
//   preview_token: "<hex>",
//   target_expo_id: 9,
//   target_expo_name: "Morocco Siema Expo 2026",
//   source_kind: "excel" | "expo",
//   source_size: 42212,
//   counts: {
//     total_verified: 42212,
//     invalid_email:   0,
//     duplicates_in_list: 0,
//     g1_already_registered_target:  887,   // excluded
//     g2_activate_raw:              14967,
//     g2_activate_mailable:         14941,   // minus unsub, minus existing token
//     g3_register_raw:              26358,
//     g3_register_mailable:         26262,   // minus unsub
//     unsubscribed_hits:              121,
//     existing_pending_tokens_hit: 26,       // G2 raw → mailable delta from tokens
//   }
// }
//
// Read-only, no writes. Preview lasts 30 min.
router.post('/reactivation/segment', upload.single('file'), async (req, res) => {
    try {
        const organizerId = req.organizer_id || 1;
        const target_expo_id = parseInt(req.body.target_expo_id, 10);

        if (!target_expo_id) {
            return res.status(400).json({ success: false, error: 'target_expo_id is required' });
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

        // ---- Build the raw email list from the input source -----------
        let rawEmails = [];          // [{ email, name, last_name, company, country, job_title }]
        let sourceKind = null;
        if (req.file) {
            sourceKind = 'excel';
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            for (const row of rows) {
                rawEmails.push({
                    email: normEmail(row.email || row.Email || row.EMAIL || ''),
                    name: String(row.name || row.Name || row.first_name || row['First Name'] || '').trim(),
                    last_name: String(row.last_name || row['Last Name'] || row.surname || '').trim(),
                    company: String(row.company || row.Company || row.organization || '').trim(),
                    country: String(row.country || row.Country || '').trim(),
                    job_title: String(row.job_title || row['Job Title'] || row.title || '').trim(),
                });
            }
        } else if (req.body.source_expo_ids) {
            // From-expo path (JSON body). One or more source expos on this organizer.
            sourceKind = 'expo';
            const src = Array.isArray(req.body.source_expo_ids)
                ? req.body.source_expo_ids.map(id => parseInt(id, 10)).filter(Boolean)
                : String(req.body.source_expo_ids).split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
            if (src.length === 0) {
                return res.status(400).json({ success: false, error: 'source_expo_ids must be a non-empty list of expo IDs' });
            }
            // Ownership check + fetch visitors
            const srcCheck = await pool.query(
                'SELECT COUNT(*)::int AS n FROM expos WHERE id = ANY($1) AND organizer_id = $2',
                [src, organizerId]
            );
            if (srcCheck.rows[0].n !== src.length) {
                return res.status(403).json({ success: false, error: 'One or more source_expo_ids do not belong to your organizer' });
            }
            // Grab the freshest row per email across the source expos (mirrors
            // the STEP 2 LATERAL from REACTIVATION_SEGMENTATION_SQL_20260818.md:143-148).
            const srcRes = await pool.query(`
                SELECT DISTINCT ON (LOWER(TRIM(email)))
                    LOWER(TRIM(email)) AS email,
                    name, last_name, company, country, job_title
                FROM visitors
                WHERE expo_id = ANY($1)
                  AND email IS NOT NULL AND TRIM(email) <> ''
                ORDER BY LOWER(TRIM(email)), updated_at DESC NULLS LAST, id DESC
            `, [src]);
            rawEmails = srcRes.rows.map(r => ({
                email: r.email,
                name: r.name || '', last_name: r.last_name || '',
                company: r.company || '', country: r.country || '',
                job_title: r.job_title || ''
            }));
        } else {
            return res.status(400).json({
                success: false,
                error: 'Provide either a file (multipart) or source_expo_ids (JSON body)'
            });
        }

        // ---- Dedup + basic validation ---------------------------------
        const total_verified = rawEmails.length;
        let invalid_email = 0;
        const seen = new Set();
        const cleanList = [];  // [{email, ...prefill}], dedup by email, valid only
        for (const row of rawEmails) {
            if (!row.email || !EMAIL_RE.test(row.email)) { invalid_email++; continue; }
            if (seen.has(row.email)) continue;
            seen.add(row.email);
            cleanList.push(row);
        }
        const duplicates_in_list = total_verified - invalid_email - cleanList.length;

        // ---- Pre-fetch DB sets (mirrors reactivation.js prefetchEmails
        // pattern) — one shot each, O(1) lookup per row -----------------
        const [targetVisitorsRes, otherVisitorsRes, unsubRes, existingTokensRes] = await Promise.all([
            pool.query(
                'SELECT LOWER(TRIM(email)) AS email FROM visitors WHERE expo_id = $1 AND email IS NOT NULL',
                [target_expo_id]
            ),
            pool.query(
                'SELECT DISTINCT LOWER(TRIM(email)) AS email FROM visitors WHERE expo_id <> $1 AND email IS NOT NULL AND organizer_id = $2',
                [target_expo_id, organizerId]
            ),
            pool.query(
                'SELECT LOWER(TRIM(email)) AS email FROM email_unsubscribes WHERE organizer_id = $1',
                [organizerId]
            ),
            pool.query(
                'SELECT LOWER(TRIM(email)) AS email FROM reactivation_tokens WHERE target_expo_id = $1',
                [target_expo_id]
            )
        ]);
        const S_target = new Set(targetVisitorsRes.rows.map(r => r.email));
        const S_other  = new Set(otherVisitorsRes.rows.map(r => r.email));
        const S_unsub  = new Set(unsubRes.rows.map(r => r.email));
        const S_tokens = new Set(existingTokensRes.rows.map(r => r.email));

        // ---- Bucket every clean email into G1 / G2 / G3 ---------------
        // Priority per REACTIVATION_SEGMENTATION_SQL_20260818.md §STEP 1:
        //   G1 = already registered for the target expo  (excluded)
        //   G2 = has LEENA history on some other expo    (activate flow)
        //   G3 = no LEENA record anywhere                (register flow)
        // Then subtract unsub from G2 + G3.
        // For G2 mailable, ALSO subtract existing pending tokens (they will
        // be silently skipped by create-from-excel — see doc §"Expo 13 is NOT
        // a clean slate" — the wizard should be honest about this).
        const g1_list = [];
        const g2_list = [];
        const g3_list = [];
        let unsub_hits = 0;
        let g2_already_has_token = 0;

        for (const row of cleanList) {
            if (S_target.has(row.email)) { g1_list.push(row); continue; }
            const isUnsub = S_unsub.has(row.email);
            if (S_other.has(row.email)) {
                g2_list.push({ ...row, _unsub: isUnsub, _hasToken: S_tokens.has(row.email) });
                if (isUnsub) unsub_hits++;
                if (S_tokens.has(row.email)) g2_already_has_token++;
            } else {
                g3_list.push({ ...row, _unsub: isUnsub });
                if (isUnsub) unsub_hits++;
            }
        }
        const g2_activate_mailable = g2_list.filter(r => !r._unsub && !r._hasToken).length;
        const g3_register_mailable = g3_list.filter(r => !r._unsub).length;

        // ---- Cache the segmented sets for the orchestrator ------------
        // Payload is small (5 short strings per row) and lives 30 min. For
        // 42k rows this is ~5 MB in Node heap — fine. G24 does not apply:
        // this is server-side state, not a request payload.
        const previewToken = cachePreview({
            target_expo_id,
            target_expo_name: targetExpo.name,
            target_country_code: targetExpo.country_code || null,
            source_kind: sourceKind,
            source_size: total_verified,
            // NOTE: g1_list intentionally not cached — the orchestrator does
            //       nothing with it (it's the "excluded" bucket).
            g2_activate: g2_list,   // includes _unsub + _hasToken flags for the build phase
            g3_register: g3_list,   // includes _unsub flag
            created_at: new Date().toISOString()
        });

        res.json({
            success: true,
            preview_token: previewToken,
            target_expo_id,
            target_expo_name: targetExpo.name,
            source_kind: sourceKind,
            source_size: total_verified,
            counts: {
                total_verified,
                invalid_email,
                duplicates_in_list,
                g1_already_registered_target: g1_list.length,
                g2_activate_raw: g2_list.length,
                g2_activate_mailable,
                g3_register_raw: g3_list.length,
                g3_register_mailable,
                unsubscribed_hits: unsub_hits,
                existing_pending_tokens_hit: g2_already_has_token,
            },
            preview_expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
            note: 'Zero writes. Preview is cached server-side for 30 minutes. Pass preview_token to POST /reactivation/build to commit.'
        });

    } catch (err) {
        console.error('[campaign-wizard/segment] error:', err.message);
        res.status(500).json({ success: false, error: 'Segmentation failed', details: err.message });
    }
});

// ============================================================
// BUILD (SKELETON — G1) — POST /api/campaigns/reactivation/build
// ============================================================
//
// G1 skeleton: creates an import_jobs row with job_type='reactivation_campaign',
// dispatches setImmediate that immediately marks status='completed'. Full 6
// phases (re-segment → mint tokens silently → build recipient rows → create
// draft campaigns + steps → insert campaign_recipients) land in G2.
//
// Input: { preview_token }
// Response: 202 { success, job_id, phase, ... }
router.post('/reactivation/build', async (req, res) => {
    try {
        const organizerId = req.organizer_id || 1;
        const { preview_token } = req.body || {};

        if (!preview_token) {
            return res.status(400).json({ success: false, error: 'preview_token is required' });
        }
        const preview = readPreview(preview_token);
        if (!preview) {
            return res.status(410).json({
                success: false,
                error: 'preview_token expired or not found — re-run POST /reactivation/segment'
            });
        }

        // Create the job row up front so the caller can poll it immediately.
        const totalRows = preview.g2_activate.length + preview.g3_register.length;
        const jobRes = await pool.query(
            `INSERT INTO import_jobs (organizer_id, job_type, target_expo_id, total_count, status)
             VALUES ($1, 'reactivation_campaign', $2, $3, 'processing') RETURNING id`,
            [organizerId, preview.target_expo_id, totalRows]
        );
        const jobId = jobRes.rows[0].id;

        // G1 SKELETON — orchestrator body lands in G2. For now, immediately
        // mark completed so the polling endpoint returns cleanly and the
        // wizard flow can be smoke-tested end-to-end without campaigns being
        // created yet. G2 replaces this setImmediate with the real phases.
        setImmediate(async () => {
            try {
                await pool.query(
                    `UPDATE import_jobs
                     SET status='completed', processed_count=$1, completed_at=NOW(), updated_at=NOW(),
                         error_message='SKELETON: G2 will implement the 6 phases (re-segment → mint tokens → build recipients → create draft campaigns → insert campaign_recipients)'
                     WHERE id=$2`,
                    [totalRows, jobId]
                );
                console.log(`[wizard/build ${jobId}] SKELETON — marked completed, ${totalRows} rows unhandled (G2 pending)`);
            } catch (err) {
                console.error(`[wizard/build ${jobId}] skeleton commit failed:`, err.message);
                await pool.query(
                    `UPDATE import_jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
                    [err.message, jobId]
                ).catch(() => {});
            }
        });

        res.status(202).json({
            success: true,
            job_id: jobId,
            phase: 'accepted',
            phase_progress: 0,
            phase_total: totalRows,
            g2_activate_count: preview.g2_activate.length,
            g3_register_count: preview.g3_register.length,
            target_expo_id: preview.target_expo_id,
            target_expo_name: preview.target_expo_name,
            message: 'Wizard job accepted. Poll /api/campaigns/reactivation/job/' + jobId + ' for status. NOTE (G1): orchestrator body is skeleton — no campaigns will be created until G2 lands.'
        });
    } catch (err) {
        console.error('[campaign-wizard/build] error:', err.message);
        res.status(500).json({ success: false, error: 'Build kickoff failed', details: err.message });
    }
});

// ============================================================
// JOB STATUS (SKELETON — G1) — GET /api/campaigns/reactivation/job/:id
// ============================================================
//
// G1: thin wrapper over import_jobs. G2 will add phase-aware fields
// (phase name + phase_progress/phase_total) once the orchestrator emits
// them per phase.
router.get('/reactivation/job/:id', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, job_type, status, total_count, processed_count, skipped_count, failed_count,
                    error_message, created_at, updated_at, completed_at, target_expo_id
             FROM import_jobs
             WHERE id = $1 AND organizer_id = $2 AND job_type = 'reactivation_campaign'`,
            [parseInt(req.params.id, 10), req.organizer_id || 1]
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Wizard job not found' });
        }
        res.json(r.rows[0]);
    } catch (err) {
        console.error('[campaign-wizard/job] error:', err.message);
        res.status(500).json({ success: false, error: 'Job status lookup failed' });
    }
});

module.exports = router;
