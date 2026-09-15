# Manual DB changes — 16 Sep 2026, Madesign launch prep

> Point-in-time record. Five config/data writes made directly against production
> (`leena_v401_db`, Render) on the night of 15→16 Sep, ahead of the Madesign 2026
> wave activation on 16 Sep 13:30. Authored by the SIEMA line, relayed by Suer.
> No code shipped with these changes — see *§7 Deliberately not fixed in code*.

**⚠️ SQL below is RECONSTRUCTED from the observed end state, not a transcript.**
The statements were run in Render Shell; they were not captured. Each block is
written to reproduce the state this document verifies, and each is paired with the
read-only query that confirms it. Treat the verification output as authoritative
and the SQL as illustrative.

---

## 1. Why these writes happened

The 15 Sep read-only audit of the Madesign public visitor flow
(`form-public.html?id=64` → confirmation mail → reactivation → activation mail)
found the French flow rendering in English and one dead link. Two defects were
severe enough to fix before the wave went out to ~11,000 people:

| Audit # | Defect | Blast radius at time of audit |
|---|---|---|
| A2 / A3 | Form 64 had no `config.language`, so `form-public.html:578` fell through to `'en'` — labels, submit button, validation and the whole thank-you card rendered English on a French form | **661 visitors** registered through this form between 09-09 and 09-15, all of whom saw the English flow |
| D9 | `{{badge_link}}` was absent from the activation path's `templateData` (`routes/reactivation.js:853-865`); `utils/email.js:21` returns `''` for an unmatched key, so the QR fallback anchor shipped as `href=""` | Every activation mail — 0 sent at that point, 4,575 tokens pending |

Both are config-fixable. The decision was to fix them in data and ship no code
during the launch window.

---

## 2. Write 1-3 — form 64 (`Formulaire d’inscription des visiteurs`)

### Write 1 — `config.language = 'fr'`

```sql
UPDATE forms
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{language}', '"fr"'::jsonb)
WHERE id = 64;
```

**Rationale.** `public/form-public.html:578` is the single switch for the whole
page:

```js
formLanguage = (config && config.language === 'fr') ? 'fr' : 'en';
```

Everything downstream keys off it — `pickSuccess()` / `pickError()` / `pickMisc()`
(`:476-489`) and `document.documentElement.lang` (`:579`). The French constants
already existed in the file (`:438-444`, `:450-454`, `:458-460`) and were simply
never selected. This one key turns on all six thank-you strings at once:

| | before (EN) | after (FR) |
|---|---|---|
| Title | `Thank You!` | `Merci !` |
| Heading | `Registration Successful` | `Inscription confirmée` |
| QR instruction | `Show this QR at the entrance` | `Présentez ce QR code à l'entrée` |
| Message | `A copy was also emailed to you. No email? Just show this screen.` | `Une copie vous a également été envoyée par e-mail. Pas d'e-mail ? Montrez simplement cet écran.` |
| Button | `Submit Another Registration` | `Envoyer une autre inscription` |
| Received note | `Your registration has been received.` | `Votre inscription a bien été enregistrée.` |

Form 64 sets no `successTitle`/`successHeading`/… overrides in `config.style`, so
nothing masks the language default.

### Write 2 — `config.style.buttonText`

```sql
UPDATE forms
SET config = jsonb_set(config, '{style,buttonText}', '"S''inscrire"'::jsonb)
WHERE id = 64;
```

**Rationale.** Write 1 alone would **not** have fixed the submit button.
`form-public.html:648-649` applies `config.style.buttonText` *after* the language
default, unconditionally:

```js
const submitBtn = document.querySelector('.btn-submit');
if (submitBtn && s.buttonText) {
    submitBtn.innerHTML = `<i class="bi bi-send me-2"></i> ${s.buttonText}`;
}
```

The stored value was the literal `Register`, which would have survived the
language switch and left one English word on an otherwise French form.

### Write 3 — field texts

```sql
-- fields[6] (0-indexed) — website label
UPDATE forms
SET fields = jsonb_set(fields, '{6,label}', '"Site web"'::jsonb)
WHERE id = 64;

-- fields[4] (0-indexed) — email placeholder
UPDATE forms
SET fields = jsonb_set(fields, '{4,placeholder}', '"votre@email.com"'::jsonb)
WHERE id = 64;
```

**Rationale.** Two visitor-facing English strings stored in `forms.fields`, outside
the reach of the language switch (which only governs code-side defaults, never
operator-authored field text).

### Verification — form 64 after writes 1-3

```
lang | btn         | (forms.id=64)
fr   | S'inscrire

ord | alan                   | etiket                                              | placeholder
  1 | name                   | Prénom                                              |
  2 | last_name              | Nom                                                 |
  3 | title                  | Fonction                                            |
  4 | company                | Entreprise                                          |
  5 | email                  | Adresse e-mail                                      | votre@email.com
  6 | mobile                 | Numéro de téléphone mobile                          | Veuillez saisir votre numéro WhatsApp actif
  7 | website                | Site web                                            |
  8 | country                | Pays                                                |   (268 options)
  9 | nature_of_your_company | Nature de votre entreprise                          |    (30 options)
 10 | agree                  | Acceptez-vous de recevoir des courriels d'Elan Expo ? |     (1 option)
```

`last_name.required = true` (7 Sep deploy) confirmed intact.
`email_template_id = 86` confirmed populated — the form-builder save race did not
blank this form.

---

## 3. Write 4 — templates 86 / 87 / 88, `{{badge_link}}` → `{{badge_link|badge_url}}`

```sql
UPDATE email_templates
SET html_content = REPLACE(html_content, '{{badge_link}}', '{{badge_link|badge_url}}'),
    body         = REPLACE(body,         '{{badge_link}}', '{{badge_link|badge_url}}')
WHERE id IN (86, 87, 88);
```

**Rationale.** `utils/email.js:15-22` already supports a fallback chain and takes
the first **truthy** value:

```js
return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const parts = expr.split('|').map(p => p.trim());
    for (const part of parts) {
        if (/^".*"$/.test(part)) return part.slice(1, -1);
        if (data[part]) return data[part];
    }
    return '';
});
```

The chain is a **measured-complete** fix across all three send paths that reach
these templates:

| Path | `badge_link` | `badge_url` | chain resolves |
|---|---|---|---|
| Form 64, new visitor | ✅ `routes/visitors.js:384` (recomputed every send) | ✅ `:330` | via `badge_link` |
| Form 64, returning visitor | ✅ `routes/visitors.js:384` (recomputed — **not** read from DB) | ⚠️ `:282` reads the column, NULL on 321/1100 expo-18 rows | via `badge_link` |
| Activation | ❌ absent from `templateData` (`routes/reactivation.js:853-865`) | ✅ `:744` → `:862`, freshly generated per activation | via `badge_url` |

The 321 NULL `badge_url` rows never matter, because `badge_link` is first in the
chain and is recomputed on every form-path send — that is what the "Durable
fallback link" comment at `routes/visitors.js:383` means.

**The chain stays after the native fix lands.** It costs nothing and keeps the
anchor alive on any future path that supplies only one of the two keys.

### Side effect on todo item 27

`routes/emailSend.js` supplies `badge_url` (`:104` for `/single`, `:245` for
`/bulk`) but not `badge_link`. Chained templates therefore degrade to a working
link from the Send Emails admin panel wherever `badge_url` is non-empty, which
**narrows** item 27's standing rule:

- `28`, `47`, `69` — still bare `{{badge_link}}`, **rule still applies**, do not
  send from the admin panel.
- `86`, `87`, `88` — chained; the panel path resolves via `badge_url`. Suer should
  spot-check one real send before relying on this, since `emailSend.js:90` falls
  back to the stored column for existing visitors.

### Verification

```
id | name                                                | zincir | ciplak_badge_link
28 | Exhibitor Badge Mail Template Morocco Siema Expo    | f      | t
47 | Morocco Siema FoodExpo QR Code Badge Mail           | f      | t
69 | Morocco Siema FoodExpo QR Code Badge Mail FR        | f      | t
86 | Morocco Madesign Expo QR Code Badge Mail FR         | t      | f
87 | Morocco Madesign Expo QR Code Badge Mail            | t      | f
88 | Exhibitor Badge Mail Template Morocco Madesign Expo | t      | f
```

---

## 4. Write 5 — backup table

```sql
CREATE TABLE email_templates_backup_20260916 AS
SELECT * FROM email_templates WHERE id IN (86, 87, 88);
```

| table | rows | contents | drop after |
|---|---|---|---|
| `email_templates_backup_20260916` | **3** | pre-chain snapshot of templates 86/87/88 | **5 Oct 2026** |

Added to the backup-table inventory as todo item **38**. Rollback is a
column-wise restore of `html_content` / `body` from this table by `id`.

No backup was taken for the form-64 writes (writes 1-3) — the prior values are
recorded in §2 above and in the 15 Sep audit, and the blast radius of a bad revert
is one form.

---

## 5. Preflight verification — Madesign waves (Part A, 16 Sep, read-only)

Run after the writes, before activation. `SET SESSION CHARACTERISTICS AS
TRANSACTION READ ONLY`, SELECT only.

### Campaigns

```
id | name                                     | status | expo_id | created_at
80 | Morocco Madesign Expo 2026 Activate Wave | draft  |      18 | 2026-09-15 21:46:08.257+00
81 | Morocco Madesign Expo 2026 Register Wave | draft  |      18 | 2026-09-15 21:46:08.266+00
```

### Recipients

```
campaign_id | status  | count        campaign_id | toplam | tekil_email
         80 | active  |  4575                 80 |   4716 |        4716
         80 | holdout |   141                 81 |   6742 |        6742
         81 | active  |  6540
         81 | holdout |   202
```

**Build-page count anomaly — resolved, cosmetic.** The wizard reported
"Processed 4,575 rows across 2 campaigns" with progress stuck at 4,575/11,464
while status read `completed`. Actual totals are 4,716 + 6,742 = **11,458**;
the 6-row delta against 11,464 is exactly the six unsubscribed addresses dropped
during the build. The "4,575" is the activate wave's *active* count rendered
against the pre-suppression total. Both campaigns wrote their full recipient sets.
Nothing to re-run.

### Steps

```
campaign_id | step | template_id | tpl | delay_hours | condition
         80 |    1 |          90 | A1  |           0 | not_registered
         80 |    2 |          91 | A2  |         214 | not_registered
         80 |    3 |          92 | A3  |         120 | not_registered
         81 |    1 |          93 | R1  |           0 | not_registered
         81 |    2 |          94 | R2  |         214 | not_registered
         81 |    3 |          95 | R3  |         120 | not_registered
```

### Tokens

```
total | f64  | f_null | f_diger      status  | count
 4575 | 4575 |      0 |       0      pending |  4575
```

`f_null = 0` closes audit finding #8: every token carries `form_id = 64`, so
`routes/reactivation.js:821-828` selects template **86 (FR)** and never falls
through to the `ORDER BY f.id ASC LIMIT 1` branch, which would have picked
form 63 → template **87 (English)**. All 4,575 token emails match a campaign-80
recipient 1:1.

### Unsubscribe safety

Suppression list for organizer 1: **548** addresses. Join against both recipient
sets returns **0 rows** — zero leakage.

### Additional checks

- All 4,575 active campaign-80 recipients carry `extra_fields.activation_url`,
  **all pointing at `reactivate-fr.html`** (correct for `country_code='MA'`).
- All 141 holdouts carry no `activation_url` — control group gets no token,
  per `routes/campaignBuilder.js:1161-1163`.
- Absence of `_lc` in the stored URL is expected, not a defect: it is appended at
  send time by `utils/trackingPixel.js:189`.
- Register templates 93/94/95 all link `form-public.html?id=64` (the French form);
  none links `id=63`. Activate templates 90/91/92 carry `{{activation_url}}` and
  no form link.

**Preflight verdict: GO.** No blocker found.

---

## 6. Auditability caveat — `updated_at` was not bumped

After all five writes:

```
forms.id=64            updated_at = 2026-09-10 08:24:11.082+00
email_templates 86     updated_at = 2026-09-08 07:47:55.132+00
email_templates 87     updated_at = 2026-09-08 07:48:42.675+00
email_templates 88     updated_at = 2026-09-08 07:55:49.540+00
```

Every row holds tonight's values while carrying a stale `updated_at`. Neither table
has an `updated_at` trigger — maintaining it is the application layer's job (the
same known gap `migrations/012_finance_foundation.sql:110-111` records for the
finance tables), and a raw `UPDATE` in Render Shell does not touch it.

**Consequence:** the DB cannot date these changes. `email_templates_backup_20260916`
is the only dated evidence that they happened, and this document is the only record
of what the prior values were. Anyone reverting must read §2/§3 rather than trusting
`updated_at`.

---

## 7. Deliberately not fixed in code

The native `badge_link` fix on the activation path was **cancelled for this
window** — no code ships before or during the Madesign launch. The chain in
templates 86/87/88 is a measured-complete substitute (§3), so the code change
carries no launch-blocking value.

Carried to todo item **44**:
> post-fair: add native `badge_link` to `routes/reactivation.js:853-865`
> `templateData` (chain in templates 86/87/88 stays as insurance)

Also left unfixed and carried to todo (items **39-43**), all visitor-facing English
on an otherwise French surface, none blocking:

- 268 English country names + 30 English sector options in `forms.fields` (audit #4/#5)
- hardcoded EN in `form-public.html` — `:222`, `:338`, `:203`, `:399`, `:496` (audit #9)
- `(Resent)` subject suffix, `routes/visitors.js:406` (audit #10)
- English server-side reactivation errors surfacing on the FR page,
  `routes/reactivation.js:622-690` → `reactivate-fr.html:588`/`:601` (audit #11)
- `forms.submission_count = 0` vs 661 real rows — stale counter (audit #12)

---

## 8. Reproducibility

These five writes exist **only in the production database**. They are not a
migration and cannot be rebuilt from this repo. Per `docs/sessions/README.md`,
that places them in the *DATA OPERATIONS — production changes NOT in git* class;
this document is their record.
