// utils/phoneNormalize.js
//
// Normalize a raw visitor phone string to E.164-ish WhatsApp format.
// Pure function, no I/O — unit-testable.

// TODO: Future expo-aware country code (ADR ref TBD) — currently hardcoded
// for Mega Clima Nigeria (expo_id=7). When multi-country expos need this,
// pass the country code in instead of the module constant.
const COUNTRY_CODE = '+234'; // Nigeria

/**
 * normalizePhone(raw) → string
 *
 * Rules (applied in order):
 *   STEP 1:  strip whitespace, dashes, parens, dots  /[\s\-\(\)\.]/g → ''
 *   STEP 2a: if starts with COUNTRY_CODE + "0"        → COUNTRY_CODE + rest (drop embedded 0)
 *            (handles common Nigerian entry: "+234 0801..." → "+234801...")
 *   STEP 2b: if starts with "+"                       → leave as-is
 *   STEP 3:  if starts with "0"                       → COUNTRY_CODE + rest (drop leading 0)
 *   STEP 4:  if no "+" and not starting with "0"      → COUNTRY_CODE + value
 *   STEP 5:  empty / null / undefined                 → '' (empty string)
 *
 * KNOWN LIMITATIONS:
 *   1. STEP 3 strips only a single leading "0". If a number starts with
 *      "00" (international access code, e.g. "00234..."), this rule would
 *      produce a malformed result. Currently no such data exists in
 *      expo_id=7 (verified 2026-05-19). Add guard if observed in future.
 *   2. STEP 2a only handles the +CC + 0 pattern. It does NOT fix:
 *      - Short numbers (len < 14, e.g. missing digits): ~95 rows in expo_id=7
 *      - Junk/over-length numbers (len > 14 after STEP 2a): ~10 rows
 *      These are separate data quality issues, not normalization problems.
 *
 * @param {string|null|undefined} raw - raw visitors.phone value
 * @returns {string} normalized phone, or '' when input is empty/blank
 */
function normalizePhone(raw) {
  // STEP 5 (early): empty / null / undefined
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw).replace(/[\s\-\(\)\.]/g, ''); // STEP 1
  if (cleaned === '') return ''; // STEP 5 (post-clean blank)

  // STEP 2a: COUNTRY_CODE followed by an embedded leading "0" → drop that 0.
  // Generic via COUNTRY_CODE so it adapts if the constant changes.
  if (cleaned.startsWith(COUNTRY_CODE + '0')) {
    return COUNTRY_CODE + cleaned.slice(COUNTRY_CODE.length + 1);
  }
  if (cleaned.startsWith('+')) return cleaned;                       // STEP 2b
  if (cleaned.startsWith('0')) return COUNTRY_CODE + cleaned.slice(1); // STEP 3
  return COUNTRY_CODE + cleaned;                                     // STEP 4
}

module.exports = { normalizePhone };
