/**
 * Regression test — email-segments /send scalability
 *
 * Origin: SEGMENT_FORENSICS_20260828.md §5c. Written after the M1-M4 rewrite
 * (commit d1cebcf) shipped a /send handler that pre-rendered per-visitor HTML
 * into a Node array and pushed ~10 KB × N as a single INSERT payload — which
 * OOM'd / HTTP-timed-out at N≈8k in production (Yaprak's noshow_any send on
 * 28 Aug 2026, zero rows written across 5 attempts spanning 15 minutes). The
 * Mode 2 fix (commit 90e2999) collapses the payload from N×10KB to N×40B by
 * enqueueing visitor_id + template_id and letting the worker render per row.
 *
 * NOT WIRED TO CI YET (per Suer's instruction). This file exists so the
 * failure mode is captured in-repo and future segment changes have a
 * concrete assertion to fail against before hitting production.
 *
 * How to run manually (against a staging DB, NOT production):
 *   1. Set DATABASE_URL to a staging PG with the current schema.
 *   2. Provide an admin JWT via TEST_JWT env var.
 *   3. Point TEST_BASE_URL at the running app (default http://localhost:3000).
 *   4. node tests/test_email_segments_smoke.js
 *
 * The test:
 *   1. Creates a test expo + template on the target DB.
 *   2. Seeds 10,000 visitors with unique emails, no check-ins.
 *   3. Calls POST /api/email-segments/send with segment=noshow_any.
 *   4. Asserts response returns within 5 seconds.
 *   5. Asserts response.queued === 10000.
 *   6. Asserts email_queue contains exactly 10,000 pending rows for the test expo.
 *   7. Asserts every row has html_content=NULL and template_id set (Mode 2 shape).
 *   8. Cleans up seeded rows (visitors + email_queue + template + expo).
 *
 * The Mode 1 implementation from d1cebcf would fail step 4 (timeout) OR step 6
 * (zero rows because Node OOM'd before INSERT). The Mode 2 implementation from
 * 90e2999 passes all steps.
 */

const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_JWT = process.env.TEST_JWT;
const DATABASE_URL = process.env.DATABASE_URL || process.env.RENDER_DATABASE_READONLY_URL;

const SEED_VISITORS = 10000;
const RESPONSE_TIMEOUT_MS = 5000;
const TEST_ORGANIZER_ID = 1;                    // must match TEST_JWT's org
const TEST_EXPO_PREFIX = '[SMOKE-SEGMENT] ';    // easy cleanup filter
const TEMPLATE_HTML_BYTES = 10 * 1024;          // 10 KB payload, mirrors prod

function assert(cond, msg) {
    if (!cond) {
        console.error(`\n❌ ASSERTION FAILED: ${msg}`);
        process.exit(1);
    }
    console.log(`  ✓ ${msg}`);
}

async function main() {
    if (!TEST_JWT) throw new Error('TEST_JWT env var required');
    if (!DATABASE_URL) throw new Error('DATABASE_URL env var required');

    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    let expoId, templateId;

    try {
        console.log(`\n=== email-segments /send scalability smoke test (N=${SEED_VISITORS}) ===\n`);

        // 1. Create test expo + template
        console.log('Setting up test fixtures...');
        const expoRes = await pool.query(
            `INSERT INTO expos (name, organizer_id, start_date, end_date)
             VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 1) RETURNING id`,
            [TEST_EXPO_PREFIX + Date.now(), TEST_ORGANIZER_ID]
        );
        expoId = expoRes.rows[0].id;

        const html = 'x'.repeat(TEMPLATE_HTML_BYTES);
        const tplRes = await pool.query(
            `INSERT INTO email_templates (name, subject, html_content, organizer_id, expo_id, is_active)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [TEST_EXPO_PREFIX + 'template', 'Test subject', html, TEST_ORGANIZER_ID, expoId]
        );
        templateId = tplRes.rows[0].id;
        console.log(`  ✓ Created expo ${expoId} and template ${templateId}`);

        // 2. Seed SEED_VISITORS in batches of 1000
        console.log(`Seeding ${SEED_VISITORS} test visitors...`);
        const seedT0 = Date.now();
        const uuid = () => require('crypto').randomBytes(16).toString('hex');
        for (let i = 0; i < SEED_VISITORS; i += 1000) {
            const chunk = Math.min(1000, SEED_VISITORS - i);
            const valueClauses = [];
            const values = [];
            for (let j = 0; j < chunk; j++) {
                const b = j * 6;
                valueClauses.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`);
                values.push(
                    'Test' + (i + j),
                    'Smoke',
                    `smoke-${i + j}-${Date.now()}@leena-test.local`,
                    TEST_ORGANIZER_ID,
                    expoId,
                    uuid()
                );
            }
            await pool.query(
                `INSERT INTO visitors (name, last_name, email, organizer_id, expo_id, qr_code)
                 VALUES ${valueClauses.join(',')}`,
                values
            );
        }
        console.log(`  ✓ Seeded ${SEED_VISITORS} visitors in ${Date.now() - seedT0}ms`);

        // 3. Call /send with segment=noshow_any and measure response time
        console.log(`Calling POST ${BASE_URL}/api/email-segments/send ...`);
        const reqT0 = Date.now();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS + 2000);
        let response, body;
        try {
            response = await fetch(`${BASE_URL}/api/email-segments/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TEST_JWT}`
                },
                body: JSON.stringify({
                    expo_id: expoId,
                    segment: 'noshow_any',
                    template_id: templateId
                }),
                signal: controller.signal
            });
            body = await response.json();
        } finally {
            clearTimeout(timer);
        }
        const responseTime = Date.now() - reqT0;
        console.log(`  → response in ${responseTime}ms, status=${response.status}`);
        console.log(`  → body: ${JSON.stringify(body).slice(0, 200)}`);

        // 4. Assertions
        console.log('\nAssertions:');
        assert(response.ok, `HTTP status is 2xx (got ${response.status})`);
        assert(responseTime < RESPONSE_TIMEOUT_MS, `response returned in <${RESPONSE_TIMEOUT_MS}ms (got ${responseTime}ms)`);
        assert(body.success === true, 'response.success === true');
        assert(body.queued === SEED_VISITORS, `body.queued === ${SEED_VISITORS} (got ${body.queued})`);

        const rowCountRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM email_queue WHERE expo_id = $1 AND template_id = $2`,
            [expoId, templateId]
        );
        assert(rowCountRes.rows[0].n === SEED_VISITORS, `email_queue has exactly ${SEED_VISITORS} rows for the test expo`);

        const shapeRes = await pool.query(
            `SELECT
               COUNT(*) FILTER (WHERE html_content IS NULL)::int AS mode2_shape,
               COUNT(*) FILTER (WHERE html_content IS NOT NULL)::int AS mode1_shape,
               COUNT(*) FILTER (WHERE visitor_id IS NOT NULL AND template_id IS NOT NULL)::int AS has_worker_keys,
               COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
             FROM email_queue WHERE expo_id = $1 AND template_id = $2`,
            [expoId, templateId]
        );
        const shape = shapeRes.rows[0];
        assert(shape.mode2_shape === SEED_VISITORS, `all rows are Mode 2 shape (html_content NULL) — Mode 1 rows would indicate regression to the OOM path`);
        assert(shape.mode1_shape === 0, 'no rows have pre-rendered html_content');
        assert(shape.has_worker_keys === SEED_VISITORS, 'every row has visitor_id + template_id for the worker');
        assert(shape.pending === SEED_VISITORS, `all rows initial status = 'pending'`);

        console.log('\n✅ ALL ASSERTIONS PASSED');
    } finally {
        // Cleanup — ordered to respect FKs
        if (expoId) {
            console.log(`\nCleanup: removing test fixtures for expo ${expoId}...`);
            await pool.query(`DELETE FROM email_queue WHERE expo_id = $1`, [expoId]);
            await pool.query(`DELETE FROM email_logs WHERE expo_id = $1`, [expoId]);
            await pool.query(`DELETE FROM visitors WHERE expo_id = $1`, [expoId]);
            if (templateId) await pool.query(`DELETE FROM email_templates WHERE id = $1`, [templateId]);
            await pool.query(`DELETE FROM expos WHERE id = $1`, [expoId]);
            console.log('  ✓ Cleanup complete');
        }
        await pool.end();
    }
}

main().catch(err => {
    console.error('\n❌ TEST FAILED WITH UNCAUGHT ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
});
