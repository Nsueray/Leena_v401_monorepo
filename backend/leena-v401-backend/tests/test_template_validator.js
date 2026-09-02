/**
 * Unit test — validateTemplateBody (G3/G4 wizard piece 6)
 *
 * No DB. No network. No HTTP. Requires the named export directly:
 *
 *   const { validateTemplateBody } = require('../routes/campaignBuilder');
 *
 * The named export is attached at routes/campaignBuilder.js:958 alongside
 * the router default export — same pattern as reactivation.js's
 * `.processReactivationChunks` / `.generateToken`.
 *
 * The 9 cases are the same shape my ad-hoc /tmp/validator_unit.js ran
 * during G2 review, promoted into the repo so a future refactor cannot
 * silently break them.
 *
 * RUN: node tests/test_template_validator.js
 * EXITS: 0 on pass, 1 on any failure.
 */

const { validateTemplateBody, KNOWN_TOKENS } = require('../routes/campaignBuilder');

let passed = 0;
let failed = 0;
const failures = [];

function assertEqual(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log(`  ✓ ${label}`); }
    else {
        failed++;
        const msg = `${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`;
        failures.push(msg);
        console.log(`  ✗ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
    }
}

function runCase(label, html, subject, wave, expected) {
    const issues = validateTemplateBody(html, subject, wave);
    const errCodes = issues.filter(i => i.severity === 'error').map(i => i.code).sort();
    const warnCodes = issues.filter(i => i.severity === 'warning').map(i => i.code).sort();
    console.log(`\n[${label}]  wave=${wave}`);
    console.log(`  issues:`);
    for (const i of issues) console.log(`    ${i.severity}/${i.code}`);
    assertEqual(errCodes, (expected.errors || []).slice().sort(), `${label} — error codes match`);
    assertEqual(warnCodes, (expected.warnings || []).slice().sort(), `${label} — warning codes match`);
}

console.log(`=== validateTemplateBody unit tests ===`);
console.log(`KNOWN_TOKENS: ${[...KNOWN_TOKENS].sort().join(', ')}`);
console.log(`(Fixed keys from email_worker.js:569-577 + wizard's extra_fields)\n`);

// Case A — clean chain with activation_url href (wave=activate should be silent)
runCase(
    'A. clean chain (activate)',
    '<p>{{first_name|last_name|company|"Dear Visitor"}},</p><a href="{{activation_url}}">Go</a>',
    'Hello {{first_name|last_name|company|"there"}}',
    'activate',
    { errors: [], warnings: [] }
);

// Case B — bare {{country}} — must be a valid token (extra_fields), no issues.
runCase(
    'B. bare {{country}} (activate)',
    '<p>Hi from {{country}}!</p><a href="{{activation_url}}">Activate</a>',
    'Update on {{country}}',
    'activate',
    { errors: [], warnings: [] }
);

// Case C1 — bare {{first_name}} in body — NO_GREETING_CHAIN (error) because
// email_worker.js:571 maps it to '' on miss.
runCase(
    'C1. bare {{first_name}} in body (activate)',
    '<p>Dear {{first_name}},</p><a href="{{activation_url}}">Go</a>',
    'Hi',
    'activate',
    { errors: ['NO_GREETING_CHAIN'], warnings: [] }
);

// Case C2 — bare {{name}} in body — WARNING BARE_NAME_FALLBACK, no error,
// because email_worker.js:570 maps it to `first_name || 'Guest'`.
runCase(
    'C2. bare {{name}} in body (activate)',
    '<p>Dear {{name}},</p><a href="{{activation_url}}">Go</a>',
    'Hi',
    'activate',
    { errors: [], warnings: ['BARE_NAME_FALLBACK'] }
);

// Case D — junk segment inside a chain — UNRESOLVED_TOKEN (error).
runCase(
    'D. junk segment in chain (activate)',
    '<p>{{first_name|junk_key|"Fallback"}}</p><a href="{{activation_url}}">Go</a>',
    'Ok',
    'activate',
    { errors: ['UNRESOLVED_TOKEN'], warnings: [] }
);

// Case E — activate wave, href does NOT wire {{activation_url}} — MISSING_ACTIVATION_URL.
runCase(
    'E. activate without {{activation_url}} (activate)',
    '<p>{{first_name|last_name|"Hi"}},</p><a href="https://leena.app/form-public.html?id=53">Register</a>',
    'Register now',
    'activate',
    { errors: ['MISSING_ACTIVATION_URL'], warnings: [] }
);

// Case F — register wave, has any external href — clean.
runCase(
    'F. register with external href (register)',
    '<p>{{first_name|last_name|"Hi"}},</p><a href="https://leena.app/form-public.html?id=53">Register</a>',
    'Register now',
    'register',
    { errors: [], warnings: [] }
);

// Case G — register wave, no <a> at all — NO_CTA (warning).
runCase(
    'G. register with no CTA (register)',
    '<p>{{first_name|last_name|"Hi"}},</p><p>See you there.</p>',
    'Update',
    'register',
    { errors: [], warnings: ['NO_CTA'] }
);

// Case H — literal {{unsubscribe_url}} — DEAD_UNSUB_URL warning, no error
// (unsubscribe_url is whitelisted in KNOWN_TOKENS to suppress the redundant
// UNRESOLVED_TOKEN error; DEAD_UNSUB_URL communicates the real issue).
runCase(
    'H. literal {{unsubscribe_url}} (activate)',
    '<p>{{first_name|last_name|"Hi"}}</p><a href="{{activation_url}}">Go</a><a href="{{unsubscribe_url}}">Unsub</a>',
    'Ok',
    'activate',
    { errors: [], warnings: ['DEAD_UNSUB_URL'] }
);

console.log(`\n=== RESULT: ${passed}/${passed + failed} assertions passed ===`);
if (failed > 0) {
    console.error('\nFAILURES:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
}
console.log('✅ ALL PASSED');
process.exit(0);
