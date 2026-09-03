# DEPLOY — SIEMA batch (2-3 Sep 2026)

> One session doc for the eight commits that make up the SIEMA launch batch.
> The 2 Sep polish commit (`81c9a0f`) landed after the last per-day deploy doc
> and is folded in here rather than left orphaned. Live evidence at the end
> is the 4-recipient run on production expo 9 (Suer, ~16:32 UTC).

---

## 1. The eight commits, in order

| SHA | Time (Istanbul) | Title |
|---|---|---|
| `81c9a0f` | **2 Sep 18:45** | feat(wizard): step-column headers, tooltips, step-1 disabled + backend normaliser + info box |
| `72a29d4` | **3 Sep 10:31** | feat(wizard): cross-campaign overlap detection + opt-in exclusion |
| `77297e7` | **3 Sep 12:08** | feat(wizard): holdout at build time — random control group, opt-in, 0–20% |
| `f6e7f44` | **3 Sep 13:35** | feat(wizard): Delivery B — `/lift` report + one-line lift on Stats tab |
| `3f4da63` | **3 Sep 14:22** | feat: Morocco CAN-SPAM footer + wizard preview readability |
| `52cc517` | **3 Sep 18:17** | feat(wizard): SIEMA batch — sender name, French page, form design, phone, footer |
| `fec84bf` | **3 Sep 18:58** | fix(wizard): phone assertion location + expo-name fallback for CAMPAIGN_SENDER_NAME |
| `7e34f9e` | **3 Sep 19:39** | feat(campaign-wizard): propagate form_id + phone to reused pending tokens (Phase 2b) |

---

## 2. Commit-by-commit

### `81c9a0f` — step-column headers, tooltips, step-1 disabled + backend normaliser + info box

**What.**
- Header row above each wave's step list (Template | Delay (hours) | Send to | | ), 5-column grid-aligned to `.wizard-step-row`.
- `title=` tooltips on delay input + condition select naming that Step 1 is always 0/`all`.
- Row 1 (index 0) delay + condition inputs `disabled`, and the array is mutated on every render to force `delay_hours=0 / condition='all'` — matches the backend contract at `routes/campaigns.js:383-384` + `:891-892`.
- Muted "typical drip" hint (`0h → 120h → 120h → 120h`) under Add step in both waves.
- Collapsible info box at top of `#wizardTab` (own localStorage key `wizardInfoBox_closed`; independent of page-level box). English only per Suer's ask.
- New backend `normaliseStep1(arr, waveLabel)` helper in `POST /api/campaigns/reactivation/build` (`routes/campaignBuilder.js`, `+27`) called for both waves BEFORE template validation and orchestrator. Logs one line per wave when it fires, silent when 0/`all` is already sent. Closes the gap where a direct API caller (or a UI regression) could `POST activate_steps[0]={delay_hours:120,condition:'not_registered'}` and land step 1 five days late with reminder-only semantics — the exact failure mode `campaigns.js:383-384` was written to prevent.

**Why.** Suer's live use — *"0 and 24 mean nothing without labels"* — plus the UI-only enforcement leaves the API open.

**Path:line.**
- `public/reactivation-campaign.html` +94/-2 — header row + tooltips + row-1 forcing + drip hint + info box + `initWizardInfoBox()` wired from `wInitTab()`.
- `routes/campaignBuilder.js` +27 — `normaliseStep1` helper + two call sites in `/build`.

**Test coverage.**
- `tests/test_wizard_silent.js` **STEP 7** (+119): third `/segment` for a fresh preview_token, then `/build` with deliberately-offending `activate_steps[0] = {delay_hours:120, condition:'not_registered'}` + `register_steps[0] = {delay_hours:240, condition:'not_opened'}`. After the job completes, reads `campaign_steps` for `step_number=1` from BOTH campaigns and asserts every row has `delay_hours=0 AND condition='all'`. Any refactor that removes the normaliser, moves it below the Phase 5 INSERT loop, or breaks the mutation semantics of the wave-step array will fail STEP 7.

### `72a29d4` — cross-campaign overlap detection + opt-in exclusion

**What.** Warning-first (never automatic) surface for the same email being enrolled in two campaigns for the same target expo.

- New body flag: `exclude_already_in_campaign` (bool, default `false`). Accepted on multipart (string `'true'`) and JSON (boolean `true`).
- **5th prefetch query** added to the existing `Promise.all` in `/segment` (no serial round-trip), bounded by `LOWER(TRIM(cr.email)) = ANY($3)` so worst-case bandwidth scales with source size, not the expo's active-recipient count:
  ```sql
  SELECT LOWER(TRIM(cr.email)) AS email, cr.campaign_id,
         ec.name AS campaign_name, ec.status AS campaign_status
  FROM campaign_recipients cr
  JOIN email_campaigns ec ON ec.id = cr.campaign_id
  WHERE cr.status = 'active'
    AND ec.expo_id = $1 AND ec.organizer_id = $2
    AND LOWER(TRIM(cr.email)) = ANY($3)
  ```
- Enum values verified against production DISTINCT queries: `email_campaigns.status` = (draft 3, completed 14). No `ec.status` predicate → **drafts count**, per Suer's Sunday-build/Monday-launch pattern where a draft-skip would silence the warning in exactly the situation it exists for. `campaign_recipients.status` = (active 63k, completed 92k, unsubscribed 603) — only `'active'` included.
- **EXPLAIN ANALYZE** against expo 9 target = **0.096 ms** (idx_campaigns_expo → idx_recipients_campaign nested loop, source array of 1). Worst case against expo 7 = **44 ms** (idx_recipients_status scan + Memoize on campaign_id).
- Response gains 2 keys inside `counts` (`already_in_another_campaign`, `excluded_already_in_campaign`) + `other_campaigns` alongside `counts` (max 5 by overlap desc, campaign id tiebreak, each carries `{id, name, status, overlap_count}` so the UI distinguishes draft-only vs at-least-one-active).
- **Exclusion** (opt-in): when flag=`true` AND overlap set is non-empty, `cleanList` is filtered IN PLACE before the bucketing loop. Filter is on the source list, not a post-hoc count subtraction — `g1/g2/g3` stay internally consistent.
- **Frontend** (`public/reactivation-campaign.html` +99/-3): amber warning row `#wPvCrossCampaignNote` under G1 note, only shown when `already_in_another_campaign > 0`. Muted confirmation row `#wPvCrossCampaignExcludedNote` shown after exclusion. Copy switches on `Array.every(oc => oc.status === 'draft')` (all-draft vs at-least-one-active phrasing). "Remove them from this campaign" button re-calls `/segment` with the flag, gets a NEW `preview_token`, adopts it at `:1618`; `/build` reads it at `:1885`. **Client-side filtering would leave the server cache unchanged and the build would enrol everyone** — the button re-run is architecturally required, not decorative.

**Why.** `campaignBuilder.js:912` inserts with `ON CONFLICT (campaign_id, email) DO NOTHING` — conflict key is per campaign, not per expo. The four `/segment` prefetch sets (`S_target`, `S_other`, `S_tokens`, unsubs) never consulted `campaign_recipients` or `email_campaigns`. Two wizard runs against the same target expo enrolled the same email in both campaigns; both step-1 emails shipped the same day if activated together.

**Path:line.** `routes/campaignBuilder.js` +110/-3 (5th prefetch query in `/segment`, exclusion filter, response shape); `public/reactivation-campaign.html` +99/-3 (6 new IDs, 27 total wPv IDs verified present exactly once); `tests/test_wizard_silent.js` +113 (**STEP 8**).

**Test coverage.**
- STEP 8a (no flag): asserts `already_in_another_campaign === 5`, `other_campaigns` is a top-level array, every overlap campaign name starts with `[SMOKE-WIZARD]`, and `g1/g2/g3/tokens_to_mint` UNCHANGED from STEP 6 baseline (0/3/2/0) — the byte-identical invariant for zero-drift on detection-only mode.
- STEP 8b (`flag=true`): asserts `excluded_already_in_campaign === 5`, `already_in_another_campaign === 0` (filtered emails no longer counted), `g1/g2/g3` ALL === 0 (all 5 emails filtered before bucketing, both buckets collapse), `g2_raw + g3_raw === 0` (rows never entered buckets — proves pre-bucketing filter).

### `77297e7` — holdout at build time (control group, opt-in, 0–20%)

**What.** Random N% of mailable recipients gets NO email and NO token; the row still lands in `campaign_recipients` with `status='holdout'` so post-fair we can measure real campaign lift.

- Body accepts optional `holdout_pct` (integer 0–20, default 0). Bad input → 400 with clear error before touching state.
- Selection happens in the request-path scope (Fisher-Yates shuffle → Set) and is captured in the `setImmediate` closure. **Must happen before Phase 2 iterates `preview.g2_activate` to mint tokens** — a naive design that only set `status='holdout'` at INSERT time would still create `reactivation_tokens` rows for held-out people.
- Per-wave selection: `round(mailable × pct/100)`. G2 mailable filtered by `!_unsub`; G3 same.
- **Phase 2 mint filter extended:** `preview.g2_activate.filter(r => !r._unsub && !r._hasToken && !S_holdoutG2.has(r.email))` — held-out emails never get a `reactivation_tokens` row.
- **Phase 3 (G2 recipient build):** early-return on `isHoldout` — row pushed with no `activation_url` in `extra_fields` + `_holdout=true`. Row still lands in `campaign_recipients` so Delivery B can count them.
- **Phase 4 (G3 recipient build):** `_holdout: S_holdoutG3.has(r.email)` on every row.
- **Phase 6 INSERT:** adds `status` column (7 cols instead of 6). Per-row `'holdout'` for `_holdout=true`, `'active'` otherwise. VARCHAR(30), no CHECK constraint (verified read-only). `next_step_due_at` stays NULL — both send-path filters miss holdout rows:
  - `campaigns.js:917-918` `UPDATE ... WHERE status = 'active'`
  - `email_worker.js:347-348` `SELECT ... WHERE status = 'active' AND next_step_due_at IS NOT NULL`
- `checkCampaignCompletion` at `email_worker.js:671-674` checks `NOT EXISTS (status = 'active')` — holdouts do NOT keep the campaign open forever.
- **Cross-campaign overlap query updated:** `cr.status IN ('active','holdout')` instead of `cr.status = 'active'`. Without this a second campaign would silently mail Campaign A's control group and contaminate the lift measurement.
- Response 202 body gains `holdout_activate` + `holdout_register` counts. `tokens_to_mint` recalculated to exclude the holdout set (matches Phase 2's filter, so the two numbers stay contracted).
- **Zero-holdout drift guard:** when `holdout_pct` is 0/absent, `S_holdoutG2` and `S_holdoutG3` are empty → all filters are byte-identical to prior behaviour → STEP 8's byte-identical assertion still passes.
- **Frontend:** new form-group on Panel 4 (Confirm) between summary and draft-only note. `#wHoldoutPct` min=0 max=20 step=1 value=0. `wUpdateHoldoutSummary()` computes per-wave counts client-side using the same `round()` math the backend uses. Edge case: `pct > 0 but round(mailable × pct/100) === 0` renders *"0 holdout — the mailable pool is too small for X% to round up."*

**Why (Suer 3 Sep).** Measure real campaign lift for SIEMA. A random N% gets no email and no token; post-fair we compare their registration + check-in rates to the mailed group's. Must land before the SIEMA build on ~6 Sep.

**Path:line.** `routes/campaignBuilder.js` +124/-9; `public/reactivation-campaign.html` +57; `tests/test_wizard_silent.js` +152 (**STEP 9**).

**Test coverage.**
- STEP 9 uses the 5-row fixture with `holdout_pct=20`: `round(3 * 0.20) = 1` G2 holdout, `round(2 * 0.20) = 0` G3 holdout.
- Asserts: 202 body `holdout_activate === 1, holdout_register === 0`; activate campaign has exactly 1 `status='holdout'` + 2 `status='active'`; holdout row's `next_step_due_at IS NULL`; NO new `reactivation_tokens` row for the held-out email since `jobStart9` (measured as a delta — the G2 seeds already have tokens from earlier steps' mints; what changes is 0); follow-up `/segment` shows `already_in_another_campaign === 5` AND the new activate campaign appears in `other_campaigns` (proves overlap query uses `cr.status IN ('active','holdout')`).

### `f6e7f44` — Delivery B: `/lift` report + one-line lift on Stats tab

**What.** Read-only lift measurement on the campaign detail page. Closes the holdout loop that Delivery A (`77297e7`) opened.

- New endpoint: `GET /api/campaigns/:id/lift` in `routes/campaignBuilder.js` (+133). Behind `authMiddleware` at router-scope; organizer-scoped via `WHERE ec.organizer_id = $2` → 404 if the caller doesn't own the campaign. Read-only.
- **Route mount order verified:** `campaigns.js` is mounted first at `index.js:145` with `GET /:id` at `:161` but no `/:id/lift` handler, so Express falls through to `campaignBuilder` at `index.js:146`. No route collision.
- **SQL:** bucket by `CASE WHEN cr.status='holdout' THEN 'holdout' ELSE 'mailed' END`, then LATERAL-count how many rows per bucket registered on the campaign's expo (visitors row with matching `lower(trim(email))`) and how many checked in. **Email-JOIN** because `campaign_recipients.visitor_id` is 0% populated for excel-uploaded lists (Delivery A design §3.2).
- **Response shape:**
  ```json
  { "success": true, "campaign_id": N, "expo_id": M, "expo_started": bool,
    "mailed":  {"total", "registered", "rate_pct", "checked_in", "checkin_rate_pct"},
    "holdout": null | {...same shape...},
    "lift_pts_registered": null | number,
    "lift_pts_checked_in":  null | number }
  ```
- `expo_started` (bool, `expos.start_date <= CURRENT_DATE`) lets the UI label pre-fair numbers *"registration only — check-in data arrives when the fair opens"*. `holdout=null` when the campaign has no `status='holdout'` rows (pre-holdout-era campaigns). `lift_pts_*` null when `holdout=null` OR either bucket empty. Rates rounded to 1 decimal.
- **Stats tab one-liner** (`public/email-campaigns.html` +49): placeholder `<div id="wLiftLine" style="display:none;">` injected at top of the rendered html; `wLiftFetch(campaignId)` called at the end of `renderStats` (fire-and-forget, no `await`). Populates the placeholder if `data.holdout` is present and both buckets non-empty.
- **Copy per Suer's spec, verbatim:**
  > **Mailed:** 21.4% registered · **Holdout:** 9.8% · **Lift** +11.6 pts

  Pre-fair sub-line: *"Registration only — check-in data arrives when the fair opens."*
  Post-fair sub-line: *"Check-in: Mailed 15.6% · Holdout 6.7% · Lift +8.9 pts"*
- **Silent no-op paths:** pre-holdout campaigns (`data.holdout === null`), pre-lift-endpoint backends (404), network errors — all leave the Stats tab exactly as it was before. `wLiftLine` stays `display:none`.
- Zero touches to any other function on `email-campaigns.html`. Yaprak's daily flow through Create Campaign / Activate / Pause / Recipients upload is byte-identical.

**Why.** Complete the measurement loop opened by holdout. Read-only, opt-in-by-data-presence, silent when there's nothing to say.

**Path:line.** `routes/campaignBuilder.js` +133 (`GET /:id/lift`); `public/email-campaigns.html` +49 (`renderStats` placeholder + `wLiftFetch`); `docs/WIZARD_USER_GUIDE.md` NEW (+119).

**Test coverage.**
- `tests/test_wizard_silent.js` **STEP 10** (+60): runs BEFORE the STEP 9 cleanup so `activateCamp9Id` still exists. Asserts HTTP 200, `success: true`; `campaign_id === activateCamp9Id`, `expo_id === 17`; `expo_started === false` (expo 17 `start_date 2026-09-30` > CURRENT_DATE 3 Sep); `mailed.total === 2, mailed.registered === 0`; `holdout.total === 1, holdout.registered === 0`; both buckets carry the full 5-key shape; `lift_pts_registered === 0`; `typeof lift_pts_checked_in === 'number'`.

### `3f4da63` — Morocco CAN-SPAM footer + wizard preview readability

**What (Phase A — footer).** Physical postal address on its own lines after the unsubscribe link, satisfying US CAN-SPAM §316.5(a)(5). Built into the footer template string directly — NOT appended via `.replace()` on the sentence, so any future wording change cannot silently drop the address.

Morocco entity (Suer 2 Sep):
```
ELAN EXPO MAROC SARL
30, Bd Rahal El Meskini, 2ème Etage, Appart N° 5, Casablanca, Morocco
+212 650 219 756
```

UTF-8 verified: `2ème` renders as `32 c3 a8 6d 65` (è = U+00E8 → C3 A8), `N°` renders as `4e c2 b0` (° = U+00B0 → C2 B0).

⚠️ **CAMPAIGN-ONLY.** Grep proof: `injectUnsubscribeLink` has exactly 1 call site (`email_worker.js:596` inside `enqueueStepEmail`), and `enqueueStepEmail` has exactly 1 caller (`email_worker.js:429` inside `processRecipient`, the campaign scheduler). Badge / certificate / single-recipient sends bypass this helper. Sender identity unchanged — From stays `noreply@leena.app` on established DKIM/DMARC on `leena.app`.

**What (Phase B — wizard preview).** Suer misread the struck-through grey G1 line as "0 registered". Fix: restructure the preview panel around a plain-English 3-line headline block and hide the raw ledger inside a collapsible `<details>`.

- New headline block (blue): *"Will receive emails: N"* (large bold), *"Excluded: M (x already registered · y invalid emails …)"*, *"New tokens to be minted: K"*. Sum computed client-side from the `/segment` response.
- G1 amber info row replaces the struck-through grey line: *"N people are ALREADY registered on <target expo name> — they are excluded and will receive nothing."* Only shown when `g1 > 0`.
- Register-wave-empty state: when `g3_mailable=0`, hide the 3 G3 rows in the ledger (class `.wPvG3Row` on each) and show a single muted line *"Register wave: none in this source (everyone is already in our database)."*
- Collapsible `<details><summary>Details</summary>` wraps the full ledger, retaining every existing `wPv*` ID (21/21 verified present exactly once).

Backend `/segment` response shape UNCHANGED. Cosmetic-only diff to `wRenderPreview`.

**Path:line.** `utils/trackingPixel.js` +15/-4; `public/reactivation-campaign.html` +100/-13; `todo.md` +1 (P2 per-country office footer address).

**Test coverage.** Pre-deploy `/segment` baseline captured by Suer from the browser (21,389 / 2 invalid / 93 G1 / 21,294 G2 mailable / 0 G3, ~21:02 local); post-deploy 21:18 baseline (headline *"21,286 will receive", "103 excluded (101 + 2)", "21,286 to mint"*) both verbatim in `docs/sessions/DEPLOY_FOOTER_AND_WIZARD_POLISH_20260902.md`; arithmetic invariants held both times.

### `52cc517` — SIEMA batch: sender name, French page, form design, phone, footer

Approved batch of 5 items + Change B + Small Add, single deploy.

**Item 1 — Sender display name.**
- `utils/email.js` +11/-3: `sendEmailWithReplyTo` gains optional `fromName`. When set, SendGrid gets `{email, name}` object → *"SIEMA FoodExpo 2026 <noreply@leena.app>"*. When null (all callers except campaign worker), bare email as today.
- `email_worker.js` +25/-7: `isCampaignTask` gate at `:230` extended to set `fromName = env CAMPAIGN_SENDER_NAME`. Badge / certificate / single-recipient tasks lack `task.campaign_id` → `fromName=null` → bare email preserved.

**Item 2 — French activation page.**
- `public/reactivate-fr.html` NEW (+641): byte-for-byte copy of `reactivate.html` with `<html lang="fr">`, 24 user-facing strings translated (Moroccan business register, "vous", proper UTF-8 accents), `toLocaleDateString('fr-FR', ...)` at both sites. English file untouched (`git diff public/reactivate.html` empty). Server-side error strings stay English (deferred trade-off — P3).
- `/build` accepts `activation_lang: 'en'|'fr'` (default `'en'`). Phase 3 URL builder switches file at `routes/campaignBuilder.js:1007`: `reactivate.html` vs `reactivate-fr.html`. Response echoes `activation_lang`.

**Item 3 — Activation form design.**
- `/build` accepts `form_id`. Shape check pre-preview, ownership check post-preview (`WHERE id=$1 AND expo_id=$2 AND organizer_id=$3`). Threaded to `processReactivationChunks` at `:976`, replacing the hardcoded `null` identified in the SIEMA pre-launch audit §6b. Response echoes `activation_form_id`.

**Item 4 — Phone through resolveCountry-first-then-normalize (Change B).**
- Excel reader applies the pattern from `reactivation.js:228-235`: `resolveCountry(row.country, targetCountryCode, map)` first, then `normalizePhone(raw, resolved)`. Countries map loaded once via `getCoreCountriesMap` (cached at module scope). Row's own country wins; missing country falls back to target expo.
- Verified local: France "06…" on MA target → **+33**, Morocco "06…" on MA → **+212**, Senegal on MA → **+221**, empty country → target (MA), explicit "+33" → **+33**.
- Single-layer normalisation: `processReactivationChunks` itself does not normalise (verified at `reactivation.js:61-140` — takes `r.phone` as-is). From-expo path takes phones straight from `visitors.phone` (already normalised post-2 Sep).

**Item 5 — French footer sentence.**
- `utils/trackingPixel.js` +19/-13: `injectUnsubscribeLink` signature gains `expoCountryCode` as last param. Sentence branches on `countryCode === 'MA'` (strict — upper-case ISO alpha-2). NULL / undefined / '' / non-`'MA'` → English fallback. Verified live: null → ENGLISH, undefined → ENGLISH, `''` → ENGLISH, `'NG'` → ENGLISH, `'MA'` → FRENCH, `'ma'` → ENGLISH, `'FR'` → ENGLISH. Never throws.
- Address block stays hardcoded Morocco (P2 unchanged for SIEMA period; per-country office footer is the future work).
- `email_worker.js` processCampaign SELECT gains `country_code` (`:326`). Threaded through `processRecipient` (`:396`, `:419`) and `enqueueStepEmail` (`:443`, `:545`) as last positional param. `injectUnsubscribeLink` call at `:610` forwards it. **Proof:** every `processRecipient` / `enqueueStepEmail` call site is the new arity (1/1 each; no legacy call sites remain).

**Small Add — language default from target country.**
- `/segment` response includes `target_country_code`. UI reads it to default the activation-language select (`'MA'` → Français preselected; else English; overridable + remembered per session via `dataset.userTouched`).

**Confirm-panel (public/reactivation-campaign.html +110).** Two selects:
- *"Activation page language"* (English / Français, defaulted from country_code, overridable, sticky).
- *"Activation page design"* (populated from `GET /api/forms/expo/:id`, visitor-type forms only, default *"(default — yellow theme)"*).
- Both hidden when `actSteps === 0` (no activate wave → no activation URL). `wBuild` sends `activation_lang` + `form_id` only when non-default.
- `wPopulateActivationForms` fetches on Confirm entry, silent on error.

**Test coverage.**
- Fixture seeded with phones on rows 1-3 (JS number + explicit +212 + Turkish local).
- STEP 9 gains `form_id=42` (belongs to expo 11, target is expo 17) → asserts HTTP 404 + error message names `form_id`. Positive `form_id` round-trip deferred at commit-time — expo 17 had no forms; validated by code trace `campaignBuilder.js:976 → reactivation.js:131`. **Phase 2b (`7e34f9e`) later added a positive round-trip via a per-test probe form.**

### `fec84bf` — phone assertion location + expo-name fallback for CAMPAIGN_SENDER_NAME

**What (test bug).** STEP 9's phone assertion FAILED against Suer's live TEST_JWT run *("0 non-empty out of 0")* because it filtered `reactivation_tokens` by `created_at >= jobStartTime9`. The G2 seeds' tokens were minted at STEP 3 (STEP 9's `tokens_to_mint = 0` by design; STEP 9 is the reuse path). Wrong-timestamp SELECT → zero rows → the assertion "at least one non-empty phone" evaluated as `0 >= 1` → FALSE → assertion threw.

**⚠️ Straight-up test bug — the failure was CORRECT (the assertion was wrong, not the code being tested). The assertion did NOT silently pass earlier; it failed the run.**

Fix: move the phone assertion to a new **STEP 5f** block right after STEP 5's other DB assertions, filtered on `created_at >= jobStartTime` (STEP 3's timestamp). All 3 G2 seeds have fresh tokens there. Assert 3/3 tokens present, ≥1 non-empty phone, ≥1 E.164 (starts with `+`) — proves `resolveCountry + normalizePhone` fired.

STEP 9's old assertion site left with a comment recording why the check moved — future readers see the trap and don't re-introduce it.

**What (env-var safety net).** When `CAMPAIGN_SENDER_NAME` is unset, fall back to the campaign's expo name so recipients see something contextual rather than bare `noreply@leena.app`.

- Wanted as "one line" but `processTask` (queue drain, where `fromName` lives) runs in a different scope than `processCampaign` (scheduler, where `organizerName` is already fetched). Needed a small module-scoped cache + async lookup at `email_worker.js:148-169`:
  - `Map<campaign_id, expo_name>` cache, one query per NEW `campaign_id`
  - `_getExpoNameForCampaign()` non-fatal on DB error (returns `''`)
  - fallback chain: env → cached expo name → null
- Cache lives until worker restart — campaign→expo binding never changes after creation, so no invalidation logic needed. Cache miss cost: one JOIN query per campaign; hit cost: O(1) `Map` lookup. For a 40k drain across 5 steps, exactly 1 query added per campaign lifetime.

**Backwards compat.** Env var still wins when set (Suer's SIEMA plan unchanged); unset AND no expo → null → bare email as today. Badge/certificate/single-recipient tasks lack `task.campaign_id` → `isCampaignTask=false` → `fromName` stays null on every non-campaign path.

**Path:line.** `email_worker.js` +27/-6 (`:148-169` cache/helper, `:230` chain); `tests/test_wizard_silent.js` +27/-27 (STEP 5f + STEP 9 assertion moved).

### `7e34f9e` — Phase 2b: propagate form_id + phone to reused pending tokens

**What.** When `/build` REUSES existing pending tokens (`_hasToken=true`), a new UPDATE block writes the current build's `form_id` (always) and current row's `phone` (only when the token's phone is empty) into those tokens BEFORE Phase 3 builds recipient rows.

- **Reuse citation.** `routes/campaignBuilder.js:1015` mint filter skips `_hasToken=true` rows; `:1078` Phase 3 SELECT then pulls both freshly-minted AND pre-existing pending tokens for the full `g2_mailable` list. The "reused" tokens are the ones Phase 2 skipped that Phase 3 finds in the DB.
- **Phase 2b block (`routes/campaignBuilder.js:1057-1116`):** inserts between Phase 2's mint call and Phase 3's SELECT. Filter set:
  ```javascript
  const reusedRows = preview.g2_activate.filter(r =>
    !r._unsub && r._hasToken && !S_holdoutG2.has(r.email)
  );
  ```
- Chunked (1000/statement) batch UPDATE using a VALUES join for per-row phone; `form_id` + `target_expo_id` shared as `$1`/`$2`:
  ```sql
  UPDATE reactivation_tokens rt
  SET form_id = $1,
      phone = CASE WHEN COALESCE(rt.phone, '') = '' THEN v.phone ELSE rt.phone END
  FROM (VALUES ...) AS v(email, phone)
  WHERE rt.target_expo_id = $2
    AND rt.status = 'pending'
    AND rt.email = v.email
  ```
  - `form_id` → **always** to `formIdForActivation` (may be NULL).
  - `phone` → only when the token's current phone is empty (COALESCE guard; never clobber a good phone).
  - `status` → `WHERE status='pending'` per spec: never touch activated/expired tokens.
  - `updated_at` → **NOT SET**. Verified read-only against production that `reactivation_tokens` has no `updated_at` column (19 columns; not added).
- `truncateRowFields` reused for VARCHAR(255) phone safety.

**Why.** The live 4-recipient test on expo 9 (see §3 below) exposed that reused tokens kept their original `form_id` (usually NULL → default yellow theme) and original phone (usually empty), so the wizard's Confirm-panel choices had no effect on repeat runs.

**Test coverage.**
- `tests/test_wizard_silent.js` **STEP 6 extension**:
  - STEP 0a2 (new): creates a probe form (visitor-type, `is_active=false`, name-prefixed) on `TEST_EXPO_ID` via `POST /api/forms`; captures `probeFormId`. Cleanup added to both `programmaticCleanup` and `emitCleanupSql`.
  - Pre-snapshot: reads `form_id + phone` for the 3 G2 seed tokens, asserts `form_id=NULL` for all (STEP 3 didn't pass `form_id`) and ≥1 non-empty phone.
  - Second `/build` now sends `form_id: probeFormId`.
  - Post-snapshot: re-reads same rows, asserts all 3 `form_id === probeFormId` (proves UPDATE fired) AND all 3 phones byte-equal to pre-snapshot (proves COALESCE guard held).

---

## 3. LIVE EVIDENCE — 4-recipient test on production expo 9

**Context.** Suer's browser click-through on production expo 9 (Morocco Siema Expo 2026), 3 Sep ~16:32 UTC. Two runs:

- **Run 1 (~16:21 UTC, campaign 59).** Reused old tokens (`tokens_to_mint=0`). Activation page opened with the yellow default theme (form_id=NULL) and empty phone — even though Confirm panel had form 59 selected and source rows carried phones. **This is the finding that produced Phase 2b (`7e34f9e`).**
- **Run 2 (~16:32 UTC, campaign 60, after Phase 2b deploy).** Fresh mint — 4 new `reactivation_tokens` rows, all `form_id=59`, all phones populated correctly per Decision B.

### Delivered mail (Run 2 / campaign 60, verbatim per Suer)

- **From:** `Elan Expo <noreply@leena.app>`
- **Subject:** `Nihat, votre badge SIEMA 2026 est prêt`
- Preheader: new stored preheader for template 74 (see §MANUAL_DB_CHANGES doc)
- **Footer:** French sentence *"Si vous ne souhaitez plus recevoir ces e-mails de Elan Expo, désabonnez-vous ici."* + Morocco address block (ELAN EXPO MAROC SARL / 30, Bd Rahal El Meskini, 2ème Etage, Appart N° 5, Casablanca, Morocco / +212 650 219 756)
- **Authentication-Results:** `dkim=pass`, `spf=pass`, `dmarc=pass`
- **Activation page:** clicked link → `reactivate-fr.html` rendered with **form 59's design** and prefilled data (name + phone in E.164)

### `reactivation_tokens` after the fresh mint (read-only, 3 Sep post-run)

Query: `SELECT id, LEFT(token,10), email, phone, form_id, status, LEFT(created_at::text,19) FROM reactivation_tokens WHERE target_expo_id=9 AND email IN (…) ORDER BY email;`

| id | token10 | email | phone | form_id | status | created |
|---|---|---|---|---|---|---|
| 148853 | `d462d2d384` | `elif@elan-expo.com` | `+212661234568` | 59 | pending | 2026-09-03 16:32:49 |
| 148854 | `67b4cfdb6a` | `info@elanexpo.net` | `+33612345678` | 59 | pending | 2026-09-03 16:32:49 |
| 148855 | `be39144a12` | `info@plusdesignmaroc.com` | `+212661234569` | 59 | pending | 2026-09-03 16:32:49 |
| 148852 | `71bded5d17` | `suer@elan-expo.com` | `+212661234567` | 59 | pending | 2026-09-03 16:32:49 |

**Every proof point Suer named:**
- `elif`, `info@plusdesignmaroc.com`, `suer` — Morocco locals `0661234567/8/9` → **+212** (row country Morocco OR falls back to target expo MA)
- `info@elanexpo.net` — French local `0612345678` with `country='France'` → **+33** (row country wins over target MA — **Decision B proven live**)
- All four `form_id=59` (activation page design flowed through — Item 3 proven)
- All four `pending` at `created_at 16:32:49` — one-shot mint under campaign 60

⚠️ Note the DB timestamp `16:32:49` matches campaign 60's `created_at`, not campaign 59's `16:21:33`. Suer's shorthand *"campaign 59, built ~16:32"* conflates the pair: campaign 59 was the earlier run that surfaced the reuse bug; campaign 60 was the post-Phase-2b run that produced these tokens.

### Verification checklist (all green)

- ✅ Sender display: *"Elan Expo <noreply@leena.app>"* — proves `CAMPAIGN_SENDER_NAME` env var + `email_worker.js:256-265` chain
- ✅ Subject line: French, with `{{first_name}}` fallback chain working (`Nihat,`)
- ✅ Body preheader: matches the 3 Sep Render-Shell repair (§MANUAL_DB doc)
- ✅ Footer: French sentence + Morocco address — proves `expoCountryCode='MA'` reached `injectUnsubscribeLink`
- ✅ SPF/DKIM/DMARC pass — sender-name change did not break authentication (SPF via `em5759.leena.app` bounce subdomain per 2 Sep audit §C.1)
- ✅ Activation link → `reactivate-fr.html` — proves `activation_lang='fr'` reached Phase 3 URL builder
- ✅ Activation page rendered with form 59 design — proves `form_id=59` flowed through `processReactivationChunks` and `/verify/:token` joined `forms.config`
- ✅ Row phones populated per Decision B — proves `resolveCountry(row.country, targetCountryCode, map)` then `normalizePhone(raw, resolved)`

---

## 4. Deploy sequence

Each of the 7 code commits above was individually pushed → Render restart (~30 s each) → `/health` 200 confirmed before the next commit landed. `7e34f9e` (Phase 2b) shipped last at 19:39:41 Istanbul; `/health` returned 200 at try 4 (~1 min after push).

Validator unit tests stayed **18/18** through every step (each pre-push local run).
