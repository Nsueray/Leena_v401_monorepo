# LEENA — Read-Only Discovery Report
**Date:** 2026-08-18 · **Mode:** Discovery only, no writes · **Author:** Claude Code session

> Every claim below is tagged **VERIFIED** (read in this session, with `path:line` or command output),
> **HYPOTHESIS** (plausible, untested), or **NEEDS MORE INFO**.
> All `path:line` references relative to `backend/leena-v401-backend/` unless stated otherwise.
>
> **REVISION 2 — DB access restored mid-session** (Suer updated the Render IP whitelist).
> All previously DB-blocked items have been measured. **Task 2's root cause moved from
> HYPOTHESIS to VERIFIED FACT.** Sections marked ⟳ were rewritten from live data.
> Every SQL result below was run read-only as `claude_readonly` on `leena_v401_db`.

---

## ⚠️ SCORECARD ON THE BRIEF'S PREMISES

| Premise in brief | Verdict |
|---|---|
| "An expo starts in ~7 days" | ✅ **CONFIRMED EXACTLY.** `expo_id=13` **Nigeria Mega Project Expo 2026**, **2026-08-25 → 2026-08-27**, `(start_date - CURRENT_DATE) = 7` |
| "Last dev work ~18 May, ~3 months frozen" | ❌ **WRONG.** Last commit **2026-08-04** (14 days ago); 60+ commits after 18 May |
| "ELL work is in a different workspace" | ❌ **WRONG.** The ELL finance module was built **in this repo** (migrations 012–028) |
| "Zoho field mapping is believed correct" | ✅ **CORRECT — Zoho is fine.** The bug is entirely on LEENA's side |
| Task 4 — expo editing is missing | ❌ **WRONG.** Built 2026-06-18; endpoint + UI both exist, UI is unlinked |
| Task 5 — expo grouping is missing | ❌ **WRONG.** `expo_clusters` exists, **migration applied in production**, but **0 clusters created** |

**THE HEADLINE:** Task 2 is no longer a hypothesis. **1,682 visitors on the fair that opens
in 7 days have a job title sitting in `custom_fields.title` while the `job_title` column is
empty.** The key Zoho sends is `title` (lowercase). Registrations are still arriving at
~200–270/day, so the number grows daily.

---

## SUMMARY TABLE

| # | Finding | Status | Risk if we act | Risk if we don't |
|---|---|---|---|---|
| 0.1 | Repo active through **2026-08-04**, not May. Local == origin/main. 20 untracked May-era files. | **VERIFIED** | None | Planning on a false "frozen system" premise |
| 0.2 | Deployed commit still **not** verifiable read-only. But migration 010 **is** applied in prod. | **NEEDS MORE INFO** | — | Small: we may analyse code that isn't live |
| 0.3 ⟳ | DB access **RESTORED**. All queries below are live production reads. | **VERIFIED** | None | — |
| 0.4 ⟳ | **Target = `expo_id=13` Nigeria Mega Project Expo 2026, 25–27 Aug, 7 days out, 3,289 visitors, 0 check-ins yet.** | **VERIFIED** | None | — |
| 1 | `CLAUDE.md` ~3 months stale: 34 routes mounted, 21 documented; 6 route files undocumented. | **VERIFIED** | None | Docs mislead every later decision |
| **2** ⟳ | **Zoho sends `title`; `webhook.js:55` doesn't read it. 1,682 rows on expo 13 recoverable; 1,758 across all expos.** | **VERIFIED FACT** | Very low — 2-line additive | 57% of the fair's visitors have no job title on badge/export/reports |
| 2b ⟳ | Conference visitors on expo 13: **35 of 35 have empty `job_title`** (100%). | **VERIFIED** | — | Speaker/conference badges blank |
| 2c | Same bug class already fixed for `phone`/`mobile` in May (6,214 rows), todo checkbox still stale. | **VERIFIED** | None | Re-deriving a known root cause |
| **3** ⟳ | **Purple confirmed wrong: forms 52/53/55 all set `primaryColor #009846` (green) → `#29539f`. `showSuccess()` discards it via innerHTML and falls back to `#667eea→#764ba2`.** | **VERIFIED** | Low — 1 frontend file | Confirmation screen off-brand for the whole fair |
| 4 | Expo edit exists (`PUT /api/expos/:id` + `expo-form.html`). Dashboard pencil is **dead**. UI **unlinked** from all navigation. | **VERIFIED** | Low | We'd rebuild what exists |
| 4b | Changing dates mid-fair silently rewrites Fair Totals (`reports.js:933-981`). No audit trail. | **VERIFIED** | **HIGH** | Numbers shift with no warning |
| 5 ⟳ | Migration 010 **applied** (5 tables, 27 columns). But **`expo_clusters` is EMPTY** and `country_code` is NULL on every expo — built, never adopted. | **VERIFIED** | Low | Designing from zero something already built |
| 5b ⟳ | Co-location is a **real recurring pattern**: Ghana (3 expos), Nigeria (2), Kenya (2) all share exact dates. Expo 13 is **standalone**. | **VERIFIED** | — | — |
| 5c | All read paths single-expo by construction (`expo_id = $1` as filter #1). No cross-expo read. | **VERIFIED** | — | — |
| 6a ⟳ | **Expo 13 has ZERO terminals and ZERO badge-template links.** Nothing can check anyone in today. | **VERIFIED** | — | **Fair cannot operate** unless set up before 25 Aug |
| **6b** ⟳ | **Both May bulk-print terminal keys are still `is_active=true`** — and both are in plaintext in `CLAUDE.md`, in the GitHub repo. | **VERIFIED** | Low to revoke | Anyone with repo access can print badges / read visitor lists |
| 6c ⟳ | `Africa/Lagos` hardcoding (29 sites) — **risk DOWNGRADED**: expo 13 is in Nigeria, so it is correct here. Latent for Morocco (22 Sep). | **VERIFIED** | — | Breaks at the *next* fair, not this one |
| 6d ⟳ | Email worker **HEALTHY**: 0 pending, 0 failed, 0 stuck; sent as recently as 09:11 today. | **VERIFIED** | — | — |
| 6e ⟳ | **4 test rows in expo 13** (incl. `yaprakguzelcik@gmail.com`, `elan02@elan-expo.com`, `test@test.com`). | **VERIFIED** | Low | Polluted baseline metrics, as in May |
| 6f ⟳ | **5 backup tables** still in production, one ~3 months past its documented drop date; one (`visitors_backup`) undocumented. | **VERIFIED** | Low | Clutter; signals cleanup never finished |
| 6g | todo.md checkboxes unreliable — 6 sampled, **2 stale**, 4 genuinely open. | **VERIFIED** | None | Bad backlog triage |

---

## TASK 0 — Environment & State

### 0.1 Repo state — VERIFIED

```
$ git log -5 --format='%h %ad %s' --date=short
3ebe8b5 2026-08-04 office management screen + name resolution fix
84135a7 2026-08-04 tests: PLN schedule rules (M4 third pass)
32717fe 2026-08-04 tests: MOT commission rules (M4 second pass)
b5b6384 2026-08-04 tests: ODE payout rules (M4 first pass)
ff080fb 2026-08-04 agent office assignment (create/edit)

$ git branch --show-current      → main
$ git status --branch --porcelain → ## main...origin/main   (no ahead/behind markers)
$ git rev-list --left-right --count origin/main...main → 0   0
$ git fetch --dry-run            → (no output, exit 0)
```

**Last commit: 2026-08-04** — 14 days ago, not 3 months. Local is exactly in sync with origin/main.

**Timeline of what actually happened after 18 May** (VERIFIED via `git log --since`):

| Period | Work |
|---|---|
| 2026-05-21 → 05-22 | Dashboard fixes (`main-panel-v2`), Fair Totals mode — *during/just after the Nigeria fair* |
| 2026-06-03 → 06-04 | Production schema recovery migrations; per-form sales notification; form-builder Bootstrap-JS removal |
| **2026-06-18** | **`335dacd` Add Expo Operations module (read/write/clone + reference + partners/clusters)** ← Tasks 4 & 5 |
| 2026-06-20 | LEENA-native `POST /api/contracts/convert` |
| 2026-07-21 → 08-04 | ELL finance module: contracts, payments, commissions, payouts, schedules, offices, cash forecast (migrations 012–028) |

**Untracked leftovers (20 files)** — all May-era audit docs plus two SQL scripts
(`cleanup-day12-dryrun.sql`, `cleanup-day12-commit.sql`). Note `FAIR_DAY1_*_20260519.md` and
`FAIR_DAY2_MIDDAY_20260520.md` exist, confirming the May fair ran 19–21 May and was monitored.
No uncommitted *code* changes — `git status --porcelain` shows only `??` entries, zero ` M`.

### 0.2 Deployed vs local — NEEDS MORE INFO

I cannot verify the deployed commit read-only. Evidence of absence:
- No `render.yaml` / `.render*` at repo root (checked, no matches).
- No version/build-SHA endpoint. `index.js` exposes `GET /health` only.
- I did not call production HTTP — that would be an outbound action beyond a read-only brief.

**NEEDS MORE INFO — the live commit SHA — obtain from Render Dashboard →
Leena_v401 → Events/Deploys (shows the deployed commit), or `git rev-parse HEAD` in Render Shell.**

⚠️ Consequence worth stating plainly: **the ELL finance work and the Expo Operations
module are on `main`, and Render auto-deploys `main` on push.** If nothing blocked those
deploys, production has been running Expo Operations since 18 June and the finance module
since late July. That is a claim I cannot verify — but it is the default behaviour
documented in `CLAUDE.md` ("git push = production'a deploy").

### 0.3 Database access — ⟳ RESTORED, VERIFIED WORKING

Env var name confirmed: `RENDER_DATABASE_READONLY_URL` (`.env`). Initially all three SSL
modes failed (`Connection terminated unexpectedly` on TLS; `28000 SSL/TLS required` without
SSL — the latter proving the host was alive and it was a network-layer block, i.e. the
documented IP-whitelist failure mode).

**Suer updated the Render inbound IP rule mid-session and access came back:**
```
CONNECTED: {"current_user":"claude_readonly","current_database":"leena_v401_db",
            "utc_now":"2026-08-18T06:12:40.274Z"}
```
Everything below marked ⟳ is a live read-only production measurement.

### 0.4 Target expo — ⟳ VERIFIED

```sql
SELECT id,name,start_date::text,end_date::text,(start_date-CURRENT_DATE)::int AS days_away
FROM expos WHERE id IN (13,9);
```
| id | name | start | end | days_away |
|---|---|---|---|---|
| **13** | **Nigeria Mega Project Expo 2026** | **2026-08-25** | **2026-08-27** | **7** |
| 9 | Morocco Siema Expo 2026 | 2026-09-22 | 2026-09-24 | 35 |

**The brief's "~7 days" is exactly right. All analysis below targets `expo_id = 13`.**

Note a second expo follows five weeks later — **Morocco Siema Expo 2026 (id 9, 22–24 Sep)**.
That one matters for the `Africa/Lagos` finding (6.2a): Morocco is not Nigeria.

**Current scale of expo 13 (⟳ VERIFIED):**

| Metric | Value |
|---|---|
| Visitors registered | **3,289** |
| — of which `visitor` | 3,132 |
| — of which `exhibitor` | 121 |
| — of which `conference` | 35 |
| Check-ins so far | **0** |
| Visitors missing a QR code | **0** ✅ |
| Distinct countries | 22 (0 blank) ✅ |
| Forms | 3 (ids 52 exhibitor, 53 visitor, 55 conference — all active) |
| Email templates | 5 |
| **Terminals** | **0** ⚠️ |
| First / last registration | 2026-06-11 → **2026-08-18 09:11 (today)** |

Registration volume is live and heavy — 205 yesterday, 274 the day before, 1,131 on 9 Aug.

---

---

## TASK 1 — Documentation Freshness

**VERIFIED — the docs are substantially stale, and stale in a way that hides entire modules.**

`CLAUDE.md` self-labels "Son güncelleme: 18 Mayıs 2026 | Versiyon: v4.0.5" and its route-mount
section lists **21** routes. `index.js` actually mounts **34** (`grep -c "^if .*app.use('/api'"` → 34).

Six route files are **entirely absent** from `CLAUDE.md` (verified by grepping each name):
`routes/partners.js`, `routes/clusters.js`, `routes/salesAgents.js`, `routes/commissions.js`,
`routes/cashForecast.js`, `routes/emailTracking.js`.

Directly relevant to this brief: `expo_clusters`, `expos.cluster_id`, `PUT /api/expos/:id`,
`POST /api/expos/:id/clone`, `/api/clusters`, and the four `expo-*.html` pages are **all real
and all undocumented**. Conversely `CLAUDE.md`'s "Dizin Yapısı" still lists only migrations
001–003 while 000–028 exist on disk. `todo.md` (618 lines, "Son güncelleme: 18 Mayıs 2026")
has the same cut-off, and its checkboxes are independently unreliable (see 6.1).

The one genuinely current document is `LEENA_CURRENT_STATE.md` (untracked, "Generated
2026-05-08 from actual code, routes, and production DB") — but it predates the Expo
Operations module too.

**Calibration verdict: treat `CLAUDE.md` as accurate for pre-May-18 EMS behaviour and as
silent — not authoritative — for anything after. It never says "no expo edit exists"; it
simply stops before that work landed. Do not read its silence as absence.**

---

## TASK 2 — Job title missing on Zoho registrations · **HIGH PRIORITY**

### 2.1 Data evidence — ⟳ **VERIFIED. The hypothesis is now a measured fact.**

```sql
SELECT origin, COUNT(*) AS rows,
 COUNT(*) FILTER (WHERE COALESCE(job_title,'')<>'')                AS col_job_title_filled,
 COUNT(*) FILTER (WHERE COALESCE(custom_fields->>'title','')<>'')  AS cf_title_nonempty,
 COUNT(*) FILTER (WHERE COALESCE(job_title,'')=''
                    AND COALESCE(custom_fields->>'title','')<>'')  AS recoverable
FROM visitors WHERE expo_id=13 GROUP BY origin;
```

| origin | rows | `job_title` column filled | `custom_fields.title` filled | **RECOVERABLE** |
|---|---:|---:|---:|---:|
| **`zohoform`** | **1,770** | **54** (3%) | **1,736** (98%) | **1,682** |
| `massimport` | 1,085 | 1,016 (94%) | 44 | 42 |
| `reactivation_campaign` | 320 | 283 (88%) | 12 | 11 |
| `public` | 113 | **110 (97%)** | 113 | 3 |

**Read the first and last rows together — that is the whole bug in two lines.**
Both paths receive a `title` key. The public form writes it to the column 97% of the time;
the Zoho path writes it 3% of the time.

**The exact key Zoho sends is `title` — lowercase.** ⟳ VERIFIED two ways:

1. Key frequency across `custom_fields` on expo 13 — `title` is the **single most common
   custom key in the entire expo**, on 1,905 rows. No `Title`, `Job_Title`, or `jobTitle`
   key exists anywhere (0 rows each).
2. Raw sample rows, `origin='zohoform'` (most recent, yesterday):

| id | form_id | `job_title` column | `custom_fields->>'title'` |
|---|---|---|---|
| 63359 | 53 | `''` | `Sales Officer` |
| 63358 | 53 | `''` | `Civil engineering graduate` |
| 63357 | 53 | `''` | `General Manager` |
| 63356 | 53 | `''` | `Technical Adviser` |
| 63354 | 55 | `''` | `CEO` |
| 63352 | 53 | `''` | `Director` |

And the control group — `origin='public'`, same key, **written through correctly**:

| id | form_id | `job_title` column | `custom_fields->>'title'` |
|---|---|---|---|
| 63234 | 52 | `Senior Project Manager` | `Senior Project Manager` |
| 63233 | 52 | `Project Coordinator/Project Lead` | `Project Coordinator/Project Lead` |
| 62993 | 52 | `Associate Engineering Manager` | `Associate Engineering Manager` |

Identical values, populated on one path and dropped on the other. **This is conclusive.**

**Scale — ⟳ VERIFIED.** Rows where the column is empty but the value is sitting in `custom_fields.title`:

| expo_id | recoverable rows |
|---|---:|
| **13 (target)** | **1,738** |
| 9 (Morocco, next fair) | 13 |
| 10 (Kenya) | 5 |
| 7 (Nigeria, May) | 2 |
| **TOTAL** | **1,758** |

By visitor type on expo 13 — empty `job_title`:

| visitor_type | rows | empty `job_title` | |
|---|---:|---:|---|
| visitor | 3,132 | 1,778 | 57% |
| exhibitor | 121 | 12 | 10% |
| **conference** | **35** | **35** | **100%** ⚠️ |

**Every single conference registrant has a blank job title.**

**Good news: nothing is lost and nothing needs re-collecting.** All 1,758 values are intact
in `custom_fields.title` and recoverable with one UPDATE.

### 2.2 Form configuration — ⟳ VERIFIED

Forms on expo 13 (`SELECT id,name,visitor_type,email_template_id,is_active FROM forms WHERE expo_id=13`):

| id | name | visitor_type | email_template_id | active |
|---|---|---|---|---|
| 52 | Exhibitor Registration Form | exhibitor | 48 | ✅ |
| **53** | **Visitor Registration Form** | visitor | 49 | ✅ |
| 55 | Nigeria Mega Project Expo 2026 Conference Registration | conference | 50 | ✅ |

**Which form does Zoho post to?** ⟳ VERIFIED from the data: the `zohoform` rows carry
`form_id = 53` (visitor) and `form_id = 55` (conference). The `public` rows carry
`form_id = 52` (exhibitor). So **Zoho drives forms 53 and 55; the LEENA-hosted public form
URL is being used for 52.** That neatly explains the reported symptom — ops sees titles on
exhibitor registrations and not on visitor/conference ones.

The webhook uses `form_id` **only** to resolve `visitor_type`; it does **not** read
`forms.fields` for field mapping (mapping is the hardcoded key list at `webhook.js:45-60`).
**So "the Zoho mapping is correct" is true and the value is still dropped** — LEENA's side of
the mapping is a fixed list that omits `title`.

Traffic is also spread over 9 distinct `source` strings (UTM-style: `- Pixad`,
`- Landing Page`, `- Email Marketing`, `- Linkedin`, `- Leena`), including one typo variant
`- Landign Page` (1 row) and a stray `This is a test submission` (1 row). Cosmetic, not blocking.

### 2.3 Code path — **VERIFIED**

**Zoho webhook** — `routes/webhook.js`, route signature confirmed at line 34
(`router.post('/zoho/:organizer_id/:expo_id/:form_id', ...)`, no auth middleware; a
shared-secret header check at lines 36-40):

```js
// webhook.js:55
const jobTitle = req.body.jobTitle ?? req.body.job_title ?? '';
```

Unknown-key routing into `custom_fields` — `webhook.js:63-74`:
```js
const knownFields = new Set([
  'name', 'lastName', 'last_name', 'email', 'company',
  'badgeNumber', 'badge_id', 'sector', 'visitorCategory', 'visitor_category',
  'visitorStatus', 'visitor_status', 'visitorType', 'visitor_type',
  'visitorSource', 'source', 'jobTitle', 'job_title',
  'country', 'phone', 'mobile', 'Mobile', 'website', 'origin'
]);
const customFields = {};
for (const [key, value] of Object.entries(req.body)) {
  if (!knownFields.has(key) && value !== null && value !== undefined && value !== '') {
    customFields[key] = value;
  }
}
```
`title` / `Title` are **not** in `knownFields` → a `title` key lands in `custom_fields.title`
and is written to the JSONB column, while the `job_title` **column** stays `''`.

**Public form** — `routes/visitors.js:197` (`router.post('/public', ...)`):
```js
// visitors.js:207
job_title: custom_fields?.job_title || custom_fields?.title || '',
```

### Side-by-side diff of the three write paths — **VERIFIED**

| Path | `path:line` | Keys accepted for `job_title` |
|---|---|---|
| **Zoho webhook** | `webhook.js:55` | `jobTitle`, `job_title` |
| **Public form** | `visitors.js:207` | `job_title`, **`title`** |
| **Excel import** | `visitors.js:683` | `job_title`, `Job Title`, **`title`**, **`Title`**, `position`, `Position` |
| Reactivation Excel | `reactivation.js:133` | `job_title`, `Job Title`, **`title`** |

**The Zoho path is the only one of four without a `title` fallback.** This maps exactly onto
the reported symptom: same field, works via the LEENA form URL, blank via Zoho.

### 2b. Precedent — the identical bug was already found and fixed for `phone` — **VERIFIED**

`todo.md` (Zoho Webhook Phone Mapping, 19 May) records:

> **Forward-only fix**: `routes/webhook.js:57` … `knownFields` Set'e `'mobile'`, `'Mobile'` ekle.
> `routes/visitors.js:208` paralel fix … **root cause: Zoho `mobile` lowercase gönderiyor,
> handler sadece `phone` okuyor.** … Backfill (6,214 rows) applied.

That is the same failure mode, one field over. And the fix **has since landed** (the todo
checkbox is stale):
```js
// webhook.js:57  — mobile/Mobile fallbacks present
const phone = req.body.phone ?? req.body.mobile ?? req.body.Mobile ?? '';
// visitors.js:208 — parallel fix present
phone: custom_fields?.phone || custom_fields?.mobile || custom_fields?.Mobile || '',
```
`knownFields` at `webhook.js:67` now contains `'mobile', 'Mobile'`. **6,214 rows were
affected by the phone instance before it was caught** — a useful scale reference for how
long this class of bug can run unnoticed.

There is also direct evidence Zoho-family forms use `title`: `CLAUDE.md:1419` records a
May backfill `UPDATE visitors SET job_title = custom_fields->>'title' … AND visitor_type='exhibitor'`
(52 rows) — i.e. **the value has previously been found sitting in `custom_fields.title`**
on this very system, and was fixed by hand rather than at the handler.

### 2.4 Blast radius of `job_title` — **VERIFIED**

Readers, `path:line`:

| Consumer | Location | Reads |
|---|---|---|
| Badge rendering | `public/badge.html:340` | `visitor.job_title \|\| visitor.jobTitle \|\| visitor.job` |
| Badge field toggle | `public/badge.html:368` | `content.show_job_title === true && displayJobTitle` |
| Badge template default | `routes/badgeTemplates.js:35` | `show_job_title: false` ← **default OFF** |
| Check-in list | `routes/checkins.js:353-357` | `COALESCE(custom_fields->>'job_title', v.job_title, '')` |
| Check-in reports | `routes/checkinReports.js:72,111` | `custom_fields->>'job_title'` **only** |
| Terminal lookup | `routes/terminalCheckins.js:120,184,228,253` | `v.job_title` → `jobTitle` (camelCase) |
| Visitor export (xlsx) | `routes/visitors.js:1032,1047` | `r.job_title \|\| ''` |
| Reports breakdown | `routes/reports.js:255` | `INITCAP(TRIM(LOWER(job_title)))` |
| Certificates | `routes/conferenceCertificates.js:385,520,541` | `v.job_title` |
| Lead scanner | `routes/leads.js:87,117,149,178` | `v.job_title` |
| Email segments | `routes/emailSegments.js:106,119,147` | `visitor.job_title \|\| ''` |
| Reactivation | `routes/reactivation.js` (12 sites) | `job_title` column |
| Form submissions | `routes/forms.js:226` | `job_title` |

**Two consumers already carry a fallback and would change behaviour if the column is populated:**
- `checkins.js:353-357` prefers `custom_fields->>'job_title'` **over** the column. Note it
  looks for `job_title` inside custom_fields — **not** `title` — so it does not currently
  rescue the Zoho case either.
- `checkinReports.js:72` reads *only* `custom_fields->>'job_title'`, ignoring the column
  entirely. **This report will stay blank even after a webhook fix**, unless it is
  also changed. Worth flagging as a second, separate defect.

**What breaks if a currently-empty value starts being populated:** nothing structurally.
Every consumer already handles both empty and non-empty. Concrete effects:
1. Badges — **only if** the badge template has `show_job_title: true`; default is `false`
   (`badgeTemplates.js:35`). Layout risk: long titles on a fixed-size badge. `badge.html`
   has word-wrap/auto-size per `CLAUDE.md`, but this is worth an eyeball before printing.
2. Reports job-title breakdown gains rows it did not have — an *improvement* that will look
   like a discontinuity against historical numbers.
3. Exports gain a populated column.
4. `checkins.js` COALESCE ordering means existing `custom_fields.job_title` values keep
   winning — no regression there.

### 2.5 Deliverable

**Root cause — ⟳ VERIFIED FACT (no longer a hypothesis).**
- Zoho sends the key **`title`** (lowercase) — measured on 1,905 rows; no other casing exists.
- `webhook.js:55` reads only `jobTitle`/`job_title`, so `title` never reaches the column.
- `title` is absent from `knownFields` (`webhook.js:63-68`), so the value is captured into
  `custom_fields` instead — **nothing is lost, everything is recoverable.**
- `visitors.js:207` on the public path *does* read `title`, which is why the same form
  submitted through the LEENA URL works. Measured: 97% filled on `public` vs 3% on `zohoform`.
- Impact on the fair opening in 7 days: **1,682 rows**, growing ~200–270/day, plus 1,738
  total on expo 13 and 1,758 across all expos.

**Minimum-change fix — DESCRIBED, NOT IMPLEMENTED.** Two lines in one file:
1. `webhook.js:55` — extend the coalesce chain to include the confirmed key(s), mirroring
   the shape already used at `visitors.js:207` and the already-shipped phone fix at
   `webhook.js:57`.
2. `webhook.js:63-68` — add the same key(s) to `knownFields` so the value stops being
   duplicated into `custom_fields`.

Additive and backward-compatible: `??`/`||` chains only fire when the earlier keys are
absent, so every currently-working payload is byte-identical in behaviour. Forward-only —
it does **not** repair existing rows; that needs a separate backfill
(`UPDATE … SET job_title = custom_fields->>'<key>' …`), for which the May precedent
(`CLAUDE.md:1419`, with a backup table) is the template. **⟳ The backfill is now a
precisely known quantity** — 1,758 rows, all with the value already present in
`custom_fields.title`, verifiable before and after with the same query used in 2.1.

**Sequencing matters:** if only the backfill is run, every new Zoho registration keeps
arriving broken (~200–270/day). If only the handler is fixed, the 1,682 existing rows stay
blank through the fair. **Both are needed, handler first.**

**⟳ Note: the diagnostic step is already done.** The Render-log approach suggested earlier
is no longer needed — the DB data above names the key conclusively. What remains is
verifying the *fix*, not the diagnosis.

**Testing against live Zoho without polluting production:** the webhook is guarded only by
the `x-webhook-token` header (`webhook.js:36-40`), so it can be exercised directly with
`curl` against a **disposable test expo** — create one via the existing expo create path,
point a `curl` POST at `/api/webhook/zoho/<org>/<test_expo>/<form>` with a plus-addressed
real mailbox (`suer+zohotest@elan-expo.com`). Two hard constraints from the May lessons in
`CLAUDE.md`: **(L1) never use a fake domain** — SendGrid does an MX lookup, defers 72h, then
hard-bounces, damaging sender reputation; use plus-addressing on a real mailbox. And scope
everything to a throwaway `expo_id` so the target expo's baseline metrics stay clean.
Cheapest of all: just read the existing `webhook.js:92,97` log lines from a **real** visitor
submission — zero writes, zero test data.

---

## TASK 3 — Success page ignores the form's design colours

### 3.1 / 3.2 Root cause — **VERIFIED, complete**

The page is `public/form-public.html` (551 lines). Style is stored in `forms.config` JSONB
under `config.style` and applied by `applyFormStyle(config)` (`form-public.html:471-548`),
called at line 200 after the form loads.

**The mechanism of the bug is a DOM lifetime mismatch.** `applyFormStyle` applies styling
two different ways:

*(a) Inline element styles — destroyed on re-render:*
```js
// form-public.html:496-510
const header = document.querySelector('.form-header');
if (header) {
    header.style.background = `linear-gradient(135deg, ${s.headerBannerColor}, ${s.headerGradientEnd})`;
    …
}
// form-public.html:513-530 — same pattern for .form-footer, incl. footer.textContent = s.footerText
```

*(b) An injected `<style>` tag — survives re-render:*
```js
// form-public.html:539-546
styleTag.textContent = `
    .btn-submit { background: ${s.primaryColor} !important; border-radius: ${s.borderRadius}px !important; }
    .btn-submit:hover { … }
    .form-control:focus, .form-select:focus { … }
    .form-control, .form-select { … }
    .form-container { border-radius: ${s.borderRadius}px !important; }
`;
document.head.appendChild(styleTag);
```
Note what is **absent** from that list: `.form-header` and `.form-footer`.

Then on submit, `showSuccess(qrCode)` (`form-public.html:412-445`) does:
```js
const container = document.getElementById('formContent');
…
container.innerHTML = `
    <div class="form-header">      ← BRAND NEW ELEMENT, no inline style
        <h2>Thank You!</h2>
    </div>
    …
    <div class="form-footer">
        Powered by Leena v401 &copy; ${new Date().getFullYear()}
    </div>
`;
```

The freshly-created `.form-header` has no inline background, so it falls through to the
static stylesheet:
```css
/* form-public.html:36 */
.form-header { background: var(--primary-gradient); … }
/* form-public.html:12-14 */
--primary-color: #667eea;
--secondary-color: #764ba2;
--primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

**`#667eea → #764ba2` is the purple.** That is the reported "standard purple", located
exactly: `public/form-public.html:14`.

Two corollaries, both VERIFIED:
- The **"Submit Another Registration" button *does* keep the correct colour** — it is
  `.btn-submit`, covered by the injected `<style>` tag with `!important`. So the success
  card will show a correctly-branded button under a purple header. A useful confirming
  symptom to check against what ops actually sees.
- The **configured `footerText` is also lost** — `showSuccess` hardcodes
  `"Powered by Leena v401 © <year>"` (line 441), overriding whatever
  `s.footerText` had set at line 529. Same root cause, second visible symptom.

`showError(message)` (`form-public.html:447-470`) has the **identical** defect — same
`innerHTML` replacement, same two elements.

### 3.2b ⟳ The target expo's forms DO have custom branding — VERIFIED

This closes the loop: the bug is not "no style was configured".

```sql
SELECT id, name, config->'style'->>'primaryColor', config->'style'->>'headerBannerColor',
       config->'style'->>'headerGradientEnd', config->'style'->>'footerText'
FROM forms WHERE expo_id=13;
```

| form | primaryColor | headerBannerColor | headerGradientEnd | footerText |
|---|---|---|---|---|
| 52 Exhibitor | `#009846` | `#009846` | `#29539f` | Powered by Leena EMS · © Elan Expo |
| 53 Visitor | `#009846` | `#009846` | `#29539f` | Powered by Leena EMS · © Elan Expo |
| 55 Conference | `#009846` | `#009846` | `#29539f` | Powered by Leena EMS · © Elan Expo |

All three forms are branded **green `#009846` → blue `#29539f`** (Nigerian green/blue), and
none uses a banner image, so the gradient is what renders. **The success card shows
`#667eea → #764ba2` purple instead** — a colour that appears nowhere in the configuration.

**Predicted exact symptom, from code + this data:** green/blue header on the form → submit →
**purple header**, a **green `#009846` button** ("Submit Another Registration", which
survives via the injected `<style>` tag), and the footer reading **"Powered by Leena v401 ©
2026"** instead of the configured "Powered by Leena EMS · © Elan Expo". If ops confirms that
three-part signature, the diagnosis is airtight.

### 3.3 Style keys that exist in the designer today — **VERIFIED**

From `public/form-builder.html:1061-1074` (the object actually serialised into
`config.style`), cross-checked against the `DEFAULT_STYLE` fallback at `form-public.html:477-480`.
**15 keys**, exact names:

| Key | Control | Default |
|---|---|---|
| `headerBannerImage` | upload (base64) | `null` |
| `headerBannerColor` | colour picker | `#667eea` |
| `headerGradientEnd` | colour picker + enable checkbox | `#764ba2` |
| `headerHeight` | range 80–300 | `200` |
| `footerBannerImage` | upload (base64) | `null` |
| `footerBannerColor` | colour picker | `#667eea` |
| `footerGradientEnd` | colour picker + enable checkbox | `#764ba2` |
| `footerHeight` | range 40–200 | `80` |
| `footerText` | text | `Powered by Leena EMS · © Elan Expo` |
| `primaryColor` | colour picker | `#667eea` |
| `backgroundColor` | colour picker | `#f5f7fa` |
| `fontFamily` | select (Poppins/Inter/Roboto/Open Sans/Montserrat/system-ui) | `Poppins` |
| `buttonText` | text | `Register` |
| `borderRadius` | range 0–24 | `12` |

A fix may legitimately reference any of these. Note `primaryColor`, `headerBannerColor`,
`headerGradientEnd`, `footerBannerColor`, `footerGradientEnd`, `headerBannerImage`,
`footerBannerImage`, `footerText` are the eight relevant to a success card.

### 3.4 Scope — **VERIFIED**

- **Frontend-only. One file: `public/form-public.html`.** No backend, no DB, no migration.
  The style data is already fetched and already in scope at the call site (line 200).
- Affected functions: `showSuccess()` (412-445) and `showError()` (447-470).
- **Is the success card duplicated elsewhere? Checked — no, and this matters:**
  `public/reactivate.html` has its own separate implementation and does **not** share the
  bug. It uses a **pre-existing hidden `<div id="successState">`** that is shown/hidden
  (`reactivate.html:399, 554, 561, 569`) rather than innerHTML-replaced, so nothing is
  destroyed. Its success header is nonetheless hardcoded
  `style="background: var(--success)"` (`reactivate.html:400`) where
  `--success: #10b981` (`reactivate.html:20`) — i.e. **green, deliberately, and also
  ignoring the form's `primaryColor`**. It does call `applyFormStyle(data.form_config)`
  (`reactivate.html:494`, function at line 580) but that is a *different* function from
  form-public's.

  **So: two pages, two different implementations, two different wrong colours (purple vs
  green), only one of which is the reported bug.** If ops wants brand-consistent
  confirmation screens everywhere, `reactivate.html` is a second, independent piece of work
  — not a free ride on the same fix.

---

## TASK 4 — Editing an existing expo

### 4.1 Does an edit capability exist today? **YES — VERIFIED**

**Backend — `routes/expos.js:282`:**
```js
router.put('/:id', authenticateToken, async (req, res) => {
```
- **Method/path:** `PUT /api/expos/:id`
- **Auth:** `authenticateToken` = `middleware/authMiddleware` (`expos.js:5`), sets `req.organizer_id`
- **Ownership:** enforced in SQL — `WHERE id = $p AND organizer_id = $p+1` (`expos.js:331`); 404 on miss
- **Transactional:** `BEGIN` / `COMMIT` / `ROLLBACK` with `client.release()` in `finally` (`expos.js:321-356`)
- **Date validation:** `expos.js:287-290` — both dates parsed, `start > end` → 400. Note this
  fires **only when both are supplied in the same request** (`if (b.start_date && b.end_date)`).
  **Sending `start_date` alone can therefore produce `start > end` with no complaint.**
  *(VERIFIED from the guard's condition — I have not executed it.)*

**Columns it permits updating** — `WRITABLE_FIELDS`, `expos.js:166-178` (VERIFIED, 32 entries),
plus `name` handled separately (which also regenerates `slug`, `expos.js:306-310`), plus
`sectors` via the `expo_sectors` junction (`expos.js:299, 348`):

```
location, description, logo_url, start_date, end_date,
edition_year, country_code, city, venue, organizer_role, status,
show_open_hours, cluster_id,
buildup_1_days_before, buildup_2_days_before, standard_buildup_days_before,
catalogue_deadline_days_before, stand_design_deadline_days_before,
payment_deadline_days_before, visa_deadline_days_before, breakdown_days_after,
buildup_day_1, buildup_day_2, standard_buildup_day, catalogue_submission_deadline,
stand_design_confirmation_deadline, payment_deadline, visa_support_deadline, breakdown,
catalogue_form_url, stand_design_form_url, visitor_preregistration_form_url
```

Related endpoints, all VERIFIED present: `POST /api/expos/:id/clone` (`expos.js:381`),
`PUT /api/expos/:id/cluster` (`expos.js:500`), `DELETE /api/expos/:id` (`expos.js:521`).

**Frontend — two answers, and the distinction is the finding:**

1. **`public/dashboard_new.html:667` — the pencil the brief asks about is DEAD.**
   ```html
   <button class="btn btn-secondary"><i class="bi bi-pencil"></i></button>
   ```
   No `onclick`, no handler, no listener. The adjacent Enter button has
   `onclick="enterExpo(...)"` (line 666), so the omission is visible in one glance.
   Clicking it does nothing at all.

2. **`public/expo-form.html` — a full, working edit UI that already exists.**
   - Reached from `public/expo-list.html:276`: `openExpo(id) → expo-form.html?id=${id}`
   - Date inputs present: `expo-form.html:139,143` (`<input type="date" id="start_date">`,
     `id="end_date"`), populated at lines 281-282, submitted at line 382
   - Client-side required check at line 380
   - `expo-list.html:270` also wires `cloneExpo(id)` → the clone endpoint

**But — VERIFIED — the Expo Operations UI is orphaned.** Grepping every `.html` in `public/`
for links to `expo-list.html` / `expo-form.html` / `expo-clusters.html` / `expo-partners.html`
returns **no hits outside the `expo-*` pages themselves** (the only other matches are code
*comments* in `contract-detail.html:230,306` and `contract-list.html:244` citing them as
patterns). `dashboard_new.html` and the standard admin sidebar do **not** link to it.

**So the capability exists and is reachable only by typing the URL.** That, rather than
absence, is very likely why ops believes expo editing does not exist.

### 4.2 Not applicable — an update path exists

For completeness, the create path (`POST /api/expos`, `expos.js:205`) requires
`name`, `start_date`, `end_date` (400 if any missing, `expos.js:209-211`).

### 4.3 Dependency analysis — everything that reads expo start/end dates

**VERIFIED**, grouped by consequence.

**A. Analytics that silently re-scope when dates change — the dangerous class.**
`routes/reports.js` filters visitor and check-in rows *by the expo's own date range*:

| `path:line` | What it does |
|---|---|
| `reports.js:933-934` | Fair-total same-day registered+checked-in: `(v.created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN e.start_date AND e.end_date` **and** the same on `c.checkin_time` |
| `reports.js:946` | Fair-total walk-ins (registered during fair, first check-in < 30 min) |
| `reports.js:958` | Fair-total check-ins: `COUNT(DISTINCT c.visitor_id) … BETWEEN e.start_date AND e.end_date` |
| `reports.js:964-970` | Fair hourly-per-day series for the multi-day chart |
| `reports.js:981` | Fair source breakdown across the fair period |

These `JOIN expos e ON e.id = $1` and read the dates live. **They are not snapshots.**

**B. Derived deadlines — recompute on read.** `expos.js:103-110`, `GET /api/expos/:id`:
```sql
COALESCE(e.buildup_day_1, (e.start_date - e.buildup_1_days_before * INTERVAL '1 day')::date) AS buildup_day_1_effective
… 7 more: buildup_day_2, standard_buildup_day, catalogue_submission_deadline,
  stand_design_confirmation_deadline, payment_deadline, visa_support_deadline,
  breakdown (= end_date + breakdown_days_after)
```
Eight operational deadlines move the moment `start_date`/`end_date` move — **unless** a
manual override is stored, in which case it sticks (that is the documented D2 design,
migration 010).

**C. Dashboard status classification.** `reports.js:380-382`:
```sql
COUNT(CASE WHEN start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE THEN 1 END)::int as active_expos,
COUNT(CASE WHEN start_date > CURRENT_DATE THEN 1 END)::int as upcoming_expos,
COUNT(CASE WHEN end_date < CURRENT_DATE THEN 1 END)::int as past_expos
```

**D. Listing / sorting / filtering.** `expos.js:63` (year filter via
`COALESCE(edition_year, EXTRACT(YEAR FROM start_date))`), `expos.js:68,78` (list + `ORDER BY
start_date DESC`), `expos.js:143` (slug lookup), `reports.js:439-453`,
`conferenceCleanup.js:14,23`, `clusters.js:94-96`.

**E. Reactivation.** `reactivation.js:469-470, 506, 513-514` — dates are read into the token
verify payload and surfaced to the visitor on the activation page.

**F. Clone.** `expos.js:394` derives the new edition year from `start_date`;
`expos.js:375` deliberately **resets** dates to NULL on clone.

**G. `{{date}}` email placeholder — NOT expo dates.** `utils/email.js:15` implements a
generic `template.replace(/\{\{([^}]+)\}\}/g, …)` over a supplied data object.
`{{date}}` is populated per-call by each email flow, not read from `expos.start_date`.
**Changing expo dates does not retroactively alter emails.** Already-sent mail is inert HTML
regardless.

**H. Badges and certificates — NOT date-driven.** Grepping `badge.html` and
`conferenceCertificates.js` for `start_date`/`end_date` returns nothing; the Nigeria
certificate template hardcodes its date string (`CLAUDE.md` v4.0.5 notes
`"19–21 May 2026 • Landmark Centre, Lagos"` as a literal in `CERT_EMAIL_TEMPLATE_NG`).
So certificates would show a **stale** date after an edit rather than a wrong-but-updated one.

**I. Scheduled/worker jobs — no expo-date dependency found.** `email_worker.js` runs
`while (true)` loops (lines 340, 669) plus `setInterval(runCampaignScheduler, …)` (line 666);
grepping the worker for `start_date`/`end_date` returns no hits.

### 4.4 What silently breaks if dates change **during** an active fair — blunt version

**The check-in and registration numbers change under ops' feet, with no warning and no audit trail.**

Concretely: every "Fair Total" figure in `reports.js:933-981` is computed as
`BETWEEN e.start_date AND e.end_date` **at query time**. Narrow the range and real check-ins
that already happened drop out of the totals. Widen it and pre-registration traffic from
before the fair gets counted as fair-day activity. The rows in `checkins` are untouched —
only the reported numbers move. Refresh the dashboard and the numbers are simply different.
Nobody gets an error.

Three aggravating factors:

1. **No audit trail.** `PUT /:id` sets `updated_at = CURRENT_TIMESTAMP` (`expos.js:329`)
   and nothing else. There is no history table, no before/after capture. Once changed, the
   previous range is unrecoverable from the app.
2. **The date-order guard has a hole.** `expos.js:287` only validates when *both* dates are
   present in the body. A single-field update can leave `start_date > end_date`, at which
   point every `BETWEEN` clause matches zero rows and all Fair Totals read **0**.
3. **The eight operational deadlines silently shift too** (`expos.js:103-110`) — build-up
   days, payment deadline, visa deadline — for any that don't have a manual override stored.

**Also worth knowing:** changing `name` regenerates `slug` (`expos.js:306-310`). Any
public/bookmarked URL built on the old slug (`GET /api/expos/slug/:slug`, `expos.js:138`)
stops resolving. Not date-related, but it sits on the same endpoint ops would be using.

**Recommendation for the date question specifically: editing an expo's dates is safe before
and after a fair, and genuinely hazardous during one.** The endpoint gives no protection
against that today.

---

## TASK 5 — Combining expos on the same dates (discovery only)

### 5.1 Does a grouping concept exist? **YES — VERIFIED in code, migration 010**

`migrations/010_expo_operations.sql` (dated 2026-06-16, committed `335dacd` 2026-06-18)
creates a first-class grouping entity:

```sql
-- expo_clusters — group of equal expos (no parent/child).
CREATE TABLE IF NOT EXISTS expo_clusters (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    city        VARCHAR(255),
    country     VARCHAR(255),
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Cluster link (nullable — supports the "leaves a cluster" scenario)
ALTER TABLE expos ADD COLUMN IF NOT EXISTS cluster_id INTEGER REFERENCES expo_clusters(id);
```

The migration's own header comment states the design intent: **"group of equal expos
(no parent/child)"** — i.e. co-located peers, exactly the request.

**⟳ RESOLVED — migration 010 IS applied in production. VERIFIED:**
```sql
SELECT to_regclass('public.expo_clusters'), to_regclass('public.expo_sectors'),
       to_regclass('public.expo_partners'), to_regclass('public.core_countries'),
       to_regclass('public.core_sectors');
→ all five return their table name (none NULL)

SELECT COUNT(*) FROM information_schema.columns WHERE table_name='expos'
  AND column_name IN (...the 27 new columns...);
→ 27   ← exactly the count the migration's own verification block expects
```

**But it was never adopted — ⟳ VERIFIED:**
```sql
SELECT c.id,c.name,(SELECT COUNT(*) FROM expos e WHERE e.cluster_id=c.id) FROM expo_clusters c;
→ 0 rows
```
**`expo_clusters` is empty. Zero clusters exist, zero expos are assigned to one.**
Likewise `country_code`, `city`, `venue`, `cluster_id`, `edition_year` are **NULL on all 15
expos**, and `status` is `'announcement'` on every expo including ones that finished months
ago (expo 1 ran Sep 2025). **The Expo Operations schema shipped and the fields were never
filled in** — consistent with the UI being unreachable (6a).

**⟳ Full `expos` column list — VERIFIED (43 columns, `information_schema.columns`):**

Only **`id`** and **`name`** are `NOT NULL`. **Every other column is nullable** — including
`organizer_id`, `start_date`, and `end_date`. (The create endpoint enforces
name/start/end at the application layer, `expos.js:209-211`, but the *database* does not.)

| Group | Columns |
|---|---|
| Legacy core (16) | `id`✱, `organizer_id`, `name`✱, `slug`, `location`, `description`, `logo_url`, `start_date`, `end_date`, `created_at`, `updated_at`, `form_id`, `settings` (jsonb), `default_badge_template_id`, `reactivation_closed_at`, `reactivation_closed_by` |
| Migration 010 identity (8) | `edition_year`, `country_code`, `city`, `venue`, `organizer_role` *(default `main_organizer`)*, `status` *(default `announcement`)*, `show_open_hours`, **`cluster_id`** |
| Migration 010 offsets (8) | `buildup_1_days_before` (3), `buildup_2_days_before` (2), `standard_buildup_days_before` (1), `catalogue_deadline_days_before` (25), `stand_design_deadline_days_before` (25), `payment_deadline_days_before` (30), `visa_deadline_days_before` (40), `breakdown_days_after` (0) |
| Migration 010 overrides (8) | `buildup_day_1`, `buildup_day_2`, `standard_buildup_day`, `catalogue_submission_deadline`, `stand_design_confirmation_deadline`, `payment_deadline`, `visa_support_deadline`, `breakdown` — all `date`, all NULL |
| Migration 010 URLs (3) | `catalogue_form_url`, `stand_design_form_url`, `visitor_preregistration_form_url` |

✱ = `NOT NULL`. 16 + 27 = 43 ✓ — confirming migration 010 applied cleanly and completely.

Note `settings` (jsonb) carries a default nobody documented:
`{"auto_checkin_on_badge_print": true, "duplicate_threshold_seconds": 120}`.

**Supporting API + UI already exist (VERIFIED):**

| Layer | Evidence |
|---|---|
| `routes/clusters.js` | Full CRUD: `GET /` (17), `POST /` (34), `PUT /:id` (51), `DELETE /:id` (70), **`GET /:id/expos` (91)** |
| Mount | `index.js:71` (load), `index.js:121` (`app.use('/api/clusters', clusterRoutes)`) |
| Assign | `PUT /api/expos/:id/cluster` (`expos.js:500`); `cluster_id` also in `WRITABLE_FIELDS` (`expos.js:169`) |
| UI | `public/expo-clusters.html`, linked from `public/expo-list.html:98` |

`clusters.js:91-96` is the one genuinely multi-expo read in the system:
```sql
SELECT id, name, start_date, end_date, status, country_code
FROM expos WHERE cluster_id = $1 ORDER BY start_date NULLS LAST, name
```

### 5.2 How hard is per-expo isolation? **VERIFIED — hard, and uniform**

`expo_id` is not a filter that gets appended — it is **filter #1, structurally**:

```js
// routes/visitors.js:17-19 — buildVisitorFilter, shared by /paginated, /export, /bulk-email
function buildVisitorFilter(query, expo_id) {
  const filters = ['expo_id = $1'];
  const values = [expo_id];
  let idx = 2;
```
Every optional filter appends from `$2` onward. `expo_id` **cannot be omitted** without
rewriting the function — `$1` is referenced by the correlated subqueries at
`visitors.js:40,42,45,47,50` too.

Same shape elsewhere (VERIFIED):
- `routes/checkins.js:55` — `WHERE qr_code = $1 AND expo_id = $2`
- `routes/checkins.js:76-79` — per-expo counts, `WHERE v.id = $1 AND v.expo_id = $2`
- `routes/checkins.js:229` — `countQuery += ' AND c.expo_id = $N'`
- `routes/reports.js:933-981` — every Fair-Total query is `… = $1` with a single expo_id
- `routes/expos.js:331` — writes scoped `AND organizer_id = $N`

Frontend mirrors it: `localStorage.selectedExpoId` is a **single scalar** set on the
dashboard and read by every admin page (documented in `CLAUDE.md` "Frontend State Yönetimi"
and consistent with the redirect rules; the sidebar shows one `selectedExpoName`).

### 5.3 Existing multi-expo / cross-expo reads — **VERIFIED, three kinds**

1. **True multi-expo read (one):** `clusters.js:91-96`, `GET /api/clusters/:id/expos` —
   returns all expos in a cluster. It returns *expo rows*, **not** aggregated visitors or
   check-ins.
2. **Cross-expo clone (three)** — confirms the docs' claim: `routes/terminals.js:52`,
   `routes/forms.js:272`, `routes/emailTemplates.js:266`, all
   `router.post('/clone/:id', authMiddleware, …)`. These **copy a row into another expo**;
   they do not read across expos.
3. **Organizer-wide aggregate (one):** `reports.js:380-382` counts active/upcoming/past
   expos for the organizer — a count of expos, not of their contents.

**⟳ Co-location is a real, recurring operational pattern — VERIFIED.** Expos sharing exact
start+end dates:

| dates | n | expos |
|---|---|---|
| 2026-03-03 → 03-05 | 3 | `4:Mega Clima Ghana 2026 (Test)`, `5:Mega Clima Ghana 2026`, `6:Ghana Mega Water 2026` |
| 2026-05-19 → 05-21 | 2 | `7:Mega Clima Nigeria 2026`, `8:Nigeria Mega Water 2026` |
| 2026-06-17 → 06-19 | 2 | `10:Mega Clima Kenya 2026`, `12:Kenya Mega Water Expo 2026` |

The request is grounded in three real past instances — always the pattern "Mega Clima X" +
"X Mega Water". **However, the upcoming expo 13 is standalone** — no other expo shares
25–27 Aug. So this is *not* urgent for the fair in 7 days; it is a real need for the next
co-located pair.

**No endpoint anywhere aggregates visitors, check-ins, or reports across more than one expo.**

### 5.4 Factual statement of distance

- **Schema layer: already there** (contingent on migration 010 being applied).
  `expo_clusters` + `expos.cluster_id` model exactly "a set of co-equal expos", and
  `expo_clusters` even carries its own `start_date`/`end_date`/`city`/`country` — the
  co-location attributes.
- **Cluster management layer: already there.** Full CRUD API + a UI page + membership
  assignment + a cluster→expos listing.
- **Query layer: not there at all.** Every operational read (`visitors`, `checkins`,
  `reports`, `terminals`, `forms`, `badge_templates`) takes exactly one `expo_id` as `$1`.
  Nothing accepts a cluster, a list, or an array.
- **Session/"selected expo" layer: not there.** `selectedExpoId` is one scalar in
  localStorage, consumed by ~20 admin pages independently.

**So the gap is not schema and not cluster CRUD — it is (a) the query layer, which would
need to accept a set of expo ids rather than one, and (b) the frontend "selected expo"
concept, which is a single scalar today.** Whether visitor identity should merge across
co-located expos (the same person is currently a separate `visitors` row per expo, since
email uniqueness is per-expo) is a third question this discovery does not answer.

*No architecture, design, or migration proposed — per brief.*

---

## TASK 6 — Pre-fair risk snapshot

### 6.1 todo.md backlog — verified sample of 6 — **VERIFIED**

`todo.md`, 618 lines, self-dated 18 May 2026. Checked against actual code:

| # | todo item | Checkbox | Reality | Verdict |
|---|---|---|---|---|
| 1 | Zoho webhook phone mapping fix (`webhook.js:57`) | `[ ]` open | **Applied** — `webhook.js:57` has `?? req.body.mobile ?? req.body.Mobile`; `knownFields:67` has `'mobile','Mobile'`; `visitors.js:208` parallel fix present | **STALE — actually done** |
| 2 | `webhook.js` → send via email_queue, drop direct sgMail | `[ ]` open | **Applied** — `grep -c "INSERT INTO email_queue" routes/webhook.js` → 1; no `sgMail.send` in `webhook.js` | **STALE — actually done** |
| 3 | `emailSend.js` bulk/single → email_queue | `[ ]` open | **Still open** — 0 email_queue INSERTs; sends synchronously via `sendEmailWithReplyTo` at `emailSend.js:94` and `:223` | **CORRECT — open** |
| 4 | `emailSegments.js` → email_queue | `[ ]` open | **Still open** — 0 email_queue INSERTs; `emailSegments.js:160` synchronous send | **CORRECT — open** |
| 5 | `leads.js:99-128` → replace duplicate-check with `ON CONFLICT` | `[ ]` open | **Still open** — `leads.js` still SELECT-then-INSERT (~line 101 SELECT, ~line 126 INSERT), no `ON CONFLICT` | **CORRECT — open** |
| 6 | Delete legacy pages + `*.backup.html` | `[ ]` open | **Still open** — 10 files present: `dashboard.html`, `admin-dashboard.html`, `main-panel.html`, plus `checkins/dashboard/expo-create/main-panel/qrscanner/register/reports.backup.html` | **CORRECT — open** |

**Verdict: 2 of 6 checkboxes are wrong (both in the "already fixed" direction).**
`todo.md` under-reports progress; it does not over-report it. Safe to use as a superset of
open work, not as a status source. Independently, `todo.md` predates the entire Expo
Operations module and the ELL finance module, so it is also *missing* three months of work.

One live sgMail bypass remains repo-wide: `routes/auth.js:115` (registration notification).

### 6.2 Operationally dangerous with a fair in 7 days — ⟳ ALL VERIFIED

#### 🔴 a) Expo 13 has **ZERO terminals**. Nothing can check anyone in.

```sql
SELECT COUNT(*) FROM terminals WHERE expo_id = 13;  → 0
SELECT COUNT(*) FROM checkins  WHERE expo_id = 13;  → 0
```

24 terminals exist in the system; **none belong to expo 13.** They are spread across expos
1 (6), 3 (6), 4 (1), 5 (3), 7 (6), 8 (2). With 3,289 visitors already registered and the
doors opening in 7 days, **terminals, halls, badge templates and terminal keys all still
have to be created.** This is the single largest operational gap found.

`badge_templates` has **no `expo_id` column** (verified via `information_schema` — it is
`organizer_id` + `visitor_type` scoped), so templates are shared organizer-wide and do not
need per-expo creation; but the **terminal→badge_template assignment** does.

#### 🔴 b) May's bulk-print terminal keys are **still live**, and they are in the public repo.

```sql
SELECT id,expo_id,terminal_no,kind,is_active FROM terminals WHERE kind='bulk_print';
```
| id | expo_id | terminal_no | kind | is_active | key prefix |
|---|---|---|---|---|---|
| 33 | 7 | BULKPRINT-1 | bulk_print | **true** | `50a9d2a4…` |
| 34 | 8 | BULKPRINT-WATER-1 | bulk_print | **true** | `77565c52…` |

**Those prefixes match the full UUIDs written in plaintext at `CLAUDE.md` v4.0.5** —
`50a9d2a4-76b4-437a-818e-271193777fff` and `77565c52-fee4-40d9-a378-22c5112529a2` — in a file
committed to `https://github.com/Nsueray/Leena_v401_monorepo`.

Why this matters: `middleware/dualAuth.js` lets a `bulk_print` terminal key stand in for a
JWT on `GET /api/visitors/paginated` **and** `POST /api/visitors/import`. So these keys grant
**read of the full visitor list and write of new visitor records** for expos 7 and 8 —
to anyone with repo access — three months after those fairs ended.

**And all 24 terminals in the system are `is_active = true`**, including six from expo 1
(Sep 2025) and one literally named `test1`/hall `test`. Terminal auth is documented as
open-ended ("Süresiz"), so nothing expires on its own.

**Recommendation: deactivate terminals for finished fairs, and rotate the two bulk-print
keys, before opening expo 13.** Note this is a data change (`terminals.is_active`), so it
needs Suer in Render Shell — it is outside this read-only session.

#### 🟡 c) Test data already in expo 13 — 4 rows

| id | email | name | origin |
|---|---|---|---|
| 61722 | `test@test.com` | test | zohoform |
| 61702 | `h.ounacer@gmail.com` | test | zohoform |
| 59726 | **`yaprakguzelcik@gmail.com`** | Yaprak | public |
| 59725 | **`elan02@elan-expo.com`** | Elahe | public |

The last two are on the exact list migration 007 cleaned in May to get clean baseline
metrics. **The same sweep should be re-run for expo 13**, using migration 007's proven
two-phase pattern (`sed 's/^COMMIT;$/ROLLBACK;/'` dry run first).

#### 🟢 d) `Africa/Lagos` hardcoding — risk **DOWNGRADED** for this fair

29 hardcoded sites (`visitors.js:40,44,45`; `reports.js` ~25 sites; `main-panel-v2.html:1253`).
**Expo 13 is in Nigeria, so Lagos is the correct timezone and every "today" metric will be
right.** This is a non-issue for 25–27 Aug.

**It becomes a live defect five weeks later.** Morocco Siema Expo 2026 (id 9, 22–24 Sep) is
UTC+1 **with DST**, versus Lagos UTC+1 **without**. In late September Morocco is on UTC+1
and Lagos on UTC+1 — so the day boundary happens to align, but only by coincidence and only
until Morocco's DST changes. `todo.md` records the same Nigeria-hardcoding in
`phoneNormalize` (`COUNTRY_CODE = '+234'`), still open. **Worth scheduling before the
Morocco fair, not before this one.**

#### 🟡 e) Five backup tables still in production

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%backup%';
```
`conference_topic_backup_20260513` · `conference_topic_backup_20260518` ·
`exhibitor_job_title_backup_20260513` · `visitors_test_backup_20260514` · **`visitors_backup`**

Four match the May documentation. **`visitors_backup` appears in no document I read** —
undated, unexplained, provenance unknown. `visitors_test_backup_20260514` carries an
explicit *"DROP after fair end 21 May 2026"* instruction, now **~3 months overdue**.
Harmless in themselves; they show post-fair cleanup was never completed.

#### 🟡 f) The dead pencil and the orphaned Expo Operations UI

`dashboard_new.html:667` has no handler, and `expo-list/form/clusters/partners.html` are
linked from nowhere. Not dangerous — but the cheapest available win, and almost certainly
why ops believes expo editing does not exist.

#### 🟡 g) Untracked SQL at the backend root

`cleanup-day12-dryrun.sql` / `cleanup-day12-commit.sql` sit next to `index.js`, uncommitted.
The commit variant contains `DROP TABLE IF EXISTS conference_topic_backup_20260518;` (line 18)
followed by UPDATEs. Inert unless someone runs `psql -f` on the wrong file. Commit or delete.

### 6.3 Email worker — ⟳ VERIFIED HEALTHY

```sql
SELECT status, COUNT(*), MIN(created_at) AS oldest, MAX(sent_at) AS last_sent
FROM email_queue GROUP BY status;
```
| status | count | oldest | last_sent |
|---|---:|---|---|
| `sent` | 233,470 | 2026-02-06 | **2026-08-18 09:11** |
| `cancelled` | 42,077 | 2026-05-12 | — |

**No `pending`, no `failed`, no `processing` rows exist at all — the queue is fully drained.**
Stuck-row check (`status='processing'` older than 1h): **0**.

Throughput over the last 8 hours — steady, no stall:
`02:00→12` · `03:00→11` · `04:00→16` · `05:00→28` · `06:00→29` · `07:00→62` · `08:00→64` · `09:00→5`

The 42,077 `cancelled` rows are the documented May test-domain incident
(`@leena-test.local`), correctly cancelled and never sent. **The worker is up and keeping
pace with live registration traffic. No action needed.**

Two related items remain open in `todo.md` and are unaffected by the above: worker→`email_logs`
status sync, and stale-`processing` recovery (risk R5) — the latter currently has nothing to recover.

---

## OPEN QUESTIONS FOR SUER — ⟳ REVISED

Most of the original blocking questions answered themselves once the DB came back.
What remains is decisions, not facts.

### 🔴 Must decide before 25 August (7 days)

1. **Expo 13 has zero terminals.** Who is creating them, and when? Nothing can check in a
   visitor today. This is bigger than any bug in this report.
2. **Rotate/deactivate the two May bulk-print keys?** Both are `is_active=true` and both are
   in plaintext in `CLAUDE.md` in the GitHub repo, and they grant visitor-list read +
   visitor import on expos 7/8. Also: deactivate the 22 other terminals belonging to
   finished fairs?
3. **Task 2 — fix the handler now or after the fair?** My read: **now.** It is two additive
   lines, the diagnosis is measured rather than guessed, and ~200–270 broken rows are
   arriving daily. Waiting means the whole fair runs with 57% of visitors title-less.
4. **Task 2 — backfill the 1,758 existing rows?** Separate decision from the handler fix.
   Values are all intact in `custom_fields.title`. May's precedent (52 rows + backup table)
   is the template. **Handler first, then backfill** — the reverse order leaves new
   registrations broken.
5. **Remove the 4 test rows from expo 13** before the fair, as was done in May?

### 🟡 Confirmations that would close remaining gaps

6. **Does the purple symptom match my prediction?** Purple header + **green `#009846`**
   button + footer reading "Powered by Leena v401 © 2026". If any of those three differs,
   tell me — my root cause would be incomplete.
7. **What commit is deployed?** Still the one thing I cannot read. Migration 010 *is* applied
   in production, which suggests you ran it deliberately — but that does not prove the
   matching code deployed. Render → Leena_v401 → Events.
8. **`visitors_backup`** — undocumented table, no date in the name, provenance unknown. Yours?
   Safe to drop, or is it load-bearing?

### 🟢 Scope decisions, not urgent

9. **Did you know `expo-form.html` / `expo-list.html` / `expo-clusters.html` exist?** All
   fully built, all reachable only by typing the URL. If ops just needs to *reach* them,
   this is a navigation-link change, not a feature build.
10. **`expo_clusters` is applied but empty** — 0 clusters, and `country_code`/`city`/`venue`/
    `status` are unfilled on all 15 expos. Was Expo Operations abandoned, parked, or simply
    never announced to ops?
11. **Co-located expos: not urgent for this fair** — expo 13 is standalone. But it has
    happened 3 times (Ghana ×3, Nigeria ×2, Kenya ×2), always "Mega Clima X" + "X Mega Water".
    **What does "work together" mean operationally** — one combined visitor list, shared
    check-in terminals, a merged report, or one badge valid at both? The answer decides
    whether this is a query-layer change or a schema/identity change.
12. **Dead pencil at `dashboard_new.html:667`** — point it at `expo-form.html?id=`, or remove it?
13. **Guard against editing expo dates during a live fair?** None exists today, there is no
    audit trail, and a single-field update can produce `start > end` (making all Fair Totals
    read 0).
14. **`Africa/Lagos` hardcoding** — correct for expo 13, latent for **Morocco (22–24 Sep)**.
    Schedule before that fair?
15. **Drop the 5 backup tables?** One is ~3 months past its documented drop date.
16. **`checkinReports.js:72` reads only `custom_fields->>'job_title'`** (not `title`, not the
    column) and will stay blank even after the Task 2 fix. Separate ticket, or in scope?
17. **The two untracked `cleanup-day12-*.sql`** at the backend root — commit or delete?
18. **`todo.md` / `CLAUDE.md` are 3 months behind** and miss two entire modules. Refresh pass?

---

## APPENDIX — What was NOT done, deliberately

Per the brief's hard constraints, this session made **no** code changes, **no** git
operations beyond reads (`log`, `status`, `branch`, `remote`, `rev-list`,
`fetch --dry-run`), **no** database writes (none were possible), and **no** deploys.
The only file created is this report, left untracked and uncommitted.

No diffs are proposed and no branch was opened. Awaiting review.
