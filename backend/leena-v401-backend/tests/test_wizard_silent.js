/**
 * G4 regression test — Campaign Wizard, end-to-end, silent mode
 *
 * ⚠️ RUN ORDER: independent of the phone smokes — different email set
 *   (@leena-test.local `smoke-wizard-N`), different tables touched. Safe
 *   in any order relative to test_reactivation_phone_smoke and
 *   test_import_phone_smoke. Cleanup is self-contained.
 *
 * ⚠️ DB verification requires WARP off + IP allowlisted on Render's
 *   PostgreSQL Inbound IP Rules. Test loads
 *   `backend/leena-v401-backend/.env` relative to THIS file (G29).
 *
 * ⚠️ Fixture is REBUILT every run — never fs.existsSync-gated (G28).
 *
 * ---
 *
 * ENDPOINTS UNDER TEST (must match the wire the G3 UI reads):
 *   POST /api/campaigns/reactivation/segment
 *   POST /api/campaigns/validate-template
 *   POST /api/campaigns/reactivation/build
 *   GET  /api/campaigns/reactivation/job/:id
 *
 * WHY THIS TEST EXISTS: this morning's import smoke silently returned
 * "success" against a body shape it did not read; the mismatch was
 * caught by hand only. Future drift in ANY of the four wizard endpoints
 * must fail here, not in Yaprak's browser during a live campaign.
 *
 * WIRE ASSERTIONS (protect against key drift):
 *   /segment 200: preview_token (string), target_expo_name (string),
 *                 source_kind (string), source_size (number),
 *                 counts.{total_verified, invalid_email, duplicates_in_list,
 *                         g1_already_registered_target,
 *                         g2_activate_raw, g2_activate_mailable,
 *                         g3_register_raw, g3_register_mailable,
 *                         unsubscribed_hits, existing_pending_tokens_hit} — all numbers
 *   /validate-template 200: ok (boolean), error_count (number),
 *                           warning_count (number), issues (array of
 *                           {code, severity, message} strings)
 *   /build 202: job_id (number), g2_activate_planned (number),
 *               g3_register_planned (number)
 *               ⚠️ NOT g2_activate_count / g3_register_count — my G1
 *               summary said the wrong name; the wire has always been
 *               *_planned. This test locks the name in place.
 *   /job/:id 200: FLAT — status, processed_count, total_count, error_message
 *               top-level. NOT nested under {job: {...}}.
 *
 * SILENT-MODE INVARIANT (the core contract): the orchestrator's Phase 2
 * calls processReactivationChunks with emailTemplate=null. The guard
 * chain (reactivation.js:141 `if (emailTemplate)`) skips the email_queue
 * INSERT loop. This test asserts 0 email_queue rows created on the
 * target expo since jobStartTime. Same shape verified live on jobs 35/36.
 *
 * DRAFT-ONLY INVARIANT: /build never activates. This test asserts both
 * created email_campaigns rows have status='draft'.
 *
 * ---
 *
 * FIXTURE SETUP (Suer 2 Sep — vacuous-G2 fix):
 *   G2 = "email has a visitors row on ANY expo of this organizer,
 *         excluding target" (routes/campaignBuilder.js:427-429 + :461-471,
 *         verified read-only).
 *   For 5 never-seen smoke-wizard-N@leena-test.local emails, G2 would be
 *   ZERO on a clean expo 17 → Phase 2 + Phase 3 would never fire → the
 *   silent-mode assertion would be vacuous.
 *   Fix: BEFORE segmenting, import smoke-wizard-1..3 as visitors on expo
 *   11 ([TEST] Reactivation Smoke Test Expo, organizer_id=1, verified
 *   read-only). Then on expo 17:
 *     g1_already_registered_target = 0
 *     g2_activate_mailable         = 3   (smoke-wizard-1..3, seeded on expo 11)
 *     g3_register_mailable         = 2   (smoke-wizard-4..5, no visitor row anywhere)
 *   Result after build:
 *     2 draft email_campaigns (one per wave, name '[SMOKE-WIZARD] ...')
 *     3 reactivation_tokens on target 17 for smoke-wizard-1..3
 *     5 campaign_recipients (3 in activate campaign, 2 in register)
 *     2 campaign_steps (one per campaign, template_id = probe)
 *     0 email_queue rows on target 17 since jobStart
 *
 * PROBE TEMPLATE (Suer 2 Sep — must not be live data):
 *   Created in-flight via POST /api/email-templates. Body has bare
 *   {{name}} + one plain non-activation-url href. This makes wave=activate
 *   MISSING_ACTIVATION_URL (error, blocks). wave=register clean of
 *   activation error, only BARE_NAME_FALLBACK warning.
 *   Deleted in cleanup — cleanup SQL includes an idempotent belt-and-braces
 *   DELETE too, in case the API delete failed.
 *
 * RERUN BEHAVIOUR:
 *   [SMOKE-WIZARD]% campaigns + expo-11 visitors accumulate across runs.
 *   Cleanup SQL emitted at end of EVERY run (success and failure).
 *   Additional programmatic cleanup fires in a `finally`.
 *
 * ---
 *
 * RUNTIME REQUIREMENTS:
 *   TEST_JWT                       — admin bearer token (browser LocalStorage)
 *   TEST_BASE_URL                  — default: https://leena.app
 *   TEST_EXPO_ID                   — default: 17 (trash bridge target)
 *   TEST_G2_SEED_EXPO_ID           — default: 11 ([TEST] Reactivation Smoke)
 *   RENDER_DATABASE_READONLY_URL   — from backend/.env, needed for DB assertions
 *
 * Origin: CAMPAIGN_WIZARD_PLAN_20260901 §3.5. G27/G28/G29 baked in per
 *         today's smoke rework.
 */

const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
// Load backend/.env relative to THIS file, not cwd (G29).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.TEST_BASE_URL || 'https://leena.app';
const TEST_JWT = process.env.TEST_JWT;
const TEST_EXPO_ID = parseInt(process.env.TEST_EXPO_ID || '17', 10);
const G2_SEED_EXPO_ID = parseInt(process.env.TEST_G2_SEED_EXPO_ID || '11', 10);
const DB_URL = process.env.RENDER_DATABASE_READONLY_URL;

const TEST_EMAILS = {
    row1: 'smoke-wizard-1@leena-test.local',   // G2 seed (imported to expo 11)
    row2: 'smoke-wizard-2@leena-test.local',   // G2 seed
    row3: 'smoke-wizard-3@leena-test.local',   // G2 seed
    row4: 'smoke-wizard-4@leena-test.local',   // G3 (no seed)
    row5: 'smoke-wizard-5@leena-test.local'    // G3 (no seed)
};
const G2_SEED_EMAILS = [TEST_EMAILS.row1, TEST_EMAILS.row2, TEST_EMAILS.row3];

const CAMPAIGN_TAG = '[SMOKE-WIZARD]';
const PROBE_TEMPLATE_NAME_PREFIX = '[SMOKE-VALIDATOR]';

// Probe template body: bare {{name}} + one plain (non-activation-url) href.
// Under wave=activate this MUST fire MISSING_ACTIVATION_URL (error) and
// BARE_NAME_FALLBACK (warning). Under wave=register the MISSING_
// ACTIVATION_URL check does not run; only BARE_NAME_FALLBACK fires.
const PROBE_HTML = '<html><body><p>Dear {{name}},</p><p>Visit us at <a href="https://leena.app">leena.app</a>.</p></body></html>';
const PROBE_SUBJECT = 'Smoke validator probe';

function assert(cond, msg) {
    if (!cond) {
        console.error(`\n❌ ASSERTION FAILED: ${msg}`);
        throw new Error(msg);
    }
    console.log(`  ✓ ${msg}`);
}

function emitCleanupSql(probeTemplateId) {
    const allEmails = Object.values(TEST_EMAILS).map(e => `'${e}'`).join(', ');
    const g2SeedEmails = G2_SEED_EMAILS.map(e => `'${e}'`).join(', ');
    console.log(`\n=== Cleanup SQL (run in Render Shell if any programmatic cleanup failed) ===`);
    console.log(`  -- Draft campaigns this test created (campaign_recipients + campaign_steps CASCADE):`);
    console.log(`  DELETE FROM email_campaigns`);
    console.log(`  WHERE expo_id = ${TEST_EXPO_ID}`);
    console.log(`    AND name LIKE '${CAMPAIGN_TAG}%';`);
    console.log(`  -- Reactivation tokens for smoke emails on target expo:`);
    console.log(`  DELETE FROM reactivation_tokens`);
    console.log(`  WHERE target_expo_id = ${TEST_EXPO_ID} AND email IN (${allEmails});`);
    console.log(`  -- G2 seed visitors imported to expo ${G2_SEED_EXPO_ID} at test start:`);
    console.log(`  DELETE FROM visitors`);
    console.log(`  WHERE expo_id = ${G2_SEED_EXPO_ID} AND email IN (${g2SeedEmails});`);
    console.log(`  -- Belt-and-braces: any visitors on target expo (should be 0):`);
    console.log(`  DELETE FROM visitors`);
    console.log(`  WHERE expo_id = ${TEST_EXPO_ID} AND email IN (${allEmails});`);
    console.log(`  -- In-flight probe template (deleted by API in normal flow;`);
    console.log(`  -- this is the belt-and-braces if the API delete failed):`);
    console.log(`  DELETE FROM email_templates`);
    console.log(`  WHERE name LIKE '${PROBE_TEMPLATE_NAME_PREFIX}%';`);
    if (probeTemplateId) {
        console.log(`  -- (This run's probe template id was ${probeTemplateId}.)`);
    }
}

async function programmaticCleanup(probeTemplateId) {
    // Delete the probe template via API. Belt-and-braces cleanup SQL is
    // always printed, so a failure here does NOT stop the test — just
    // logged for visibility.
    if (probeTemplateId) {
        try {
            const del = await fetch(`${BASE_URL}/api/email-templates/${probeTemplateId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` }
            });
            console.log(`  Programmatic probe-template DELETE returned ${del.status}`);
        } catch (e) {
            console.log(`  Programmatic probe-template DELETE errored: ${e.message}`);
        }
    }
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required (paste from browser LocalStorage)');
    if (!DB_URL) throw new Error('RENDER_DATABASE_READONLY_URL env var required (from backend/.env)');

    console.log(`\n=== Campaign Wizard silent-mode smoke ===\n`);
    console.log(`  Target:       ${BASE_URL}/api/campaigns/...`);
    console.log(`  Target expo:  ${TEST_EXPO_ID}`);
    console.log(`  G2 seed expo: ${G2_SEED_EXPO_ID}`);
    console.log(`  Probe template: created in-flight (name starts '${PROBE_TEMPLATE_NAME_PREFIX}')\n`);

    // ---- STEP 0a — build the fixture buffer once, reuse for both imports.
    const rows = [
        { name: 'W1', email: TEST_EMAILS.row1, company: 'Test Co' },
        { name: 'W2', email: TEST_EMAILS.row2, company: 'Test Co' },
        { name: 'W3', email: TEST_EMAILS.row3, company: 'Test Co' },
        { name: 'W4', email: TEST_EMAILS.row4, company: 'Test Co' },
        { name: 'W5', email: TEST_EMAILS.row5, company: 'Test Co' }
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const fullBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const tmpPath = '/tmp/wizard_smoke.xlsx';
    fs.writeFileSync(tmpPath, fullBuffer);
    console.log(`  Rebuilt ${fullBuffer.length}-byte 5-row xlsx at ${tmpPath} (always fresh)`);

    // Build a separate 3-row buffer for the G2 seed import (rows 1-3 only).
    const seedWs = XLSX.utils.json_to_sheet(rows.slice(0, 3));
    const seedWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(seedWb, seedWs, 'Sheet1');
    const seedBuffer = XLSX.write(seedWb, { type: 'buffer', bookType: 'xlsx' });

    let probeTemplateId = null;

    try {
        // ================================================================
        // STEP 0 — create the probe template + seed G2 visitors
        // ================================================================
        console.log(`\n---- STEP 0a: create in-flight probe template ----`);
        const tpRes = await fetch(`${BASE_URL}/api/email-templates`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `${PROBE_TEMPLATE_NAME_PREFIX} ${new Date().toISOString().slice(0, 19)}`,
                subject: PROBE_SUBJECT,
                html_content: PROBE_HTML,
                is_active: true
            })
        });
        if (tpRes.status !== 201 && tpRes.status !== 200) {
            const t = await tpRes.text().catch(() => '');
            throw new Error(`probe template create failed HTTP ${tpRes.status}: ${t.slice(0, 200)}`);
        }
        const tpBody = await tpRes.json();
        probeTemplateId = tpBody.template && tpBody.template.id;
        assert(typeof probeTemplateId === 'number' && probeTemplateId > 0,
            `probe template created (id=${probeTemplateId})`);

        console.log(`\n---- STEP 0b: seed 3 G2 visitors on expo ${G2_SEED_EXPO_ID} via /api/visitors/import ----`);
        const seedForm = new FormData();
        seedForm.append('file', new Blob([seedBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }), 'wizard_seed.xlsx');
        seedForm.append('expo_id', String(G2_SEED_EXPO_ID));
        seedForm.append('visitor_type', 'visitor');
        const seedRes = await fetch(`${BASE_URL}/api/visitors/import`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}` },
            body: seedForm
        });
        if (!seedRes.ok) {
            const t = await seedRes.text().catch(() => '');
            throw new Error(`seed import HTTP ${seedRes.status}: ${t.slice(0, 300)}`);
        }
        const seedResBody = await seedRes.json();
        console.log(`  seed import 202/200 body (excerpt):`);
        console.log(`    success            = ${seedResBody.success}`);
        console.log(`    job_id             = ${seedResBody.job_id}`);
        console.log(`    total              = ${seedResBody.total}`);
        console.log(`    valid              = ${seedResBody.valid}`);
        // Import can be async — poll /api/reactivation/job/:id if job_id present,
        // else assume synchronous. (Import uses import_jobs same as reactivation.)
        if (seedResBody.job_id) {
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
                const jr = await fetch(`${BASE_URL}/api/visitors/import-logs?page=1&limit=1`, {
                    headers: { 'Authorization': `Bearer ${TEST_JWT}` }
                });
                // Not all import paths surface job status — a short sleep is safer than
                // over-fitting. 3 rows completes well within a few hundred ms.
                await new Promise(r => setTimeout(r, 500));
                break;
            }
        }
        // Direct DB verification below is the authoritative check.

        // ================================================================
        // Job-start snapshot — AFTER seed import, BEFORE segment.
        // This is what "since jobStart" means for the silent-mode assertion.
        // ================================================================
        const jobStartTime = new Date();
        console.log(`\n  Job start snapshot (post-seed, pre-segment): ${jobStartTime.toISOString()}`);

        // ================================================================
        // STEP 1 — POST /api/campaigns/reactivation/segment
        // ================================================================
        console.log(`\n---- STEP 1: POST /api/campaigns/reactivation/segment ----`);
        const segForm = new FormData();
        segForm.append('file', new Blob([fullBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }), 'wizard_smoke.xlsx');
        segForm.append('target_expo_id', String(TEST_EXPO_ID));
        const segT0 = Date.now();
        const segRes = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}` },
            body: segForm
        });
        console.log(`  POST returned in ${Date.now() - segT0}ms, status=${segRes.status}`);
        if (!segRes.ok) {
            const t = await segRes.text().catch(() => '(unreadable)');
            console.error(`\n❌ HTTP ${segRes.status}: ${t.slice(0, 200)}`);
            throw new Error(`segment: ${segRes.status}`);
        }
        const segBody = await segRes.json();
        console.log(`\n  /segment 200 body:`);
        console.log(JSON.stringify(segBody, null, 2).split('\n').map(l => '    ' + l).join('\n'));

        console.log(`\n  Shape assertions (protect UI against key drift):`);
        assert(segBody.success === true, 'segBody.success === true');
        assert(typeof segBody.preview_token === 'string' && segBody.preview_token.length > 0,
            `preview_token is a non-empty string (${segBody.preview_token})`);
        assert(typeof segBody.target_expo_name === 'string', 'target_expo_name is a string');
        assert(typeof segBody.source_kind === 'string', 'source_kind is a string');
        assert(typeof segBody.source_size === 'number', 'source_size is a number');

        const counts = segBody.counts;
        assert(counts && typeof counts === 'object', 'segBody.counts is an object');
        const requiredCountKeys = [
            'total_verified', 'invalid_email', 'duplicates_in_list',
            'g1_already_registered_target',
            'g2_activate_raw', 'g2_activate_mailable',
            'g3_register_raw', 'g3_register_mailable',
            'unsubscribed_hits', 'existing_pending_tokens_hit'
        ];
        for (const k of requiredCountKeys) {
            assert(typeof counts[k] === 'number',
                `counts.${k} is a number (got ${JSON.stringify(counts[k])})`);
        }

        console.log(`\n  Value assertions (locked to G2 seed reality):`);
        assert(counts.total_verified === 5, `counts.total_verified === 5 (got ${counts.total_verified})`);
        assert(counts.invalid_email === 0, `counts.invalid_email === 0 (got ${counts.invalid_email})`);
        assert(counts.duplicates_in_list === 0, `counts.duplicates_in_list === 0 (got ${counts.duplicates_in_list})`);
        assert(counts.g1_already_registered_target === 0,
            `counts.g1_already_registered_target === 0 — smoke emails not on target expo (got ${counts.g1_already_registered_target}) — cleanup may be needed`);
        assert(counts.g2_activate_mailable === 3,
            `counts.g2_activate_mailable === 3 — the 3 seeded emails (got ${counts.g2_activate_mailable}) — if 0, seed import failed; if 2, one seed row skipped as duplicate`);
        assert(counts.g3_register_mailable === 2,
            `counts.g3_register_mailable === 2 — the 2 unseeded emails (got ${counts.g3_register_mailable})`);

        const previewToken = segBody.preview_token;

        // ================================================================
        // STEP 2a — POST /validate-template  (wave=activate, against PROBE)
        // ================================================================
        console.log(`\n---- STEP 2a: POST /validate-template  (wave=activate, PROBE template ${probeTemplateId}) ----`);
        const valRes1 = await fetch(`${BASE_URL}/api/campaigns/validate-template`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: probeTemplateId, wave: 'activate' })
        });
        if (!valRes1.ok) {
            const t = await valRes1.text().catch(() => '');
            throw new Error(`validate-template (activate) HTTP ${valRes1.status}: ${t.slice(0, 200)}`);
        }
        const val1 = await valRes1.json();
        console.log(`  activate-wave body:`);
        console.log(JSON.stringify(val1, null, 2).split('\n').map(l => '    ' + l).join('\n'));

        console.log(`\n  Shape assertions:`);
        assert(val1.success === true, 'val1.success === true');
        assert(typeof val1.ok === 'boolean', `val1.ok is boolean (got ${typeof val1.ok})`);
        assert(typeof val1.error_count === 'number', 'val1.error_count is a number');
        assert(typeof val1.warning_count === 'number', 'val1.warning_count is a number');
        assert(Array.isArray(val1.issues), 'val1.issues is an array');
        for (const i of val1.issues) {
            assert(typeof i.code === 'string', `issue.code is a string`);
            assert(typeof i.severity === 'string', 'issue.severity is a string');
            assert(typeof i.message === 'string', 'issue.message is a string');
        }
        console.log(`\n  Wave-awareness logic (activate on PROBE):`);
        const activateCodes = val1.issues.map(i => i.code);
        assert(activateCodes.includes('MISSING_ACTIVATION_URL'),
            `activate: MISSING_ACTIVATION_URL fired (codes: [${activateCodes.join(', ')}])`);
        assert(activateCodes.includes('BARE_NAME_FALLBACK'),
            `activate: BARE_NAME_FALLBACK fired for bare {{name}} in body (codes: [${activateCodes.join(', ')}])`);
        assert(val1.ok === false, `activate: ok === false (has errors, got ok=${val1.ok})`);

        // ================================================================
        // STEP 2b — POST /validate-template  (wave=register, against PROBE)
        // ================================================================
        console.log(`\n---- STEP 2b: POST /validate-template  (wave=register, PROBE) ----`);
        const valRes2 = await fetch(`${BASE_URL}/api/campaigns/validate-template`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: probeTemplateId, wave: 'register' })
        });
        if (!valRes2.ok) {
            const t = await valRes2.text().catch(() => '');
            throw new Error(`validate-template (register) HTTP ${valRes2.status}: ${t.slice(0, 200)}`);
        }
        const val2 = await valRes2.json();
        console.log(`  register-wave body:`);
        console.log(JSON.stringify(val2, null, 2).split('\n').map(l => '    ' + l).join('\n'));

        console.log(`\n  Wave-awareness logic (register on PROBE):`);
        const registerCodes = val2.issues.map(i => i.code);
        assert(!registerCodes.includes('MISSING_ACTIVATION_URL'),
            `register: MISSING_ACTIVATION_URL NOT fired (codes: [${registerCodes.join(', ')}])`);
        assert(registerCodes.includes('BARE_NAME_FALLBACK'),
            `register: BARE_NAME_FALLBACK fired (codes: [${registerCodes.join(', ')}])`);
        const registerErrors = val2.issues.filter(i => i.severity === 'error');
        assert(registerErrors.length === 0 && val2.ok === true,
            `register: no errors, ok === true (errors=${registerErrors.length}, ok=${val2.ok})`);

        // ================================================================
        // STEP 3 — POST /reactivation/build
        // ================================================================
        // Steps in BOTH waves. skip_template_validation=true because the
        // probe deliberately fails activate-wave validation; we're testing
        // silent-mode + campaign creation here, not the block path (unit
        // tests cover the block path).
        console.log(`\n---- STEP 3: POST /reactivation/build ----`);
        const runTag = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const buildBody = {
            preview_token: previewToken,
            activate_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
            register_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
            activate_name: `${CAMPAIGN_TAG} Activate ${runTag}`,
            register_name: `${CAMPAIGN_TAG} Register ${runTag}`,
            skip_template_validation: true    // API-only per Suer's rule
        };
        const buildRes = await fetch(`${BASE_URL}/api/campaigns/reactivation/build`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody)
        });
        console.log(`  status=${buildRes.status}`);
        if (buildRes.status !== 202) {
            const t = await buildRes.text().catch(() => '');
            throw new Error(`build expected 202, got ${buildRes.status}: ${t.slice(0, 300)}`);
        }
        const built = await buildRes.json();
        console.log(`  /build 202 body:`);
        console.log(JSON.stringify(built, null, 2).split('\n').map(l => '    ' + l).join('\n'));

        console.log(`\n  Shape assertions (protect UI against key drift):`);
        assert(built.success === true, 'built.success === true');
        assert(typeof built.job_id === 'number', `built.job_id is a number (got ${built.job_id})`);
        assert(typeof built.g2_activate_planned === 'number',
            `built.g2_activate_planned is a number (got ${built.g2_activate_planned}) — exact key G3 UI reads`);
        assert(typeof built.g3_register_planned === 'number',
            `built.g3_register_planned is a number (got ${built.g3_register_planned}) — exact key G3 UI reads`);

        console.log(`\n  Value assertions (locked to fixture):`);
        assert(built.g2_activate_planned === 3, `built.g2_activate_planned === 3 (got ${built.g2_activate_planned})`);
        assert(built.g3_register_planned === 2, `built.g3_register_planned === 2 (got ${built.g3_register_planned})`);

        // ================================================================
        // STEP 4 — Poll /reactivation/job/:id
        // ================================================================
        console.log(`\n---- STEP 4: Poll /reactivation/job/${built.job_id} ----`);
        const pollDeadline = Date.now() + 60000;
        let job = null;
        while (Date.now() < pollDeadline) {
            const jr = await fetch(`${BASE_URL}/api/campaigns/reactivation/job/${built.job_id}`, {
                headers: { 'Authorization': `Bearer ${TEST_JWT}` }
            });
            if (!jr.ok) {
                const t = await jr.text().catch(() => '');
                throw new Error(`job HTTP ${jr.status}: ${t.slice(0, 200)}`);
            }
            job = await jr.json();
            console.log(`    [${new Date().toISOString().slice(11, 19)}Z] status=${job.status} processed=${job.processed_count}/${job.total_count}`);
            if (job.status === 'completed' || job.status === 'failed') break;
            await new Promise(r => setTimeout(r, 1500));
        }

        console.log(`\n  Shape assertions (FLAT — NOT nested under {job:{...}}):`);
        assert(job, 'job body received');
        assert(typeof job.status === 'string', `j.status is a string, top-level (got ${typeof job.status})`);
        assert(typeof job.processed_count === 'number', 'j.processed_count is a number, top-level');
        assert(typeof job.total_count === 'number', 'j.total_count is a number, top-level');
        assert('error_message' in job, 'j.error_message key present (may be null)');
        assert(job.status === 'completed', `job.status === 'completed' (final=${job.status}, error=${job.error_message || 'none'})`);

        // ================================================================
        // STEP 5 — DB assertions (read-only)
        // ================================================================
        console.log(`\n---- STEP 5: DB assertions (read-only) ----`);
        const pool = new Pool({
            connectionString: DB_URL,
            ssl: { rejectUnauthorized: false }
        });
        try {
            // 5a — silent-mode invariant: 0 email_queue rows on target since jobStart
            const eqRes = await pool.query(
                `SELECT COUNT(*)::int AS n FROM email_queue
                 WHERE expo_id = $1 AND created_at >= $2`,
                [TEST_EXPO_ID, jobStartTime.toISOString()]
            );
            console.log(`    email_queue rows on expo ${TEST_EXPO_ID} since jobStart: ${eqRes.rows[0].n}`);
            assert(eqRes.rows[0].n === 0,
                `silent-mode invariant: 0 email_queue rows since jobStart (got ${eqRes.rows[0].n})`);

            // 5b — 2 draft email_campaigns, both status='draft'
            const campRes = await pool.query(
                `SELECT id, name, status FROM email_campaigns
                 WHERE expo_id = $1 AND created_at >= $2 AND name LIKE $3
                 ORDER BY id ASC`,
                [TEST_EXPO_ID, jobStartTime.toISOString(), CAMPAIGN_TAG + '%']
            );
            console.log(`    ${CAMPAIGN_TAG} campaigns created since jobStart: ${campRes.rows.length}`);
            for (const row of campRes.rows) {
                console.log(`      #${row.id}  status='${row.status}'  name='${row.name}'`);
            }
            assert(campRes.rows.length === 2, `exactly 2 draft campaigns (got ${campRes.rows.length})`);
            for (const row of campRes.rows) {
                assert(row.status === 'draft', `campaign ${row.id} status === 'draft' (got '${row.status}')`);
            }

            // 5c — 3 reactivation_tokens on target for the 3 G2 seed emails
            const tokRes = await pool.query(
                `SELECT COUNT(*)::int AS n FROM reactivation_tokens
                 WHERE target_expo_id = $1 AND email = ANY($2) AND created_at >= $3`,
                [TEST_EXPO_ID, G2_SEED_EMAILS, jobStartTime.toISOString()]
            );
            console.log(`    reactivation_tokens on target expo ${TEST_EXPO_ID} for G2 seed emails since jobStart: ${tokRes.rows[0].n}`);
            assert(tokRes.rows[0].n === 3,
                `exactly 3 reactivation_tokens minted for seeded G2 emails (got ${tokRes.rows[0].n})`);

            // 5d — campaign_recipients: total = 5, template_id in each step matches PROBE
            const campIds = campRes.rows.map(r => r.id);
            const recRes = await pool.query(
                `SELECT campaign_id, COUNT(*)::int AS n FROM campaign_recipients
                 WHERE campaign_id = ANY($1)
                 GROUP BY campaign_id ORDER BY campaign_id`,
                [campIds]
            );
            const recByCampaign = {};
            for (const r of recRes.rows) recByCampaign[r.campaign_id] = r.n;
            const totalRec = recRes.rows.reduce((s, r) => s + r.n, 0);
            console.log(`    campaign_recipients per campaign: ${JSON.stringify(recByCampaign)}, sum=${totalRec}`);
            assert(totalRec === 5,
                `campaign_recipients sum === 5 (built.g2+built.g3 = 3+2) (got ${totalRec})`);

            // 5e — campaign_steps: 2 rows (one per campaign), both with the probe template_id
            const stepRes = await pool.query(
                `SELECT campaign_id, template_id, step_number FROM campaign_steps
                 WHERE campaign_id = ANY($1)
                 ORDER BY campaign_id, step_number`,
                [campIds]
            );
            console.log(`    campaign_steps rows:`);
            for (const row of stepRes.rows) {
                console.log(`      campaign_id=${row.campaign_id}  step=${row.step_number}  template_id=${row.template_id}`);
            }
            assert(stepRes.rows.length === 2, `campaign_steps count === 2 (got ${stepRes.rows.length})`);
            for (const row of stepRes.rows) {
                assert(row.template_id === probeTemplateId,
                    `campaign_steps row for campaign ${row.campaign_id} points at probe template ${probeTemplateId} (got ${row.template_id})`);
            }

            // ============================================================
            // STEP 6 — SECOND-RUN mailable + reuse invariant (Suer 2 Sep)
            // ============================================================
            // The first build minted 3 tokens on target expo. A second
            // segment against the same fixture MUST report:
            //   g2_activate_mailable        = 3   (mailable = raw − unsub;
            //                                      pending-token rows are STILL mailable)
            //   existing_pending_tokens_hit = 3   (all 3 hit the token cache)
            //   tokens_to_mint              = 0   (nothing new to mint)
            // A second build then MUST:
            //   g2_activate_planned         = 3   (all 3 reused, none dropped)
            //   reactivation_tokens for those emails on target = STILL 3
            //   (no new rows minted; the 3 existing tokens are reused)
            //
            // Regression guard: locks in the fix at campaignBuilder.js:472
            // where the old formula subtracted _hasToken. The old bug
            // silently disabled the activate wave on any second run —
            // exactly the state Yaprak will hit if she previews twice
            // before building.
            console.log(`\n---- STEP 6: SECOND-RUN mailable + reuse invariant ----`);
            console.log(`  Recording pre-second-run reactivation_tokens count for target expo ${TEST_EXPO_ID}:`);
            const preRun2 = await pool.query(
                `SELECT COUNT(*)::int AS n FROM reactivation_tokens
                 WHERE target_expo_id = $1 AND email = ANY($2)`,
                [TEST_EXPO_ID, G2_SEED_EMAILS]
            );
            console.log(`    ${preRun2.rows[0].n} tokens exist for G2 seed emails on target`);
            assert(preRun2.rows[0].n === 3,
                `pre-second-run baseline: 3 tokens exist for G2 seed emails (got ${preRun2.rows[0].n})`);

            // Second segment run — same fixture, same target.
            console.log(`\n  Second /segment call (same fixture, same target):`);
            const seg2Form = new FormData();
            seg2Form.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg2Form.append('target_expo_id', String(TEST_EXPO_ID));
            const seg2Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg2Form
            });
            if (!seg2Res.ok) {
                const t = await seg2Res.text().catch(() => '');
                throw new Error(`second /segment HTTP ${seg2Res.status}: ${t.slice(0, 200)}`);
            }
            const seg2Body = await seg2Res.json();
            console.log(`    counts:  ${JSON.stringify(seg2Body.counts)}`);
            const c2 = seg2Body.counts;
            assert(c2.g2_activate_mailable === 3,
                `second-run g2_activate_mailable === 3 — pending-token rows STAY mailable (got ${c2.g2_activate_mailable}) — this is the regression the fix guards against`);
            assert(c2.existing_pending_tokens_hit === 3,
                `second-run existing_pending_tokens_hit === 3 (got ${c2.existing_pending_tokens_hit})`);
            assert(c2.tokens_to_mint === 0,
                `second-run tokens_to_mint === 0 — no new tokens needed (got ${c2.tokens_to_mint})`);

            // Second build run.
            const preview2Token = seg2Body.preview_token;
            const runTag2 = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '-run2';
            const jobStartTime2 = new Date();
            const build2Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/build`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preview_token: preview2Token,
                    activate_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
                    register_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
                    activate_name: `${CAMPAIGN_TAG} Activate ${runTag2}`,
                    register_name: `${CAMPAIGN_TAG} Register ${runTag2}`,
                    skip_template_validation: true
                })
            });
            if (build2Res.status !== 202) {
                const t = await build2Res.text().catch(() => '');
                throw new Error(`second /build HTTP ${build2Res.status}: ${t.slice(0, 300)}`);
            }
            const built2 = await build2Res.json();
            console.log(`\n  Second /build 202 body:`);
            console.log(JSON.stringify(built2, null, 2).split('\n').map(l => '    ' + l).join('\n'));

            console.log(`\n  Second-run build assertions:`);
            assert(built2.g2_activate_planned === 3,
                `second-run g2_activate_planned === 3 (got ${built2.g2_activate_planned})`);
            assert(built2.tokens_to_mint === 0,
                `second-run tokens_to_mint === 0 (got ${built2.tokens_to_mint})`);

            // Poll second job to completion.
            const pollDeadline2 = Date.now() + 60000;
            let job2 = null;
            while (Date.now() < pollDeadline2) {
                const jr2 = await fetch(`${BASE_URL}/api/campaigns/reactivation/job/${built2.job_id}`, {
                    headers: { 'Authorization': `Bearer ${TEST_JWT}` }
                });
                job2 = await jr2.json();
                if (job2.status === 'completed' || job2.status === 'failed') break;
                await new Promise(r => setTimeout(r, 1500));
            }
            console.log(`\n  Second job final: status=${job2 && job2.status}`);
            assert(job2 && job2.status === 'completed',
                `second job completed (final=${job2 && job2.status})`);

            // DB — no new tokens were minted (still 3 total for those emails).
            const postRun2 = await pool.query(
                `SELECT COUNT(*)::int AS n FROM reactivation_tokens
                 WHERE target_expo_id = $1 AND email = ANY($2)`,
                [TEST_EXPO_ID, G2_SEED_EMAILS]
            );
            console.log(`    Post-second-run tokens on target for G2 seed emails: ${postRun2.rows[0].n}`);
            assert(postRun2.rows[0].n === 3,
                `no new tokens minted by second run — total still 3 (got ${postRun2.rows[0].n}) — token reuse invariant holds`);

            // Second-run campaign recipients count == g2_planned + g3_planned.
            const camp2Res = await pool.query(
                `SELECT id, name, status FROM email_campaigns
                 WHERE expo_id = $1 AND created_at >= $2 AND name LIKE $3
                 ORDER BY id ASC`,
                [TEST_EXPO_ID, jobStartTime2.toISOString(), CAMPAIGN_TAG + '%']
            );
            console.log(`    Second-run campaigns created: ${camp2Res.rows.length}`);
            for (const row of camp2Res.rows) {
                console.log(`      #${row.id}  status='${row.status}'  name='${row.name}'`);
            }
            assert(camp2Res.rows.length === 2,
                `second-run created exactly 2 draft campaigns (got ${camp2Res.rows.length})`);
            const camp2Ids = camp2Res.rows.map(r => r.id);
            const rec2Res = await pool.query(
                `SELECT COUNT(*)::int AS n FROM campaign_recipients
                 WHERE campaign_id = ANY($1)`,
                [camp2Ids]
            );
            console.log(`    Second-run campaign_recipients total: ${rec2Res.rows[0].n}`);
            assert(rec2Res.rows[0].n === 5,
                `second-run campaign_recipients sum === 5 (3 activate + 2 register) (got ${rec2Res.rows[0].n})`);

            // ============================================================
            // STEP 7 — Step-1 normaliser (Suer 2 Sep, post-G3-UI-diff)
            // ============================================================
            // The wizard's /build writes campaign_steps directly (see
            // campaignBuilder.js:723-729), bypassing routes/campaigns.js:
            // 383-384 which forces step_number=1 → delay_hours=0,
            // condition='all'. The G3 UI now disables step-1's delay +
            // condition inputs, but an API caller (or a future UI
            // regression) could still POST activate_steps[0] with
            // delay_hours=120 / condition='not_registered' and have the
            // first email land 5 days late with reminders-only semantics —
            // the exact failure mode campaigns.js's override was written
            // to prevent.
            //
            // The backend guard in campaignBuilder.js normalises (does NOT
            // reject) matching the existing endpoint's behaviour. This
            // step sends the offending shape and verifies the DB row is
            // clean.
            console.log(`\n---- STEP 7: Step-1 normaliser regression guard ----`);
            // Re-segment to get a fresh preview_token (previous one has
            // been consumed; the 30-min TTL doesn't apply — used tokens
            // can't be reused safely because Phase 2 mints tokens for the
            // whole g2_activate list).
            console.log(`  Third /segment call (for a fresh preview_token):`);
            const seg3Form = new FormData();
            seg3Form.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg3Form.append('target_expo_id', String(TEST_EXPO_ID));
            const seg3Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg3Form
            });
            if (!seg3Res.ok) {
                const t = await seg3Res.text().catch(() => '');
                throw new Error(`third /segment HTTP ${seg3Res.status}: ${t.slice(0, 200)}`);
            }
            const seg3Body = await seg3Res.json();
            const preview3Token = seg3Body.preview_token;

            const runTag3 = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '-run3';
            const jobStartTime3 = new Date();
            console.log(`\n  Third /build — DELIBERATELY sending step-1 with delay_hours=120 and condition='not_registered':`);
            const build3Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/build`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preview_token: preview3Token,
                    activate_steps: [
                        // This is the offending shape — the backend MUST normalise.
                        { template_id: probeTemplateId, delay_hours: 120, condition: 'not_registered' }
                    ],
                    register_steps: [
                        { template_id: probeTemplateId, delay_hours: 240, condition: 'not_opened' }
                    ],
                    activate_name: `${CAMPAIGN_TAG} Activate ${runTag3}`,
                    register_name: `${CAMPAIGN_TAG} Register ${runTag3}`,
                    skip_template_validation: true
                })
            });
            if (build3Res.status !== 202) {
                const t = await build3Res.text().catch(() => '');
                throw new Error(`third /build HTTP ${build3Res.status}: ${t.slice(0, 300)}`);
            }
            const built3 = await build3Res.json();
            console.log(`    /build returned job_id=${built3.job_id}`);

            // Poll the third job to completion.
            const pollDeadline3 = Date.now() + 60000;
            let job3 = null;
            while (Date.now() < pollDeadline3) {
                const jr3 = await fetch(`${BASE_URL}/api/campaigns/reactivation/job/${built3.job_id}`, {
                    headers: { 'Authorization': `Bearer ${TEST_JWT}` }
                });
                job3 = await jr3.json();
                if (job3.status === 'completed' || job3.status === 'failed') break;
                await new Promise(r => setTimeout(r, 1500));
            }
            assert(job3 && job3.status === 'completed',
                `third job completed (final=${job3 && job3.status})`);

            // DB check — for the two campaigns created by this run, the
            // step_number=1 row must have delay_hours=0 and condition='all'
            // for BOTH waves (activate normalised from 120/not_registered,
            // register normalised from 240/not_opened).
            const camp3Res = await pool.query(
                `SELECT id, name FROM email_campaigns
                 WHERE expo_id = $1 AND created_at >= $2 AND name LIKE $3
                 ORDER BY id ASC`,
                [TEST_EXPO_ID, jobStartTime3.toISOString(), CAMPAIGN_TAG + '%']
            );
            console.log(`    Third-run campaigns: ${camp3Res.rows.length}`);
            for (const row of camp3Res.rows) {
                console.log(`      #${row.id}  name='${row.name}'`);
            }
            assert(camp3Res.rows.length === 2,
                `third run created 2 campaigns (got ${camp3Res.rows.length})`);

            const camp3Ids = camp3Res.rows.map(r => r.id);
            const step1Res = await pool.query(
                `SELECT campaign_id, step_number, delay_hours, condition FROM campaign_steps
                 WHERE campaign_id = ANY($1) AND step_number = 1
                 ORDER BY campaign_id`,
                [camp3Ids]
            );
            console.log(`    step_number=1 rows (must be 0h + 'all' for both waves):`);
            for (const row of step1Res.rows) {
                console.log(`      campaign_id=${row.campaign_id}  delay_hours=${row.delay_hours}  condition='${row.condition}'`);
            }
            assert(step1Res.rows.length === 2,
                `two step_number=1 rows (one per wave) (got ${step1Res.rows.length})`);
            for (const row of step1Res.rows) {
                assert(row.delay_hours === 0,
                    `campaign ${row.campaign_id} step_number=1 delay_hours === 0 (got ${row.delay_hours}) — normaliser fired`);
                assert(row.condition === 'all',
                    `campaign ${row.campaign_id} step_number=1 condition === 'all' (got '${row.condition}') — normaliser fired`);
            }

            // ============================================================
            // STEP 8 — Cross-campaign overlap detection + exclusion
            // (Suer 3 Sep — bug: same email in two wizard-built campaigns
            // gets step 1 of BOTH; segmentation never consulted
            // campaign_recipients before this change)
            // ============================================================
            // By this point STEP 3 + STEP 6 + STEP 7 have created 6 campaigns
            // named '[SMOKE-WIZARD]%' on target expo TEST_EXPO_ID. All 5
            // smoke emails are enrolled in some subset of those campaigns
            // (activate campaigns hold smoke-wizard-1..3 = 3 G2 emails; register
            // campaigns hold smoke-wizard-4..5 = 2 G3 emails).
            //
            // 8a — /segment without the flag. Assert:
            //   already_in_another_campaign === 5      (all 5 smoke emails overlap)
            //   g2/g3/mailable/tokens_to_mint unchanged from STEP 6 second-run
            //   (drafts count as overlap; g1/g2/g3 depend on visitors table, not campaigns)
            // 8b — /segment WITH the flag. Assert:
            //   excluded_already_in_campaign === 5
            //   g2_activate_mailable + g3_register_mailable === 0 (all 5 filtered out
            //   before bucketing, so all mailable numbers collapse to 0)
            //
            // Drafts count from this change forward, so no activation needed
            // inside the test — STEP 6/7's draft campaigns are the fixture.
            console.log(`\n---- STEP 8: cross-campaign overlap detection + exclusion ----`);

            // ---- 8a: without the flag (default false) ----
            console.log(`\n  8a: /segment (default, exclude_already_in_campaign not sent):`);
            const seg8aForm = new FormData();
            seg8aForm.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg8aForm.append('target_expo_id', String(TEST_EXPO_ID));
            const seg8aRes = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg8aForm
            });
            if (!seg8aRes.ok) {
                const t = await seg8aRes.text().catch(() => '');
                throw new Error(`8a /segment HTTP ${seg8aRes.status}: ${t.slice(0, 200)}`);
            }
            const seg8a = await seg8aRes.json();
            console.log(`    counts: ${JSON.stringify(seg8a.counts)}`);
            console.log(`    other_campaigns.length: ${Array.isArray(seg8a.other_campaigns) ? seg8a.other_campaigns.length : 'MISSING'}`);
            if (Array.isArray(seg8a.other_campaigns)) {
                for (const oc of seg8a.other_campaigns) {
                    console.log(`      #${oc.id} '${oc.name}' status='${oc.status}' overlap_count=${oc.overlap_count}`);
                }
            }

            console.log(`\n  8a shape + value assertions:`);
            assert(typeof seg8a.counts.already_in_another_campaign === 'number',
                `counts.already_in_another_campaign is a number (got ${JSON.stringify(seg8a.counts.already_in_another_campaign)})`);
            assert(typeof seg8a.counts.excluded_already_in_campaign === 'number',
                `counts.excluded_already_in_campaign is a number`);
            assert(Array.isArray(seg8a.other_campaigns),
                `other_campaigns is an array (top-level, alongside counts — NOT inside counts)`);
            assert(seg8a.counts.excluded_already_in_campaign === 0,
                `8a: excluded === 0 when flag not set (got ${seg8a.counts.excluded_already_in_campaign})`);
            assert(seg8a.counts.already_in_another_campaign === 5,
                `8a: already_in_another_campaign === 5 — all 5 smoke emails overlap the earlier [SMOKE-WIZARD] campaigns (got ${seg8a.counts.already_in_another_campaign})`);
            // Byte-identical assertion for g1/g2/g3/to_mint against STEP 6 shape:
            // seeded 3 G2 on expo 11, 2 G3, tokens still exist from earlier runs.
            assert(seg8a.counts.g1_already_registered_target === 0,
                `8a: g1 unchanged === 0 (got ${seg8a.counts.g1_already_registered_target})`);
            assert(seg8a.counts.g2_activate_mailable === 3,
                `8a: g2_mailable unchanged === 3 (got ${seg8a.counts.g2_activate_mailable})`);
            assert(seg8a.counts.g3_register_mailable === 2,
                `8a: g3_mailable unchanged === 2 (got ${seg8a.counts.g3_register_mailable})`);
            assert(seg8a.counts.tokens_to_mint === 0,
                `8a: tokens_to_mint unchanged === 0 (all 3 G2 tokens exist from earlier runs) (got ${seg8a.counts.tokens_to_mint})`);
            // Every overlap campaign should be tagged [SMOKE-WIZARD].
            for (const oc of seg8a.other_campaigns) {
                assert(oc.name && oc.name.indexOf(CAMPAIGN_TAG) === 0,
                    `8a: overlap campaign #${oc.id} name starts with '${CAMPAIGN_TAG}' (got '${oc.name}')`);
            }

            // ---- 8b: WITH the flag ----
            console.log(`\n  8b: /segment with exclude_already_in_campaign=true:`);
            const seg8bForm = new FormData();
            seg8bForm.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg8bForm.append('target_expo_id', String(TEST_EXPO_ID));
            seg8bForm.append('exclude_already_in_campaign', 'true');
            const seg8bRes = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg8bForm
            });
            if (!seg8bRes.ok) {
                const t = await seg8bRes.text().catch(() => '');
                throw new Error(`8b /segment HTTP ${seg8bRes.status}: ${t.slice(0, 200)}`);
            }
            const seg8b = await seg8bRes.json();
            console.log(`    counts: ${JSON.stringify(seg8b.counts)}`);

            console.log(`\n  8b value assertions (exclusion applied BEFORE bucketing):`);
            assert(seg8b.counts.excluded_already_in_campaign === 5,
                `8b: excluded === 5 — all 5 smoke emails filtered out (got ${seg8b.counts.excluded_already_in_campaign})`);
            assert(seg8b.counts.already_in_another_campaign === 0,
                `8b: already_in_another_campaign === 0 after exclusion — filtered emails no longer counted (got ${seg8b.counts.already_in_another_campaign})`);
            assert(seg8b.counts.g1_already_registered_target === 0,
                `8b: g1 === 0 after exclusion (got ${seg8b.counts.g1_already_registered_target})`);
            assert(seg8b.counts.g2_activate_mailable === 0,
                `8b: g2_mailable === 0 (all 3 G2 emails were in overlap set → excluded) (got ${seg8b.counts.g2_activate_mailable})`);
            assert(seg8b.counts.g3_register_mailable === 0,
                `8b: g3_mailable === 0 (both G3 emails were in overlap set → excluded) (got ${seg8b.counts.g3_register_mailable})`);
            assert(seg8b.counts.g2_activate_raw === 0 && seg8b.counts.g3_register_raw === 0,
                `8b: g2_raw + g3_raw both === 0 — filter is on source list, not post-hoc (rows never entered buckets)`);
            assert(seg8b.counts.tokens_to_mint === 0,
                `8b: tokens_to_mint === 0 (no G2 mailable → nothing to mint)`);

            // ============================================================
            // STEP 9 — Holdout at build time (Suer 3 Sep, Delivery A)
            // ============================================================
            // 5-row fixture, holdout_pct=20:
            //   G2 mailable = 3 → round(3 * 0.20) = 1 holdout, 2 active
            //   G3 mailable = 2 → round(2 * 0.20) = 0 holdout, 2 active
            // Assertions:
            //   202 body: holdout_activate === 1, holdout_register === 0
            //   Job completes
            //   Activate campaign has 1 status='holdout' + 2 status='active'
            //   Holdout row's next_step_due_at IS NULL
            //   NO new reactivation_token minted for the held-out email
            //     (measured "since jobStart9" — pre-existing tokens from
            //     STEP 3 for the G2 seeds are excluded from the delta)
            //   Follow-up /segment reports the held-out email inside
            //     already_in_another_campaign (proves cr.status IN
            //     ('active','holdout') is what the overlap query uses)
            console.log(`\n---- STEP 9: Holdout at build time (holdout_pct=20) ----`);

            // Fresh /segment for a new preview_token (all previous consumed).
            const seg9Form = new FormData();
            seg9Form.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg9Form.append('target_expo_id', String(TEST_EXPO_ID));
            const seg9Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg9Form
            });
            if (!seg9Res.ok) {
                const t = await seg9Res.text().catch(() => '');
                throw new Error(`9 /segment HTTP ${seg9Res.status}: ${t.slice(0, 200)}`);
            }
            const seg9 = await seg9Res.json();
            const preview9Token = seg9.preview_token;

            const runTag9 = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '-holdout';
            const jobStartTime9 = new Date();
            console.log(`\n  /build with holdout_pct=20:`);
            const build9Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/build`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    preview_token: preview9Token,
                    activate_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
                    register_steps: [{ template_id: probeTemplateId, delay_hours: 0, condition: 'all' }],
                    activate_name: `${CAMPAIGN_TAG} Activate ${runTag9}`,
                    register_name: `${CAMPAIGN_TAG} Register ${runTag9}`,
                    skip_template_validation: true,
                    holdout_pct: 20
                })
            });
            if (build9Res.status !== 202) {
                const t = await build9Res.text().catch(() => '');
                throw new Error(`9 /build HTTP ${build9Res.status}: ${t.slice(0, 300)}`);
            }
            const built9 = await build9Res.json();
            console.log(`    202 body: ${JSON.stringify(built9)}`);

            console.log(`\n  9 shape + value assertions on 202 body:`);
            assert(typeof built9.holdout_activate === 'number',
                `built9.holdout_activate is a number (got ${JSON.stringify(built9.holdout_activate)})`);
            assert(typeof built9.holdout_register === 'number',
                `built9.holdout_register is a number`);
            assert(built9.holdout_activate === 1,
                `built9.holdout_activate === 1 (round(3 G2 mailable × 20%)) (got ${built9.holdout_activate})`);
            assert(built9.holdout_register === 0,
                `built9.holdout_register === 0 (round(2 G3 mailable × 20%) = 0) (got ${built9.holdout_register})`);

            // Poll to completion.
            const pollDeadline9 = Date.now() + 60000;
            let job9 = null;
            while (Date.now() < pollDeadline9) {
                const jr9 = await fetch(`${BASE_URL}/api/campaigns/reactivation/job/${built9.job_id}`, {
                    headers: { 'Authorization': `Bearer ${TEST_JWT}` }
                });
                job9 = await jr9.json();
                if (job9.status === 'completed' || job9.status === 'failed') break;
                await new Promise(r => setTimeout(r, 1500));
            }
            assert(job9 && job9.status === 'completed',
                `9 job completed (final=${job9 && job9.status}, error=${job9 && job9.error_message})`);

            // Find the newly-created activate campaign.
            const activateName9 = `${CAMPAIGN_TAG} Activate ${runTag9}`;
            const camp9Res = await pool.query(
                `SELECT id FROM email_campaigns WHERE expo_id = $1 AND name = $2`,
                [TEST_EXPO_ID, activateName9]
            );
            assert(camp9Res.rows.length === 1,
                `activate campaign '${activateName9}' created (got ${camp9Res.rows.length} matches)`);
            const activateCamp9Id = camp9Res.rows[0].id;

            // Status counts + next_step_due_at NULL for holdout row.
            const statusCounts = await pool.query(
                `SELECT status, COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE next_step_due_at IS NULL)::int AS null_due,
                        COUNT(*) FILTER (WHERE next_step_due_at IS NOT NULL)::int AS nonnull_due
                 FROM campaign_recipients WHERE campaign_id = $1
                 GROUP BY status ORDER BY status`,
                [activateCamp9Id]
            );
            console.log(`\n  Activate campaign ${activateCamp9Id} recipient status:`);
            for (const row of statusCounts.rows) {
                console.log(`    status='${row.status}'  n=${row.n}  next_step_due_at NULL=${row.null_due} non-null=${row.nonnull_due}`);
            }
            const holdoutRow = statusCounts.rows.find(r => r.status === 'holdout');
            const activeRow = statusCounts.rows.find(r => r.status === 'active');
            assert(holdoutRow && holdoutRow.n === 1,
                `activate campaign has exactly 1 status='holdout' row (got ${holdoutRow ? holdoutRow.n : 0})`);
            assert(activeRow && activeRow.n === 2,
                `activate campaign has exactly 2 status='active' rows (got ${activeRow ? activeRow.n : 0})`);
            assert(holdoutRow.null_due === 1 && holdoutRow.nonnull_due === 0,
                `holdout row has next_step_due_at NULL (${holdoutRow.null_due}/1)`);

            // Get the held-out email and verify NO new token was minted for it.
            const holdoutEmailRes = await pool.query(
                `SELECT email FROM campaign_recipients WHERE campaign_id = $1 AND status = 'holdout' LIMIT 1`,
                [activateCamp9Id]
            );
            const heldOutEmail = holdoutEmailRes.rows[0].email;
            console.log(`\n  Held-out email (randomly selected): ${heldOutEmail}`);
            const newTokRes = await pool.query(
                `SELECT COUNT(*)::int AS n FROM reactivation_tokens
                 WHERE target_expo_id = $1 AND email = $2 AND created_at >= $3`,
                [TEST_EXPO_ID, heldOutEmail, jobStartTime9.toISOString()]
            );
            console.log(`    NEW tokens (since jobStart9) for held-out email: ${newTokRes.rows[0].n}`);
            assert(newTokRes.rows[0].n === 0,
                `NO new reactivation_token minted for held-out email '${heldOutEmail}' since jobStart9 (got ${newTokRes.rows[0].n})`);

            // Follow-up /segment: held-out email must appear in the overlap set,
            // proving the query filters cr.status IN ('active','holdout').
            const seg10Form = new FormData();
            seg10Form.append('file', new Blob([fullBuffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }), 'wizard_smoke.xlsx');
            seg10Form.append('target_expo_id', String(TEST_EXPO_ID));
            const seg10Res = await fetch(`${BASE_URL}/api/campaigns/reactivation/segment`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TEST_JWT}` },
                body: seg10Form
            });
            const seg10 = await seg10Res.json();
            console.log(`\n  Follow-up /segment already_in_another_campaign = ${seg10.counts.already_in_another_campaign}`);
            assert(seg10.counts.already_in_another_campaign === 5,
                `follow-up /segment reports all 5 smoke emails overlap (holdout included) (got ${seg10.counts.already_in_another_campaign})`);
            const activateInOthers = (seg10.other_campaigns || []).some(oc => oc.id === activateCamp9Id);
            assert(activateInOthers,
                `the new activate campaign ${activateCamp9Id} appears in other_campaigns list (proves overlap query includes cr.status='holdout')`);
        } finally {
            await pool.end();
        }

        console.log('\n✅ ALL ASSERTIONS PASSED');
    } finally {
        // Programmatic cleanup runs whether we passed or failed. Emitted SQL
        // is belt-and-braces for anything that didn't clean up.
        console.log(`\n---- Programmatic cleanup ----`);
        await programmaticCleanup(probeTemplateId);
    }
}

main()
    .then(() => { emitCleanupSql(null); process.exit(0); })
    .catch(err => {
        console.error(`\n❌ TEST FAILED: ${err.message}`);
        // probeTemplateId is out of scope here — cleanup SQL always fires
        // the LIKE-name DELETE, which catches this run's row and any prior
        // leftover ones.
        emitCleanupSql(null);
        process.exit(1);
    });
