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
// G2: reuse the same token-minting chunk processor as the reactivation route.
// Called with emailTemplate=null to enforce silent mode (verified live 2 Sep
// on jobs 35/36: tokens created, 0 email_queue rows).
const { processReactivationChunks, generateToken } = require('./reactivation');
// Valid step conditions — mirrors campaigns.js:47 exactly.
const VALID_CONDITIONS = ['all', 'not_opened', 'opened', 'not_clicked', 'clicked', 'not_registered', 'registered'];

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
// TRUNCATION HELPER (Piece 5) — reactivation_tokens columns are
// VARCHAR(255). One 303-char value can roll back a 1000-row chunk
// (per CAMPAIGN_UI_DESIGN_20260819.md §2.4). Truncate at 255 with a
// counter surfaced in the job's console log + result summary.
// ============================================================
const VARCHAR_LIMIT = 255;
function truncate255(s) {
    const str = s == null ? '' : String(s);
    return str.length > VARCHAR_LIMIT ? str.slice(0, VARCHAR_LIMIT) : str;
}
function truncateRowFields(row) {
    let truncated = 0;
    const t = (v) => {
        const s = v == null ? '' : String(v);
        if (s.length > VARCHAR_LIMIT) { truncated++; return s.slice(0, VARCHAR_LIMIT); }
        return s;
    };
    const out = {
        email: t(row.email),
        name: t(row.name),
        last_name: t(row.last_name),
        company: t(row.company),
        country: t(row.country),
        job_title: t(row.job_title),
        phone: t(row.phone || '')
    };
    return { row: out, truncated };
}

// ============================================================
// TEMPLATE VALIDATION (Piece 6) — 5 checks per plan §3.4.
//
//   NO_GREETING_CHAIN         ERROR — bare {{first_name}}/{{name}}/{{last_name}}
//                                     not wrapped in a `|` chain in the body
//   BARE_FIRST_NAME_IN_SUBJECT ERROR — same, in the subject
//   UNRESOLVED_TOKEN          ERROR — {{token}} not in the wizard's known set
//                                     (see KNOWN_TOKENS below)
//   NO_CTA                    WARNING — no <a href="..."> with a real target
//   DEAD_UNSUB_URL            WARNING — literal {{unsubscribe_url}} in body
//                                       (unfillable in campaign mode — G7)
//
// A campaign-recipient row's `extra_fields` JSONB can carry any key; the
// wizard puts `activation_url` there for G2 tokens. Both `first_name` +
// `last_name` are proper columns on `campaign_recipients`. `{{name}}` is
// the frontend alias for `first_name` (documented in
// REACTIVATION_SEGMENTATION_SQL_20260818.md:213-216).
// ============================================================
// KNOWN_TOKENS derived from the actual resolvers, not invented:
//
//   Campaign Mode 2 render (email_worker.js:569-577) provides the fixed set:
//       name, first_name, last_name, email, company, date
//   Plus `...extraFields` at :576 — anything the wizard puts into
//   campaign_recipients.extra_fields becomes a valid token at send time.
//   The wizard populates: activation_url, country, job_title, expo_name
//   (see Phase 3/4 build).
//
// NOT included:
//   - unsubscribe_url  — unfillable in campaign mode (G7); flagged separately
//                        as DEAD_UNSUB_URL warning.
//   - qr_code, badge_url — those live in badge/confirmation Mode 2 (email_worker.js
//                        :208-223), NOT in campaign mail. Using them in a
//                        campaign template renders empty.
const KNOWN_TOKENS = new Set([
    // Fixed keys from email_worker.js:569-577 (campaign Mode 2 data build):
    'name', 'first_name', 'last_name', 'email', 'company', 'date',
    // Keys wizard writes into extra_fields for every recipient (Phase 3/4):
    'activation_url', 'country', 'job_title', 'expo_name',
    // Recognised so the validator does NOT fire UNRESOLVED_TOKEN — but the
    // literal placeholder is unfillable in campaign mode (G7). It gets its
    // own warning (DEAD_UNSUB_URL) below.
    'unsubscribe_url'
]);

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

// True iff `part` is a quoted literal, matching utils/email.js:18 exactly.
function isQuotedLiteral(part) {
    return /^".*"$/.test(part);
}

// Validate a single {{...}} inside content: for chain form ({{a|b|"lit"}}) every
// segment must be either a KNOWN_TOKENS key or a quoted literal — mirrors the
// resolver at utils/email.js:15-22 which walks parts left-to-right and only
// resolves keys present in `data` OR literal strings. A junk segment would
// silently render empty at send time.
function inspectPlaceholder(inside) {
    const parts = inside.split('|').map(p => p.trim());
    const hasChain = parts.length > 1;
    const unknownSegments = parts.filter(p => !isQuotedLiteral(p) && !KNOWN_TOKENS.has(p));
    return { parts, hasChain, unknownSegments };
}

/**
 * Validate a template body/subject pair against the greeting-chain rule and
 * the token-resolvability rules. Optionally wave-aware (Fix 3):
 *   wave === 'activate'  → body MUST contain <a href="...{{activation_url}}...">
 *                          (ERROR MISSING_ACTIVATION_URL); NO_CTA suppressed
 *                          (the activation URL IS the CTA).
 *   wave === 'register'  → no activation_url required; NO_CTA warning applies.
 *   wave === null        → standalone /validate-template preview — activation
 *                          check skipped, generic CTA check runs as warning.
 */
function validateTemplateBody(html, subject, wave) {
    const issues = [];
    const bodyStr = String(html || '');
    const subjStr = String(subject || '');

    const scan = (str, where) => {
        let m;
        PLACEHOLDER_RE.lastIndex = 0;
        while ((m = PLACEHOLDER_RE.exec(str)) !== null) {
            const inside = m[1].trim();
            const { parts, hasChain, unknownSegments } = inspectPlaceholder(inside);

            // Chain-syntax check FIRST — a `{{first_name|last_name|company|"Dear Visitor"}}`
            // parses cleanly; a `{{first_name|junk_key}}` does not.
            if (hasChain && unknownSegments.length > 0) {
                issues.push({
                    code: 'UNRESOLVED_TOKEN',
                    severity: 'error',
                    message: `${where}: chain {{${inside}}} contains unknown segment(s): ${unknownSegments.map(s => `"${s}"`).join(', ')} — must be a known key or a quoted literal`
                });
                continue;
            }
            if (hasChain) continue; // valid chain form

            // Bare token — must be in KNOWN_TOKENS, and (for first_name/name/last_name)
            // must NOT be bare (must use the chain form).
            const key = parts[0].split(/\s/)[0]; // guard against inner whitespace
            if (!KNOWN_TOKENS.has(key)) {
                issues.push({
                    code: 'UNRESOLVED_TOKEN',
                    severity: 'error',
                    message: `${where}: token {{${inside}}} is not resolvable at send time (not in the wizard's known set)`
                });
                continue;
            }
            // Severity split — measured against email_worker.js:570-572
            // (Suer, 2 Sep):
            //   {{first_name}} / {{last_name}} → `|| ''` at :571-572 → render
            //     EMPTY on miss. This is what breaks at send time. ERROR.
            //   {{name}} → `recipient.first_name || 'Guest'` at :570 → NEVER
            //     empty; falls back to the fixed English word "Guest".
            //     Correct but not localisable and not controllable. WARNING.
            //   Same distinction applies in the subject line.
            if (key === 'first_name' || key === 'last_name') {
                if (where === 'body') {
                    issues.push({
                        code: 'NO_GREETING_CHAIN',
                        severity: 'error',
                        message: `${where}: bare {{${key}}} without a |-chain — will render empty if the field is missing (CLAUDE.md v4.0.9)`
                    });
                } else {
                    issues.push({
                        code: 'BARE_FIRST_NAME_IN_SUBJECT',
                        severity: 'error',
                        message: `${where}: bare {{${key}}} without a |-chain — will render empty in the subject line if the field is missing`
                    });
                }
            } else if (key === 'name') {
                issues.push({
                    code: 'BARE_NAME_FALLBACK',
                    severity: 'warning',
                    message: `${where}: {{name}} renders the fixed English word "Guest" when the first name is empty. Recommended chain: {{first_name|last_name|company|"Dear Visitor"}} — this lets you control the greeting.`
                });
            }
        }
    };
    scan(bodyStr, 'body');
    scan(subjStr, 'subject');

    // ---- Wave-aware CTA check (Fix 3) --------------------------------
    // ACTIVATE wave: MUST wire {{activation_url}} into an <a href> — this is
    // exactly the #58/#59 failure from the 18 Aug template audit (CTA
    // pointed at empty {{activation_url}} for Group 3 recipients who held
    // no token). For activate-wave recipients ALL have tokens — missing
    // the placeholder inside the href means the link goes nowhere.
    if (wave === 'activate') {
        const hasActivationHref =
            /\<a[^>]*\shref\s*=\s*["'][^"']*\{\{\s*activation_url\s*\}\}[^"']*["']/i.test(bodyStr);
        if (!hasActivationHref) {
            issues.push({
                code: 'MISSING_ACTIVATION_URL',
                severity: 'error',
                message: 'body: activate-wave template has no <a href="...{{activation_url}}..."> — CTA points nowhere for recipients with tokens (#58/#59 pattern from 18 Aug audit)'
            });
        }
    } else {
        // REGISTER wave (or standalone preview): NO_CTA if there's no
        // <a href="..."> with a non-empty target at all.
        const hasAnyExternalHref = /\<a[^>]*\shref\s*=\s*["'][^"'\s][^"']*["']/i.test(bodyStr);
        if (!hasAnyExternalHref) {
            issues.push({
                code: 'NO_CTA',
                severity: 'warning',
                message: 'body: no <a href="..."> with a non-empty target — announcement-only template?'
            });
        }
    }

    // ---- DEAD_UNSUB_URL warning (G7) ----
    if (/\{\{\s*unsubscribe_url\s*\}\}/.test(bodyStr)) {
        issues.push({
            code: 'DEAD_UNSUB_URL',
            severity: 'warning',
            message: 'body: literal {{unsubscribe_url}} placeholder is unfillable in campaign mode (G7) — worker appends its own footer, this token will render as empty href'
        });
    }

    return issues;
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
// VALIDATE-TEMPLATE (Piece 6) — POST /api/campaigns/validate-template
// ============================================================
//
// Pure validation. Fetches subject + html_content for template_id, runs the
// 5 checks, returns { ok, issues:[{code, message, severity}], template_name }.
// ok === issues.every(i => i.severity !== 'error').
router.post('/validate-template', async (req, res) => {
    try {
        const organizerId = req.organizer_id || 1;
        const { template_id, wave } = req.body || {};
        if (!template_id) {
            return res.status(400).json({ success: false, error: 'template_id is required' });
        }
        if (wave != null && wave !== 'activate' && wave !== 'register') {
            return res.status(400).json({ success: false, error: 'wave, if provided, must be "activate" or "register"' });
        }
        const r = await pool.query(
            `SELECT id, name, subject, html_content FROM email_templates
             WHERE id = $1 AND organizer_id = $2`,
            [template_id, organizerId]
        );
        if (r.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        const t = r.rows[0];
        const issues = validateTemplateBody(t.html_content, t.subject, wave || null);
        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warningCount = issues.filter(i => i.severity === 'warning').length;
        res.json({
            success: true,
            template_id: t.id,
            template_name: t.name,
            wave: wave || null,
            ok: errorCount === 0,
            error_count: errorCount,
            warning_count: warningCount,
            issues
        });
    } catch (err) {
        console.error('[campaign-wizard/validate-template] error:', err.message);
        res.status(500).json({ success: false, error: 'Template validation failed' });
    }
});

// ============================================================
// BUILD (G2 — full orchestrator) — POST /api/campaigns/reactivation/build
// ============================================================
//
// Six phases inside one import_jobs row (job_type='reactivation_campaign'):
//   1. RESEGMENT     — read from preview cache (already done at segment time)
//   2. MINT TOKENS   — silent via processReactivationChunks (emailTemplate=null)
//   3. BUILD G2 RECIPIENTS — with activation_url from just-minted tokens
//   4. BUILD G3 RECIPIENTS — no tokens needed
//   5. CREATE 2 DRAFT CAMPAIGNS + STEPS — email_campaigns + campaign_steps
//   6. INSERT campaign_recipients — batch INSERT with ON CONFLICT DO NOTHING
//
// Body:
//   {
//     preview_token: string,
//     activate_steps: [{template_id, delay_hours, condition}, ...],
//     register_steps: [{template_id, delay_hours, condition}, ...],
//     activate_name?: string,      // default: "<expo> Activate Wave"
//     register_name?: string,      // default: "<expo> Register Wave"
//     skip_template_validation?: true  // API-only per Suer, not in the wizard UI
//   }
//
// Returns 202 { job_id, ...counts }. Poll /reactivation/job/:id for status.
router.post('/reactivation/build', async (req, res) => {
    try {
        const organizerId = req.organizer_id || 1;
        const {
            preview_token,
            activate_steps = [],
            register_steps = [],
            activate_name,
            register_name,
            skip_template_validation
        } = req.body || {};

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

        // ---- Validate step configs shape ---------------------------------
        const stepArrays = [
            { name: 'activate_steps', arr: activate_steps },
            { name: 'register_steps', arr: register_steps }
        ];
        for (const { name, arr } of stepArrays) {
            if (!Array.isArray(arr)) {
                return res.status(400).json({ success: false, error: `${name} must be an array` });
            }
            for (let i = 0; i < arr.length; i++) {
                const s = arr[i];
                if (!s || typeof s.template_id !== 'number') {
                    return res.status(400).json({ success: false, error: `${name}[${i}].template_id must be a number` });
                }
                if (s.delay_hours != null && (typeof s.delay_hours !== 'number' || s.delay_hours < 0)) {
                    return res.status(400).json({ success: false, error: `${name}[${i}].delay_hours must be a non-negative number` });
                }
                if (s.condition && !VALID_CONDITIONS.includes(s.condition)) {
                    return res.status(400).json({ success: false, error: `${name}[${i}].condition must be one of: ${VALID_CONDITIONS.join(', ')}` });
                }
            }
        }
        if (activate_steps.length === 0 && register_steps.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one of activate_steps or register_steps must be non-empty' });
        }

        // ---- Template validation (Piece 6, unless skip flag set) ---------
        // Blocks on error-severity issues; warnings pass through.
        // WAVE-AWARE (Fix 3): activate-wave templates must wire {{activation_url}}
        // into an href (or ERROR); register-wave templates get the generic CTA
        // warning. Templates used in BOTH waves are validated against BOTH — if
        // a template is legal in only one wave it can still be legally used in
        // that one, and its report will name the wave that objected.
        if (!skip_template_validation) {
            const uniqueTemplateIds = [...new Set([
                ...activate_steps.map(s => s.template_id),
                ...register_steps.map(s => s.template_id)
            ])];
            if (uniqueTemplateIds.length > 0) {
                const tr = await pool.query(
                    `SELECT id, name, subject, html_content FROM email_templates
                     WHERE id = ANY($1) AND organizer_id = $2`,
                    [uniqueTemplateIds, organizerId]
                );
                if (tr.rows.length !== uniqueTemplateIds.length) {
                    return res.status(404).json({ success: false, error: 'One or more template_ids not found for your organizer' });
                }
                const activateTemplateIds = new Set(activate_steps.map(s => s.template_id));
                const registerTemplateIds = new Set(register_steps.map(s => s.template_id));
                const blockingIssues = [];
                for (const t of tr.rows) {
                    if (activateTemplateIds.has(t.id)) {
                        const errs = validateTemplateBody(t.html_content, t.subject, 'activate')
                            .filter(i => i.severity === 'error');
                        if (errs.length > 0) blockingIssues.push({ template_id: t.id, template_name: t.name, wave: 'activate', errors: errs });
                    }
                    if (registerTemplateIds.has(t.id)) {
                        const errs = validateTemplateBody(t.html_content, t.subject, 'register')
                            .filter(i => i.severity === 'error');
                        if (errs.length > 0) blockingIssues.push({ template_id: t.id, template_name: t.name, wave: 'register', errors: errs });
                    }
                }
                if (blockingIssues.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'One or more templates fail validation. Fix the templates or pass skip_template_validation=true to override.',
                        blocking_templates: blockingIssues
                    });
                }
            }
        }

        // ---- Create the job row up front so caller can poll immediately --
        const totalRows = preview.g2_activate.length + preview.g3_register.length;
        const jobRes = await pool.query(
            `INSERT INTO import_jobs (organizer_id, job_type, target_expo_id, total_count, status)
             VALUES ($1, 'reactivation_campaign', $2, $3, 'processing') RETURNING id`,
            [organizerId, preview.target_expo_id, totalRows]
        );
        const jobId = jobRes.rows[0].id;

        // ---- Dispatch orchestrator body (setImmediate, phased) -----------
        setImmediate(async () => {
            let phase = 'phase_1_resegment';
            try {
                console.log(`[wizard/build ${jobId}] START — target expo ${preview.target_expo_id}, G2=${preview.g2_activate.length}, G3=${preview.g3_register.length}`);

                // Phase 1 — resegment (already done at segment time; nothing to do).
                // Kept as an explicit named phase for future orchestration.

                // -------------------------------------------------------------
                // Phase 2 — MINT TOKENS silently.
                // Filter G2 to !_unsub && !_hasToken. Truncate VARCHAR(255)
                // fields per Piece 5. Call processReactivationChunks with
                // emailTemplate=null (silent-mode guard chain enforced at
                // reactivation.js:133/346/380/440).
                // -------------------------------------------------------------
                phase = 'phase_2_mint_tokens';
                console.log(`[wizard/build ${jobId}] ${phase} START`);

                const tokensNeeded = preview.g2_activate.filter(r => !r._unsub && !r._hasToken);
                let truncatedCount = 0;
                const tokenValidRows = tokensNeeded.map(r => {
                    const { row: t, truncated } = truncateRowFields(r);
                    truncatedCount += truncated;
                    // Fix 1: use reactivation.js:25 generateToken() — single
                    // source of truth. Never a second RNG.
                    return { ...t, token: generateToken() };
                });
                if (truncatedCount > 0) {
                    console.log(`[wizard/build ${jobId}] Piece 5: truncated ${truncatedCount} field values to 255 chars`);
                }

                // Fetch target expo full row (processReactivationChunks reads it).
                const targetExpoRes = await pool.query(
                    `SELECT id, name, end_date FROM expos WHERE id = $1`,
                    [preview.target_expo_id]
                );
                const targetExpo = targetExpoRes.rows[0];

                if (tokenValidRows.length > 0) {
                    await processReactivationChunks(jobId, tokenValidRows, {
                        target_expo_id: preview.target_expo_id,
                        organizerId,
                        template_id: null,          // silent
                        form_id: null,
                        emailTemplate: null,        // silent (guarded at reactivation.js:133)
                        targetExpo,
                        source_expo_id: null        // not the from-expo path
                    });
                    console.log(`[wizard/build ${jobId}] ${phase} DONE — minted ${tokenValidRows.length} tokens`);
                } else {
                    console.log(`[wizard/build ${jobId}] ${phase} SKIP — 0 new tokens needed (all G2 already have tokens or are unsubbed)`);
                }

                // -------------------------------------------------------------
                // Phase 3 — BUILD G2 RECIPIENT ROWS with activation_url.
                // Includes freshly-minted AND pre-existing tokens (both
                // preview.g2_activate emails that aren't unsub).
                // -------------------------------------------------------------
                phase = 'phase_3_g2_recipients';
                const g2Mailable = preview.g2_activate.filter(r => !r._unsub);
                const g2Emails = g2Mailable.map(r => r.email);
                let g2Recipients = [];
                if (g2Emails.length > 0) {
                    const tokenLookup = await pool.query(
                        `SELECT LOWER(TRIM(email)) AS email, token FROM reactivation_tokens
                         WHERE target_expo_id = $1 AND email = ANY($2)
                           AND status = 'pending'`,
                        [preview.target_expo_id, g2Emails]
                    );
                    const tokenByEmail = new Map(tokenLookup.rows.map(r => [r.email, r.token]));
                    const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
                    for (const r of g2Mailable) {
                        const tok = tokenByEmail.get(r.email);
                        if (!tok) continue; // token missing (chunk error) — skip; will surface in job.failed_count
                        g2Recipients.push({
                            email: r.email,
                            first_name: r.name || null,
                            last_name: r.last_name || null,
                            company: r.company || null,
                            extra_fields: {
                                activation_url: `${baseUrl}/reactivate.html?token=${tok}`,
                                country: r.country || '',
                                job_title: r.job_title || '',
                                expo_name: preview.target_expo_name
                            }
                        });
                    }
                }
                console.log(`[wizard/build ${jobId}] ${phase} DONE — ${g2Recipients.length} G2 recipient rows built`);

                // -------------------------------------------------------------
                // Phase 4 — BUILD G3 RECIPIENT ROWS. No tokens; extra_fields
                // carries country + job_title so future templates can use them.
                // -------------------------------------------------------------
                phase = 'phase_4_g3_recipients';
                const g3Mailable = preview.g3_register.filter(r => !r._unsub);
                const g3Recipients = g3Mailable.map(r => ({
                    email: r.email,
                    first_name: r.name || null,
                    last_name: r.last_name || null,
                    company: r.company || null,
                    extra_fields: {
                        country: r.country || '',
                        job_title: r.job_title || '',
                        expo_name: preview.target_expo_name
                    }
                }));
                console.log(`[wizard/build ${jobId}] ${phase} DONE — ${g3Recipients.length} G3 recipient rows built`);

                // -------------------------------------------------------------
                // Phase 5 — CREATE 2 DRAFT CAMPAIGNS + steps.
                // Skip a campaign if its step array is empty AND its recipient
                // count is zero — an empty campaign is not useful and would
                // trip the existing activation guard at campaigns.js:422
                // (canActivate needs steps.length > 0 && total_count > 0).
                // -------------------------------------------------------------
                phase = 'phase_5_create_campaigns';
                const createdCampaigns = [];
                async function createCampaignWithSteps(name, steps, recipients, kind) {
                    if (steps.length === 0 && recipients.length === 0) {
                        console.log(`[wizard/build ${jobId}] skip ${kind} — 0 steps AND 0 recipients`);
                        return null;
                    }
                    const cr = await pool.query(
                        `INSERT INTO email_campaigns (organizer_id, expo_id, name, description, created_by)
                         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                        [organizerId, preview.target_expo_id, name,
                         `Auto-created by wizard for ${preview.target_expo_name}`, organizerId]
                    );
                    const camp = cr.rows[0];
                    for (let i = 0; i < steps.length; i++) {
                        const s = steps[i];
                        await pool.query(
                            `INSERT INTO campaign_steps (campaign_id, step_number, template_id, delay_hours, condition)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [camp.id, i + 1, s.template_id,
                             s.delay_hours == null ? 0 : s.delay_hours,
                             s.condition || 'all']
                        );
                    }
                    console.log(`[wizard/build ${jobId}] created ${kind} campaign ${camp.id} with ${steps.length} step(s)`);
                    return camp;
                }
                const activateCamp = await createCampaignWithSteps(
                    activate_name || `${preview.target_expo_name} Activate Wave`,
                    activate_steps, g2Recipients, 'activate'
                );
                const registerCamp = await createCampaignWithSteps(
                    register_name || `${preview.target_expo_name} Register Wave`,
                    register_steps, g3Recipients, 'register'
                );
                if (activateCamp) createdCampaigns.push({ id: activateCamp.id, name: activateCamp.name, kind: 'activate', recipient_count: g2Recipients.length });
                if (registerCamp) createdCampaigns.push({ id: registerCamp.id, name: registerCamp.name, kind: 'register', recipient_count: g3Recipients.length });

                // -------------------------------------------------------------
                // Phase 6 — INSERT campaign_recipients.
                // Batch insert with ON CONFLICT DO NOTHING (shape from
                // campaigns.js:615-619). extra_fields as JSONB.
                // -------------------------------------------------------------
                phase = 'phase_6_insert_recipients';
                const RECIPIENT_CHUNK = 500;
                async function insertRecipients(campaignId, rows) {
                    if (!campaignId || rows.length === 0) return 0;
                    let inserted = 0;
                    for (let i = 0; i < rows.length; i += RECIPIENT_CHUNK) {
                        const chunk = rows.slice(i, i + RECIPIENT_CHUNK);
                        const valueClauses = [];
                        const params = [];
                        chunk.forEach((r, idx) => {
                            const b = idx * 6;
                            valueClauses.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`);
                            params.push(campaignId, r.email, r.first_name, r.last_name, r.company, JSON.stringify(r.extra_fields));
                        });
                        const insRes = await pool.query(
                            `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
                             VALUES ${valueClauses.join(',')}
                             ON CONFLICT (campaign_id, email) DO NOTHING`,
                            params
                        );
                        inserted += insRes.rowCount;
                    }
                    // NB: NOT updating email_campaigns.total_recipients.
                    // Confirmed at campaigns.js:177-185 — stats.total_count
                    // comes from COUNT(*) over campaign_recipients, not the
                    // column. canActivate at campaigns.js:422 reads that
                    // stats.total_count too. The activate handler at
                    // campaigns.js:911 RE-RESETS total_recipients from a
                    // COUNT(*) at activation time regardless. Maintaining
                    // it here is dead weight — dropped.
                    return inserted;
                }
                const activateInserted = activateCamp ? await insertRecipients(activateCamp.id, g2Recipients) : 0;
                const registerInserted = registerCamp ? await insertRecipients(registerCamp.id, g3Recipients) : 0;
                console.log(`[wizard/build ${jobId}] ${phase} DONE — inserted activate=${activateInserted}, register=${registerInserted}`);

                // ---- Mark job completed ------------------------------------
                const summary = {
                    campaigns: createdCampaigns,
                    tokens_minted_this_run: tokenValidRows.length,
                    activate_recipients_inserted: activateInserted,
                    register_recipients_inserted: registerInserted,
                    truncated_field_count: truncatedCount
                };
                await pool.query(
                    `UPDATE import_jobs
                     SET status='completed', processed_count=$1, completed_at=NOW(), updated_at=NOW(),
                         error_message=CASE WHEN error_message IS NULL THEN $2 ELSE error_message END
                     WHERE id=$3`,
                    [activateInserted + registerInserted,
                     truncatedCount > 0 ? `Completed with ${truncatedCount} field values truncated to 255 chars (Piece 5)` : null,
                     jobId]
                );
                console.log(`[wizard/build ${jobId}] ✅ COMPLETED — summary: ${JSON.stringify(summary)}`);
            } catch (err) {
                console.error(`[wizard/build ${jobId}] FAILED at ${phase}:`, err.message, err.stack);
                await pool.query(
                    `UPDATE import_jobs SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
                    [`${phase}: ${String(err.message).slice(0, 500)}`, jobId]
                ).catch(() => {});
            }
        });

        res.status(202).json({
            success: true,
            job_id: jobId,
            g2_activate_planned: preview.g2_activate.filter(r => !r._unsub).length,
            g3_register_planned: preview.g3_register.filter(r => !r._unsub).length,
            tokens_to_mint: preview.g2_activate.filter(r => !r._unsub && !r._hasToken).length,
            target_expo_id: preview.target_expo_id,
            target_expo_name: preview.target_expo_name,
            message: `Wizard job accepted. Poll /api/campaigns/reactivation/job/${jobId} for status. All campaigns will land in DRAFT — activate them from the Email Campaigns page when ready.`
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
// Named exports for direct unit testing (no HTTP round-trip, no DB).
// Mirrors reactivation.js's `.processReactivationChunks` / `.generateToken`
// pattern — Express still sees `router` as the mounted default export.
module.exports.validateTemplateBody = validateTemplateBody;
module.exports.KNOWN_TOKENS = KNOWN_TOKENS;
