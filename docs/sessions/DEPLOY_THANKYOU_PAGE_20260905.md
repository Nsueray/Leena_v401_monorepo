# DEPLOY — thank-you page + language-aware defaults (5 Sep 2026)

## Commit

`4d0263d` — merge of `feat/thankyou-page` (`de89247`) into `main`, pushed
5 Sep 12:11 IST. Render deploy landed ~12:11:55 with a ~45 s 502 window
at cutover (matches G3). Form mtime `Sat, 05 Sep 2026 09:10:58 GMT`.

Job B Option A from 4 Sep. Preceded by the byte-identical regression
proof in the branch commit's message; live QA in §3 below.

## Config keys

`forms.config` (JSONB, no schema change — `PUT /:id` writes as-is):

- **`config.language`** — top-level. `'en'` (default when absent) or `'fr'`. Only `'fr'` diverges from today's behaviour. Written by `form-builder.html` only when the operator picks Français (`getFormLanguage()` returns `'fr'` or `null` — never `'en'` — so existing forms save byte-identical config).
- **`config.style.successTitle`** — string. Default: `"Thank You!"` (EN) / `"Merci !"` (FR). Renders as `<h2>` in the success card header.
- **`config.style.successHeading`** — string. Default: `"Registration Successful"` / `"Inscription confirmée"`. Renders as `<h4>` under the check-circle icon.
- **`config.style.successQrInstruction`** — string. Default: `"Show this QR at the entrance"` / `"Présentez ce QR code à l'entrée"`. Rendered only when the response carries `qr_code`.
- **`config.style.successMessage`** — string. Default: `"A copy was also emailed to you. No email? Just show this screen."` / `"Une copie vous a également été envoyée par e-mail. Pas d'e-mail ? Montrez simplement cet écran."`. Muted line under the QR image.
- **`config.style.successButtonLabel`** — string. Default: `"Submit Another Registration"` / `"Envoyer une autre inscription"`. Button under everything.

**Resolution order for every string:** `config.style.<key>` override → language default (from `config.language`) → today's English fallback. English defaults are byte-identical to the strings that were hardcoded in `showSuccess()` before this deploy — forms that set neither `language` nor any `success*` key render byte-identical output. Verified programmatically in the branch commit's regression harness.

**Extras (internal, no UI override):**
- `<html lang>` is set from `config.language` via `applyFormStyle()` — `document.documentElement.lang = 'fr'|'en'`.
- The error card's title / heading / button label follow language-default resolution too (`ERROR_DEFAULTS_{EN,FR}` at module scope in `form-public.html`). No override keys — you can't rewrite `"Oops!"` per-form.
- The always-shown line `"Your registration has been received."` is language-defaulted the same way (`MISC_DEFAULTS_{EN,FR}`); no override key. Deliberately kept out of the 5-key UI ship list per Suer's spec.

## UI surface

New collapsible section in `form-builder.html` Design tab, between "Colors & Typography" and the Preview column. Contains a language `<select>` (English / Français) and 5 blank text inputs; each label carries the EN + FR default inline. Blank input = use language default.

`getStyleConfig()` conditionally appends each of the 5 success keys only when the input is non-blank (whitespace-trimmed). `loadStyleConfig()` populates them from `rawStyle[key] || ''`. Existing forms save byte-identical `config.style`.

`saveForm()` includes `language` on `config` only when `getFormLanguage()` returns non-null (i.e. `'fr'`). Existing forms save byte-identical `config`.

## QA result

Click-through QA passed live 5 Sep (Suer):

- **Form 51 (English, no new keys):** success card renders **byte-identical** to pre-deploy. `<html lang="en">`, `Thank You!` / `Registration Successful` / etc. **PASS.**
- **Form 59 (SIEMA French form) set to `config.language = 'fr'`:** success card now renders the full FR default set — `Merci !` / `Inscription confirmée` / `Présentez ce QR code à l'entrée` / `Une copie vous a également été envoyée…` / `Votre inscription a bien été enregistrée.` / `Envoyer une autre inscription`. `<html lang="fr">`. **PASS.**

**Live consequence for SIEMA visitors** — anyone completing form 59 from now on sees the French success card; the Excel test rows and any organic Zoho traffic that lands via form 59 will produce a fully French confirmation experience. Match to the campaign wave 78 activation on Monday: activate-wave recipients who click the reactivation link land on `reactivate-fr.html` (also French per the wizard's `activation_lang='fr'` set at build), and any of them who then submits form 59 (unusual — reactivation activates without re-submitting the form, but possible via the "register a new colleague" flow) gets a matching French Thank-you card.

## Regression proof — pre-deploy

Headless JS-shim harness executed HEAD's `showSuccess` + `showError` against the current versions using form 51 and form 59 production configs — **5/5 IDENTICAL** across 5 cases (form 51 EN + QR, form 51 no QR, form 59 no lang + QR, form 59 no QR, null config). FR + override (`successTitle: "Bienvenue !"`) programmatically verified: `<h2>Bienvenue !</h2>` (override wins) + `<h4>Inscription confirmée</h4>` (FR default holds for other 4 unset keys).

Full narrative + shim harness code in the branch commit message on `de89247`.

## Files touched

| File | Lines | What |
|---|---|---|
| `public/form-public.html` | +104 / -10 | 6 default tables (EN/FR pairs) + `esc()` + `pickSuccess/pickError/pickMisc` + rewritten `showSuccess`/`showError` + `applyFormStyle` reads `config.language` and sets `<html lang>` |
| `public/form-builder.html` | +74 / -2 | Collapsible "Thank-you page" section (language select + 5 inputs) + `getStyleConfig` extension + `getFormLanguage` + `loadStyleConfig` population + `saveForm` conditional `cfg.language` |

Zero backend changes. `routes/forms.js PUT /:id` writes `config` blind; JSONB accepts the new keys with no allowlist. Zero schema change.

## Related

- `docs/sessions/DEPLOY_STEP1_NOT_REGISTERED_20260904.md` — step-1 `not_registered` end-to-end (4 Sep, the two commits that made SIEMA's Monday activation safe against the build/activation gap).
- `docs/sessions/SIEMA26_BUILD_20260904.md` — the SIEMA build using those changes.
- `CLAUDE.md` G41 (new) — form-public success/error strings are language-aware via `config.language` + `config.style.success*`.
