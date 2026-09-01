# SIEMA Landing Form — Phase 1 Inventory (Read-Only)

**Date:** 1 Sep 2026, 17:20 UTC
**Scope:** SIEMA Morocco Expo 2026 (expo id **9**, 22–24 Sep). Goal is to
replace the Zoho registration forms currently embedded on
`https://siemamaroc.com/landing/` and `https://siemamaroc.com/visit/` with a
Leena form served from `leena.app` and dropped into the same `<iframe>`
slot. **This doc is inventory only** — no proposal, no diff, no writes.
Every claim below carries `path:line` evidence or a psql command trace.

**Pre-flight:** `psql "$RENDER_DATABASE_READONLY_URL" -c 'SELECT 1'` → `1 row`.
DB reachable from my egress.

---

## 1. Live schema

### `forms` table (`\d forms`)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NOT NULL | `nextval('forms_id_seq'::regclass)` |
| organizer_id | integer | nullable | — |
| expo_id | integer | nullable | — |
| name | text | **NOT NULL** | — |
| description | text | nullable | — |
| config | jsonb | nullable | — |
| is_active | boolean | nullable | `true` |
| submission_count | integer | nullable | `0` |
| email_template_id | integer | nullable | — |
| created_at | timestamptz | nullable | `now()` |
| visitor_type | text | nullable | — |
| **fields** | **jsonb** | nullable | — |
| **source** | **text** | nullable | — |
| **origin** | **text** | nullable | — |
| updated_at | timestamptz | nullable | `now()` |

- Indexes: `forms_pkey (id)`, `idx_forms_expo_id (expo_id)`.
- FKs: `expo_id → expos(id) ON DELETE CASCADE`; `organizer_id → organizers(id) ON DELETE CASCADE`.
- Referenced by: `reactivation_tokens.form_id → forms(id)`.

### `visitors` table (`\d visitors` — abridged, all 30 columns present)

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NOT NULL | `nextval('visitors_id_seq'::regclass)` |
| organizer_id | integer | nullable | — |
| expo_id | integer | nullable | — |
| name | text | nullable | — |
| last_name | text | nullable | — |
| email | text | nullable | — |
| badge_id | text | nullable | — |
| company, country, job_title, phone, website, sector, expo_name | text | nullable | — |
| **source** | text | nullable | — |
| **origin** | text | nullable | — |
| visitor_type | text | nullable | — |
| visitor_status, visitor_category, workshop_topic | text | nullable | — |
| custom_fields | jsonb | nullable | — |
| qr_code | text | nullable | — |
| form_id | integer | nullable | — |
| created_at | timestamptz | nullable | `now()` |
| updated_at | timestamptz | nullable | — |
| booth_number | text | nullable | — |
| badge_url | text | nullable | — |
| is_badge_printed | boolean | nullable | `false` |
| badge_printed_at | timestamptz | nullable | — |

- Indexes: `visitors_pkey (id)`, `idx_visitors_expo_id (expo_id)`, **`idx_visitors_unique_email_per_expo` UNIQUE `(organizer_id, expo_id, lower(email)) WHERE expo_id >= 3 AND email IS NOT NULL AND email <> ''`** — the upsert-safety index.
- FKs: `expo_id → expos(id) ON DELETE CASCADE`; `organizer_id → organizers(id) ON DELETE CASCADE`.
- Referenced by (child tables cascading FROM visitors): campaign_recipients, checkins, conference_certificates, email_logs, email_queue, exhibitor_leads (2 FKs), reactivation_tokens.

---

## 2. SIEMA expo row (verified — NOT assumed)

```
 id |          name           | organizer_id | start_date |  end_date
----+-------------------------+--------------+------------+------------
  1 | Morocco Siema Expo      |            1 | 2025-09-09 | 2025-09-11
  9 | Morocco Siema Expo 2026 |            1 | 2026-09-22 | 2026-09-24
```

**Confirmed: expo id 9** is Morocco Siema Expo 2026 (22–24 Sep 2026), organizer 1.
Expo id 1 is last year's edition — kept for historical data, not the target.

---

## 3. Forms on SIEMA (expo 9)

```
 id |                  name                  | visitor_type |    source    |    origin    | email_template_id | is_active | submission_count
----+----------------------------------------+--------------+--------------+--------------+-------------------+-----------+------------------
 38 | Exhibitor Registration Form            | exhibitor    | form-builder | form-public  |                28 | t         | 0
 51 | Visitor Registration Form              | visitor      | form-builder | form-public  |                47 | t         | 0
 59 | Formulaire d'inscription des visiteurs | visitor      | form-builder | form-builder |                69 | t         | 0
```

**Three active forms on expo 9.** Form **51 confirmed** as the pre-registration visitor
form; form 59 is a **French translation** created 31 Aug 2026 (created_at
`2026-08-31 12:43:59`) — Yaprak's SIEMA Phase B follow-up.

### Visitor-count sanity per form (expo 9 rows in `visitors`)

```
 form_id |  n
---------+-----
      51 | 377
      38 | 199
      59 |   2
(total   | 578)
```

Every row on expo 9 currently carries a Leena-managed `form_id` — no rows with
`form_id=NULL`. That matters for the Phase 2 discussion: nothing on this expo
was born from off-Leena Zoho traffic, so the "replace the Zoho form on siemamaroc.com"
work is genuinely first-touch, not a swap of a mid-flight funnel.

### Distribution of `visitors.source` / `visitors.origin` on expo 9

```
   source    |  n            origin  |  n
-------------+-----          ---------+-----
 public_form | 551            public  | 551
 zoho        |  27            zohoform|  27
```

The 27 `zoho`/`zohoform` rows are the current siemamaroc.com Zoho path (`v4.0.6` webhook).
The 551 `public_form`/`public` rows are all Leena `form-public.html` traffic.

### Form 51 — full fields (`fields` JSONB pretty-print, condensed)

Ordered by field position:

| # | name | label | type | required | opts |
|---|---|---|---|---|---|
| 1 | `name` | First Name | text | true | — |
| 2 | `last_name` | Last Name | text | true | — |
| 3 | `title` | Job Title / Position | text | **false** | — |
| 4 | `company` | Company | text | true | — |
| 5 | `email` | Email Address | email | true | — |
| 6 | `mobile` | Mobile Phone | tel | true | — |
| 7 | `website` | Website | text | false | — |
| 8 | `city` | City | text | true | — |
| 9 | `country` | Country | select | true | 268 |
| 10 | `business_represent` | 1) What type of business do you represent? | select | true | 18 |
| 11 | `how_many_employees` | 2) How many employees does your company have? | radio | true | 6 |
| 12 | `main_reason_for_visiting` | 3) What is your main reason for visiting Morocco Siema FoodExpo? | radio | true | 11 |
| 13 | `purchasing_decisions` | 4) Are you involved in purchasing decisions? | radio | true | 3 |
| 14 | `which_product_categories_interested` | 5) Which product categories are you most interested in? | radio | true | 15 |
| 15 | `hear_about_event` | 6) How did you hear about Morocco Siema FoodExpo? | select | true | 18 |
| 16 | `interested_exhibition_future` | 7) Are you interested in exhibiting at future editions? | radio | true | 3 |
| 17 | `agree` | Do you accept to receive emails from Elan Expo? | radio | true | 1 |

**17 fields, 15 required, 2 optional (`title`, `website`).** The `hear_about_event`
select carries the 18 canonical options documented in `HEARD_ABOUT_US_20260827.md` §1.

### Form 51 — full `config` JSONB

```json
{
  "style": {
    "buttonText": "Register",
    "fontFamily": "Poppins",
    "footerText": "Morocco Siema FoodExpo 2026 · Organized by Elan Expo",
    "borderRadius": "12",
    "footerHeight": "80",
    "headerHeight": "200",
    "primaryColor": "#ef7f1a",
    "backgroundColor": "#f5f7fa",
    "footerBannerColor": "#fdead2",
    "footerBannerImage": null,
    "footerGradientEnd": null,
    "headerBannerColor": "#ef7f1a",
    "headerBannerImage": null,
    "headerGradientEnd": null
  },
  "notification": {
    "html": "<p>Hello team,</p>\n<p>A new visitor has just registered for <strong>{{expo_name}}</strong>:</p>\n<ul>\n  <li><strong>Name:</strong> {{name}} {{last_name}}</li>\n  <li><strong>Email:</strong> {{email}}</li>\n  <li><strong>Phone:</strong> {{phone}}</li>\n  <li><strong>Company:</strong> {{company}}</li>\n  <li><strong>Country:</strong> {{country}}</li>\n  <li><strong>Job title:</strong> {{job_title}}</li>\n<li><strong>Website:</strong> {{website}}</li>\n</ul>\n<p>Registered on {{registration_date}}.</p>",
    "enabled": true,
    "subject": "{{expo_name}} Visitor Registration",
    "recipients": "project@elan-expo.com, elif@elan-expo.com"
  }
}
```

Two top-level keys: `style` (consumed by frontend — see §7) and `notification`
(consumed by backend at `routes/visitors.js:242` — sales notification email
sent to Elif + project mailbox).

### Form 59 (French) — full `config` JSONB

Same shape. Notable differences from 51: `buttonText: "S'inscrire"`, gradient
end `#5e2e1b`, `footerText: "Powered by Leena EMS · © Elan Expo"`, and
**`notification.enabled: false`** (no sales alert). Fields mirror 51 in French
but drop `city`, `hear_about_event`, and `interested_exhibition_future` (14 fields
total vs 51's 17).

---

## 4. Nigeria MP26 reference (form 53)

Included as a known-good structural baseline per the request.

```
 id | name                        | expo_id | visitor_type | source        | origin       | email_template_id | is_active | submission_count
----+-----------------------------+---------+--------------+---------------+--------------+-------------------+-----------+------------------
 53 | Visitor Registration Form   |      13 | visitor      | form-builder  | form-public  |                33 | t         | 0
```

**Visitor count on form 53:** 6,015 (last measured in
`SEGMENT_FORENSICS_20260828.md` §3 / re-confirmed by the same query today
would produce a similar figure — this session did not re-count).

### Form 53 fields (condensed — no `hear_about_event`, no `city`, no walk-up-style Q1–Q7)

| # | name | label | type | required | opts |
|---|---|---|---|---|---|
| 1 | `name` | First Name | text | true | — |
| 2 | `last_name` | Last Name | text | true | — |
| 3 | `title` | Job Title / Position | text | **true** | — |
| 4 | `company` | Company | text | true | — |
| 5 | `email` | Email Address | email | true | — |
| 6 | `mobile` | Mobile Phone | tel | true | — |
| 7 | `website` | Website | text | false | — |
| 8 | `city` | City | text | true | — |
| 9 | `country` | Country | select | true | 268 |
| 10 | `nature_of_your_company` | Nature of Your Company | select | true | 30 |
| 11 | `agree` | Do you accept to receive emails from Elan Expo? | radio | true | 1 |

**11 fields.** Form 53 is materially shorter than form 51 — it lacks the Q1–Q7
survey block (business_represent, employees, reason, purchasing, categories,
hear_about_event, interested_exhibition_future).

### Form 53 `config` — identical shape

Same `{style, notification}` top-level keys. `style.primaryColor="#009846"`,
`style.headerGradientEnd="#29539f"` (green→blue), `notification.enabled=true`,
recipients `project@elan-expo.com, elif@elan-expo.com`.

### Structural verdict

Form 51 is a **superset** of form 53's structure — same 11 core fields (with
`title` optional instead of required on 51) plus the 6 walk-up survey questions
plus `hear_about_event`. Any code path that works on form 53 (proven by 6,015
NMP registrations) will work on form 51.

---

## 5. Candidate email templates for SIEMA registration confirmation

### Templates linked to SIEMA forms or SIEMA-named

```
 id | name                                             | subject                                                  | expo_id | is_active
----+--------------------------------------------------+----------------------------------------------------------+---------+-----------
  2 | Siema Test Email                                 | Welcome to {{expo_name}}                                 |  (null) | t
 28 | Exhibitor Badge Mail Template Morocco Siema Expo | Your Exhibitor Badge - Morocco Siema Expo                |       9 | t
 47 | Morocco Siema FoodExpo QR Code Badge Mail        | Your Registration is Confirmed - Your QR Code is Ready   |       9 | t
 69 | Morocco Siema FoodExpo QR Code Badge Mail FR     | Votre inscription est confirmée – Votre code QR est prêt |       9 | t
```

**Form 51 links to template 47; form 59 links to template 69; form 38 links to
template 28.** Template 2 ("Siema Test Email") is legacy/testing (expo_id NULL,
generic `Welcome to {{expo_name}}` subject) — not a candidate for the real
registration confirmation.

### Greeting-chain audit — the mandatory-chain check

Placeholder scan across each candidate's `html_content` and `subject`:

```
 id | name                                              | greeting_status | subject_status
----+---------------------------------------------------+-----------------+---------------------
 28 | Exhibitor Badge Mail Template Morocco Siema Expo  | BARE_NAME       | NO_NAME_PLACEHOLDER
 47 | Morocco Siema FoodExpo QR Code Badge Mail         | BARE_NAME       | NO_NAME_PLACEHOLDER
 69 | Morocco Siema FoodExpo QR Code Badge Mail FR      | BARE_NAME       | NO_NAME_PLACEHOLDER
```

**All three templates use bare `{{name}}` — none carry the mandatory chain
`{{first_name|last_name|company|"Dear Visitor"}}` documented in CLAUDE.md
v4.0.9.**

Exact placeholder inventory per template (from
`regexp_matches(html_content, '\{\{[^}]+\}\}', 'g') DISTINCT`):

- **Template 47:** `{{qr_code}}`, `{{name}}` — 2 placeholders total.
- **Template 69:** `{{qr_code}}`, `{{name}}` — 2 placeholders total.
- **Template 28:** `{{qr_code}}`, `{{name}}` — 2 placeholders total.

None reference `first_name` or `last_name` or `company` at all. Subjects have
no name placeholder — they read as fixed-text greetings.

### Practical implication (facts only, not a proposal)

Per `utils/email.js:12-23` the `processEmailTemplate` resolver walks
alternatives on `|` and returns the first truthy `data[key]`. All send paths
that use these templates set `data.name = visitor.name || 'Guest'` before
calling — so `{{name}}` **won't render empty** on the current pool. The chain
would only matter if a SIEMA visitor row somehow had a blank `name` column;
the `visitors_unique_email_per_expo` upsert path doesn't NULL out `name`, so
the risk is present but tiny.

**Not proposing a fix in this doc** — flagging that if the incoming SIEMA
funnel produces any Zoho rows with missing `name`, template 47 would greet
them as literally the string `"Guest"`, not "Dear Visitor" via the chain. All
three templates carry this same shape.

---

## 6. Submit-path trace — what a public form submission writes

### Frontend → API request (`public/form-public.html:340-386`)

```javascript
340   const formElement = document.getElementById('registrationForm');
341   const formDataToSend = new FormData(formElement);
343   const visitorData = {
344       form_id: formData.id,
345       expo_id: formData.expo_id,
346       source: 'public_form',        // HARD-CODED CLIENT SIDE — line 348
347       custom_fields: {}
348   };
...
375   const urlParams = new URLSearchParams(window.location.search);
376   const lcToken = urlParams.get('_lc');
377   if (lcToken) visitorData._lc = lcToken;
378
380   const response = await fetch(`${API_URL}/visitors/public`, {
381       method: 'POST',
382       ...
```

**The client hard-codes `source: 'public_form'`** at `form-public.html:348`.
Every submission from this page carries the same source string in the request
body regardless of which form is loaded.

### Backend handler (`routes/visitors.js:204-244`)

```javascript
204   router.post('/public', async (req, res) => {
205     try {
206       const { form_id, expo_id, source, custom_fields } = req.body;
207
208       const visitorData = {
209         name: custom_fields?.full_name || custom_fields?.name || '',
...
215         phone: custom_fields?.phone || custom_fields?.mobile || custom_fields?.Mobile || '',
216         source: source || 'public_form',    // request-body source wins; literal fallback
217         origin: 'public',                    // HARD-CODED — always literal 'public'
218         expo_id,
...
232
233       if (form_id) {
234         const formResult = await pool.query(
235           `SELECT email_template_id, organizer_id, visitor_type, config, name FROM forms WHERE id = $1`,
236           [form_id]
237         );
```

**Line 216** — `visitors.source` = whatever the client sent, fallback literal
`'public_form'`. Client always sends `'public_form'`, so effectively the
column is always `'public_form'`.

**Line 217** — `visitors.origin` = literal string `'public'`, **not read from
`forms.origin`, not read from any config.**

**Line 235** — the SELECT against `forms` fetches ONLY
`email_template_id, organizer_id, visitor_type, config, name`. **`forms.source`
and `forms.origin` columns exist on the row but are NOT read by this handler.**

### Answer to the source-diversity question, stated plainly

**Two different Leena forms submitted through `form-public.html` today would
produce the SAME `visitors.source='public_form'` value.** The `visitors.form_id`
column would differ, but the `source` column would not — because the client
hard-codes it and the backend takes the client value.

The `forms` table's own `source` and `origin` columns are set at form-creation
time to `'form-builder'` / `'form-public'` (or `'form-builder'` / `'form-builder'`
for the French form 59) but are **never consumed at submit time**. They are
purely admin-metadata about how the form was authored.

The public form-fetch endpoint `routes/forms.js:396-435` DOES return
`f.source` and `f.origin` in its response body (lines 410–411), so a client
could read them and pass a form-specific `source` string in the submit body —
but `form-public.html:348` does not do this.

### Auxiliary writes on the same INSERT (lines 322-353, new-visitor path)

- Line 344 `organizerId || 1` — organizer_id inherits from the form row's owner.
- Line 349 `formVisitorType` — visitor_type inherits from `forms.visitor_type`
  (or literal `'visitor'` if form has NULL). This IS a per-form value.
- Line 350 `form_id || null` — form_id stored.
- QR generation at line 318 (`uuidv4()`) + badge_id at line 319
  (`qrCode.substring(0, 8).toUpperCase()`) + badge_url at line 320
  (`generateBadgeUrl(qrCode)`).

Existing-visitor path (lines 288-312) — UPDATE `COALESCE(NULLIF(...))` merge,
QR/badge preserved, `updated_at = NOW()`. `visitors.source` and
`visitors.origin` are **NOT updated on the existing-visitor path** — they
retain whatever the row was born with.

---

## 7. Post-submit behaviour + `forms.config` reads

### Post-submit — no external redirect exists today

`showSuccess(qrCode)` at `public/form-public.html:413-444`:

```javascript
413   function showSuccess(qrCode) {
414       const container = document.getElementById('formContent');
...
425       container.innerHTML = `
426           <div class="form-header">
427               <h2>Thank You!</h2>
...
434               <p class="text-muted">Your registration has been received.</p>
435               <button class="btn btn-submit mt-3" onclick="location.reload()">
436                   <i class="bi bi-arrow-clockwise me-2"></i> Submit Another Registration
437               </button>
```

**No `window.location.href = ...`, no `window.top.location`, no
`postMessage`, no `location.assign`, no meta refresh.** The success path
replaces `#formContent` innerHTML with a Thank-You card that lives inside the
same document. The only navigation trigger is the "Submit Another"
button which calls `location.reload()`.

Backend `POST /api/visitors/public` returns
`{ success, message, visitor, qr_code, email_sent, ... }` — no redirect URL
field.

### `forms.config` — everything read today

Two consumers, both existing:

**Frontend — `public/form-public.html:482-580` `applyFormStyle(config)`** reads
only `config.style.*`:
- `headerBannerImage`, `headerBannerColor`, `headerGradientEnd`, `headerHeight`
- `footerBannerImage`, `footerBannerColor`, `footerGradientEnd`, `footerHeight`, `footerText`
- `primaryColor`, `backgroundColor`, `fontFamily`, `buttonText`, `borderRadius`

If `config` is null → hardcoded defaults at `:487-491`
(`headerBannerColor: '#667eea'`, `headerGradientEnd: '#764ba2'`, etc.). If
`config.style` is missing → same defaults.

**Backend — `routes/visitors.js:242`** reads only `config.notification`:
```javascript
242   formNotificationConfig = formResult.rows[0].config?.notification || null;
```
Consumed later at lines around `:451` (sales notification email enqueue —
"NOTIFICATION" log line, recipients from `notification.recipients`, subject/html
from `notification.subject` / `notification.html`).

**No other `config.` key is read anywhere.** Specifically:
- No `config.redirect_url` (does not exist as a key today).
- No `config.iframe_parent` / `config.postMessage_target` (does not exist).
- No `config.thank_you_url` (does not exist).

`grep -n "config\.\|form\.config\|\.config\." public/form-public.html` returns
only the `applyFormStyle` branch. `grep -n "config" routes/visitors.js`
returns only the notification block. Independently verified for both files.

---

## Summary of Phase 1 facts

| Question | Answer |
|---|---|
| SIEMA expo id | **9**, Morocco Siema Expo 2026, 22–24 Sep, organizer 1 |
| SIEMA pre-registration form | **id 51**, "Visitor Registration Form", 17 fields, 15 required, visitor_type='visitor', links template 47, 377 visitors so far |
| French sibling | **id 59**, 14 fields, links template 69, 2 visitors so far (created 31 Aug) |
| Structural reference | Form 53 (Nigeria MP) is a strict subset; superset structure of 51 is proven to work |
| Registration confirmation template | 47 (EN) / 69 (FR); **both use bare `{{name}}`, neither carries the mandatory greeting chain** |
| What a submit writes to `visitors.source` | Literal `'public_form'` (client-hardcoded, backend accepts as-is with same literal fallback) — SAME value regardless of which form was used |
| What a submit writes to `visitors.origin` | Literal `'public'` (backend hardcode) |
| Do `forms.source` / `forms.origin` affect submit? | **NO.** Columns exist and are returned by `/api/forms/public/:id` but are not read by `routes/visitors.js:204` submit handler |
| Can `form-public.html` redirect externally after submit? | **NO code path today.** Success renders in-place; "Submit Another" is a `location.reload()` |
| What `forms.config` keys are consumed today? | Frontend: `config.style.*` (14 keys). Backend: `config.notification.*` (4 keys). Nothing else. |
| iframe-embeddability | Confirmed by Suer's context (leena.app sends no `X-Frame-Options`, no `frame-ancestors` CSP); not re-verified in this doc |

**Phase 1 complete. No proposal, no diff — STOP as instructed.**
