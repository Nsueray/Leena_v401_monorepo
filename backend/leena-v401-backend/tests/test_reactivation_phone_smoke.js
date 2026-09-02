/**
 * Regression test — /api/reactivation/create-from-excel phone normalisation
 *                   (SILENT mode, no template_id)
 *
 * Origin: IMPORT_PHONE_NORMALISATION_20260901.md Sep 2026 rewrite +
 *         2 Sep 2026 verification pass.
 *
 * Motivation: reactivation-campaign.html:278 marks the template <select>
 * `required`, so the UI cannot exercise no-template silent mode — the
 * exact gap the wizard closes. This test hits the backend endpoint
 * directly instead, verifying:
 *
 *   1. skipped_invalid_phone === 1  (row 3 "12ab" rejected)
 *   2. invalid_phone_samples[0].row === 4  (Excel row 4 = data row 3)
 *   3. valid === 2  (rows 1+2 went through — G21-safe numeric cell
 *                    + xxxxxxxxxx placeholder preserved as empty)
 *   4. Async job completes.
 *   5. 2 reactivation_tokens landed for the smoke emails.
 *   6. 0 email_queue rows for expo 17 created after job start —
 *      no template_id ⇒ no send, per silent-mode guard chain
 *      (reactivation.js:133 `if (emailTemplate)` + :346/:440/:380).
 *
 * The reactivation-campaign.html 4th UI line ("Invalid Phone (Skipped) N
 * (rows X, Y, Z)") is verified by code review only — the UI cannot POST
 * without a template today; see the deploy doc for the code-level
 * verification note.
 *
 * ---
 *
 * RUNTIME REQUIREMENTS:
 *   TEST_JWT                       — admin bearer token (browser LocalStorage)
 *   TEST_BASE_URL                  — default: https://leena.app
 *   TEST_EXPO_ID                   — default: 17 (trash bridge; country_code='NG')
 *   RENDER_DATABASE_READONLY_URL   — from backend/leena-v401-backend/.env,
 *                                    needed for the two DB assertions
 *
 * Reads /tmp/phone_smoke.xlsx (built by test_import_phone_smoke.js).
 * Rebuilds it if missing — same 3 rows, same fixed emails.
 *
 * ---
 *
 * RERUN BEHAVIOUR: on a fresh slate, valid===2 as asserted. On a rerun
 * WITHOUT running the cleanup SQL, the backend's prefetchEmails sees the
 * previous tokens and returns valid===0 + skipped_duplicate===2 — the
 * strict assertion at #3 will fail with a clear diagnostic pointing at
 * the cleanup SQL below. Run cleanup, then rerun.
 *
 * Cleanup SQL emitted at the end (via .then/.catch pair) whether
 * assertions pass or fail. Covers BOTH the reactivation_tokens created
 * here AND any visitor rows the same emails might have from earlier
 * import-smoke runs.
 */

const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
require('dotenv').config();

const BASE_URL = process.env.TEST_BASE_URL || 'https://leena.app';
const TEST_JWT = process.env.TEST_JWT;
const TEST_EXPO_ID = parseInt(process.env.TEST_EXPO_ID || '17', 10);
const DB_URL = process.env.RENDER_DATABASE_READONLY_URL;

// Same fixed emails as test_import_phone_smoke.js so both tests share
// one clean-up statement at the end. 5 rows after Decision B.
const TEST_EMAILS = {
    row1: 'smoke-phone-1@leena-test.local',
    row2: 'smoke-phone-2@leena-test.local',
    row3: 'smoke-phone-3@leena-test.local',
    row4: 'smoke-phone-4@leena-test.local',
    row5: 'smoke-phone-5@leena-test.local'
};

function assert(cond, msg) {
    if (!cond) {
        console.error(`\n❌ ASSERTION FAILED: ${msg}`);
        throw new Error(msg);
    }
    console.log(`  ✓ ${msg}`);
}

function emitCleanupSql() {
    const emails = Object.values(TEST_EMAILS).map(e => `'${e}'`).join(', ');
    console.log(`\n=== Cleanup SQL (run in Render Shell) ===`);
    console.log(`  -- Reactivation tokens created by this test:`);
    console.log(`  DELETE FROM reactivation_tokens`);
    console.log(`  WHERE target_expo_id = ${TEST_EXPO_ID} AND email IN (${emails});`);
    console.log(`  -- Any visitor rows on the same emails (from earlier import-smoke runs):`);
    console.log(`  DELETE FROM visitors`);
    console.log(`  WHERE expo_id = ${TEST_EXPO_ID} AND email IN (${emails});`);
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required (paste from browser LocalStorage)');
    if (!DB_URL) throw new Error('RENDER_DATABASE_READONLY_URL env var required (backend .env)');

    console.log(`\n=== /api/reactivation/create-from-excel — silent-mode phone smoke ===\n`);
    console.log(`  Target: ${BASE_URL}/api/reactivation/create-from-excel`);
    console.log(`  Expo:   ${TEST_EXPO_ID} (must be country_code='NG')`);
    console.log(`  Mode:   silent — NO template_id (guard chain: reactivation.js:133/346/380/440)\n`);

    // Reuse /tmp/phone_smoke.xlsx if the import smoke already built it; else rebuild.
    const tmpPath = '/tmp/phone_smoke.xlsx';
    let buffer;
    if (fs.existsSync(tmpPath)) {
        buffer = fs.readFileSync(tmpPath);
        console.log(`  Using existing ${tmpPath} (${buffer.length} bytes)`);
    } else {
        const rows = [
            { name: 'SmokeRow1', last_name: 'Numeric',
              email: TEST_EMAILS.row1, company: 'Test Co',
              phone: 2348012345678 },                    // JS NUMBER (G21 shape)
            { name: 'SmokeRow2', last_name: 'Placeholder',
              email: TEST_EMAILS.row2, company: 'Test Co',
              phone: 'xxxxxxxxxx' },
            { name: 'SmokeRow3', last_name: 'Invalid',
              email: TEST_EMAILS.row3, company: 'Test Co',
              phone: '12ab' },                           // Decision B: dropped, not skipped
            { name: 'SmokeRow4', last_name: 'Turkish',
              email: TEST_EMAILS.row4, company: 'Test Co', country: 'Turkey',
              phone: '0532 123 45 67' },                 // row-country resolver → TR
            { name: 'SmokeRow5', last_name: 'PlusWins',
              email: TEST_EMAILS.row5, company: 'Test Co', country: 'Turkey',
              phone: '+212 661 23 45 67' }               // '+' wins → +212
        ];
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        fs.writeFileSync(tmpPath, buffer);
        console.log(`  Rebuilt ${buffer.length}-byte xlsx at ${tmpPath}`);
    }

    // Snapshot BEFORE the request — used by the "0 new email_queue rows" DB check.
    const jobStartTime = new Date();
    console.log(`  Job start snapshot: ${jobStartTime.toISOString()}`);

    // POST as multipart/form-data, target_expo_id as a form field.
    const form = new FormData();
    form.append('file', new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'phone_smoke.xlsx');
    form.append('target_expo_id', String(TEST_EXPO_ID));
    // NO template_id — silent mode.

    const reqT0 = Date.now();
    const response = await fetch(`${BASE_URL}/api/reactivation/create-from-excel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_JWT}` },
        body: form
    });
    const responseTime = Date.now() - reqT0;
    console.log(`  POST response in ${responseTime}ms, status=${response.status}`);

    // Status check BEFORE .json() — G25.
    if (!response.ok) {
        const bodyText = await response.text().catch(() => '(unreadable)');
        console.error(`\n❌ HTTP ${response.status} ${response.statusText}`);
        console.error(`   body (first 200): ${bodyText.slice(0, 200)}`);
        throw new Error(`Non-2xx: ${response.status}`);
    }

    const body = await response.json();

    // Print full 202 body BEFORE asserting.
    console.log(`\n  202 response body:`);
    console.log(`    success                    = ${body.success}`);
    console.log(`    job_id                     = ${body.job_id}`);
    console.log(`    total                      = ${body.total}`);
    console.log(`    valid                      = ${body.valid}`);
    console.log(`    skipped                    = ${body.skipped}`);
    console.log(`    phone_dropped              = ${body.phone_dropped}`);
    console.log(`    phone_dropped_samples      = ${JSON.stringify(body.phone_dropped_samples || [], null, 2).replace(/\n/g, '\n                                 ')}`);
    console.log(`    unmatched_countries_top5   = ${JSON.stringify(body.unmatched_countries_top5 || [])}`);
    console.log(`    message                    = ${JSON.stringify(body.message)}`);

    // Rerun-diagnostic BEFORE the strict assertions.
    if (body.valid === 0 && body.phone_dropped === 1) {
        console.error(`\n  ⚠️  Rerun shape detected: valid=0 (tokens for smoke emails already exist).`);
        console.error(`      Run the cleanup SQL at the end of this output, then retry to get a fresh-run pass.`);
    }

    // Assertions on the 202 body (Decision B — row 3 is DROPPED not SKIPPED).
    console.log(`\n  Assertions on 202 body:`);
    assert(body.success === true, 'body.success === true');
    assert(body.job_id !== undefined && body.job_id !== null,
        `body.job_id present (${body.job_id})`);
    assert(body.phone_dropped === 1,
        `body.phone_dropped === 1 — row 3 phone dropped (got ${body.phone_dropped})`);
    assert(Array.isArray(body.phone_dropped_samples) && body.phone_dropped_samples.length >= 1,
        'body.phone_dropped_samples[] populated (≥1)');
    assert(body.phone_dropped_samples[0].row === 4,
        `body.phone_dropped_samples[0].row === 4 — Excel row for "12ab" (got ${body.phone_dropped_samples[0].row})`);
    assert(body.valid === 5,
        `body.valid === 5 — all 5 rows become tokens under Decision B (got ${body.valid}) — if 0, smoke emails have stale tokens; run cleanup SQL and retry`);

    // Poll /job/:id until completed.
    console.log(`\n  Polling /api/reactivation/job/${body.job_id} ...`);
    const pollDeadline = Date.now() + 60000; // 60 s max
    let job = null;
    while (Date.now() < pollDeadline) {
        const jr = await fetch(`${BASE_URL}/api/reactivation/job/${body.job_id}`, {
            headers: { 'Authorization': `Bearer ${TEST_JWT}` }
        });
        if (!jr.ok) {
            const t = await jr.text().catch(() => '');
            throw new Error(`job status HTTP ${jr.status}: ${t.slice(0, 200)}`);
        }
        job = await jr.json();
        console.log(`    [${new Date().toISOString().slice(11, 19)}Z] status=${job.status} processed=${job.processed_count}/${job.total_count}`);
        if (job.status === 'completed') break;
        if (job.status === 'failed') throw new Error(`Job failed: ${job.error_message}`);
        await new Promise(r => setTimeout(r, 1500));
    }
    assert(job && job.status === 'completed', `job completed (final status=${job?.status})`);

    // DB assertions — read-only.
    console.log(`\n  DB assertions (read-only against RENDER_DATABASE_READONLY_URL):`);
    const pool = new Pool({
        connectionString: DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        const emails = Object.values(TEST_EMAILS);

        const tokRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM reactivation_tokens
             WHERE target_expo_id = $1 AND email = ANY($2)`,
            [TEST_EXPO_ID, emails]
        );
        console.log(`    reactivation_tokens for smoke emails on expo ${TEST_EXPO_ID}: ${tokRes.rows[0].n}`);
        assert(tokRes.rows[0].n === 5,
            `exactly 5 reactivation_tokens created for smoke emails (got ${tokRes.rows[0].n}) — Decision B: row3 phone-drop still creates the token`);

        const eqRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM email_queue
             WHERE expo_id = $1 AND created_at >= $2`,
            [TEST_EXPO_ID, jobStartTime.toISOString()]
        );
        console.log(`    email_queue rows on expo ${TEST_EXPO_ID} created since job start (${jobStartTime.toISOString()}): ${eqRes.rows[0].n}`);
        assert(eqRes.rows[0].n === 0,
            `zero email_queue rows on expo ${TEST_EXPO_ID} since job start — silent mode confirmed (got ${eqRes.rows[0].n})`);
    } finally {
        await pool.end();
    }

    console.log('\n✅ ALL ASSERTIONS PASSED');
}

// try/finally-equivalent — cleanup SQL emitted on both pass and fail.
main()
    .then(() => { emitCleanupSql(); process.exit(0); })
    .catch(err => {
        console.error(`\n❌ TEST FAILED: ${err.message}`);
        emitCleanupSql();
        process.exit(1);
    });
