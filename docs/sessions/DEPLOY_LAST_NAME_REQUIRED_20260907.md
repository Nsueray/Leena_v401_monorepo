# DEPLOY — `last_name` required on reactivate pages + /activate (7 Sep 2026)

## Commit

`a9a44fd` — `fix(reactivation): last_name required on both pages + /activate endpoint`.
Deployed 17:12 IST (14:12 UTC / 15:12 Casablanca) as part of the same push as `1f8692a`
(Stage 4d callcenter). Cutover window: **20 s** (17:12:28 → 17:12:48 UTC+3, `/health`
as Render's health check path — G43).

Explicit push authorisation: SIEMA had ~1,000 pending activations for tomorrow's next-step
send, and 9% of today's activations were landing with empty `last_name`. Waiting until 22:00
would ship the same shape to another wave of activations. Suer's call: worth the 20-s cutover.

## Why

Measured at 15:00 IST:
- **61 of 685 activations today (9%)** landed with empty `visitors.last_name`
- **9,376 of 15,788 pending tokens** were minted **without** a `last_name` (imported data
  quality — many wizard rows only had a first name column populated)

Full-day figures at EOD:
- 63 empty-last_name / 702 reactivation activations today = 9% (matches Suer's 15:00 rate)
- ~9,363 pending tokens still without last_name (fix protects tomorrow's activations)

> ⚠️ **8 Sep correction:** *702* was **not** the day-1 end-of-day count — it was
> the cumulative activation count at ~14:17 UTC (17:17 IST), taken right after
> this deploy landed and mislabeled as EOD when the doc was written. Actual day-1
> end (`activated_at <= 2026-09-07 23:59:59+00`) = **884** activations. By 06:00
> UTC 8 Sep the total had drifted to 896; by midday 8 Sep it was 909. The 9%
> empty-`last_name` ratio itself remains representative (the fix took effect at
> the same moment the snapshot was taken, so the ratio is against pre-fix rows).
> Forensic recount: `SIEMA_ACTIVATION_MISMATCH_20260908.md`.

Root cause: `reactivate.html` and `reactivate-fr.html` had `required` on the first-name input
(`id="name"` at line :356 both pages) but NOT on the last-name input (`id="lastName"` at line
:360). `POST /api/reactivation/activate` at `routes/reactivation.js:665` only required `token`.
So a visitor could submit with an empty last_name and the row would save with `last_name=''`.

## Three-layer fix

### Client — `public/reactivate.html` (+16 / -4)

- Label `Last Name` → `Last Name *`.
- Input adds `required` + `oninvalid` handler that `event.preventDefault()`s the browser's
  native popup and shows an inline `<div>`. That div carries the message in the page's
  language, not the browser's locale-dependent default.
- New inline `<div id="lastNameError">Last name required</div>` — red 13 px text under the
  input, initially hidden.
- Submit handler adds a belt-and-braces JS check before the fetch: if empty, show the inline
  div, focus the field, `return`. Never fires the `/activate` call. Prevents scripted
  submissions from bypassing the native validation.

### Client — `public/reactivate-fr.html` (+16 / -4)

Same three edits with French copy: label `Nom *`, inline `<div id="lastNameError">Nom
obligatoire</div>`, French comment on the submit-handler check.

Prefill unchanged on both pages (`data.visitor.last_name || ''` at :474 / :477) — when the
token was minted with a `last_name`, the field is pre-populated and the user just clicks
Confirm.

### Server — `routes/reactivation.js` (+15)

New check right after the token check at `:669`:
```js
if (!last_name || String(last_name).trim() === '') {
  return res.status(400).json({
    success: false,
    error: 'Last name is required',
    code: 'LAST_NAME_REQUIRED'
  });
}
```
Belt-and-braces for scripted submissions and for cached tabs that still serve the old HTML.

## Behaviour matrix

| Path | Before | After |
|---|---|---|
| User with prefilled last_name (token had it) | field pre-filled, click Confirm | **unchanged** |
| User with empty field, tries to submit | submit fires, empty string sent, activation succeeds, row saved with `last_name=''` | native validation blocked, inline error in page's language, field focused, nothing sent |
| Cached tab from before this deploy | activation succeeded silently | server 400 `LAST_NAME_REQUIRED`, `showAlert(data.error)` at `:535` / `:544` surfaces *"Last name is required"* (English string — hard-reload fixes for FR users) |
| Scripted submission bypassing native validation | activation succeeded with empty last_name | server 400 `LAST_NAME_REQUIRED`, nothing written |

## Cache-tab caveat for FR visitors

The `error` string in the response is English (`"Last name is required"`). FR visitors on a
tab cached before this deploy see the English text via `showAlert()`. Cost: cosmetic — a
hard reload of the page fetches the new HTML and gets inline `Nom obligatoire` in French.

If it becomes a pattern, add a small `errorMessages` object in the response keyed by lang,
or bind the client to render its own message via `data.code`. Deferred.

## Gates

- `node -c routes/reactivation.js` — PASS
- Both `<script>` blocks parse — PASS
- Boot smoke `✓ Reactivation routes loaded (v402)` — PASS
- Post-deploy markers, all three files, all present

## Related

- `docs/sessions/SIEMA26_LAUNCH_DAY_20260907.md` §7 — the three-daytime-deploys incident and
  the new G42 rule
- CLAUDE.md G42 — deploy freeze on campaign days
- CLAUDE.md G43 — `/health` as Render's health check path cuts the 502 window
- `docs/sessions/SIEMA_ACTIVATION_MISMATCH_20260908.md` — 8 Sep forensic recount

## Postscript (2026-09-08) — matcher miss surfaced by the same activation window

While validating this deploy the next morning, we discovered that the SIEMA
campaign 78 `email_events` `'registered'` count was **0** against 909 real token
activations. Root cause: `utils/trackingPixel.js:177` used
`.includes('reactivate.html')`, which does not match `reactivate-fr.html` — every
C78 activation URL pointed at the FR page, so `_lc` was never appended and the
campaign 'registered' event never fired. Fixed same day by widening the substring
to bare `'reactivate'`. 909 backfill events inserted manually with
`metadata.via='backfill_reactivate_fr_matcher_miss'`. The scheduler's
`not_registered` guard was unaffected (check (c) catches every activation via
`reactivation_tokens.status='activated'`), so no visitor was ever re-mailed after
activating.
