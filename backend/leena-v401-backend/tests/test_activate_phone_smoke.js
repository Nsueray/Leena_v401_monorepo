/**
 * Regression test — /api/reactivation/activate fail-open + A-1 custom_fields trace
 *
 * ⚠️ RUN ORDER: this test creates its own tokens via create-from-excel, then
 * activates two of them. If test_reactivation_phone_smoke.js OR
 * test_import_phone_smoke.js left visitor rows on expo 17, this test's
 * create-from-excel step will skip those emails as already_registered and
 * `valid` won't be 5. Run the cleanup SQL after the other two smokes before
 * running this one.
 *
 * ⚠️ DB verification requires WARP off + your local IP on Render's
 * PostgreSQL Inbound IP Rules. Test loads `backend/leena-v401-backend/.env`
 * automatically (path resolved relative to this file, not cwd).
 *
 * Origin: DEPLOY_PHONE_NORMALISATION_20260902.md Addendum — Decision B
 * shipped the /activate fail-open + A-1 JSONB `custom_fields` trace path
 * (`routes/reactivation.js:673-708` and the widened 16-column INSERT at
 * `:711-731`) but that path has NEVER been exercised end-to-end in
 * production. This test does it.
 *
 * The activation body mirrors `public/reactivate.html:520-529` exactly:
 *   { token, _lc, name, last_name, company, country, job_title, phone }
 *
 * Two rows exercised:
 *
 *   Row 4 (Turkey local) — activation body sends { phone:'0532 123 45 67',
 *     country:'Turkey' } to force the /activate handler's own country-fallback
 *     resolution (row_country → expo → null) to pick TR from the body,
 *     normalise to +90, and complete the visitor INSERT with
 *     custom_fields NULL (happy path — phoneResult.ok === true).
 *
 *   Row 3 (12ab) — activation body sends { phone:'12ab', country:'Nigeria' }
 *     to force the /activate handler's fail-open branch: phone stored as ''
 *     AND custom_fields JSONB blob {phone_raw:'12ab', phone_reject_reason:
 *     '<reason>', phone_rejected_at:<ISO>} written atomically with the INSERT.
 *
 * Assertions:
 *   - both activations return 2xx with success=true
 *   - visitor for row 4 stored phone '+905321234567' AND custom_fields IS NULL
 *   - visitor for row 3 stored phone '' AND custom_fields contains all three
 *     A-1 trace keys with correct values
 *
 * ---
 *
 * RUNTIME REQUIREMENTS:
 *   TEST_JWT                       — admin bearer for create-from-excel
 *                                    (/activate itself is public, no auth)
 *   TEST_BASE_URL                  — default: https://leena.app
 *   TEST_EXPO_ID                   — default: 17 (trash bridge; country_code='NG')
 *   RENDER_DATABASE_READONLY_URL   — from backend/.env, for token + visitor lookups
 *
 * Cleanup SQL emitted on both pass and fail paths.
 */

const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.TEST_BASE_URL || 'https://leena.app';
const TEST_JWT = process.env.TEST_JWT;
const TEST_EXPO_ID = parseInt(process.env.TEST_EXPO_ID || '17', 10);
const DB_URL = process.env.RENDER_DATABASE_READONLY_URL;

const TEST_EMAILS = {
    row1: 'smoke-phone-1@leena-test.local',
    row2: 'smoke-phone-2@leena-test.local',
    row3: 'smoke-phone-3@leena-test.local',
    row4: 'smoke-phone-4@leena-test.local',
    row5: 'smoke-phone-5@leena-test.local'
};

function assert(cond, msg) {
    if (!cond) { console.error(`\n❌ ASSERTION FAILED: ${msg}`); throw new Error(msg); }
    console.log(`  ✓ ${msg}`);
}

function emitCleanupSql() {
    const emails = Object.values(TEST_EMAILS).map(e => `'${e}'`).join(', ');
    console.log(`\n=== Cleanup SQL (Render Shell) ===`);
    console.log(`  DELETE FROM reactivation_tokens WHERE target_expo_id = ${TEST_EXPO_ID} AND email IN (${emails});`);
    console.log(`  DELETE FROM visitors            WHERE expo_id = ${TEST_EXPO_ID} AND email IN (${emails});`);
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required');
    if (!DB_URL) throw new Error('RENDER_DATABASE_READONLY_URL env var required (backend .env)');

    console.log(`\n=== /api/reactivation/activate — fail-open + A-1 trace smoke ===\n`);
    console.log(`  Target: ${BASE_URL}`);
    console.log(`  Expo:   ${TEST_EXPO_ID} (must be country_code='NG')`);
    console.log(`  Flow:   create-from-excel silent → look up 2 tokens → POST /activate for each → DB assertions\n`);

    // ---------------------------------------------------------------------
    // 1. Build the 5-row xlsx and post to create-from-excel (silent).
    //    ALWAYS rebuild — never trust a leftover file on disk.
    // ---------------------------------------------------------------------
    const rows = [
        { name: 'SmokeRow1', last_name: 'Numeric',
          email: TEST_EMAILS.row1, company: 'Test Co',
          phone: 2348012345678 },
        { name: 'SmokeRow2', last_name: 'Placeholder',
          email: TEST_EMAILS.row2, company: 'Test Co',
          phone: 'xxxxxxxxxx' },
        { name: 'SmokeRow3', last_name: 'Invalid',
          email: TEST_EMAILS.row3, company: 'Test Co',
          phone: '12ab' },
        { name: 'SmokeRow4', last_name: 'Turkish',
          email: TEST_EMAILS.row4, company: 'Test Co', country: 'Turkey',
          phone: '0532 123 45 67' },
        { name: 'SmokeRow5', last_name: 'PlusWins',
          email: TEST_EMAILS.row5, company: 'Test Co', country: 'Turkey',
          phone: '+212 661 23 45 67' }
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync('/tmp/phone_smoke.xlsx', buffer);
    console.log(`  Built 5-row xlsx (${buffer.length} bytes)`);

    const form = new FormData();
    form.append('file', new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), 'phone_smoke.xlsx');
    form.append('target_expo_id', String(TEST_EXPO_ID));
    // silent — no template_id

    const createResp = await fetch(`${BASE_URL}/api/reactivation/create-from-excel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_JWT}` },
        body: form
    });
    if (!createResp.ok) {
        const t = await createResp.text().catch(() => '');
        throw new Error(`create-from-excel HTTP ${createResp.status}: ${t.slice(0, 200)}`);
    }
    const createBody = await createResp.json();
    console.log(`  create-from-excel: job_id=${createBody.job_id} valid=${createBody.valid} phone_dropped=${createBody.phone_dropped}`);

    // Poll the job to completion (5 rows drain in <2 s normally, cap 60 s).
    const pollDeadline = Date.now() + 60000;
    let job = null;
    while (Date.now() < pollDeadline) {
        const jr = await fetch(`${BASE_URL}/api/reactivation/job/${createBody.job_id}`, {
            headers: { 'Authorization': `Bearer ${TEST_JWT}` }
        });
        job = await jr.json();
        if (job.status === 'completed') break;
        if (job.status === 'failed') throw new Error(`Job failed: ${job.error_message}`);
        await new Promise(r => setTimeout(r, 1500));
    }
    assert(job && job.status === 'completed', `create-from-excel job completed (final status=${job?.status})`);

    // ---------------------------------------------------------------------
    // 2. Look up the two tokens we need (row 3 + row 4) via read-only DB.
    // ---------------------------------------------------------------------
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    let row3Token, row4Token;
    try {
        const tokRes = await pool.query(
            `SELECT email, token FROM reactivation_tokens
             WHERE target_expo_id = $1 AND email IN ($2, $3)
             ORDER BY email`,
            [TEST_EXPO_ID, TEST_EMAILS.row3, TEST_EMAILS.row4]
        );
        assert(tokRes.rows.length === 2, `2 tokens found for row3 + row4 (got ${tokRes.rows.length})`);
        for (const t of tokRes.rows) {
            if (t.email === TEST_EMAILS.row3) row3Token = t.token;
            if (t.email === TEST_EMAILS.row4) row4Token = t.token;
        }
        assert(row3Token && row4Token, 'both tokens retrieved');

        // -----------------------------------------------------------------
        // 3. Activate row 4 with { phone:'0532 123 45 67', country:'Turkey' }.
        //    Exercises the /activate row-country resolver's happy path.
        //    Expect: response success, visitor.phone='+905321234567',
        //    visitor.custom_fields IS NULL (phoneResult.ok === true).
        // -----------------------------------------------------------------
        console.log(`\n  Activating row 4 (Turkey local, expect happy path)...`);
        const row4Body = {
            token: row4Token,
            name: 'SmokeRow4', last_name: 'Turkish', company: 'Test Co',
            country: 'Turkey', job_title: '',
            phone: '0532 123 45 67'
        };
        const act4 = await fetch(`${BASE_URL}/api/reactivation/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row4Body)
        });
        if (!act4.ok) {
            const t = await act4.text().catch(() => '');
            throw new Error(`row 4 activate HTTP ${act4.status}: ${t.slice(0, 200)}`);
        }
        const act4Body = await act4.json();
        console.log(`    row 4 response: success=${act4Body.success} visitor.id=${act4Body.visitor?.id}`);
        assert(act4Body.success === true, 'row 4 activate response success=true');

        // -----------------------------------------------------------------
        // 4. Activate row 3 with { phone:'12ab', country:'Nigeria' }.
        //    Exercises the fail-open + A-1 trace path.
        //    Expect: response success, visitor.phone='',
        //    visitor.custom_fields = { phone_raw:'12ab', phone_reject_reason:'…', phone_rejected_at:<ISO> }.
        // -----------------------------------------------------------------
        console.log(`\n  Activating row 3 ("12ab", expect fail-open + custom_fields trace)...`);
        const row3Body = {
            token: row3Token,
            name: 'SmokeRow3', last_name: 'Invalid', company: 'Test Co',
            country: 'Nigeria', job_title: '',
            phone: '12ab'
        };
        const act3 = await fetch(`${BASE_URL}/api/reactivation/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row3Body)
        });
        if (!act3.ok) {
            const t = await act3.text().catch(() => '');
            throw new Error(`row 3 activate HTTP ${act3.status}: ${t.slice(0, 200)}`);
        }
        const act3Body = await act3.json();
        console.log(`    row 3 response: success=${act3Body.success} visitor.id=${act3Body.visitor?.id}`);
        assert(act3Body.success === true, 'row 3 activate response success=true');

        // -----------------------------------------------------------------
        // 5. DB assertions — the load-bearing check.
        // -----------------------------------------------------------------
        console.log(`\n  DB assertions (read-only):`);
        const visRes = await pool.query(
            `SELECT email, phone, custom_fields FROM visitors
             WHERE expo_id = $1 AND email IN ($2, $3)
             ORDER BY email`,
            [TEST_EXPO_ID, TEST_EMAILS.row3, TEST_EMAILS.row4]
        );
        assert(visRes.rows.length === 2, `2 visitor rows created (got ${visRes.rows.length})`);
        const byEmail = new Map(visRes.rows.map(r => [r.email, r]));

        // Row 4 — happy path
        const row4Visitor = byEmail.get(TEST_EMAILS.row4);
        assert(row4Visitor.phone === '+905321234567',
            `row 4 stored phone === '+905321234567' (got '${row4Visitor.phone}')`);
        assert(row4Visitor.custom_fields === null,
            `row 4 custom_fields IS NULL (got ${JSON.stringify(row4Visitor.custom_fields)})`);

        // Row 3 — fail-open + trace
        const row3Visitor = byEmail.get(TEST_EMAILS.row3);
        assert(row3Visitor.phone === '',
            `row 3 stored phone === '' (got '${row3Visitor.phone}')`);
        assert(row3Visitor.custom_fields !== null,
            `row 3 custom_fields NOT NULL (got ${JSON.stringify(row3Visitor.custom_fields)})`);
        // custom_fields comes back as a JS object (pg driver auto-parses JSONB).
        const cf = row3Visitor.custom_fields;
        assert(cf.phone_raw === '12ab',
            `row 3 custom_fields.phone_raw === '12ab' (got '${cf.phone_raw}')`);
        assert(typeof cf.phone_reject_reason === 'string' && cf.phone_reject_reason.length > 0,
            `row 3 custom_fields.phone_reject_reason is a non-empty string (got '${cf.phone_reject_reason}')`);
        assert(typeof cf.phone_rejected_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(cf.phone_rejected_at),
            `row 3 custom_fields.phone_rejected_at is an ISO string (got '${cf.phone_rejected_at}')`);

        console.log(`\n  Row 3 custom_fields blob: ${JSON.stringify(cf, null, 2).replace(/\n/g, '\n  ')}`);
    } finally {
        await pool.end();
    }

    console.log('\n✅ ALL ASSERTIONS PASSED');
}

main()
    .then(() => { emitCleanupSql(); process.exit(0); })
    .catch(err => {
        console.error(`\n❌ TEST FAILED: ${err.message}`);
        emitCleanupSql();
        process.exit(1);
    });
