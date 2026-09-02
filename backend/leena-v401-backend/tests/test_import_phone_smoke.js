/**
 * Regression test — /api/visitors/import phone normalisation
 *
 * Origin: IMPORT_PHONE_NORMALISATION_20260901.md (Sep 2026 rewrite).
 * Written after commit XXX shipped libphonenumber-js-backed normalisation for
 * the primary import path. Ensures three known-failing shapes behave as designed:
 *
 *   Row 1: numeric Excel cell (JS number 2348012345678, NG) → +2348012345678
 *          (G21 crash class — pre-fix this crashed .trim() and failed the whole batch)
 *   Row 2: "xxxxxxxxxx" agency placeholder → treated as empty phone, row imports
 *   Row 3: "12ab" letters+digits, unfixable → row REJECTED with reason
 *
 * NOT WIRED TO CI YET. This file exists so the failure mode is captured in-repo
 * and any future change to the phone normaliser or the import path has a concrete
 * assertion to fail against.
 *
 * ---
 *
 * RUNTIME REQUIREMENTS — this test cannot run locally against unit-test infra.
 * It POSTs a real .xlsx to /api/visitors/import against a running server, which
 * writes to the target expo. It requires:
 *
 *   TEST_JWT       — admin bearer token (browser DevTools → LocalStorage → 'token')
 *   TEST_BASE_URL  — running Leena app (default: https://leena.app)
 *   TEST_EXPO_ID   — target expo (defaults to 17, the [TEST] Bridge trash expo).
 *                    Expo MUST have country_code = 'NG' populated for Row 1 to
 *                    normalise correctly. Confirmed by Suer on 2 Sep 2026 as
 *                    part of the country_code backfill.
 *
 * Post-run: leaves 2 test visitors on the expo (unique emails prefixed
 * 'smoke-phone-<timestamp>-N@leena-test.local'). Cleanup SQL is emitted at
 * the end of the run so ops can delete them via Render Shell if desired.
 *
 * ---
 *
 * Because JWT signing is blocked from Claude Code's side (correctly — it would
 * be prod auth-bypass), this test WILL BE RUN by Suer post-deploy in Step 3 of
 * the phone-normalisation rollout. Doc will state result.
 */

const XLSX = require('xlsx');

const BASE_URL = process.env.TEST_BASE_URL || 'https://leena.app';
const TEST_JWT = process.env.TEST_JWT;
const TEST_EXPO_ID = parseInt(process.env.TEST_EXPO_ID || '17', 10);

function assert(cond, msg) {
    if (!cond) {
        console.error(`\n❌ ASSERTION FAILED: ${msg}`);
        process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required (paste from browser LocalStorage)');
    console.log(`\n=== /api/visitors/import phone-normalisation smoke test ===\n`);
    console.log(`  Target: ${BASE_URL}/api/visitors/import`);
    console.log(`  Expo:   ${TEST_EXPO_ID} (must be country_code='NG')\n`);

    // Build a 3-row XLSX buffer in memory. Row 1 uses a JS NUMBER for phone —
    // this is the G21 crash class (Excel-native numeric cells). Row 2 uses the
    // 'xxxxxxxxxx' agency placeholder. Row 3 uses '12ab' (unfixable).
    const timestamp = Date.now();
    const rows = [
        {
            name: 'SmokeRow1', last_name: 'Numeric',
            email: `smoke-phone-${timestamp}-1@leena-test.local`,
            company: 'Test Co', phone: 2348012345678  // JS NUMBER — G21 shape
        },
        {
            name: 'SmokeRow2', last_name: 'Placeholder',
            email: `smoke-phone-${timestamp}-2@leena-test.local`,
            company: 'Test Co', phone: 'xxxxxxxxxx'   // agency placeholder
        },
        {
            name: 'SmokeRow3', last_name: 'Invalid',
            email: `smoke-phone-${timestamp}-3@leena-test.local`,
            company: 'Test Co', phone: '12ab'         // unfixable
        }
    ];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    console.log(`  Built 3-row xlsx buffer: ${buffer.length} bytes\n`);

    // POST as multipart/form-data.
    const form = new FormData();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    form.append('file', blob, 'smoke_phone.xlsx');
    form.append('expo_id', String(TEST_EXPO_ID));

    const reqT0 = Date.now();
    const response = await fetch(`${BASE_URL}/api/visitors/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_JWT}` },
        body: form
    });
    const body = await response.json();
    const responseTime = Date.now() - reqT0;

    console.log(`  Response in ${responseTime}ms, status=${response.status}`);
    console.log(`  Body counters: success=${body.results?.success_count} failed=${body.results?.failed_count} skipped=${body.results?.skipped_count}`);
    console.log(`  Errors:`, JSON.stringify(body.results?.errors || [], null, 2));

    // Assertions
    console.log('\nAssertions:');
    assert(response.ok, `HTTP 2xx (got ${response.status})`);
    assert(body.success === true, 'response.success === true');
    assert(body.results != null, 'response.results present');
    assert(body.results.success_count === 2,
        `success_count === 2 (numeric cell + placeholder — got ${body.results.success_count})`);
    assert(body.results.failed_count === 1,
        `failed_count === 1 (12ab rejected — got ${body.results.failed_count})`);
    assert(Array.isArray(body.results.errors) && body.results.errors.length >= 1,
        'errors[] populated');
    assert(typeof body.results.errors[0].message === 'string' &&
           body.results.errors[0].message.startsWith('Phone rejected'),
        `errors[0].message starts with "Phone rejected" (got "${body.results.errors[0].message}")`);

    console.log('\n✅ ALL ASSERTIONS PASSED');
    console.log(`\nCleanup SQL (run in Render Shell if desired):`);
    console.log(`  DELETE FROM visitors WHERE email LIKE 'smoke-phone-${timestamp}-%@leena-test.local';`);
}

main().catch(err => {
    console.error('\n❌ TEST FAILED WITH UNCAUGHT ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
});
