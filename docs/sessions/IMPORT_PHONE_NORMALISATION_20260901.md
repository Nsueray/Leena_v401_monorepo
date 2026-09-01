# Import Phone Normalisation — Phase 1 (Read-Only, No Code)

**Date:** 1 Sep 2026, 17:50 UTC
**Scope:** todo #4 (P1) — accept any Excel/agency phone shape, store one
consistent format. Root cause of three failed agency files is G21 (Excel
stores phones as JS numbers → `.trim()` crashes).

**Rules for this doc:** read-only, evidence-cited, decision points named
explicitly with trade-offs. **No code, no diff, no writes.** Suer decides
scope before Phase 2 begins.

**DB pre-flight:** `psql "$RENDER_DATABASE_READONLY_URL" -c 'SELECT 1'` →
`1 row`. DB reachable.

---

## 1. What exists today — the phone touch-map, with `path:line`

### Existing normalizer

`utils/phoneNormalize.js:36-45` — `normalizePhone(raw)`, pure function.

- Line 9: `const COUNTRY_CODE = '+234'; // Nigeria` — **module-level constant, single country**.
- Line 24: STEP 1 strips `[\s\-\(\)\.]` from the input.
- Line 28: STEP 2a — if starts with `+234` + embedded `0` → drop the 0.
- Line 32: STEP 2b — if already starts with `+` → leave as-is.
- Line 33: STEP 3 — if starts with `0` → prefix `+234`.
- Line 34: STEP 4 — otherwise → prefix `+234`.
- Line 25: STEP 5 — null/empty → `''`.

**Documented known limitations** (lines 12-23 comment block):
- STEP 3 strips only one leading `0` — `00` international prefix would be
  malformed after normalisation.
- STEP 2a only fixes `+CC + 0` for the module's own country code, not others.
- Short/junk numbers not handled — flagged as separate data-quality issue.

### Every place phone is READ, TRANSFORMED, or WRITTEN

| # | path:line | Path | Coerces to string? | Normalises? | Notes |
|---|---|---|---|---|---|
| 1 | `routes/visitors.js:9` | require import | — | — | pulls `normalizePhone` in |
| 2 | **`routes/visitors.js:712`** | `/api/visitors/import` — READ | **NO** | NO | `const phone = row.phone \|\| row.Phone \|\| … \|\| ''` — accepts numeric from XLSX untouched |
| 3 | **`routes/visitors.js:788`** | `/api/visitors/import` — WRITE (existing visitor UPDATE) | `.trim()` | NO | **G21 CRASH SITE** — if `phone` is a JS number, `phone.trim()` throws → per-row `catch` at `:962` marks row `failed_count++` |
| 4 | `routes/visitors.js:884` | `/api/visitors/import` — WRITE (new visitor INSERT) | `.trim()` | NO | Same crash pattern (verified via read; new-visitor branch also does `phone.trim()`) |
| 5 | `routes/visitors.js:215` | `/api/visitors/public` — READ from JSON body | N/A (JSON is always string) | NO | `custom_fields?.phone \|\| .mobile \|\| .Mobile` |
| 6 | `routes/visitors.js:307` | `/api/visitors/public` — WRITE existing (UPDATE) | via `COALESCE(NULLIF)` | NO | Passes `visitorData.phone` verbatim |
| 7 | `routes/visitors.js:340` | `/api/visitors/public` — WRITE new (INSERT) | verbatim | NO | Same |
| 8 | `routes/visitors.js:149` `:173` | `PUT /api/visitors/:id` (manual edit) | via `COALESCE(NULLIF)` | NO | UI-driven, trusted-string |
| 9 | `routes/visitors.js:1075` | `GET /api/visitors/export` — export CSV `Phone` column | — | NO | Raw column dump |
| 10 | **`routes/visitors.js:1076`** | `GET /api/visitors/export` — export CSV `Phone (WhatsApp)` column | — | **YES** — calls `normalizePhone(r.phone)` | The **only** read-site that normalises today |
| 11 | `routes/webhook.js:57` | `POST /api/webhook/zoho/:org/:expo/:form` — READ from JSON body | N/A (JSON) | NO | `req.body.phone ?? req.body.mobile ?? req.body.Mobile ?? ''` |
| 12 | `routes/reactivation.js:197` | `POST /api/reactivation/create-from-excel` — READ | **YES** — `.toString().trim()` | NO | Crash-safe path; produces messy but stored data |
| 13 | `routes/reactivation.js:112,123` | Reactivation token INSERT | verbatim | NO | |
| 14 | `routes/reactivation.js:669` | `POST /api/reactivation/activate` — visitor row from token | verbatim | NO | |

**Read the map like this:** exactly one path today (**#3 / #4**, the primary
Excel import) is unguarded against numeric cells and produces the G21 crash
that killed three agency files. The reactivation Excel path (**#12**) had
the same class of risk historically and was already guarded with
`.toString().trim()` — that fix pattern already exists in-repo.

**Only one write-time normalisation site exists today: the export column
`Phone (WhatsApp)`** at `visitors.js:1076`. The stored `visitors.phone`
column is the raw string as received.

---

## 2. DB profile — real counts, no estimates

All figures from live prod DB (`RENDER_DATABASE_READONLY_URL`) on 2026-09-01
17:50 UTC. Every value is `COUNT(*)::int`, no sampling.

### Baseline

| Metric | Rows |
|---|---|
| `visitors` total rows | 70,092 |
| `phone` column non-null | 68,706 |
| `phone` non-empty after `TRIM` | **64,325** |
| `phone` null | 1,386 |
| `phone` empty string after trim | 4,381 |

All shape stats below are against the **64,325 non-empty** rows.

### Shape classification (mutually non-exclusive except where noted)

| Shape | Count | % of non-empty |
|---|---|---|
| Starts with `+` (partially or fully normalised) | 24,211 | 37.6% |
| Starts with `00` (international access code prefix) | 456 | 0.7% |
| Digits only, no `+`, no separator | 38,293 | 59.5% |
| Contains whitespace | 2,970 | 4.6% |
| Contains `-` (dash) | 857 | 1.3% |
| Contains `(` or `)` | 32 | 0.05% |
| Contains `.` | 48 | 0.07% |
| Contains other non-standard chars | 28 | 0.04% |
| Rows with leading/trailing whitespace | 31 | 0.05% |

### Length distribution

| Bucket | Rows |
|---|---|
| < 7 (very short — data-quality junk) | 9 |
| 7–9 | 488 |
| **10–11 (local-number sweet spot: `0XXXXXXXXX` / `0XXXXXXXXXX`)** | **36,548** |
| 12–13 | 7,646 |
| **14 (`+CCXXXXXXXXXX`)** | 14,501 |
| 15–17 (`+CC` + space/dash separator, or `+CC0…` trunk-zero) | 4,926 |
| > 17 (very long — junk or heavy separator use) | 207 |
| **Overall: min=3, max=29** | |

### Trunk-zero pattern — the "already-in-DB malformed" set (todo #13 said 840; actual is 6× that)

The pattern `+CC0…` (country code followed immediately by a local trunk zero)
occurs when an agency joined `+234` to a local number that still had its
leading `0`. The result looks correct to the eye but is not dialable.

| Pattern | Total rows | Split by expo |
|---|---|---|
| `+2340…` (Nigeria trunk zero) | **3,142** | expo 3=505 · expo 7=1,540 · expo 8=19 · **expo 13=1,057** · expo 1=13 · expo 5=6 · expo 6=1 · expo 9=1 |
| `+2120…` (Morocco trunk zero) | **900** | **expo 1=894** · expo 5=1 · expo 7=2 · expo 9=1 · expo 13=2 |
| `+2330…` (Ghana trunk zero) | **813** | **expo 5=794** · expo 6=15 · expo 1=2 · expo 13=2 |
| `+2540…` (Kenya trunk zero) | 2 | (both small-test rows) |
| **Any `+CC0…`** | **5,148** | across 9 expos |

**Todo #13 is stale — the real count is 5,148, not 840.** The 840 figure
probably captured a single expo at a point in time. Any backfill discussion
must use 5,148 as the actual scope.

### The dominant class: digits-only local numbers

38,293 rows are digits-only, no `+`. Their first-digit distribution:

| First digit | Rows |
|---|---|
| `0` | **35,266** |
| `2` | 1,432 |
| `8` | 618 |
| `6` | 324 |
| `7` | 278 |
| `9` | 186 |
| Others (1, 3, 4, 5) | 189 |

**35,266 rows begin with a literal `0`** — these are almost all Moroccan
(`06XXXXXXXX`), Nigerian (`08XXXXXXXXX`), Ghanaian (`02XXXXXXXX`) local
numbers, cell shape depending on carrier. The current normaliser at
`phoneNormalize.js:33` would prepend `+234` to ALL of them regardless of
which expo/country they belong to — wrong for the ~1,000+ Moroccan rows on
expo 1 and the ~800+ Ghanaian rows on expo 5.

### Junk observed (small counts, real)

- `xxxxxxxxxx` — agency placeholder: **12 rows**. Should be dropped, not
  normalised.
- Unicode directional marks (`U+202A` LEFT-TO-RIGHT EMBEDDING, `U+202C` POP
  DIRECTIONAL FORMATTING) embedded inside phone strings: **3 rows** (one
  observed sample: `‪+212 712‑059792‬`, also includes a non-standard
  hyphen `U+2011`).

### Sample rows per shape (from live DB)

```
starts_00           : 00212636505612 (expo 1, Morocco)
digits_only 10      : 0654864997 (expo 1), 0711512828 (expo 9), 08067781379 (expo 13)
digits_only 11      : 08067781379 (expo 13, Nigeria)
trunk_zero_nigeria  : +23407047009707 (len 15, expo 3), +23408088762928 (len 15, expo 3)
trunk_zero_morocco  : +2120633787189 (len 14, expo 1), +21206 64 36 03 54 (len 18, expo 1)
has_whitespace      : "+48 690 901 098" (expo 9), "+33 7 56 97 31 01" (expo 1), "0802 462 4791" (expo 3)
has_dash            : "0607-148807" (expo 1), "+212 661-712943" (expo 1), "+2120602-894368" (expo 1)
```

### The expo→country situation

`expos.country_code CHAR(2)` column exists (`\d expos` line ~19), FK to
`core_countries(code)`. **All 17 rows have `country_code = NULL`** —
`SELECT id, name, country_code FROM expos ORDER BY id` returns empty
values for every expo. The column exists but is not populated.

`core_countries` is a lookup table with only two columns: `code CHAR(2)`,
`name VARCHAR(100)`. **No dialing_code column.** So even if `country_code`
were populated, there's no in-schema way to map `NG` → `234`.

This matters for §5 option A below.

---

## 3. Proposed normalisation rules — table + worked examples

**Applied in order, first match wins.**

The design uses the **expo's country** as the source of truth for the
default dialing code (per §5 option A, which I'll recommend as the primary
answer). The country→dialing map lives as a small module constant since
`core_countries` has no dialing_code column.

| # | Input shape (raw cell) | Detection rule | Stored output | Worked example |
|---|---|---|---|---|
| 0 | Excel numeric cell | `typeof raw === 'number' \|\| (typeof raw === 'bigint')` | Coerce with `String(raw)`, then continue below | XLSX `2348012345678` (number) → `"2348012345678"` (string), then Rule 3 |
| 1 | Blank / null / undefined | `!raw \|\| String(raw).trim() === ''` | `''` (empty string) | `null` → `''`; `"   "` → `''` |
| 2 | Junk placeholder | Regex `/^x+$/i` after strip | `''` (empty string, treat as blank) | `xxxxxxxxxx` → `''`; `XXXXXX` → `''` |
| 3 | Cleanable to E.164 with `+` | After cleaning `[\s\-\(\)\.‎‏‪-‮‐‑]` → starts with `+` | Return cleaned as-is (already E.164-ish) | `"+48 690 901 098"` → `"+48690901098"`; `"‪+212 712‑059792‬"` → `"+212712059792"` |
| 4 | International access code | Starts with `00` after cleaning | Replace leading `00` with `+` | `00212636505612` → `+212636505612` |
| 5 | Trunk-zero after country code | Regex `/^\+([1-9]\d{0,2})0(\d{6,})$/` where `CC` is the leading digits | Strip the trunk `0`: `+CC + rest` | `+2340611234567` → `+234611234567`; `+2120633787189` → `+212633787189` |
| 6 | Local number, leading `0` | Starts with `0` after cleaning, and expo has a country with known dialing code | `+<dialing_code> + rest_after_zero` | On expo 13 (NG): `0801234567` → `+234801234567`. On expo 9 (MA): `0654864997` → `+212654864997` |
| 7 | Local number, no `0`, no `+` | Digits only after cleaning, length ≤ 10, expo has known country | `+<dialing_code> + digits` | On expo 13 (NG): `8012345678` → `+2348012345678`. On expo 9 (MA): `654864997` → `+212654864997` |
| 8 | Numeric-looking, long enough to already contain a country code | Digits only after cleaning, length ≥ 11 and starts with a known dialing prefix `234\|212\|233\|254\|…` | Prefix `+`, no other change | `2348012345678` → `+2348012345678`; `212611234567` → `+212611234567` |
| 9 | Fallback — anything else | Whatever survives cleaning | Return cleaned string as-is; DO NOT invent a country code | `not-a-phone` (would already have died at rule 2's junk clean) — for anything else, preserve rather than corrupt |

**All rules operate on the cleaned string.** The clean-step (used by rules
3–9) strips: whitespace `\s`, dashes `-`, parens `()`, dots `.`, and the
observed Unicode directional marks `‎‏‪-‮` and
non-standard hyphens `‐‑`.

**Deliberately NOT hidden inside the code:** rule 8's dialing-prefix list.
It's a knowable set for the expos we operate in — Nigeria 234, Morocco 212,
Ghana 233, Kenya 254, Turkey 90. Any new country needs a one-line addition
to the map. Better than surprising an ops user with a corrupt number.

### The country→dialing map (proposed as `utils/countryDialing.js`)

```
NG (Nigeria)   → 234
MA (Morocco)   → 212
GH (Ghana)     → 233
KE (Kenya)     → 254
TR (Turkey)    → 90
```

Sourced from the 5 expo countries observed in `expos.name` values. Any expo
whose `country_code` is NULL falls back to §5's decision point.

### Sample table of what rules would produce (real DB rows)

| Raw stored today | Applied rule | Output |
|---|---|---|
| `08061351061` (expo 13, NG) | 6 | `+2348061351061` |
| `+2349163938411` (expo 13) | 3 | `+2349163938411` (unchanged) |
| `0654864997` (expo 1, MA) | 6 | `+212654864997` |
| `00212636505612` (expo 1) | 4 | `+212636505612` |
| `+2120633787189` (expo 1) | 5 (trunk zero) | `+212633787189` |
| `+23407047009707` (expo 3, NG) | 5 (trunk zero) | `+2347047009707` |
| `+212 661-712943` (expo 1) | 3 (after clean) | `+212661712943` |
| `+48 690 901 098` (expo 9, foreign visitor) | 3 (after clean) | `+48690901098` |
| `xxxxxxxxxx` (expo 3) | 2 | `''` |
| `‪+212 712‑059792‬` (unicode marks) | 3 (after clean) | `+212712059792` |
| `2348012345678` (expo 13, no +) | 8 (prefix known) | `+2348012345678` |
| `+2340611234567` (Nigeria trunk zero, len 15) | 5 | `+234611234567` |

---

## 4. Numeric-cell safeguard — the G21 fix in one line

Regardless of §5's decision, **rule 0 above is unconditional**: every phone
read site must coerce the value to a string before doing anything else.
That single change closes G21.

Concrete change is a one-line prefix at each of the four unsafe sites
(**visitors.js:712** and its subsequent `.trim()` at `:788` and `:884`, and
the second `phone` read in the reactivation activate flow at
`reactivation.js:669`). The existing reactivation Excel-import fix pattern
at `reactivation.js:197` (`.toString().trim()`) is already the answer —
just applied to the sites that missed it.

---

## 5. The unresolved decision — local number, no country code

This is Suer's decision, presented here with real cost.

**The population that this affects:** ~35,000 rows starting with `0` and
digits-only. All are local numbers without a country prefix. Their correct
country cannot be inferred from the string itself — the same shape
`06XXXXXXXX` is a valid Moroccan mobile AND a valid Nigerian landline
prefix, etc.

Three options:

### Option A — use the expo's country

**Rule:** for a local number without `+`, prefix the dialing code of the
expo the row belongs to.

- **What it needs:**
  1. Backfill `expos.country_code` for all 17 rows (one-off SQL, trivial —
     I can prepare it, Suer runs). Every expo's country is obvious from
     its name (Nigeria/Morocco/Ghana/Kenya).
  2. Add a `utils/countryDialing.js` map from `code` → dialing digits (5
     entries as listed in §3).
  3. Import path fetches the expo's country_code from a single lookup
     before the per-row loop (already reads `expo_id` — one extra SELECT).
- **Trade-off (upside):** produces one consistent format. WhatsApp/SMS work
  directly from the stored column, no per-caller lookup. Solves the ~35k
  local-number rows and every future import.
- **Trade-off (downside):** wrong for the small population of
  **cross-country visitors** — a French visitor with `0612345678`
  registering on a Moroccan expo would get `+212612345678` (wrong; should
  be `+33612345678`). Real magnitude: current DB has
  `+33`/`+48`/`+49`/`+44` etc rows already stored *with the + prefix* by
  attentive uploaders — so the miscoding risk only applies to future
  no-prefix-cross-country entries. Estimated volume: single-digit rows per
  fair based on the current mix.
- **My recommendation:** this one. The downside is bounded (an ops user
  can hand-edit the rare foreign visitor via the visitor detail panel,
  which already exists per todo #9 closed), and the upside is a WhatsApp-
  ready column across ~35k rows.

### Option B — leave as-is (store `06XXXXXXXX` verbatim)

- **What it needs:** rule 6 disappears; rule 7 disappears; rule 8 stays.
- **Trade-off (upside):** zero miscoding risk. Foreign visitors are stored
  verbatim; local visitors are stored verbatim; anyone using the number
  externally has to know the visitor's country. `Phone (WhatsApp)` export
  column would need per-row country context (which today it doesn't have —
  it hardcodes `+234`, verified `phoneNormalize.js:9`).
- **Trade-off (downside):** the ~35k local numbers stay unreachable from
  export. Every WhatsApp bulk from Yaprak still has this friction.
- **When it wins:** if we ever go multi-organiser with tenants that operate
  in unpredictable countries, or if the miscoding downside is
  unacceptable. Neither is the current situation.

### Option C — flag for review

- **Rule:** rules 6+7 become "store as `+???NUMBER`" — a sentinel-prefixed
  string. Import result includes an "ambiguous" counter. An admin panel
  filter lets ops resolve them one at a time.
- **Trade-off (upside):** zero miscoding. Auditable trail.
- **Trade-off (downside):** breaks WhatsApp/SMS use of the column until an
  admin has clicked through 35,000 rows. High-touch for a low-value
  outcome. Not realistic pre-SIEMA.

---

## 6. Where this fix lands — scope statement

**Scope of change (subject to Suer's approval in §5):**

- `utils/phoneNormalize.js` — rewrite to become expo-country aware. Signature
  changes from `normalizePhone(raw)` → `normalizePhone(raw, opts)` where
  `opts.defaultCountryCode` is the ISO 3166-1 alpha-2 code (`'NG'`, `'MA'`, …).
  Backwards-compat: `opts` omitted → falls back to legacy `+234` (so
  `visitors.js:1076` export site keeps working during rollout).
- `utils/countryDialing.js` (new) — 5-line map + `dialingCodeFor(alpha2)` helper.
- `routes/visitors.js`:
  - line 712/788/884: apply rule 0 (coerce) + call normalizer with the
    expo's country. `expo_id` is already in scope (`req.body.expo_id`);
    fetch `country_code` once at top of import handler.
  - line 1076: keep working via backwards-compat.
- `routes/reactivation.js:197` and `:669`: apply normalizer with target
  expo's country. `.toString().trim()` already there; adds normalisation on top.
- `routes/visitors.js:215` (public form) and `webhook.js:57`: **out of
  scope for Phase 1 fix per Suer's brief ("import path only")**. Flag as
  Phase 1.5 if desired.

**A dedicated unit test file, `tests/test_phone_normalize.js`**, seeded
from the shape of the three failed agency files. Each of the ~20 fixture
rows carries a comment noting which agency file / which real production
row it represents.

**A pre-existing production migration is NOT part of this scope.** The
5,148 `+CC0…` rows and the ~35k local `0…` rows are separate: §7 below
lays out the dry-run SQL for them without running anything.

---

## 7. Backfill dry-run — SQL only, DO NOT RUN

**⚠️ NOT for execution. Read-only preview of what the approved normaliser
would produce against existing rows.** Run counts + before/after samples;
this SELECT does not modify data.

```sql
-- Preview 1: trunk-zero fixes (5,148 rows across 4 country patterns)
WITH candidates AS (
    SELECT id, expo_id, phone AS old_phone,
           CASE
             WHEN phone LIKE '+2340%' THEN '+234' || SUBSTRING(phone FROM 6)
             WHEN phone LIKE '+2120%' THEN '+212' || SUBSTRING(phone FROM 6)
             WHEN phone LIKE '+2330%' THEN '+233' || SUBSTRING(phone FROM 6)
             WHEN phone LIKE '+2540%' THEN '+254' || SUBSTRING(phone FROM 6)
           END AS new_phone
    FROM visitors
    WHERE phone ~ '^\+(234|212|233|254)0[0-9]+$'
)
SELECT COUNT(*)::int AS to_fix,
       COUNT(DISTINCT expo_id)::int AS across_expos
FROM candidates;

-- Sample 20 real rows before/after
SELECT id, expo_id, old_phone, new_phone
FROM (
  SELECT id, expo_id, phone AS old_phone,
         CASE
           WHEN phone LIKE '+2340%' THEN '+234' || SUBSTRING(phone FROM 6)
           WHEN phone LIKE '+2120%' THEN '+212' || SUBSTRING(phone FROM 6)
           WHEN phone LIKE '+2330%' THEN '+233' || SUBSTRING(phone FROM 6)
           WHEN phone LIKE '+2540%' THEN '+254' || SUBSTRING(phone FROM 6)
         END AS new_phone
  FROM visitors
  WHERE phone ~ '^\+(234|212|233|254)0[0-9]+$'
  ORDER BY id
  LIMIT 20
) t;
```

```sql
-- Preview 2: local-number normalisation IF Option A approved
-- Requires expos.country_code backfill first — SQL noted separately below.
-- For each row: build the target string using the expo's country code.
WITH dialing_map AS (
    SELECT * FROM (VALUES ('NG','234'),('MA','212'),('GH','233'),('KE','254'),('TR','90')) AS m(code, dial)
),
candidates AS (
    SELECT v.id, v.expo_id, v.phone AS old_phone,
           e.country_code, d.dial,
           '+' || d.dial || SUBSTRING(v.phone FROM 2) AS new_phone
    FROM visitors v
    JOIN expos e ON e.id = v.expo_id
    JOIN dialing_map d ON d.code = e.country_code
    WHERE v.phone ~ '^0[0-9]{8,11}$'
      AND e.country_code IS NOT NULL
)
SELECT COUNT(*)::int AS to_fix,
       COUNT(DISTINCT expo_id)::int AS across_expos,
       COUNT(*) FILTER (WHERE country_code='NG')::int AS ng,
       COUNT(*) FILTER (WHERE country_code='MA')::int AS ma,
       COUNT(*) FILTER (WHERE country_code='GH')::int AS gh
FROM candidates;
```

```sql
-- Preview 3: expos.country_code backfill (17 rows, static)
-- Not for execution here — one-time SQL to prepare Option A.
UPDATE expos SET country_code = 'NG' WHERE id IN (3, 7, 8, 13, 14);
UPDATE expos SET country_code = 'MA' WHERE id IN (1, 9);
UPDATE expos SET country_code = 'GH' WHERE id IN (2, 4, 5, 6);
UPDATE expos SET country_code = 'KE' WHERE id IN (10, 12);
-- expos 11, 15, 16, 17 are test/placeholder — leave NULL.
```

**None of the SQL above has been executed. It's here for Suer to review
alongside the normalisation rules before deciding Option A/B/C.**

---

## 8. Summary — what Suer is being asked to approve before Phase 2

1. **Rule 0** (coerce numeric cells to string) — closes G21. Non-controversial.
2. **Rules 1–5, 8, 9** (blank/junk/international-prefix/trunk-zero/prefixed-digits) — deterministic, no country context needed. Non-controversial.
3. **Rules 6, 7** (local-number-no-country-code) — depend on §5 decision:
   - **Option A (recommended)** — use expo's country; needs a 17-row
     `expos.country_code` backfill and a 5-entry dialing-code map.
   - **Option B** — leave as-is.
   - **Option C** — flag for review (not realistic pre-SIEMA).
4. **Scope of code change** — import path only (`visitors.js:712/788/884`
   and `reactivation.js:197/669`), plus new `utils/countryDialing.js`.
   Backwards-compat kept for `visitors.js:1076` export.
5. **Regression test scaffold** — `tests/test_phone_normalize.js` seeded
   from the three failed agency files' shape.
6. **Backfill (todo #13)** — NOT bundled. Dry-run SQL provided above for
   Suer to review separately later.

**Decisions Suer needs to make:**

- Option A / B / C for §5.
- Whether to include public-form (`visitors.js:215`) and Zoho webhook
  (`webhook.js:57`) sites in the same PR, or defer as Phase 1.5.
- Whether to bundle the `expos.country_code` backfill SQL with the code
  change or run it separately (recommend: bundle, because Option A needs
  it to work).

**STOP. No code, no diff, no writes. Awaiting Suer's approval.**
