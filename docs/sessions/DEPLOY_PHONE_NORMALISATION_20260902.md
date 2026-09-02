# Deploy — Phone import normalisation (todo #4)

**Date:** 2 Sep 2026
**Commits:** `2664ead` (main deploy) · `14d7ff8` (import smoke response-shape fix) · `2a1e48f` (reactivation smoke)
**Scope:** import path only — `routes/visitors.js:712/788/884` and `routes/reactivation.js:197/669`. Public form + Zoho webhook are Phase 2 (todo item #14).

Closes G21 (Excel numeric-cell phones crashing `.trim()` and killing the whole
import batch — three agency files lost) with one consistent storage format
(E.164, `+CCXXXXXXXXX`) at every import write site. Design decisions locked
in `docs/sessions/IMPORT_PHONE_NORMALISATION_20260901.md`; deploy record follows.

---

## 1. What shipped (in order)

| commit | UTC | files | net |
|---|---|---|---|
| `fbd18c8` | 1 Sep 20:36 | `CAMPAIGN_WIZARD_PLAN` + `CAMPAIGN_UI_DESIGN` | +6 / −4 (doc citation fix, Suer catch — `reactivation.js:133/346/380/440`, not the stale `:26-35`) |
| `50660e6` | 2 Sep 06:19 | `CLAUDE.md` | +4 (DB access quick-reference — two-command block to end G4 rediscovery) |
| **`2664ead`** | **2 Sep 09:00** | **9 files** | **+666 / −65** |
| `14d7ff8` | 2 Sep 09:15 | `tests/test_import_phone_smoke.js` | +104 / −68 (response-shape fix — my assertion read `body.results.*`, actual shape is top-level per `routes/visitors.js:1018-1022`) |
| `2a1e48f` | 2 Sep 09:41 | `tests/test_reactivation_phone_smoke.js` (new) | +248 (silent-mode verification since `reactivation-campaign.html:278` marks template `required`) |

Deploy of `2664ead`: pushed `09:00:06 UTC`, service healthy at `09:03:46 UTC`,
no visible 502 window in my poll (Render likely did a zero-downtime rollover
or the window fell between 4-second polls). Endpoint sanity confirmed: `POST
/api/visitors/import` unauth → 401 in 274 ms; `POST /api/reactivation/activate`
empty → 400 "Token is required" (new fail-open code path reachable).

## 2. `2664ead` — the main change

### 2.1 `utils/phoneNormalize.js` (154 → 194 lines)

Ambidextrous export:
- `normalizePhone(raw)` — legacy string return, hardcoded `+234` — **preserved
  verbatim** for `routes/visitors.js:1076` export CSV column.
- `normalizePhone(raw, defaultCountry)` — new strict mode returning
  `{ ok, e164, reason }`.

Wrapper rules (both measured against `libphonenumber-js@1.13.12`, MIT, zero deps):

- **(a) Empty/null → `{ ok:true, e164:'' }` BEFORE calling the library.**
  `parsePhoneNumberFromString('')` returns undefined; catching it here keeps
  the current empty-preservation contract at every write site (see report §1b).
- **(b) Trunk-zero retry.** If the first parse is invalid AND the cleaned
  input matches `/^\+\d{1,3}0\d{6,}$/`, strip that single 0 and parse once
  more; accept ONLY if the retry is valid. Never blind. Measured:
  `+2340801234567 NG` → invalid → retry `+234801234567` valid; `+2120633787189 MA` →
  library already fixes it, retry never runs; `+2340611234567 NG` (bogus
  6-prefix) → both first parse AND retry invalid → correctly stays rejected.

Additional preprocessing:
- `00XXXXXXX…` folded to `+XXXXXXX…` (E.123 international prefix — library
  doesn't do this on its own).
- Junk placeholder `/^x+$/i` → `{ ok:true, e164:'' }` (agency Excel column
  placeholder — 12 rows in prod).
- Cleaning strips whitespace, dashes, parens, dots, plus observed Unicode
  direction marks (`U+202A-E`) and non-standard hyphens (`U+2010`, `U+2011`).
- No default country AND no leading `+` → `{ ok:false, reason:'no country context …' }`.

### 2.2 Wiring — the five sites

| # | site | change |
|---|---|---|
| 1 | `routes/visitors.js:641-656` | fetch `expo.country_code` once alongside expo name |
| 2 | `routes/visitors.js:712-732` (import row loop) | replace unguarded `phone.trim()` with `normalizePhone(rawPhone, expoCountryCode)`; on `!ok` push `{ row, raw_value, message: "Phone rejected: …" }` into `results.errors`, increment `failed_count`, `continue`. G21 crash class closed. |
| 3 | `routes/visitors.js:788` (existing-visitor UPDATE) | `phone.trim()` → `phone` (already E.164) |
| 4 | `routes/visitors.js:884` (new-visitor INSERT) | same |
| 5 | `routes/reactivation.js:181-217` (`prepareExcelRows`) | new `defaultCountry` parameter; new `skipped_invalid_phone` counter; `invalid_phone_samples` capped at 3 with Excel row number. Row REJECTED on `!ok` — matches primary-import policy. |
| 6 | `routes/reactivation.js:673-708` (`/activate`) | fetch target expo's `country_code`; **FAIL-OPEN** on `!ok` (store `''` phone, log `console.warn`, still create visitor); INSERT widened to 16 columns with `$16::jsonb custom_fields` — NULL on success, `{ phone_raw:'<≤80 chars>', phone_reject_reason, phone_rejected_at }` on failure, atomic with the INSERT (A-1). |

### 2.3 Response shape + UI

- `POST /api/visitors/import` — spreads counters at top level:
  `{ success, message, success_count, new_count, updated_count, failed_count,
    skipped_count, email_sent_count, qr_regenerated_count,
    custom_fields_updated_count, imported, errors }` at
  `routes/visitors.js:1018-1022`. Consumed by `public/import.html:440-459` unchanged.
- `POST /api/reactivation/create-from-excel` — 202 response returns
  `skipped_invalid_phone` + `invalid_phone_samples` at top level; log line at
  the same handler prints "invalid phone samples (up to 3)".
- `public/reactivation-campaign.html` — new 4th `results-item` div "Invalid
  Phone (Skipped) N (rows X, Y, Z)" populated in BOTH the async immediate
  path (`:865-880`) AND the legacy sync fallback (`:918-928`). **See §5 for
  the caveat about how this line was verified.**

### 2.4 Tests added — no CI yet, all standalone

| file | what it does |
|---|---|
| `tests/test_phone_normalize.js` | 42 unit fixtures across 6 groups (agency shapes / real prod rows from report §3 / empty preservation / rejections / legacy 1-arg / idempotency). `42 passed, 0 failed` locally. |
| `tests/test_import_phone_smoke.js` | 3-row xlsx-in-memory POST to `/api/visitors/import`. Idempotent (fixed test emails; reruns hit UPDATE path, still count as success). Prints ALL 11 top-level counters BEFORE asserting. Status check BEFORE `.json()` (G25). Cleanup SQL emitted on pass AND fail. Saves `/tmp/phone_smoke.xlsx` for the reactivation test. |
| `tests/test_reactivation_phone_smoke.js` | POST to `/api/reactivation/create-from-excel` with **no template_id**. 202 assertions + poll `/job/:id` until `completed` + 2 read-only DB checks (2 tokens created; 0 `email_queue` rows since job-start snapshot — silent mode confirmed). |

---

## 3. Verification — 2 Sep, on trash expo 17

Ran three verifications in order. Every assertion measured, not inferred.

### 3.1 Unit — `test_phone_normalize.js`

`42 passed, 0 failed`. Full run:
```
=== Agency-file shapes (G21 crash class)         → 5 pass
=== Real production samples (report §3)          → 17 pass
=== Empty inputs — preserved as empty            → 6 pass
=== Rejections — must come back ok:false         → 5 pass
=== Legacy 1-arg mode                            → 6 pass
=== Idempotency                                  → 2 pass
Result: 42 passed, 0 failed
```

Bonus catch during test-writing: `0654864997` is a valid Moroccan mobile
prefix but NOT a valid Ghanaian one (Ghana mobiles start with 2/3/5, not 6).
Library correctly rejects it under GH context — test asserts explicitly so
future readers see the plan-vs-country distinction is real.

### 3.2 Import smoke — `test_import_phone_smoke.js` (Suer, 09:26 UTC)

```
Response in 472ms, status=200
Top-level response counters:
  success           = true
  message           = "Import completed: 2 new, 0 updated, 1 failed"
  success_count     = 2
  new_count         = 2
  failed_count      = 1
  errors            = [ { row: 4, raw_value: "12ab",
                          message: "Phone rejected: invalid phone number for country NG: \"12ab\"" } ]
  imported (count)  = 2
Assertions:
  ✓ body.success === true
  ✓ body.success_count === 2 (row1 numeric-cell + row2 xxxxxxxxxx — got 2)
  ✓ body.failed_count === 1 (row3 "12ab" rejected — got 1)
  ✓ body.errors[] populated
  ✓ body.errors[0].message starts with "Phone rejected"
✅ ALL ASSERTIONS PASSED
```

**Read-only DB verification of stored values** (Suer requested; assertion
only checked counts):

| id | email | stored `phone` | `custom_fields` |
|---|---|---|---|
| 71312 | `smoke-phone-1@leena-test.local` | **`+2348012345678`** | `{}` |
| 71313 | `smoke-phone-2@leena-test.local` | **`` (empty)** | `{}` |

Row 1 numeric-cell (`2348012345678`) landed as E.164 `+2348012345678` exactly.
Row 2 `xxxxxxxxxx` preserved as empty. `custom_fields = {}` on both because
the import path doesn't hit the A-1 fail-open trace — that fires only on
`/activate`.

### 3.3 Reactivation silent-mode smoke — `test_reactivation_phone_smoke.js` (Suer, 09:47 UTC)

```
202 response body:
  success                = true
  job_id                 = 33
  total                  = 3
  valid                  = 2
  skipped                = 1
  skipped_invalid_phone  = 1
  invalid_phone_samples  = [ { row: 4, email: "smoke-phone-3@leena-test.local",
                               raw: "12ab",
                               reason: "invalid phone number for country NG: \"12ab\"" } ]
Assertions on 202 body:
  ✓ body.success === true
  ✓ body.job_id present (33)
  ✓ body.skipped_invalid_phone === 1
  ✓ body.invalid_phone_samples[0].row === 4
  ✓ body.valid === 2
Polling /api/reactivation/job/33 ...
  [09:47:27Z] status=completed processed=2/3
DB assertions (read-only):
  ✓ exactly 2 reactivation_tokens created for smoke emails
  ✓ zero email_queue rows on expo 17 since job start — silent mode confirmed
✅ ALL ASSERTIONS PASSED
```

Silent-mode guard chain (`reactivation.js:133 if (emailTemplate)` + `:346` +
`:440` + `:380`) held: no `template_id` in the POST body → zero
`email_queue` INSERTs — the exact property the wizard needs to rely on.

### 3.4 Real-file verification — `Meta Pixad 3.xlsx` (Suer, `import.html`, 09:32 UTC)

The load-bearing test. This file previously ate a whole import when the same
agency uploaded it, twice, in Aug. File shape measured by Suer's side: **261
data rows, phone cell types `int=259 / None=1 / str=1`.**

Same file, same expo pattern, same import handler — before vs after the
Sep 2026 rewrite:

| Date | Expo | Result | Errors |
|---|---|---|---|
| **26 Aug 15:35 UTC** | 13 (Nigeria MP) | **`0 new, 145 errors`** | G21 numeric-cell crashes across the batch — the whole flow choked on `.trim()` |
| **2 Sep 12:32 IST (09:32 UTC)** | 17 (trash bridge, `country_code='NG'`) | **`259 successful, 2 failed — 259 new · 0 updated`** | `Row 203: Invalid or missing email: "" ` (fully empty row) · `Row 204: Phone rejected: invalid phone number for country NG: "telefon_numarası"` (Turkish header row inside the data — column headers repeated) |

**Whole-batch phone-shape audit on all 259 successful rows** (single query,
DB-side):

```
 total | starts_+234 | empty | null_phone | other_non_e164
-------+-------------+-------+------------+----------------
   259 |         259 |     0 |          0 |              0
```

Every phone stored as `+234…` E.164. Zero exceptions. 259 of 259.

**Cost of the file to the batch as a whole:** two rows lost (both genuinely
unusable — empty email + Turkish header row), zero cost to the other 259.
Compare 26 Aug where 145 rows were lost to G21 alone.

10-row sample of stored phones:

```
  id   |       name       |           email            |     phone
-------+------------------+----------------------------+----------------
 71314 | Olusoga          | odebunmiolusoga@gmail.com  | +2349061292408
 71315 | Sodiq Olamilekan | omotoshosodiq88@gmail.com  | +2348037643118
 71316 | Ibrahim          | ibrahim.gabar@yahoo.com    | +2348155559814
 71317 | Otti             | chibuezegodson16@gmail.com | +2347051327737
 71318 | Onah             | bishopikenna855@gmail.com  | +2348068544311
 71319 | Babatunde        | eddycima@yahoo.com         | +2348060704454
 71320 | Huzaifa          | houzeifer@gmail.com        | +2348138948346
 71321 | Makinde David    | makjay.mj@gmail.com        | +2347012219945
 71322 | Isola            | isolasamsudeen@gmail.com   | +2348132107926
 71323 | Mudashiru        | khadijaholujide@gmail.com  | +2348037563375
```

---

## 4. Batch↔visitors linkage — an audit finding, not a bug

For the 259-row cleanup after verification, we needed to identify which
visitor rows came from the Pixad batch. Finding: the `visitors` table has
**NO `import_id` / `batch_id` / `log_id` FK column**. The only link between
an `import_logs` entry and its resulting rows is a **`created_at` time
window** correlated to the log's own `created_at`.

For this batch: `import_logs.id=49, created_at=2026-09-02 09:32:13.244914+00`.
Visitor rows `71314–71572` landed between `09:32:12.685` and `09:32:13.243`
(a 0.56-second window ending ~1 ms before the log row was written). All
carry `origin='massimport'` and `source='Nigeria Mega Project Expo 2026
Visitor Registration - Pixad'` — the belt-and-suspenders predicate combined
`expo + origin + source + narrow created_at window` for the cleanup.

**Not a blocker; noted as an operational awareness item.** If any future
work needs to attribute visitors back to their import log, the current
linkage model requires a time-window join. A proper `import_log_id` column
on `visitors` would be a schema addition — out of scope here, deferred.

---

## 5. Reactivation UI 4th line — verified by code review only

`reactivation-campaign.html:278` marks the campaign template `<select>` as
`required`. This makes it structurally impossible to POST
`/api/reactivation/create-from-excel` without a `template_id` from the UI.
The wizard closes this gap (todo #1); until then, the silent-mode path is
backend-only.

The 4th results-line ("Invalid Phone (Skipped) N (rows X, Y, Z)") was added
in the deploy at both DOM populators:

- Async immediate path — `public/reactivation-campaign.html:875-879`
  (reads `data.skipped_invalid_phone` + `data.invalid_phone_samples[i].row`)
- Legacy sync fallback — `:925-929` (reads
  `data.results.skipped_invalid_phone` + `data.results.invalid_phone_samples[i].row`)

Both were **verified by code review only**. Live UI execution of the line
requires either a template select (which triggers no-template exercising),
or a UI change to lift the `required` — neither shipped here. The backend
smoke `tests/test_reactivation_phone_smoke.js` fully covers the endpoint's
behaviour that these DOM populators read; the DOM populators themselves are
one-liner reads from a JSON body whose shape is asserted end-to-end.

---

## 6. Cleanup executed (Suer, Render Shell)

Single BEGIN/COMMIT transaction. Precount `259` → three DELETEs → three
zero-count verifications → COMMIT. Left in place as advised:

- `import_logs` rows 47 (`smoke_phone.xlsx`), 48 (`phone_smoke.xlsx`),
  49 (`Meta Pixad 3.xlsx` — log says `259 new`, visitors gone — accurate
  archaeology, not a bug).
- `import_jobs` row 33 (silent-mode smoke, `status='completed'`,
  `processed=2, failed=0` — historical audit).

`import_jobs` has no FK from any other table (`\d import_jobs` "Referenced by"
is empty) — deleting the tokens does not orphan anything downstream.

---

## 7. Config drift

None. This deploy touched:
- `package.json` + `package-lock.json` (add `libphonenumber-js@1.13.12`)
- `utils/phoneNormalize.js` (rewritten)
- `routes/visitors.js` (import block only)
- `routes/reactivation.js` (`prepareExcelRows` + `/activate`)
- `public/reactivation-campaign.html` (4th results-item + populators)
- `todo.md` (updates only)

Not touched: `index.js`, middleware, DB pool config, other routes,
`utils/email.js`, `email_worker.js`. No new environment variables, no
schema change (`custom_fields` was already a nullable JSONB column on
`visitors`), no migration file. Fully idempotent — rerunning the wire diff
against the pre-deploy code would produce the same result.

---

## 8. Known follow-ups from this deploy

- **todo #14 (P2)** — extend the normaliser to `routes/visitors.js:215`
  (public form submit) + `routes/webhook.js:57` (Zoho). Deferred 1 week
  minimum — see item note.
- **todo #16 (P3, NEW)** — swap check order in the import loop
  (`routes/visitors.js:712-732`). Currently phone runs before email; row 204
  in the Pixad test was reported as `Phone rejected: …` when its email was
  also blank. Email is the primary key and should be flagged first.
  Cosmetic — the row still fails either way — but the ops-facing message is
  misleading.
- **todo #13 count corrected 840 → 5,148** during Phase 1 measurement
  (`IMPORT_PHONE_NORMALISATION_20260901.md §2`). Dry-run SQL for that
  cleanup exists in the same doc §7; **not run** — Suer's call.

---

## 9. Summary

- Design (`IMPORT_PHONE_NORMALISATION_20260901.md`) → Step 2 code
  (`2664ead`) → smoke fix (`14d7ff8`) → reactivation smoke (`2a1e48f`)
  → three verifications pass → cleanup runs clean → close.
- **G21 closed. 259 real agency rows imported vs 145 lost on the same file
  eight days earlier. Zero exceptions in the E.164 shape audit.**
- Public form + Zoho webhook explicitly deferred as Phase 2 — one-week
  soak on the import deploy first.

---

## Addendum — Decision B, 2 Sep 2026

Landed the same day (commit `9d868e3`) after the first-pass verification
proved the pipeline works. Two refinements on top of `2664ead`. **Todo #4
remains CLOSED — this is a scope refinement of the shipped work, not a
reopen.** For sections 1–9 above, treat any behaviour statement about
"row rejection on invalid phone" as superseded by §B-1 below.

### B-1. What changed — drop-phone-not-row + warnings + amber UI

The 2 Sep first pass rejected a whole row when its phone was unfixable
(pushed to `results.errors`, incremented `failed_count`, `continue`). That
was overzealous — the phone is optional metadata on almost every import
Leena runs. Decision B: **unfixable phone now drops the phone (stored as
`''`), row still imports.**

| Path | Before Decision B | After Decision B |
|---|---|---|
| `routes/visitors.js` import row loop | Row → `errors[]`, `failed_count++`, `continue` | Row → `warnings[]`, `warning_count++`, `phone=''`, row IMPORTS (`success_count++`) |
| `routes/reactivation.js` `prepareExcelRows` | Row skipped (`skipped_invalid_phone`) | Token created with `phone=''` (`phone_dropped++`, `phone_dropped_samples[]`) |
| `routes/reactivation.js` `/activate` | Already fail-open (A-1 trace) | Behaviour unchanged; resolver order added |

**UI:** `import.html` renders warnings in an amber `.result-item` right
after the errors block, same `Row N: message` pattern (`import.html:452-453`
style). `reactivation-campaign.html`'s 4th line is renamed
**"Phone dropped"** and both populators (async immediate + legacy sync
fallback) read the new field names.

### B-2. Country resolution order for a local number

For a phone that does NOT start with `+` or `00`:

1. **Row's own `country` column** — 2-letter ISO code accepted directly
   (case-insensitive), otherwise case-insensitive + trimmed match against
   `core_countries.name` (230 rows verified in prod: Turkey→TR, Nigeria→NG,
   Morocco→MA, Ghana→GH, Kenya→KE all resolve directly).
2. **`expos.country_code`** — the fallback used pre-Decision-B for every row.
3. **Null** → normaliser rejects with `"no country context"`.

A leading `+` or `00` always wins upstream — the library ignores the
default country when the input carries one. `utils/countryResolve.js`
(new, +92 lines) loads the country map once per Node process (module-scope
cache) and returns `{code, matched_by, unmatched_raw?}` per row. Unmatched
non-blank strings are aggregated across the batch and surfaced as the
top-5 in `unmatched_countries_top5` on both the import response and the
reactivation 202 response. This is the ops-alias-learning surface —
first candidate we already know: `MAROC` appears **22× in prod
visitors.country** but not in `core_countries.name`.

The same resolution order applies inside `/activate` using
`tokenData.country` as (1).

### B-3. Verification on production, 2 Sep (Suer, trash expo 17)

Deploy `9d868e3` — zero-downtime rollover, no 502 window across 40 polls,
both write endpoints returning 401 in <320 ms (module load clean).

**Reactivation smoke, job 35** (rebuilt 5-row xlsx):
- `total=5, valid=5, skipped=0, phone_dropped=1`
- `phone_dropped_samples=[{row:4, email:smoke-phone-3, raw:"12ab"}]`
- `unmatched_countries_top5=[]`
- Job completed 5/5, **5 reactivation_tokens** created, **0
  `email_queue` rows** since job start.
- **ALL ASSERTIONS PASSED.**

**Import smoke** (5 rows):
- `success_count=5, new_count=5, failed_count=0, warning_count=1`
- `errors=[]`
- `warnings=[{row:4, raw_value:"12ab", message:"phone dropped: invalid
  phone number for country NG: \"12ab\""}]`
- `unmatched_countries_top5=[]`
- **ALL ASSERTIONS PASSED.**

**Stored phones verified by Suer directly in psql** (before cleanup):

```
  smoke-phone-1  +2348012345678   country=(blank)   ← numeric cell, expo NG
  smoke-phone-2  (empty)                            ← xxxxxxxxxx
  smoke-phone-3  (empty)                            ← 12ab dropped, row imported
  smoke-phone-4  +905321234567    country=Turkey    ← row country won over expo
  smoke-phone-5  +212661234567    country=Turkey    ← '+' won over row country
```

Cleanup ran: DELETE 5 tokens, DELETE 5 visitors, verification `0 | 0`.

### B-4. Two test bugs surfaced and fixed

1. **Stale `/tmp/phone_smoke.xlsx`.** An earlier reactivation-smoke run
   (job 34, before job 35) reused the leftover 3-row xlsx from a prior
   era on disk. `valid=3, phone_dropped=1` — server behaviour was
   correct, but the assertion `valid === 5` failed. Fix: **both smoke
   tests now always rebuild the xlsx**, never `fs.existsSync`-gate on
   a shared temp file. See G28.

2. **`RENDER_DATABASE_READONLY_URL not set` in import smoke.** The
   import smoke's stored-phone DB verification silently skipped
   because it did not `require('dotenv').config(...)`. Only the
   reactivation smoke had it. Suer had to verify the 5 stored phones
   in psql by hand. Fix: **both smoke tests now load dotenv
   file-relative** at the top: `require('dotenv').config({ path:
   path.join(__dirname, '..', '.env') })`. See G29.

### B-5. Run-order rule (see G27)

**Reactivation smoke FIRST, then import smoke.** The import creates
visitors on expo 17; those visitors then make the reactivation smoke's
rows skip as `already_registered` and assertion `valid === 5` fails.
Both smoke files now state this in their header comment.

### B-6. Still un-live-tested — activate smoke runs TODAY

**Two code paths from `9d868e3` have unit-test coverage but no
end-to-end production execution yet:**

- **`/activate` fail-open + A-1 `custom_fields` trace** — the JSONB
  blob `{phone_raw, phone_reject_reason, phone_rejected_at}` writing
  atomically with the widened 16-column INSERT
  (`routes/reactivation.js:711-731`). Covered by
  `tests/test_activate_phone_smoke.js` (new this commit) — creates
  5 tokens, activates row 4 (Turkey local → happy path) + row 3
  (`12ab` → fail-open + trace), asserts stored phone + `custom_fields`
  on both.

  **VERIFIED LIVE 2 Sep — job 36:** row 4 stored `+905321234567` with
  `custom_fields=NULL`; row 3 stored `''` with
  `custom_fields={phone_raw:"12ab", phone_reject_reason:"invalid phone
  number for country NG: \"12ab\"", phone_rejected_at:"2026-09-02T11:
  04:20.088Z"}`. Cleanup ran (email_queue + tokens + visitors, `0|0|0`).
  A-1 fail-open + JSONB trace round-trip proven end-to-end before the
  wizard mints real tokens. Todo #0 CLOSED. This unblocks G1 of the
  wizard (feat: wizard segment preview + orchestrator skeleton).
- **Legacy 1-arg `normalizePhone` for `visitors.js:1076` export** —
  unit-tested (Group 5 in `test_phone_normalize.js`, 6/6 pass) but
  never exercised on real prod data since deploy. Live-test deferred
  to whichever future run exports the CSV.

### B-7. New Gotchas produced

- **G27** — smoke test run order on trash expo 17
- **G28** — smoke test that reuses a file on disk must verify shape first
- **G29** — smoke test that reads the DB must load dotenv itself, path-relative

### B-8. Follow-up committed elsewhere

- **`todo #0`** (new, P1 BLOCKER): run `test_activate_phone_smoke.js`
  today. Before the wizard.
- **`todo #18`** (new, P3): `results.warnings` is spread into the
  response body but not written to `import_logs.errors` — History tab
  won't show phone-drop warnings for past imports. Small change,
  deferred. (Noted 2 Sep, not urgent.)

Deploy chain for this addendum: `9d868e3` (Decision B main deploy) +
this doc + the two smoke fixes + `test_activate_phone_smoke.js`. Single
commit `test(phone): dotenv + no stale xlsx + activate smoke; docs:
decision B addendum`.
