// utils/phoneNormalize.js
//
// Phone-number normalisation for the import path.
//
// Two calling modes on the SAME exported function (arity-dispatched):
//
//   normalizePhone(raw)                       → LEGACY string return
//   normalizePhone(raw, defaultCountry)       → { ok, e164, reason } strict result
//
// Legacy 1-arg is preserved verbatim for `routes/visitors.js:1076`
// (`'Phone (WhatsApp)': normalizePhone(r.phone)` — export CSV column). Do NOT change
// its behaviour without also updating that call site.
//
// Strict 2-arg is what all import writes go through (Sep 2026 rewrite —
// see docs/sessions/IMPORT_PHONE_NORMALISATION_20260901.md).
//
// Storage format: E.164 (+CCXXXXXXXXX). No spaces, no separators, no local-only shapes.
// Empty/blank input → { ok:true, e164:'' } — empty is a legitimate stored value,
// preserved to match existing behaviour at all 5 write sites (see report §1b).

const { parsePhoneNumberFromString } = require('libphonenumber-js');

// -----------------------------------------------------------------------------
// Cleaning: everything that libphonenumber-js does NOT tolerate.
//
// Includes the Unicode directional marks + non-standard hyphens observed in
// prod data (report §3):
//   U+202A LEFT-TO-RIGHT EMBEDDING
//   U+202B RIGHT-TO-LEFT EMBEDDING
//   U+202C POP DIRECTIONAL FORMATTING
//   U+202D LEFT-TO-RIGHT OVERRIDE
//   U+202E RIGHT-TO-LEFT OVERRIDE
//   U+2010 HYPHEN
//   U+2011 NON-BREAKING HYPHEN
// -----------------------------------------------------------------------------
const CLEAN_RE = /[\s\-().‪‫‬‭‮‐‑]/g;

// Trunk-zero after country code pattern.
// Used ONLY as the retry condition per wrapper rule (b). Never a blind strip.
// Examples: "+2340611234567" (NG, first parse invalid → retry drops the 0)
//           "+2120633787189" (MA, library already fixes it → retry never runs)
const TRUNK_ZERO_RE = /^\+\d{1,3}0\d{6,}$/;

// Junk placeholder observed in agency files (report §2, 12 rows measured).
// Treat as empty rather than as a rejection — the row keeps flowing without a phone.
const JUNK_PLACEHOLDER_RE = /^x+$/i;

// -----------------------------------------------------------------------------
// Public: normalizePhone(raw [, defaultCountry])
// -----------------------------------------------------------------------------
function normalizePhone(raw, defaultCountry) {
  if (arguments.length < 2) return legacyNormalizePhone(raw);
  return strictNormalize(raw, defaultCountry);
}

// -----------------------------------------------------------------------------
// Strict 2-arg — the import-path contract.
//
// Return shape:
//   { ok: true,  e164: '+2348012345678', reason: null }
//   { ok: true,  e164: '',               reason: null }   ← empty input (preserved)
//   { ok: false, e164: '',               reason: 'human-readable string' }
//
// Wrapper rules (both measured against libphonenumber-js 1.13.12):
//   (a) Empty/null → { ok:true, e164:'' } BEFORE calling the library
//       (parsePhoneNumberFromString('') returns undefined).
//   (b) Trunk-zero retry: if the first parse is invalid AND the cleaned input
//       matches /^\+\d{1,3}0\d{6,}$/, strip that single 0 and parse once more;
//       accept ONLY if the retry is valid. Never strip blindly.
//
// Precondition: `00` international prefix is folded to `+` after cleaning
// (well-known E.123 preprocessing — libphonenumber-js does not do this itself).
//
// Missing-country contract:
//   defaultCountry falsy AND cleaned input has no leading '+' → reject.
// -----------------------------------------------------------------------------
function strictNormalize(raw, defaultCountry) {
  // Rule (a) — empty before touching the library.
  if (raw === null || raw === undefined) {
    return { ok: true, e164: '', reason: null };
  }

  // Coerce (JS number, bigint, arbitrary object with toString).
  const asString = String(raw);

  // Clean whitespace / dashes / parens / dots / Unicode direction marks / non-standard hyphens.
  let cleaned = asString.replace(CLEAN_RE, '').trim();

  // Rule (a) — empty AFTER cleaning (e.g. "   " or "()").
  if (cleaned === '') {
    return { ok: true, e164: '', reason: null };
  }

  // Agency placeholder — treat as empty, do not reject.
  if (JUNK_PLACEHOLDER_RE.test(cleaned)) {
    return { ok: true, e164: '', reason: null };
  }

  // Fold "00" international-prefix to "+" (E.123). Library does not do this.
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // Missing-country contract: no default AND no leading + → reject.
  if (!defaultCountry && !cleaned.startsWith('+')) {
    return {
      ok: false,
      e164: '',
      reason: 'no country context (expo has no country_code and number has no country prefix)'
    };
  }

  // First parse.
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry || undefined);
  if (parsed && parsed.isValid()) {
    return { ok: true, e164: parsed.number, reason: null };
  }

  // Rule (b) — trunk-zero retry. Match only, never blind strip.
  if (TRUNK_ZERO_RE.test(cleaned)) {
    const m = cleaned.match(/^(\+\d{1,3})0(\d{6,})$/);
    if (m) {
      const retry = m[1] + m[2];
      const parsed2 = parsePhoneNumberFromString(retry);
      if (parsed2 && parsed2.isValid()) {
        return { ok: true, e164: parsed2.number, reason: null };
      }
    }
  }

  return {
    ok: false,
    e164: '',
    reason: `invalid phone number for country ${defaultCountry || '(none)'}: "${asString.slice(0, 50)}"`
  };
}

// -----------------------------------------------------------------------------
// Legacy 1-arg behaviour — preserved verbatim from May 2026 for
// `routes/visitors.js:1076` (the export CSV column). Always Nigeria +234.
// Do not modify without also updating that call site.
// -----------------------------------------------------------------------------
const LEGACY_COUNTRY_CODE = '+234';

function legacyNormalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw).replace(/[\s\-\(\)\.]/g, '');
  if (cleaned === '') return '';

  if (cleaned.startsWith(LEGACY_COUNTRY_CODE + '0')) {
    return LEGACY_COUNTRY_CODE + cleaned.slice(LEGACY_COUNTRY_CODE.length + 1);
  }
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('0')) return LEGACY_COUNTRY_CODE + cleaned.slice(1);
  return LEGACY_COUNTRY_CODE + cleaned;
}

module.exports = { normalizePhone };
