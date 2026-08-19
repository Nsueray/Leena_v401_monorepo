# EXEC BRIEF 02 — Findings & Proposed Diffs
**Date:** 2026-08-18 · **Mode:** analysis + proposal only. Nothing applied, nothing committed, no DB writes.
**Companion to:** `DISCOVERY_20260818.md` (its VERIFIED findings are taken as settled and not re-derived).

Paths relative to `backend/leena-v401-backend/` unless stated.
Target expo throughout: **`expo_id = 13`, Nigeria Mega Project Expo 2026, 25–27 Aug — 7 days out.**

---

## HEADLINE FOR EACH ITEM

| | Verdict | Fix type | Files | Risk |
|---|---|---|---|---|
| **ITEM 1** | **(ii) CODE problem — settled.** The config is already correct; `reactivate.html` ignores it. | Frontend; +1 optional backend read | 1–2 | Low |
| **ITEM 2** | **`??` works. Verified from production data, not logs.** | 1 line | 1 | Very low |

**Two corrections to the brief's own assumptions, both material:**

1. **ITEM 1 — "`data.form_config` is already in scope, so no new endpoint needed" is wrong.**
   `form_config` is `forms.**config**` (the *style* blob). The required flags live in
   `forms.**fields**`, a **different column that the verify endpoint does not select.**
   A config-driven fix therefore *does* need a one-line backend change.
2. **ITEM 1 — "If JS, native HTML5 `required` never fires" is wrong here.**
   The listener is on the **form's `submit` event**, not a button click. Browser constraint
   validation runs *before* that event is dispatched, so `required` **does** fire today —
   which is exactly why First Name and Company are genuinely enforced right now.

---

# ITEM 1 — Reactivate page accepts empty Phone and Job Title

## 1.1 Where do the rendered fields come from?

**The field list is hardcoded in the HTML. It is not built from config at all.**

`public/reactivate.html:353-391` — a static block, verbatim:

```html
355:  <label class="form-label">First Name *</label>
356:  <input type="text" class="form-control" id="name" required>
359:  <label class="form-label">Last Name</label>
360:  <input type="text" class="form-control" id="lastName">
365:  <label class="form-label">Email</label>
366:  <input type="email" class="form-control" id="email" disabled>
370:  <label class="form-label">Company *</label>
371:  <input type="text" class="form-control" id="company" required>
376:  <label class="form-label">Country</label>
377:  <input type="text" class="form-control" id="country">
380:  <label class="form-label">Job Title</label>
381:  <input type="text" class="form-control" id="jobTitle">
386:  <label class="form-label">Phone</label>
387:  <input type="tel" class="form-control" id="phone">
```

There is no loop, no template, no `fields.map(...)`. Seven fixed inputs.

**The endpoint is `GET /api/reactivation/verify/:token`** — confirmed at `reactivation.js:460`.
Its SELECT (`reactivation.js:465-476`):

```sql
SELECT rt.*, e.name as expo_name, e.location as expo_location,
       e.start_date, e.end_date,
       f.config as form_config          -- ← forms.CONFIG, not forms.FIELDS
FROM reactivation_tokens rt
JOIN expos e ON rt.target_expo_id = e.id
LEFT JOIN forms f ON rt.form_id = f.id
WHERE rt.token = $1
```

and its response (`reactivation.js:503-521`) returns `visitor`, `expo`, and
`form_config: tokenData.form_config || null`.

**⚠️ This is the pivotal detail.** `forms.config` holds the *design* blob
(`config.style.primaryColor` etc. — see `DISCOVERY_20260818.md` §3.3). The per-field
`required` flags live in **`forms.fields`**, which this query never touches. So the page
could not honour per-field config today even if it wanted to — the data never arrives.

**Reactivation tokens for expo 13 — ⟳ VERIFIED (read-only):**

```sql
SELECT form_id, status, COUNT(*),
       COUNT(*) FILTER (WHERE COALESCE(job_title,'')<>'') AS tok_has_job_title,
       COUNT(*) FILTER (WHERE COALESCE(phone,'')<>'')     AS tok_has_phone
FROM reactivation_tokens WHERE target_expo_id=13 GROUP BY form_id,status;
```

| form_id | status | count | token has job_title | token has phone |
|---|---|---:|---:|---:|
| **53** | **pending** | **9,326** | 5,229 (56%) | 8,849 (95%) |
| 53 | activated | 325 | 230 (71%) | 319 (98%) |

**Tokens exist and the campaign is large: 9,651 total, 9,326 still pending.** All carry
`form_id = 53` (Visitor Registration Form) — the same form Zoho posts to in Item 2.

**One nuance that softens the impact.** The activate handler writes
`job_title || tokenData.job_title` (`reactivation.js:599`) and
`phone || tokenData.phone` (`reactivation.js:600`) — a blank input **falls back to the value
already stored on the token**. So of the 9,326 pending, ~5,229 already carry a job title that
survives a blank submission. **The visitor's input only decides the outcome for the ~4,097
tokens with no stored job title** (and ~477 with no stored phone). Still worth fixing — but
it is not 9,326 people at risk.

## 1.2 Where does the `*` come from? → **(ii) CODE problem**

**There is no required-marker mechanism. The asterisk is a literal character typed into the
label string.**

- `reactivate.html:355` → `<label class="form-label">First Name *</label>`
- `reactivate.html:370` → `<label class="form-label">Company *</label>`

Nothing computes it. Grep for `required-mark`, `field.required`, or any `*` interpolation in
this file returns nothing — unlike `form-public.html`, which has both (§1.7).

Enforcement is likewise hardcoded: the native `required` **attribute** appears on exactly two
inputs, `#name` (line 356) and `#company` (line 371). Job Title (381) and Phone (387) have
neither the attribute nor the asterisk.

**So the marker and the enforcement are two independent hardcodings that happen to agree.**
The page has no notion of configuration for this.

**This is explanation (ii), decisively — and 1.3 removes any remaining doubt by showing the
config is already correct.**

## 1.3 The stored config — **the form already says these fields are required**

`forms.fields` is a JSONB array; the key that encodes required is exactly **`required`**
(boolean). Form 53 (`expo_id=13`, the form these tokens point at), first four fields —
⟳ VERIFIED via `jsonb_pretty`:

```json
[ { "name": "name",      "label": "First Name",          "type": "text", "required": true },
  { "name": "last_name", "label": "Last Name",           "type": "text", "required": true },
  { "name": "title",     "label": "Job Title / Position","type": "text", "required": true },
  { "name": "company",   "label": "Company",             "type": "text", "required": true } ]
```

**`title` — "Job Title / Position" — is already `required: true` in the form record.**

Two consequences:

1. **Yaprak has nothing to change.** The setting is already on. This is not a config problem,
   and no ops instruction would fix it. Code is the only lever.
2. **It independently corroborates ITEM 2.** The form's field is literally *named* `title` —
   which is precisely why Zoho posts a `title` key that `webhook.js:55` doesn't read.
   Two symptoms, one underlying field name.

Also note `last_name` is `required: true` in config but rendered **without** `*` or `required`
at `reactivate.html:359-360` — so the hardcoded subset diverges from config on **three**
fields, not the two ops reported.

**Does `form-builder.html` expose a per-field required toggle? Yes — ⟳ VERIFIED:**

| Concern | `path:line` |
|---|---|
| The checkbox | `form-builder.html:534` — `<label class="form-check-label" for="fieldRequired">This field is required</label>` |
| Read on save | `form-builder.html:842` — `const required = document.getElementById('fieldRequired').checked;` |
| Written into the field object | `form-builder.html:868` — `const field = { name, label, type, required, placeholder, helpText, options };` |
| Re-populated on edit | `form-builder.html:813` — `document.getElementById('fieldRequired').checked = field.required;` |
| Shown in the builder's own preview | `form-builder.html:920, 986` — renders a `Required` badge and a red `*` |

The toggle exists, works, persists, and is already switched on for Job Title.

## 1.4 How is the form submitted?

**A JS handler on the form's `submit` event** — `reactivate.html:504-505`:

```js
document.getElementById('activationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
```

then `fetch(`${API_URL}/activate`, {method:'POST', ...})` at 513-524, sending
`token, name, last_name, company, country, job_title, phone` — each `.value.trim()`.

**⚠️ Correction to the brief.** The brief cautions that with a JS handler "native HTML5
`required` never fires". **That is not true for this code.** The listener is bound to the
**`<form>`'s `submit` event**, and the button is `type="submit"` (line 388). The browser runs
constraint validation *first*; if a `required` field is empty it blocks submission, shows the
native bubble, and **the `submit` event is never dispatched** — so `preventDefault()` never
runs. That is exactly why First Name and Company are genuinely enforced on production today.

**Practical upshot: adding the `required` attribute to Job Title and Phone is sufficient to
enforce them. No JS validation logic needs to be written.**

**Other client-side validation today: none.** The handler does no emptiness checks, no format
checks, no length checks. It disables the button (507), posts, and branches on `response.ok`.

## 1.5 Server side + isolation — **fully isolated, but propose client-side anyway**

**Validation in `POST /api/reactivation/activate` (`reactivation.js:529`):**

```js
531:  const { token, name, last_name, company, country, job_title, phone } = req.body;
533:  if (!token) {
534:    return res.status(400).json({ success: false, error: 'Token is required' });
535:  }
```

**`token` is the only validated field.** After that it checks token existence (404), expiry
(410), already-activated (409), and duplicate email (returns success with
`already_exists: true`). `name`, `company`, `job_title`, `phone` are **never validated** —
they flow straight into the INSERT at `reactivation.js:582-607` via the
`x || tokenData.x` fallbacks.

Rejection shape: `{ success: false, error: '<message>' }` with 400/404/409/410.

**Isolation check — ⟳ VERIFIED CLEAN.** `routes/reactivation.js` imports only
`express`, `pool`, `multer`, `XLSX`, `crypto`, `uuid`, `generateBadgeUrl`,
`processEmailTemplate`, `authMiddleware` (`reactivation.js:9-18`). **No validation helper is
imported, and none exists in `utils/`.** The `if (!token)` check is inline and local to this
handler. It is **not** shared with `routes/webhook.js`, `visitors.js` POST `/public`,
`/manual`, or `/import` — each of those inlines its own checks.

**So a server-side check here would be technically safe** — it could not leak into the Zoho
path. **I am still proposing client-side only**, for a different reason: the server-side
`x || tokenData.x` fallback is *desirable* behaviour. A blank Job Title currently inherits the
value already on the token, which is right for 5,229 of the 9,326 pending. A server-side
`400` would reject those visitors instead of quietly using data we already hold — **strictly
worse for the visitor and worse for conversion on a campaign about to go out.**

## 1.6 Proposed fix — **written, not applied**

Since 1.3 established the config is already correct, this is code. Two options.

---

### 🟢 OPTION A — Minimal, client-only. **Recommended for the 7-day window.**

**File: `public/reactivate.html` — 4 lines changed, no backend, no DB.**

```diff
@@ reactivate.html:359-360
-  <label class="form-label">Last Name</label>
-  <input type="text" class="form-control" id="lastName">
+  <label class="form-label">Last Name *</label>
+  <input type="text" class="form-control" id="lastName" required>

@@ reactivate.html:380-381
-  <label class="form-label">Job Title</label>
-  <input type="text" class="form-control" id="jobTitle">
+  <label class="form-label">Job Title *</label>
+  <input type="text" class="form-control" id="jobTitle" required>

@@ reactivate.html:386-387
-  <label class="form-label">Phone</label>
-  <input type="tel" class="form-control" id="phone">
+  <label class="form-label">Phone *</label>
+  <input type="tel" class="form-control" id="phone" required>
```

**Decision needed from Suer:** `last_name` is `required: true` in form 53's config, so
including it makes the page match the config exactly. Phone is **not** in the four fields I
dumped — I only inspected `$[0 to 3]`. **Before applying, confirm Phone's `required` value in
form 53** (query in the smoke-test section). If Phone is `required: false` in config, then
marking it required is an ops decision, not a config-alignment one — ops asked for it, so it
is defensible either way, but it should be a conscious choice.

- **Additive?** Yes, in effect. It only *adds* constraints to two (or three) inputs. No
  existing behaviour is removed; no JS, no endpoint, no payload shape changes.
- **Backward compatible with the server?** Yes — `/activate` validates nothing but `token`,
  so a stricter client cannot break it.
- Does **not** follow configuration — it swaps one hardcoded subset for a better hardcoded
  subset. That is the honest trade-off, and why Option B exists.

---

### 🟡 OPTION B — Config-driven. **Correct fix; recommend post-fair.**

Needs a backend change, because §1.1 showed the required flags never reach the page.

**File 1: `routes/reactivation.js:471`** — add one column to the verify SELECT:
```diff
-        f.config as form_config
+        f.config as form_config,
+        f.fields as form_fields
```
and at `reactivation.js:520`, add one line to the response:
```diff
       form_config: tokenData.form_config || null
+      , form_fields: tokenData.form_fields || null
```
Purely additive: a new key on the response; every existing consumer is untouched.
`LEFT JOIN` means legacy tokens with `form_id IS NULL` yield `null` — handled below.

**File 2: `public/reactivate.html`** — after `applyFormStyle(data.form_config)` at line 494,
apply required flags by mapping config field names onto the seven existing input ids:

```
config field name → element id
  name       → #name          last_name → #lastName
  title      → #jobTitle      company   → #company
  country    → #country       phone     → #phone
```
For each mapping present in `form_fields`, set `el.required = !!field.required` and append/
remove the ` *` on its label. **If `form_fields` is null or the field is absent, change
nothing** — the current hardcoded markup stays as the fallback, so legacy tokens and older
forms behave exactly as today.

- Marker and enforcement then both derive from one source, and the `last_name` divergence
  fixes itself.
- Larger surface, and it touches a live endpoint that 9,326 pending emails will hit.
  **My recommendation: not in the 7-day window.**

---

### What happens to an in-flight visitor when this deploys

**Nothing is lost.** `reactivate.html` is a static file served by Express
(`index.js` static middleware). A visitor with the page already open keeps the DOM they
loaded — the deploy cannot alter a rendered page. On submit they POST to `/activate`, which
**Option A does not touch at all**, so their activation succeeds normally under the old rules.
Only *new* page loads get the stricter form.

For **Option B** the same holds for the frontend, but the backend restart (~10-20s on Render)
means a `/verify` or `/activate` request landing exactly in the restart window could fail;
the visitor would see "An error occurred. Please try again." (`reactivate.html:545`) and a
retry succeeds. The token is not consumed on a failed request — `status` only flips to
`activated` after a successful INSERT (`reactivation.js:611`). **No token is burned.**

### Smoke test — literal clicks for Yaprak (production)

Prerequisite — confirm Phone's config value first (read-only):
```sql
SELECT f.id, x->>'name' AS field, x->>'label' AS label, x->>'required' AS required
FROM forms f, LATERAL jsonb_array_elements(f.fields) x
WHERE f.id = 53 ORDER BY 2;
```

1. Get a **pending** token URL for expo 13 (do **not** reuse an activated one — it returns
   409 and shows the error card instead of the form):
   ```sql
   SELECT token FROM reactivation_tokens
   WHERE target_expo_id=13 AND status='pending' LIMIT 1;
   ```
   Open `https://leena.app/reactivate.html?token=<TOKEN>`.
2. Confirm **Job Title** and **Phone** now show `*` in their labels.
3. Clear Job Title. Click **"Confirm & Activate My Pass"**.
   → **Expected:** the browser blocks submission and shows its native "Please fill out this
   field" bubble on Job Title. The button must **not** show the "Processing..." spinner —
   if it does, the submit event fired and the fix is not working.
4. Fill Job Title, clear Phone, click again → same block on Phone.
5. Fill both, click → spinner → green success card with name / email / badge ID.
6. Verify it landed:
   ```sql
   SELECT id,name,job_title,phone,source,origin FROM visitors
   WHERE expo_id=13 AND origin='reactivation_campaign' ORDER BY id DESC LIMIT 1;
   ```
   `job_title` and `phone` must both be non-empty.
7. Re-open the same token URL → **expected:** "already activated" error card (409). Confirms
   token single-use still works.

**Note step 5 consumes a real token and creates a real visitor** on expo 13. Either accept
one extra genuine row, or ask Suer to issue a throwaway token first.

## 1.7 The sibling — `form-public.html` — **findings only, no fix proposed**

**`form-public.html` does NOT have this bug. It is the correct implementation.** It renders
fields from config and honours `field.required` for both the marker and the attribute:

| Concern | `path:line` |
|---|---|
| `required` attribute — text/email inputs | `form-public.html:244`, `:272`, `:309` |
| `required` — textarea | `:260` |
| `required` — radio (first option only) | `:292` |
| Red `*` marker | `:275`, `:321` — `${field.required ? '<span class="required-mark">*</span>' : ''}` |
| Marker CSS | `:125` — `.required-mark { color: #dc3545; }` |

So the two pages diverged: `form-public.html` is config-driven; `reactivate.html` is a
hardcoded snapshot. **`reactivate.html` is the outlier, and Option B above is essentially
"make it behave like `form-public.html`".**

Unexamined and worth a separate look later: whether `form-public.html`'s **server** side
(`visitors.js` POST `/public`) enforces required at all, or trusts the client. Not
investigated — out of scope for this brief.

---

# ITEM 2 — Zoho `title` never reaches `job_title`

## 2.1 The `??` vs `||` question — **RESOLVED: `??` works.**

**I could not read the Render logs** — I have no access to the Render dashboard or its log
API from this session, and I will not guess. **Instead I resolved it from production data,
which is stronger evidence than a single log line**, because it covers 1,910 real submissions
rather than one.

**The natural experiment:** the phone fix already shipped using `??` and is the exact same
shape as the proposed job_title fix.

```js
// webhook.js:57 — shipped in commit 3f68411, 2026-05-21
const phone = req.body.phone ?? req.body.mobile ?? req.body.Mobile ?? '';
```

Established facts:
- `todo.md` records the root cause as *"Zoho `mobile` lowercase gönderiyor, handler sadece
  `phone` okuyor"* — **Zoho sends `mobile`, not `phone`** — and that a **6,214-row backfill**
  was needed, i.e. before the fix `phone` was landing **empty**.
- Fix commit date confirmed: `git log -S "req.body.mobile" -- routes/webhook.js` →
  **`3f68411 2026-05-21`**.

**Result, split at that commit (⟳ VERIFIED, all `origin='zohoform'` rows, all expos):**

| period | rows | phone filled | % | `custom_fields` still leaking `mobile` |
|---|---:|---:|---:|---:|
| pre-fix (`< 2026-05-21`) | 21,907 | 21,763 | 99.3% *(post-backfill)* | 5,753 |
| **post-fix (`>= 2026-05-21`)** | **1,910** | **1,909** | **99.9%** | 18 |

**The inference:**
Zoho sends `mobile` and not `phone`. Post-fix, `phone` is populated on 99.9% of rows. The
only path that can populate it is the `?? req.body.mobile` fallback. **`??` only falls through
on `null`/`undefined` — so `req.body.phone` must be absent from the payload, not an empty
string.** Had Zoho been sending `phone: ""`, the chain would have stopped there and the
post-fix fill rate would be ~0%. It is 99.9%.

**Conclusion: Zoho omits keys it has no value for. `??` falls through correctly.**

**And the corollary the brief asked for: the shipped phone fix is NOT silently ineffective.**
It is demonstrably working — 99.9% fill on 1,910 post-fix rows, versus a 6,214-row backfill
needed before it. *(Reported only. `webhook.js:57` is not touched by this item.)*

The single post-fix row with an empty phone does carry `custom_fields.mobile` — one
edge-case row out of 1,910, not worth chasing before the fair.

**Operator choice: I recommend `||` anyway.** Both work under the verified facts, but:
- `||` also falls through on `''`, so it is correct under **both** hypotheses — it stays right
  even if Zoho's form config changes later to emit empty strings.
- It matches `visitors.js:207`, the reference implementation measured at **97% fill**.
- No downside here: `||` additionally falls through on `0`/`false`, which are not meaningful
  values for a job-title string.

## 2.2 Proposed handler diff

**File: `routes/webhook.js` — one line.**

```diff
@@ routes/webhook.js:55
-    const jobTitle = req.body.jobTitle ?? req.body.job_title ?? '';
+    const jobTitle = req.body.jobTitle || req.body.job_title || req.body.title || '';
```

- **Additive.** The new branch is reached only when `jobTitle` and `job_title` yield nothing —
  which is the current 97%-of-Zoho-traffic case that produces `''` today. Any payload that
  works now produces a byte-identical result.
- **Forward-only.** Existing rows are untouched; see §2.4 for those.
- Mirrors the proven shape at `visitors.js:207`
  (`custom_fields?.job_title || custom_fields?.title || ''`).

**In-flight visitor on deploy:** a Render web-service restart is ~10-20s. A Zoho POST landing
inside that window gets a connection error. Zoho's retry behaviour on webhook failure is
**not something I verified** — if it does not retry, a small number of registrations in that
window could be lost entirely (not merely title-less). **Recommend deploying at a low-traffic
hour**; current volume is ~200–270/day, so the exposure is roughly 1 registration per 5–7
minutes of downtime. Everything already written to the DB is unaffected.

## 2.3 `knownFields` — **deliberately NOT changed**

Per the brief, `webhook.js:63-68` is left alone. `title` continues to be duplicated into
`custom_fields`, and that redundancy is exactly what keeps all 1,776 rows recoverable if the
coalesce chain turns out to have a flaw. **Filed as a post-fair cleanup item.**

Concrete follow-up for the post-fair list: add `'title'` to `knownFields`, and only after the
handler fix has been confirmed working on live traffic **and** the backfill has completed.

## 2.4 Backfill SQL — **written for Suer to run. I have not run it.**

⟳ **Scope has drifted upward as expected** (registrations still arriving):
measured **1,758 → 1,776** rows over roughly one hour of this session.

| expo_id | rows (at time of writing) |
|---|---:|
| **13** | **1,756** |
| 9 | 13 |
| 10 | 5 |
| 7 | 2 |
| **TOTAL** | **1,776** |

Expect the number to be higher again by the time this runs. That is normal — the dry run in
STEP 2 prints the live count, and it should be close to 1,776 plus ~200–270 per elapsed day.

**Run only AFTER the §2.2 handler fix is deployed and confirmed** (see §2.6).

```sql
-- ============================================================
-- Zoho job_title backfill — recover custom_fields->>'title'
-- Run in Render Shell:  psql "$DATABASE_INTERNAL_URL"
-- Pattern follows migration 007 (two-phase, backup-first).
-- ============================================================

-- ── STEP 1 — BACKUP (run alone, verify, then continue) ──────
DROP TABLE IF EXISTS job_title_backup_20260818;
CREATE TABLE job_title_backup_20260818 AS
SELECT id,
       expo_id,
       job_title                      AS old_job_title,
       custom_fields->>'title'        AS cf_title,
       now()                          AS backed_up_at
FROM visitors
WHERE COALESCE(job_title,'') = ''
  AND COALESCE(custom_fields->>'title','') <> '';

SELECT COUNT(*) AS backed_up FROM job_title_backup_20260818;
-- Expect ~1,776+ (higher if time has passed; see note above)


-- ── STEP 2 — DRY RUN: counts only, writes nothing ───────────
SELECT expo_id, COUNT(*) AS will_update
FROM visitors
WHERE COALESCE(job_title,'') = ''
  AND COALESCE(custom_fields->>'title','') <> ''
GROUP BY expo_id
ORDER BY will_update DESC;

SELECT COUNT(*) AS total_will_update
FROM visitors
WHERE COALESCE(job_title,'') = ''
  AND COALESCE(custom_fields->>'title','') <> '';
-- Compare against 1,776 (expo 13: 1,756). Small upward drift = expected.
-- A LARGE or DOWNWARD deviation = STOP and re-check before continuing.


-- ── STEP 3 — UPDATE inside an explicit transaction ──────────
BEGIN;

UPDATE visitors
SET job_title = custom_fields->>'title'
WHERE COALESCE(job_title,'') = ''
  AND COALESCE(custom_fields->>'title','') <> ''
RETURNING id, expo_id, job_title;
-- Row count here must match STEP 2's total_will_update.

-- Verification INSIDE the transaction, before committing:
SELECT COUNT(*) AS remaining_empty_with_title
FROM visitors
WHERE COALESCE(job_title,'') = ''
  AND COALESCE(custom_fields->>'title','') <> '';
-- MUST be 0.

SELECT COUNT(*) AS mismatched
FROM visitors v
JOIN job_title_backup_20260818 b ON b.id = v.id
WHERE v.job_title IS DISTINCT FROM b.cf_title;
-- MUST be 0.

-- If BOTH are 0:
COMMIT;
-- If ANYTHING looks wrong instead:
-- ROLLBACK;


-- ── STEP 4 — POST-COMMIT verification ───────────────────────
SELECT COUNT(*) FILTER (WHERE COALESCE(job_title,'')<>'') AS filled,
       COUNT(*)                                            AS total
FROM visitors WHERE expo_id = 13;
-- 'filled' should jump by ~1,756 (was 1,511 of 3,289 at time of writing).

-- Rollback recipe if ever needed:
--   UPDATE visitors v SET job_title = b.old_job_title
--   FROM job_title_backup_20260818 b WHERE b.id = v.id;
```

**Is the UPDATE safely re-runnable? Yes.**
The `COALESCE(job_title,'') = ''` guard means a row is only touched while its column is
still empty. After a successful run those rows no longer match, so a second execution
updates 0 rows. **No existing value is ever overwritten** — that is the same guard's other
job. Re-running after new Zoho rows have arrived would simply catch the new ones (though
once §2.2 is deployed, there should be none).

⚠️ **`DROP TABLE IF EXISTS job_title_backup_20260818` in STEP 1 means re-running STEP 1
discards the previous snapshot.** If STEP 3 has already committed, re-running STEP 1 would
capture a *post-update* (and much smaller) set — harmless, but no longer a rollback source.
**Run STEP 1 exactly once.**

## 2.5 Two consequences ops must not be surprised by

### (a) `checkinReports.js:72` will still show blank job titles — **during the fair**

```js
// routes/checkinReports.js:72
        custom_fields->>'job_title' as job_title
```
It reads **only** `custom_fields->>'job_title'` — not the `job_title` column, and not
`custom_fields->>'title'`. Neither the handler fix nor the backfill touches
`custom_fields.job_title`, which is empty on Zoho rows (⟳ VERIFIED: 0 rows on expo 13 have a
`job_title` key in `custom_fields`).

**So the Check-in Reports "by job title" breakdown stays empty after both changes.**

Proposed one-line fix, **as a separate commit**:
```diff
-        custom_fields->>'job_title' as job_title
+        COALESCE(NULLIF(custom_fields->>'job_title',''), NULLIF(job_title,''), '') as job_title
```
*(`checkins.js:353-357` already uses exactly this COALESCE shape, so this aligns the two.)*

**This needs a scope decision now, not a silent deferral: this report is used *during* the
fair.** If the job-title breakdown matters to ops on 25–27 Aug, this must ship with the other
two changes. If it does not, defer it — but decide deliberately.

### (b) Fixing the data does **not** put job titles on printed badges

Three independent gates, and only the first is addressed by this work:

1. ✅ `visitors.job_title` populated — what §2.2 + §2.4 achieve.
2. ❌ **Badge template must have `show_job_title: true`.** `badgeTemplates.js:35` defaults it
   to **`false`**, and `badge.html:368` renders the field only
   `if (content.show_job_title === true && displayJobTitle)`.
3. ❌ **A terminal must exist and be assigned a badge template.** Per
   `DISCOVERY_20260818.md` §6.2a, **expo 13 has zero terminals** — so there is currently no
   badge printing path at all.

**Ops should not expect job titles to appear on badges as a result of this fix.** They will
appear in **exports** (`visitors.js:1047`), **reports** (`reports.js:255`), and the
**visitor detail panel** — all of which read the column directly. Badges require the terminal
and badge-template setup that has not happened yet.

## 2.6 Sequencing — non-negotiable order

1. **Deploy §2.2 handler fix.**
2. **Confirm on live traffic** before touching data:
   ```sql
   SELECT id, created_at, job_title, custom_fields->>'title' AS cf_title
   FROM visitors WHERE expo_id=13 AND origin='zohoform'
   ORDER BY created_at DESC LIMIT 10;
   ```
   New rows must show `job_title` **equal to** `cf_title`. At ~200–270/day this is
   observable within roughly 10 minutes. **If new rows still show `job_title=''`, STOP —
   do not run the backfill; the diagnosis needs revisiting.**
3. **Then run §2.4 backfill.**
4. Decide §2.5(a) separately.

Backfill-first would leave ~250 fresh broken rows arriving per day and force a second run.

---

## SUMMARY OF PROPOSED CHANGES — three separate commits, none applied

| # | Item | File(s) | Lines | Additive | Gate |
|---|---|---|---|---|---|
| 1 | Reactivate required fields (**Option A**) | `public/reactivate.html` | 4–6 | Yes | Approval + Phone-config confirmation |
| 2 | Zoho `title` → `job_title` | `routes/webhook.js` | **1** | Yes | Approval |
| 3 | Check-in report job title (§2.5a) | `routes/checkinReports.js` | 1 | Yes | **Scope decision needed** |

Not proposed as code, filed for later: Option B (config-driven reactivate),
`knownFields` cleanup (§2.3), `form-public.html` server-side validation review (§1.7).

**Backfill SQL (§2.4) is for Suer to run in Render Shell. I have not run it and will not.**

---

## OPEN DECISIONS

1. **Item 1: Option A now, or Option B?** I recommend **A** — 7 days out, 9,326 emails pending.
2. **Item 1: is Phone `required` in form 53's config?** Query provided in §1.6. Decides whether
   marking Phone required is config-alignment or a new ops rule.
3. **Item 1: include `last_name`?** Config says `required: true`; the page currently doesn't
   mark it. Aligning it is free but changes a third field ops did not report.
4. **Item 1: smoke test consumes a real token** and creates a real visitor on expo 13.
   Accept, or issue a throwaway token first?
5. **Item 2: deploy window.** A ~10-20s restart could drop Zoho POSTs; I did not verify
   whether Zoho retries. Low-traffic hour?
6. **§2.5(a): does the Check-in Report job-title breakdown matter during 25–27 Aug?**
   If yes it ships now; if no it waits. Please decide rather than defer.
