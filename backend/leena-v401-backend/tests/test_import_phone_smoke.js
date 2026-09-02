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

// Fixed test emails so rerun hits the UPDATE path.
// The '@leena-test.local' domain has no MX and cannot receive mail.
// 5 rows after Decision B (2 Sep): 3 originals + 2 Turkey rows that
// exercise the row-country fallback (row 4 local → picks TR from row;
// row 5 has '+' prefix → country ignored, MA wins from the '+212' input).
const TEST_EMAILS = {
    row1: 'smoke-phone-1@leena-test.local',
    row2: 'smoke-phone-2@leena-test.local',
    row3: 'smoke-phone-3@leena-test.local',
    row4: 'smoke-phone-4@leena-test.local',
    row5: 'smoke-phone-5@leena-test.local'
};

const EXPECTED_STORED = {
    row1: '+2348012345678',    // numeric cell → NG default (expo country_code)
    row2: '',                   // xxxxxxxxxx placeholder → empty
    row3: '',                   // 12ab dropped, row still imports (Decision B)
    row4: '+905321234567',      // "0532 123 45 67" local → TR from row.country
    row5: '+212661234567'       // "+212 661 23 45 67" → + wins, country irrelevant
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

    // Build a 5-row XLSX buffer in memory (Decision B — rows 4+5 test row-country fallback).
    //   Row 1: JS NUMBER for phone (G21 crash class — pre-fix, .trim() threw)
    //   Row 2: 'xxxxxxxxxx' agency placeholder → empty preserved
    //   Row 3: '12ab' — unfixable — DROPS phone but row imports (Decision B)
    //   Row 4: country='Turkey' + local '0532 …' — row-country resolver picks TR
    //   Row 5: country='Turkey' + '+212 …' — '+' wins, TR ignored by library
    const rows = [
        { name: 'SmokeRow1', last_name: 'Numeric',
          email: TEST_EMAILS.row1, company: 'Test Co',
          phone: 2348012345678 },                       // JS NUMBER
        { name: 'SmokeRow2', last_name: 'Placeholder',
          email: TEST_EMAILS.row2, company: 'Test Co',
          phone: 'xxxxxxxxxx' },
        { name: 'SmokeRow3', last_name: 'Invalid',
          email: TEST_EMAILS.row3, company: 'Test Co',
          phone: '12ab' },
        { name: 'SmokeRow4', last_name: 'Turkish',
          email: TEST_EMAILS.row4, company: 'Test Co', country: 'Turkey',
          phone: '0532 123 45 67' },                    // local — row-country resolver picks TR
        { name: 'SmokeRow5', last_name: 'PlusWins',
          email: TEST_EMAILS.row5, company: 'Test Co', country: 'Turkey',
          phone: '+212 661 23 45 67' }                  // '+' wins → +212, Turkey ignored
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
    console.log(`    warning_count     = ${body.warning_count}`);
    console.log(`    skipped_count     = ${body.skipped_count}`);
    console.log(`    email_sent_count  = ${body.email_sent_count}`);
    console.log(`    qr_regenerated_count = ${body.qr_regenerated_count}`);
    console.log(`    custom_fields_updated_count = ${body.custom_fields_updated_count}`);
    console.log(`    errors            = ${JSON.stringify(body.errors || [], null, 2)}`);
    console.log(`    warnings          = ${JSON.stringify(body.warnings || [], null, 2)}`);
    console.log(`    unmatched_countries_top5 = ${JSON.stringify(body.unmatched_countries_top5 || [])}`);
    console.log(`    imported (count)  = ${Array.isArray(body.imported) ? body.imported.length : 'not-array'}`);

    // Assertions — idempotent-safe under Decision B (row3 "12ab" now imports
    // with phone='' and a warning; row is still counted as success).
    console.log('\n  Assertions:');
    assert(body.success === true, 'body.success === true');
    assert(body.success_count === 5,
        `body.success_count === 5 (all 5 rows import — Decision B: row3 "12ab" no longer rejects the row) — got ${body.success_count}`);
    assert(body.failed_count === 0,
        `body.failed_count === 0 (no true failures — got ${body.failed_count})`);
    assert(body.warning_count === 1,
        `body.warning_count === 1 (row3 "12ab" dropped phone but kept row — got ${body.warning_count})`);
    assert(Array.isArray(body.warnings) && body.warnings.length >= 1,
        'body.warnings[] populated');
    assert(typeof body.warnings[0].message === 'string' &&
           body.warnings[0].message.startsWith('phone dropped'),
        `body.warnings[0].message starts with "phone dropped" (got "${body.warnings[0].message}")`);
    assert((body.errors || []).length === 0,
        `body.errors is empty (got ${JSON.stringify(body.errors || [])})`);

    // Verify stored phones via read-only DB (Suer requested — assertions above
    // only check counts). Uses RENDER_DATABASE_READONLY_URL from .env.
    const DB_URL = process.env.RENDER_DATABASE_READONLY_URL;
    if (DB_URL) {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
        try {
            const emails = Object.values(TEST_EMAILS);
            const dbRes = await pool.query(
                `SELECT email, phone FROM visitors
                 WHERE expo_id = $1 AND email = ANY($2)
                 ORDER BY email`,
                [TEST_EXPO_ID, emails]
            );
            console.log(`\n  Stored-phone verification (read-only DB):`);
            const storedByEmail = new Map(dbRes.rows.map(r => [r.email, r.phone]));
            for (const [key, email] of Object.entries(TEST_EMAILS)) {
                const actual = storedByEmail.get(email);
                const expected = EXPECTED_STORED[key];
                console.log(`    ${email.padEnd(35)} — stored='${actual}' (expected '${expected}')`);
                assert(actual === expected,
                    `${email}: stored phone === '${expected}' (got '${actual}')`);
            }
        } finally {
            await pool.end();
        }
    } else {
        console.log(`\n  ⚠️  RENDER_DATABASE_READONLY_URL not set — skipping stored-phone verification`);
    }

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
