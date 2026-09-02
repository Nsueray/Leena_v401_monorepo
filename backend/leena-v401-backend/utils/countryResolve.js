// utils/countryResolve.js
//
// Row-country fallback for phone normalisation (Sep 2026, Decision B).
//
// Resolution order for a phone that does NOT start with '+' (or '00'):
//   (1) the row's own country column (2-letter code direct, else name lookup)
//   (2) the expo's country_code
//   (3) null  → normaliser rejects with "no country context"
//
// A leading '+' always wins upstream (libphonenumber-js ignores the default
// country when the input carries one). This module is only relevant for
// local-shape numbers.
//
// Country name → 2-letter ISO code is derived from public.core_countries
// (230 rows verified 2 Sep 2026: Turkey→TR, Nigeria→NG, Morocco→MA,
// Ghana→GH, Kenya→KE all resolve directly). Case-insensitive + trimmed
// match. Unmatched raw strings are surfaced to the caller so ops can spot
// aliases in the wild (e.g. `MAROC` appears 22× in prod visitors.country
// but not in core_countries.name) — no hand-written alias table.

let _countriesCache = null;

/**
 * Load (and cache) core_countries as a Map<lowercase_name, ISO2>.
 * Cached at module scope — 230 rows, changes rarely; a DB add requires
 * Render Shell access which only Suer has, and a Node restart invalidates
 * the cache. Acceptable.
 */
async function getCoreCountriesMap(pool) {
    if (_countriesCache) return _countriesCache;
    const r = await pool.query(`SELECT code, name FROM core_countries`);
    const map = new Map();
    for (const row of r.rows) {
        // Store lowercase, trimmed. Also store the ISO code as its own key
        // so a "NG" written in the name column would still map to itself.
        map.set(String(row.name).toLowerCase().trim(), row.code);
    }
    _countriesCache = map;
    return map;
}

/**
 * resolveCountry(rowCountry, expoCountry, countriesMap)
 *   → { code, matched_by, unmatched_raw? }
 *
 * matched_by is:
 *   'row_direct' — rowCountry was already a valid 2-letter ISO code (e.g. "NG")
 *   'row_name'   — rowCountry matched a country name (e.g. "Nigeria" → NG)
 *   'expo'       — rowCountry missing/blank/unmatched, fell through to expo
 *   null         — nothing resolved
 *
 * unmatched_raw is set (trimmed, ≤80 chars) ONLY when a non-blank
 * rowCountry failed to resolve and we fell through. Caller can aggregate
 * these across the batch and surface the top-N in the job result for
 * ops-side alias learning.
 */
function resolveCountry(rowCountry, expoCountry, countriesMap) {
    const raw = rowCountry == null ? '' : String(rowCountry).trim();
    if (raw) {
        // (1a) Already a 2-letter ISO code? Accept directly; upper-case for
        //      libphonenumber-js consistency.
        if (/^[A-Za-z]{2}$/.test(raw)) {
            return { code: raw.toUpperCase(), matched_by: 'row_direct' };
        }
        // (1b) Case-insensitive name match against core_countries.
        const code = countriesMap.get(raw.toLowerCase());
        if (code) {
            return { code, matched_by: 'row_name' };
        }
        // Non-blank + unmatched — record for ops surfacing, then fall to (2).
        return {
            code: expoCountry || null,
            matched_by: expoCountry ? 'expo' : null,
            unmatched_raw: raw.slice(0, 80)
        };
    }
    // Blank / null row country → (2)
    return {
        code: expoCountry || null,
        matched_by: expoCountry ? 'expo' : null
    };
}

/**
 * Reset the module-level cache — used by tests that mutate core_countries.
 * Production code should never call this.
 */
function _resetCache() {
    _countriesCache = null;
}

module.exports = { getCoreCountriesMap, resolveCountry, _resetCache };
