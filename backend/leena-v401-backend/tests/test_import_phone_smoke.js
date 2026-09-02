/**
 * Regression test — /api/visitors/import phone normalisation
 *
 * Origin: IMPORT_PHONE_NORMALISATION_20260901.md (Sep 2026 rewrite).
 * Written after commit 2664ead shipped libphonenumber-js-backed normalisation
 * for the primary import path. Ensures three known-failing shapes behave as
 * designed:
 *
 *   Row 1: numeric Excel cell (JS number 2348012345678, NG) → +2348012345678
 *          (G21 crash class — pre-fix this crashed .trim() and failed the whole batch)
 *   Row 2: "xxxxxxxxxx" agency placeholder → treated as empty phone, row imports
 *   Row 3: "12ab" letters+digits, unfixable → row REJECTED with reason
 *
 * NOT WIRED TO CI YET. This file exists so the failure mode is captured in-repo
 * and any future change to the phone normaliser or the import path has a
 * concrete assertion to fail against.
 *
 * ---
 *
 * RUNTIME REQUIREMENTS:
 *   TEST_JWT       — admin bearer token (browser DevTools → LocalStorage → 'token')
 *   TEST_BASE_URL  — running Leena app (default: https://leena.app)
 *   TEST_EXPO_ID   — target expo (default: 17, the [TEST] Bridge trash expo).
 *                    Expo MUST have country_code='NG' populated for Row 1 to
 *                    normalise correctly. Confirmed by Suer on 2 Sep 2026.
 *
 * IDEMPOTENT: reruns are safe. Rows 1+2 land as new-visitors on the first
 * run, then hit the UPDATE path on subsequent runs — both count as success.
 * Row 3 is always rejected. Assertion: success_count===2 && failed_count===1
 * on every run.
 *
 * Also saves the built xlsx to /tmp/phone_smoke.xlsx so the reactivation
 * upload step (test 3 of the Step-3 verification) can reuse the exact same
 * bytes without rebuilding.
 *
 * Cleanup SQL emitted at the end whether assertions pass or fail (finally).
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'https://leena.app';
const TEST_JWT = process.env.TEST_JWT;
const TEST_EXPO_ID = parseInt(process.env.TEST_EXPO_ID || '17', 10);

// Fixed test emails so the same 3 rows exercise the UPDATE path on rerun.
// Suffix chosen to survive across smoke runs without polluting real data —
// the '@leena-test.local' domain has no MX and cannot receive mail.
const TEST_EMAILS = {
    row1: 'smoke-phone-1@leena-test.local',
    row2: 'smoke-phone-2@leena-test.local',
    row3: 'smoke-phone-3@leena-test.local'
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
    console.log(`\n=== Cleanup SQL (run in Render Shell if desired) ===`);
    console.log(`  DELETE FROM visitors WHERE email IN (${emails}) AND expo_id = ${TEST_EXPO_ID};`);
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required (paste from browser LocalStorage)');
    console.log(`\n=== /api/visitors/import phone-normalisation smoke test ===\n`);
    console.log(`  Target: ${BASE_URL}/api/visitors/import`);
    console.log(`  Expo:   ${TEST_EXPO_ID} (must be country_code='NG')`);
    console.log(`  Emails: fixed for idempotency — see cleanup SQL at end\n`);

    // Build a 3-row XLSX buffer in memory.
    //   Row 1: JS NUMBER for phone (G21 crash class — pre-fix, .trim() threw)
    //   Row 2: 'xxxxxxxxxx' agency placeholder
    //   Row 3: '12ab' — unfixable
    const rows = [
        { name: 'SmokeRow1', last_name: 'Numeric',
          email: TEST_EMAILS.row1, company: 'Test Co',
          phone: 2348012345678 },                       // JS NUMBER
        { name: 'SmokeRow2', last_name: 'Placeholder',
          email: TEST_EMAILS.row2, company: 'Test Co',
          phone: 'xxxxxxxxxx' },
        { name: 'SmokeRow3', last_name: 'Invalid',
          email: TEST_EMAILS.row3, company: 'Test Co',
          phone: '12ab' }
    ];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Save to /tmp so the reactivation upload step of Step-3 verification can
    // reuse the exact same bytes without rebuilding.
    const tmpPath = '/tmp/phone_smoke.xlsx';
    fs.writeFileSync(tmpPath, buffer);
    console.log(`  Built ${buffer.length}-byte xlsx, saved to ${tmpPath}\n`);

    // POST as multipart/form-data.
    const form = new FormData();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    form.append('file', blob, 'phone_smoke.xlsx');
    form.append('expo_id', String(TEST_EXPO_ID));

    const reqT0 = Date.now();
    const response = await fetch(`${BASE_URL}/api/visitors/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_JWT}` },
        body: form
    });
    const responseTime = Date.now() - reqT0;
    console.log(`  Response in ${responseTime}ms, status=${response.status}`);

    // Status check BEFORE .json() — non-2xx often has a non-JSON body
    // (Render 502 HTML page, plain "Unauthorized" text, etc.). See G25.
    if (!response.ok) {
        const bodyText = await response.text().catch(() => '(body unreadable)');
        console.error(`\n❌ HTTP ${response.status} ${response.statusText}`);
        console.error(`   body (first 200 chars): ${bodyText.slice(0, 200)}`);
        throw new Error(`Non-2xx: ${response.status}`);
    }

    const body = await response.json();

    // Print ALL top-level counters BEFORE asserting — matches import.html:440-459
    // shape exactly (routes/visitors.js:1018-1022 does `{...results}` spread).
    console.log(`\n  Top-level response counters:`);
    console.log(`    success           = ${body.success}`);
    console.log(`    message           = ${JSON.stringify(body.message)}`);
    console.log(`    success_count     = ${body.success_count}`);
    console.log(`    new_count         = ${body.new_count}`);
    console.log(`    updated_count     = ${body.updated_count}`);
    console.log(`    failed_count      = ${body.failed_count}`);
    console.log(`    skipped_count     = ${body.skipped_count}`);
    console.log(`    email_sent_count  = ${body.email_sent_count}`);
    console.log(`    qr_regenerated_count = ${body.qr_regenerated_count}`);
    console.log(`    custom_fields_updated_count = ${body.custom_fields_updated_count}`);
    console.log(`    errors            = ${JSON.stringify(body.errors || [], null, 2)}`);
    console.log(`    imported (count)  = ${Array.isArray(body.imported) ? body.imported.length : 'not-array'}`);

    // Assertions — idempotent-safe.
    console.log('\n  Assertions:');
    assert(body.success === true, 'body.success === true');
    assert(body.success_count === 2,
        `body.success_count === 2 (row1 numeric-cell + row2 xxxxxxxxxx — got ${body.success_count})`);
    assert(body.failed_count === 1,
        `body.failed_count === 1 (row3 "12ab" rejected — got ${body.failed_count})`);
    assert(Array.isArray(body.errors) && body.errors.length >= 1,
        'body.errors[] populated');
    assert(typeof body.errors[0].message === 'string' &&
           body.errors[0].message.startsWith('Phone rejected'),
        `body.errors[0].message starts with "Phone rejected" (got "${body.errors[0].message}")`);

    console.log('\n✅ ALL ASSERTIONS PASSED');
}

// try/finally ensures cleanup SQL is emitted whether we pass or crash.
main()
    .then(() => { emitCleanupSql(); process.exit(0); })
    .catch(err => {
        console.error('\n❌ TEST FAILED:', err.message);
        emitCleanupSql();
        process.exit(1);
    });
