// tests/test_phone_normalize.js
//
// Fixtures come from three sources:
//   1. The shape of the three failed agency files (G21 — Excel stored phones as
//      JS numbers, primary import at visitors.js:788 crashed on .trim()).
//   2. Real production DB samples enumerated in IMPORT_PHONE_NORMALISATION_20260901.md §3.
//   3. At least three deliberately invalid rows that MUST come back { ok:false, ... }.
//
// Runs standalone: `node tests/test_phone_normalize.js`. Exits 0 on all-pass, 1 on any fail.
// No test framework dependency — mirrors the existing tests/setup_test_db.js style
// (this repo does not have Jest / Mocha wired to CI as of Sep 2026).

const { normalizePhone } = require('../utils/phoneNormalize');

let pass = 0;
let fail = 0;
const failures = [];

function expect(label, actual, expected) {
    // Deep-ish equal for our tiny return shape.
    const ok =
        actual === expected ||
        (typeof actual === 'object' && typeof expected === 'object' &&
         actual !== null && expected !== null &&
         actual.ok === expected.ok &&
         actual.e164 === expected.e164 &&
         // reason: exact match if provided in expected, otherwise ignore.
         (expected.reason === undefined || actual.reason === expected.reason ||
          (typeof expected.reason === 'string' && typeof actual.reason === 'string' &&
           actual.reason.startsWith(expected.reason))));
    if (ok) {
        pass++;
        console.log(`  ✓ ${label}`);
    } else {
        fail++;
        failures.push({ label, actual, expected });
        console.log(`  ✗ ${label}`);
        console.log(`     expected: ${JSON.stringify(expected)}`);
        console.log(`     actual  : ${JSON.stringify(actual)}`);
    }
}

// -----------------------------------------------------------------------------
// GROUP 1 — Agency-file shapes (the three that failed on 15 Feb / 20 Apr / 13 May)
// -----------------------------------------------------------------------------
console.log('\n=== Agency-file shapes (G21 crash class) ===');

// XLSX.utils.sheet_to_json returns JS numbers when Excel cell is typed as number.
// Before Sep 2026 the import path did phone.trim() on this → TypeError.
expect('numeric cell 2348012345678 (NG)',
    normalizePhone(2348012345678, 'NG'),
    { ok: true, e164: '+2348012345678', reason: null });

expect('numeric cell 8012345678 short (NG)',
    normalizePhone(8012345678, 'NG'),
    { ok: true, e164: '+2348012345678', reason: null });

expect('bigint literal (NG)',
    normalizePhone(BigInt('2348012345678'), 'NG'),
    { ok: true, e164: '+2348012345678', reason: null });

expect('string 0801-234-5678 with dashes (NG)',
    normalizePhone('0801-234-5678', 'NG'),
    { ok: true, e164: '+2348012345678', reason: null });

expect('string +234 801 234 5678 with spaces (NG)',
    normalizePhone('+234 801 234 5678', 'NG'),
    { ok: true, e164: '+2348012345678', reason: null });

// -----------------------------------------------------------------------------
// GROUP 2 — Real production rows from report §3 (verified via read-only DB)
// -----------------------------------------------------------------------------
console.log('\n=== Real production samples (report §3) ===');

// Nigeria trunk-zero — expected retry to fire.
expect('real: "+23407047009707" (NG trunk-zero, expo 3)',
    normalizePhone('+23407047009707', 'NG'),
    { ok: true, e164: '+2347047009707', reason: null });

expect('real: "+23408088762928" (NG trunk-zero, expo 3)',
    normalizePhone('+23408088762928', 'NG'),
    { ok: true, e164: '+2348088762928', reason: null });

expect('real: "+23408171947130" (NG trunk-zero, expo 3)',
    normalizePhone('+23408171947130', 'NG'),
    { ok: true, e164: '+2348171947130', reason: null });

// Morocco trunk-zero — library self-fixes, retry never runs.
expect('real: "+2120633787189" (MA trunk-zero, expo 1)',
    normalizePhone('+2120633787189', 'MA'),
    { ok: true, e164: '+212633787189', reason: null });

expect('real: "+21206 64 36 03 54" (MA trunk-zero + spaces, expo 1)',
    normalizePhone('+21206 64 36 03 54', 'MA'),
    { ok: true, e164: '+212664360354', reason: null });

// Local Moroccan number, no country code — needs expo country context.
expect('real: "0654864997" MA (local, needs default country)',
    normalizePhone('0654864997', 'MA'),
    { ok: true, e164: '+212654864997', reason: null });

// Local Nigerian numbers, the dominant shape (~35k rows total).
expect('real: "08067781379" NG (local)',
    normalizePhone('08067781379', 'NG'),
    { ok: true, e164: '+2348067781379', reason: null });

// Different-country context: the SAME 10-digit string is valid in MA but not GH,
// because Ghanaian mobiles start with 2/5, not 6. Library correctly rejects.
// A real Ghanaian mobile:
expect('real: "0244123456" GH (Ghana mobile local)',
    normalizePhone('0244123456', 'GH'),
    { ok: true, e164: '+233244123456', reason: null });

expect('reject: "0654864997" GH — 06 is not a Ghanaian mobile prefix',
    normalizePhone('0654864997', 'GH'),
    { ok: false, e164: '', reason: 'invalid phone number for country GH' });

// 00 international-access prefix (report: 456 rows).
expect('real: "00212636505612" no default (E.123 fold to +)',
    normalizePhone('00212636505612', null),
    { ok: true, e164: '+212636505612', reason: null });

expect('real: "00212636505612" MA default',
    normalizePhone('00212636505612', 'MA'),
    { ok: true, e164: '+212636505612', reason: null });

// Foreign visitor with full E.164 — passes through regardless of expo country.
expect('real: "+48 690 901 098" foreign on any expo',
    normalizePhone('+48 690 901 098', 'NG'),
    { ok: true, e164: '+48690901098', reason: null });

expect('real: "+33 7 56 97 31 01" foreign on any expo',
    normalizePhone('+33 7 56 97 31 01', 'MA'),
    { ok: true, e164: '+33756973101', reason: null });

// Dashes / parens / dots.
expect('real: "0607-148807" MA (dashes)',
    normalizePhone('0607-148807', 'MA'),
    { ok: true, e164: '+212607148807', reason: null });

expect('real: "+212 661-712943" (mix separators)',
    normalizePhone('+212 661-712943', 'MA'),
    { ok: true, e164: '+212661712943', reason: null });

// Unicode direction marks + non-standard hyphens (report: 3 rows).
expect('real: unicode marks + U+2011 hyphen "‪+212 712‑059792‬"',
    normalizePhone('‪+212 712‑059792‬', null),
    { ok: true, e164: '+212712059792', reason: null });

// Agency placeholder — treat as empty (report: 12 rows).
expect('real: "xxxxxxxxxx" placeholder → empty preserved',
    normalizePhone('xxxxxxxxxx', 'NG'),
    { ok: true, e164: '', reason: null });

expect('real: "XXXXXX" uppercase placeholder → empty preserved',
    normalizePhone('XXXXXX', 'MA'),
    { ok: true, e164: '', reason: null });

// -----------------------------------------------------------------------------
// GROUP 3 — Empty / null / blank (report §1b: preserve current behaviour)
// -----------------------------------------------------------------------------
console.log('\n=== Empty inputs — preserved as empty (not rejected) ===');

expect('empty string with default country',
    normalizePhone('', 'NG'),
    { ok: true, e164: '', reason: null });

expect('null with default country',
    normalizePhone(null, 'NG'),
    { ok: true, e164: '', reason: null });

expect('undefined with default country',
    normalizePhone(undefined, 'NG'),
    { ok: true, e164: '', reason: null });

expect('whitespace-only "   " with default country',
    normalizePhone('   ', 'NG'),
    { ok: true, e164: '', reason: null });

expect('parens-only "()" with default country',
    normalizePhone('()', 'NG'),
    { ok: true, e164: '', reason: null });

expect('empty string with NO default country',
    normalizePhone('', null),
    { ok: true, e164: '', reason: null });

// -----------------------------------------------------------------------------
// GROUP 4 — Rejections (Suer's ≥3 invalid cases)
// -----------------------------------------------------------------------------
console.log('\n=== Rejections — must come back ok:false ===');

// 1. Non-numeric junk (not xxxx placeholder).
expect('reject: "abc" with default country',
    normalizePhone('abc', 'NG'),
    { ok: false, e164: '', reason: 'invalid phone number for country NG' });

// 2. Too-short number.
expect('reject: "12" way too short',
    normalizePhone('12', 'NG'),
    { ok: false, e164: '', reason: 'invalid phone number for country NG' });

// 3. Local number without country context (no expo country_code + no +).
expect('reject: "0801234567" no default country (test/placeholder expo)',
    normalizePhone('0801234567', null),
    { ok: false, e164: '', reason: 'no country context' });

// 4. Bogus trunk-zero — matches TRUNK_ZERO_RE but retry still invalid.
// "+2340611234567" — first parse invalid; retry "+234611234567" also invalid
// (Nigerian mobile prefixes are 7/8/9, not 6). Correctly stays rejected.
expect('reject: "+2340611234567" trunk-zero retry does NOT rescue bogus number',
    normalizePhone('+2340611234567', 'NG'),
    { ok: false, e164: '', reason: 'invalid phone number for country NG' });

// 5. Random letters mixed with digits.
expect('reject: "555-CALL-NOW" letters not in x-only pattern',
    normalizePhone('555-CALL-NOW', 'US'),
    { ok: false, e164: '', reason: 'invalid phone number for country US' });

// -----------------------------------------------------------------------------
// GROUP 5 — Legacy 1-arg mode (visitors.js:1076 backwards-compat guard)
// -----------------------------------------------------------------------------
console.log('\n=== Legacy 1-arg mode — must still return bare strings ===');

expect('legacy: null → ""', normalizePhone(null), '');
expect('legacy: "" → ""', normalizePhone(''), '');
expect('legacy: "+2340611234567" trunk zero → "+234611234567"',
    normalizePhone('+2340611234567'), '+234611234567');
expect('legacy: "0801234567" → "+234801234567"',
    normalizePhone('0801234567'), '+234801234567');
expect('legacy: "+48 690 901 098" → "+48690901098"',
    normalizePhone('+48 690 901 098'), '+48690901098');
expect('legacy: "8012345678" bare digits → "+2348012345678"',
    normalizePhone('8012345678'), '+2348012345678');

// -----------------------------------------------------------------------------
// GROUP 6 — Idempotency (running the normaliser on its own output must be safe)
// -----------------------------------------------------------------------------
console.log('\n=== Idempotency — re-normalising an E.164 output stays the same ===');

const first = normalizePhone('08067781379', 'NG');
const second = normalizePhone(first.e164, 'NG');
expect('idempotent NG local → E.164 → same E.164',
    second, { ok: true, e164: first.e164, reason: null });

const firstMA = normalizePhone('0654864997', 'MA');
const secondMA = normalizePhone(firstMA.e164, 'MA');
expect('idempotent MA local → E.164 → same E.164',
    secondMA, { ok: true, e164: firstMA.e164, reason: null });

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Result: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f.label}`);
    process.exit(1);
}
process.exit(0);
