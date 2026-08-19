# Reactivation Segmentation SQL + Recipient Sheet Formats
**Date:** 2026-08-18 · **PRE-WRITTEN, NOT EXECUTED.**

**Tonight's target: `expo_id = 13` — Nigeria Mega Project Expo 2026, 25–27 Aug, opens in
7 days.** The ~52k verified file is Nigeria data.
**Later, separate run: `expo_id = 9` — Morocco Siema Expo 2026, 22–24 Sep, SIEMA data.**

Everything is parameterised on `:target_expo_id`. Set it to **13** tonight, **9** for SIEMA.
The only value that changes between runs is that parameter and the public-form id in the
Group 3 template (form **53** for expo 13, form **51** for expo 9).

## 🔴 Expo 13 is NOT a clean slate — read before running Group 2

Verified earlier today, before DB access dropped:

| fact | value |
|---|---|
| Existing reactivation tokens on expo 13 | **9,976** (9,632 `pending`, 344 `activated`) |
| Created | 2026-08-09 → 2026-08-17 |
| Visitors already on expo 13 | **3,390** distinct emails |

Two consequences:

1. **`create-from-excel` will silently skip anyone who already holds a token.**
   `prepareExcelRows` checks `existingTokenEmails` and increments `skipped_duplicate`. Those
   people are *not* broken — they already have a valid token — but they will not appear in
   the new batch. **Do not read a low `valid` count as a failure.**
2. **STEP 3's Group 2 export selects ALL `pending` tokens for the expo**, so it will return
   the 9,632 pre-existing ones alongside anything new. If tonight's campaign should target
   only the new batch, filter by `created_at::date = CURRENT_DATE` — noted inline in STEP 3.

## Token expiry for expo 13 — the floor applies, and that is correct

`end_date` 2026-08-27 → `end_date + 1 day` = 2026-08-28, which loses to the 30-day floor of
2026-09-17. So tokens minted tonight expire **2026-09-17 — three weeks after the fair ends.**
Safe. The fair-anchored branch does not engage because the fair is nearer than 30 days; that
is the floor doing its job, not a bug. (The pre-existing 9,976 tokens were minted under the
old code and also expire well after 27 Aug.)

---

## STEP 0 — stage the verified list (Suer, Render Shell — this is a WRITE)

The ~52k verified list lives outside LEENA, so it must be staged first.

```sql
CREATE TABLE IF NOT EXISTS staging_siema_list_20260818 (
  email        TEXT,
  first_name   TEXT,
  last_name    TEXT,
  company      TEXT,
  country      TEXT,
  job_title    TEXT,
  source_note  TEXT           -- e.g. 'zoho_2019_2025' / 'leena_expo1'
);
-- \copy staging_siema_list_20260818 FROM 'verified.csv' WITH (FORMAT csv, HEADER true)

-- Normalised, deduped working view. All segmentation reads from this.
CREATE OR REPLACE VIEW v_siema_list AS
SELECT DISTINCT ON (lower(trim(email)))
       lower(trim(email)) AS email,
       NULLIF(trim(first_name),'') AS first_name,
       NULLIF(trim(last_name),'')  AS last_name,
       NULLIF(trim(company),'')    AS company,
       NULLIF(trim(country),'')    AS country,
       NULLIF(trim(job_title),'')  AS job_title,
       source_note
FROM staging_siema_list_20260818
WHERE email IS NOT NULL
  AND position('@' in email) > 1
ORDER BY lower(trim(email)), (first_name IS NULL), (company IS NULL);
```
`DISTINCT ON … ORDER BY (first_name IS NULL), (company IS NULL)` keeps the **richest** row per
address rather than an arbitrary one.

---

## STEP 1 — segmentation counts (READ-ONLY, run this first)

```sql
WITH params AS (SELECT 13::int AS target_expo_id),  -- 13 tonight, 9 for SIEMA
list AS (SELECT * FROM v_siema_list),

-- Already registered for the TARGET expo → exclude from both campaigns
g1 AS (
  SELECT l.email FROM list l
  WHERE EXISTS (SELECT 1 FROM visitors v, params p
                WHERE v.expo_id = p.target_expo_id
                  AND lower(trim(v.email)) = l.email)
),
-- Any LEENA visitor history on ANY other expo → reactivate flow
g2 AS (
  SELECT l.email FROM list l
  WHERE l.email NOT IN (SELECT email FROM g1)
    AND EXISTS (SELECT 1 FROM visitors v WHERE lower(trim(v.email)) = l.email)
),
-- No LEENA record at all → register flow
g3 AS (
  SELECT l.email FROM list l
  WHERE l.email NOT IN (SELECT email FROM g1)
    AND l.email NOT IN (SELECT email FROM g2)
),
unsub AS (SELECT DISTINCT lower(trim(email)) AS email FROM email_unsubscribes)

SELECT 'TOTAL verified list'              AS segment, COUNT(*)::int AS n FROM list
UNION ALL SELECT 'G1 already reg (exclude)',        COUNT(*)::int FROM g1
UNION ALL SELECT 'G2 reactivate (raw)',             COUNT(*)::int FROM g2
UNION ALL SELECT 'G3 register (raw)',               COUNT(*)::int FROM g3
UNION ALL SELECT 'G2 minus unsubscribed',           COUNT(*)::int FROM g2 WHERE email NOT IN (SELECT email FROM unsub)
UNION ALL SELECT 'G3 minus unsubscribed',           COUNT(*)::int FROM g3 WHERE email NOT IN (SELECT email FROM unsub)
UNION ALL SELECT 'unsubscribed hits in list',       COUNT(*)::int FROM list WHERE email IN (SELECT email FROM unsub);
```

**Sanity check: G1 + G2 + G3 must equal TOTAL.** The three sets are mutually exclusive by
construction (G2 and G3 both exclude G1; G3 excludes G2).

**Expected shape from the 18 Aug discovery pass:** LEENA holds 50,406 distinct emails, of
which 21,707 are SIEMA (expos 1+9) and only **15** overlap with all other expos. So on a ~52k
list the split will be heavily G3-weighted unless the list is mostly the LEENA-derived 21.7k.

---

## STEP 2 — Group 2 export → reactivation token seed (READ-ONLY)

Group 2 needs tokens **before** its recipient sheet can be built. Export this, upload it to
`POST /api/reactivation/create-from-excel` with `target_expo_id=13` and **no `template_id`**
(verified today on expo 17: generates tokens, sends nothing).

```sql
WITH params AS (SELECT 13::int AS target_expo_id),  -- 13 tonight, 9 for SIEMA
list AS (SELECT * FROM v_siema_list),
g1 AS (SELECT l.email FROM list l
       WHERE EXISTS (SELECT 1 FROM visitors v, params p
                     WHERE v.expo_id = p.target_expo_id AND lower(trim(v.email)) = l.email)),
unsub AS (SELECT DISTINCT lower(trim(email)) AS email FROM email_unsubscribes)
SELECT
  l.email,
  COALESCE(l.first_name, v.name)      AS name,          -- prepareExcelRows reads `name`
  COALESCE(l.last_name,  v.last_name) AS last_name,
  COALESCE(l.company,    v.company)   AS company,
  COALESCE(l.country,    v.country)   AS country,
  COALESCE(l.job_title,  v.job_title) AS job_title
FROM list l
JOIN LATERAL (
  SELECT name, last_name, company, country, job_title
  FROM visitors v2 WHERE lower(trim(v2.email)) = l.email
  ORDER BY v2.updated_at DESC NULLS LAST, v2.id DESC LIMIT 1
) v ON TRUE
WHERE l.email NOT IN (SELECT email FROM g1)
  AND l.email NOT IN (SELECT email FROM unsub)
ORDER BY l.email;
```
The `LATERAL` picks each address's **most recently updated** LEENA row, so prefill uses the
freshest known data. Column names match `prepareExcelRows` (`reactivation.js`): it reads
`name` / `Name` / `first_name`, `last_name`, `company`, `country`, `job_title`.

⚠️ **Token prefill is frozen at creation time** (`/verify` returns the `reactivation_tokens`
row, never a live `visitors` join). Run any data cleanup *before* this step.

---

## STEP 3 — Group 2 recipient sheet (READ-ONLY, AFTER tokens exist)

```sql
SELECT
  rt.email                                                        AS email,
  rt.name                                                         AS first_name,
  rt.last_name                                                    AS last_name,
  rt.company                                                      AS company,
  'https://leena.app/reactivate.html?token=' || rt.token           AS activation_url
FROM reactivation_tokens rt
WHERE rt.target_expo_id = 13          -- 13 tonight, 9 for SIEMA
  AND rt.status = 'pending'
  -- Expo 13 already holds 9,632 pending tokens from the 9-17 Aug campaign.
  -- To target ONLY tonight's new batch, uncomment:
  -- AND rt.created_at::date = CURRENT_DATE
ORDER BY rt.email;
```

---

## STEP 4 — Group 3 recipient sheet (READ-ONLY, no tokens needed)

```sql
WITH params AS (SELECT 13::int AS target_expo_id),  -- 13 tonight, 9 for SIEMA
list AS (SELECT * FROM v_siema_list),
unsub AS (SELECT DISTINCT lower(trim(email)) AS email FROM email_unsubscribes)
SELECT
  l.email       AS email,
  l.first_name  AS first_name,
  l.last_name   AS last_name,
  l.company     AS company,
  l.country     AS country,          -- not a knownCol → extra_fields
  l.job_title   AS job_title         -- not a knownCol → extra_fields
FROM list l
WHERE NOT EXISTS (SELECT 1 FROM visitors v WHERE lower(trim(v.email)) = l.email)
  AND l.email NOT IN (SELECT email FROM unsub)
ORDER BY l.email;
```
Group 3 needs **no LEENA import** — verified: `campaign_recipients.visitor_id` is written by
the from-expo path but never read; all tracking keys on `recipient_id`. The visitor row is
created by the public-form submission at conversion time.

---

## RECIPIENT SHEET FORMATS

`knownCols` (`campaigns.js:469-475`) — these map to real columns; **everything else becomes
`extra_fields`** and is available as a `{{placeholder}}`:

```
email, Email, EMAIL, e_mail
first_name, First Name, name, Name
last_name, Last Name, surname, Surname
company, Company, COMPANY, organization
```

### Group 2 — "reactivate"

| column | → | placeholder |
|---|---|---|
| `email` | `campaign_recipients.email` | `{{email}}` |
| `first_name` | column | `{{first_name}}`, `{{name}}` |
| `last_name` | column | `{{last_name}}` |
| `company` | column | `{{company}}` |
| **`activation_url`** | **`extra_fields`** | **`{{activation_url}}`** |

Template must link `href="{{activation_url}}"`. Substitution runs before the matcher
(`email_worker.js:531-532` → `:551`), so the resolved URL contains `reactivate.html`, the
matcher appends `_lc`, and `wrapClickLinks` wraps it last. Verified live on expo 17.

### Group 3 — "register"

| column | → | placeholder |
|---|---|---|
| `email` | column | `{{email}}` |
| `first_name` | column | `{{first_name}}`, `{{name}}` |
| `last_name` | column | `{{last_name}}` |
| `company` | column | `{{company}}` |
| `country`, `job_title`, … | `extra_fields` | `{{country}}`, `{{job_title}}` |

Template must link to the **target expo's public form** — form **53** (`Visitor Registration
Form`, expo 13, active) tonight; form **51** for expo 9 (SIEMA). The matcher already handles `form-public.html`, so `_lc` is appended and
`visitors.js:452-468` records `registered` on submit. **Group 3 needs no code changes.**

---

## SEQUENCE

| # | action | write? | who |
|---|---|---|---|
| 0 | stage verified list + create view | **yes** | Suer |
| 1 | run segmentation counts | no | me |
| 2 | export G2 seed → `create-from-excel` (**no `template_id`**) | yes (API) | — |
| 3 | export G2 recipient sheet (tokens now exist) | no | me |
| 4 | export G3 recipient sheet | no | me |
| 5 | build 2 campaigns + steps, upload both sheets | yes (API) | — |
| 6 | launch | yes | Suer |

## OPEN POINTS

1. **Tonight = expo 13** (Nigeria, 52k file). SIEMA/expo 9 is a later run with SIEMA data.
   Resolved.
2. **Expo 13 tokens expire 2026-09-17** (30-day floor; fair ends 08-27). Safe. The
   fair-anchored branch was verified live on throwaway expo 17 → 2026-10-03.
3. **Expo 13 already holds 9,976 tokens and 3,390 visitors** — see the clean-slate warning
   above before running Group 2.
4. **No bounce data exists in LEENA** — a "verified" list must be verified externally
   (ZeroBounce is not integrated anywhere in the codebase).
5. `prefetchEmails` uses `LOWER(email)` without `TRIM` while the filter loop uses
   `.toLowerCase().trim()`. Currently harmless — 0 untrimmed emails in production — but the
   staging view normalises with `lower(trim())`, so a stray padded address in the CSV could
   slip the "already exists" check. Worth a `TRIM` in the staging import.
