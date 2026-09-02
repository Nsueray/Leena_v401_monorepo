# Deploy — Campaign Wizard (todo #1)

**Date:** 2 Sep 2026
**Commits:** `e07ac0f` (G1) · `a404558` (G2) · `5962e1b` (bare-{{name}} severity split) · `081bb79` (G3 UI) · `803fd4f` (G4 tests) · `8740dd7` (mailable-formula fix + STEP 6)
**Scope:** new `/api/campaigns/reactivation/*` endpoints, a third tab in `public/reactivation-campaign.html`, two test files. Zero changes to the existing "Create Campaign" or "View Campaigns" tabs, to the Email Campaigns page, to the email worker, or to any live-traffic route.

Closes SIEMA blocker (target date ~8 Sep — Yaprak must ship the wave without Suer's manual SQL). Replaces the manual "Node scripts + SQL + Excel round-trips" workflow with a five-panel wizard that produces two **draft** campaigns per run, ready to activate from the existing Email Campaigns page.

---

## 1. What shipped

Six commits, one PR-worth of work, one Render deploy per commit-group but the final live build is `8740dd7`. Timings all UTC.

| commit | UTC | files | net | note |
|---|---|---|---|---|
| `e07ac0f` | 2 Sep 11:36 | 5 | +438 / −4 | G1 — segment preview endpoint (Piece 1) + orchestrator skeleton (Piece 2 shell) + Piece 4 (per-chunk error persisted into `import_jobs.error_message`) |
| `a404558` | 2 Sep 12:37 | 2 | +571 / −25 | G2 — full six-phase orchestrator + `/validate-template` + wave-aware template validation (Piece 6) + Piece 5 (VARCHAR(255) truncation) |
| `5962e1b` | 2 Sep 12:53 | 1 | +15 / −1 | Suer decision after G2 diff: bare `{{name}}` is a **warning** (BARE_NAME_FALLBACK), not an error. Measured against `email_worker.js:570-572` — `{{name}}` maps to `first_name \|\| 'Guest'` so it never renders empty; `{{first_name}}` / `{{last_name}}` do render empty and stay errors. SIEMA templates 47/69/28 all use bare `{{name}}` in body — under the old rule they would have been blocked. |
| `081bb79` | 2 Sep 13:33 | 1 | +573 | G3 — third tab in `reactivation-campaign.html`, 5 panels, all vanilla JS. Includes Suer-flagged UI Fix (a) (land on step 3 when `/build` returns 400 `blocking_templates`) and Fix (b) (`loadExpos()` calls `wInitTab()` at the end so wizard dropdowns populate even if the user clicks the wizard tab before `/expos` completes). |
| `803fd4f` | 2 Sep 14:23 | 3 | +731 | G4 — `tests/test_template_validator.js` (9 cases × 2 assertions = 18/18, direct `require` of the named export, no string slicing) + `tests/test_wizard_silent.js` (~35 assertions across the four wire endpoints + DB verification). Named exports added to `campaignBuilder.js` for direct unit testing. |
| **`8740dd7`** | **2 Sep 14:48** | 4 | +174 / −3 | **The mailable fix.** Bug found by Suer in the live click-through (not by tests) — see §3. Also adds `tokens_to_mint` to `/segment`'s `counts` (same name and formula as `/build`'s existing `:921` response), the UI's "... tokens to mint (new)" preview row, and STEP 6 in the wire smoke asserting the second-run mailable invariant. |

Render 502 window on the final push: **~14 s** (14:48:36 → 14:48:50), inside G3's 10-50 s envelope. `/health` recovered ~4 s before the static-file proxy caught up — worth remembering as a Render-side pattern.

---

## 2. What the four wizard endpoints do

All mounted under `/api/campaigns` (same prefix as `routes/campaigns.js`, no route collision — verified against the existing 18 routes). All behind `authMiddleware` at the router level (`campaignBuilder.js:39`).

### `POST /api/campaigns/reactivation/segment` — read-only preview

Multipart (`file` + `target_expo_id`) or JSON (`{target_expo_id, source_expo_ids:[…]}`) input. Zero writes. Pre-fetches four `Sets` in parallel (target-expo visitors / other-expo visitors / unsubs / existing tokens — all whole-table, organiser-scoped either directly by `organizer_id` or transitively via `target_expo_id`). Buckets every clean email into **G1** (already registered on target — excluded), **G2** (has visitor row on another expo of this organiser — activate wave), or **G3** (no visitor row anywhere — register wave).

Response `counts` after the mailable fix:
```
total_verified, invalid_email, duplicates_in_list,
g1_already_registered_target,
g2_activate_raw, g2_activate_mailable (= raw − unsub),
g3_register_raw, g3_register_mailable (= raw − unsub),
unsubscribed_hits,
existing_pending_tokens_hit (= G2 rows already holding a pending token),
tokens_to_mint (= G2 − unsub − hasToken; contracted equal to /build's tokens_to_mint)
```

Returns a `preview_token` (16-byte hex, 30-min in-memory TTL) that the orchestrator reads back verbatim.

### `POST /api/campaigns/validate-template` — wave-aware validator

Body `{template_id, wave: 'activate'|'register'|null}`. Reads the template (scoped by `organizer_id`), runs `validateTemplateBody`, returns `{ok, error_count, warning_count, issues[]:{code, severity, message}}`.

Five checks:
| code | severity | trigger |
|---|---|---|
| `NO_GREETING_CHAIN` | error | body has bare `{{first_name}}` or `{{last_name}}` (no `\|`) — renders empty per `email_worker.js:571-572` |
| `BARE_FIRST_NAME_IN_SUBJECT` | error | subject has the same bare pattern |
| `BARE_NAME_FALLBACK` | warning | bare `{{name}}` — renders `first_name \|\| 'Guest'` (`email_worker.js:570`), never empty but not controllable |
| `UNRESOLVED_TOKEN` | error | any placeholder not in the `KNOWN_TOKENS` set (derived from `email_worker.js:569-577` fixed keys + wizard's `extra_fields`) |
| `MISSING_ACTIVATION_URL` | error (wave=activate only) | body has no `<a href="…{{activation_url}}…">` — the #58/#59 pattern from the 18 Aug audit |
| `NO_CTA` | warning (wave=register or null only) | body has no `<a href>` at all |
| `DEAD_UNSUB_URL` | warning | body has literal `{{unsubscribe_url}}` — unfillable in campaign mode per G7 |

`unsubscribe_url` is in `KNOWN_TOKENS` deliberately, so DEAD_UNSUB_URL is the sole warning (not a doubled error).

### `POST /api/campaigns/reactivation/build` — the orchestrator

Body `{preview_token, activate_steps[], register_steps[], activate_name?, register_name?, skip_template_validation?}`. Returns `202` with `{job_id, g2_activate_planned, g3_register_planned, tokens_to_mint, target_expo_id, target_expo_name}`. All work runs in `setImmediate` after the response, phased into six named stages:

1. **RESEGMENT** — no-op (from preview cache)
2. **MINT TOKENS** — silently, via `processReactivationChunks(jobId, rows, {emailTemplate: null, template_id: null, ...})`. Guarded at `reactivation.js:141` (`if (emailTemplate)` around the `email_queue` INSERT loop). Uses `generateToken()` imported from `reactivation.js` — single RNG source. Truncates VARCHAR(255) overflow before mint (Piece 5). Only mints for rows with `!_unsub && !_hasToken`.
3. **BUILD G2 RECIPIENTS** — `SELECT token FROM reactivation_tokens WHERE target_expo_id=$1 AND email = ANY(FULL g2 mailable list) AND status='pending'`. Both freshly-minted AND pre-existing pending tokens are reused as recipients; `extra_fields` carries `activation_url` + `country` + `job_title` + `expo_name`.
4. **BUILD G3 RECIPIENTS** — no tokens; `extra_fields` carries `country` + `job_title` + `expo_name`.
5. **CREATE 2 DRAFT CAMPAIGNS + STEPS** — `INSERT INTO email_campaigns` (status defaults to `'draft'`, name from `activate_name`/`register_name` or auto-generated `"<expo> Activate/Register Wave"`); then `INSERT INTO campaign_steps` per step config. **A wave is skipped only when both its steps AND its recipients are empty** (otherwise creates a campaign with 0 recipients — surface for post-flight ops rather than silently drop).
6. **INSERT RECIPIENTS** — 500-row batch INSERT with `ON CONFLICT (campaign_id, email) DO NOTHING`, matching `campaigns.js:615-619`. **Does NOT update `email_campaigns.total_recipients`** — `campaigns.js:177-185` derives `stats.total_count` from `COUNT(*) over campaign_recipients`, `canActivate` at `:422` reads that same stats, and `:911` re-derives at activate time regardless. Column update is dead weight.

### `GET /api/campaigns/reactivation/job/:id` — polling

Returns the raw `import_jobs` row (**FLAT** — `res.json(r.rows[0])`, not nested under `{job: {...}}`) with `job_type='reactivation_campaign'` filter. `status`/`processed_count`/`total_count`/`error_message`/`completed_at` all top-level.

---

## 3. Two invariants the wizard guarantees

### Silent-mode invariant

Phase 2 calls `processReactivationChunks` with `emailTemplate=null`. The guard chain at `reactivation.js:141` (`if (emailTemplate)` around the `email_queue` INSERT loop) short-circuits. **Zero `email_queue` rows are ever created by the wizard's token-minting phase.** This is what makes the wizard safe on 40k+ pools — the drafts land in `email_campaigns`/`campaign_steps`/`campaign_recipients`, and no send happens until Yaprak activates from the Email Campaigns page.

Verified live on job 40 (Suer's browser click-through, §5 below).

### Draft-only invariant

`/build` never activates. Phase 5 `INSERT INTO email_campaigns` accepts the column DEFAULT of `'draft'`. **No path in the wizard sets `status='active'`.** Activation stays on the existing Email Campaigns page (`routes/campaigns.js:869`, `email-campaigns.html:465-484`) — the wizard is a build tool, not a send tool.

Verified live in DB after job 40: `SELECT status FROM email_campaigns WHERE id = <job40 campaign>` → `'draft'`.

---

## 4. Verification — automated

### 4a. Validator unit tests (`tests/test_template_validator.js`)

Requires `validateTemplateBody` and `KNOWN_TOKENS` directly via the named export on the router (`campaignBuilder.js:958-962`, same pattern as `reactivation.js`'s `.generateToken` / `.processReactivationChunks`). No DB, no network, no string-slicing.

9 cases × 2 assertions (error codes + warning codes per case) = **18/18 passed**:

```
A. clean chain                       → [] / []
B. bare {{country}}                  → [] / []
C1. bare {{first_name}}              → [NO_GREETING_CHAIN] / []
C2. bare {{name}}                    → [] / [BARE_NAME_FALLBACK]
D. junk chain segment                → [UNRESOLVED_TOKEN] / []
E. activate w/o {{activation_url}}   → [MISSING_ACTIVATION_URL] / []
F. register with external href       → [] / []
G. register with no CTA              → [] / [NO_CTA]
H. literal {{unsubscribe_url}}       → [] / [DEAD_UNSUB_URL]
```

### 4b. Wire smoke (`tests/test_wizard_silent.js`)

G27/G28/G29-compliant (documented in header): run-order independent (different email namespace than the phone smokes), fixture rebuilt every run (no `fs.existsSync` gate), dotenv resolved relative to `__filename`.

**Fixture engineering** — because 5 never-seen `@leena-test.local` emails on a clean expo 17 would give `g2_mailable=0` (making the silent-mode assertion vacuous), the test seeds `smoke-wizard-1..3` as visitors on expo 11 (`[TEST] Reactivation Smoke Test Expo`, organiser 1, verified read-only) via `POST /api/visitors/import` BEFORE segmenting. Result: `g1=0, g2=3, g3=2`.

**Probe template** — created in-flight via `POST /api/email-templates` (name `[SMOKE-VALIDATOR] <timestamp>`, bare `{{name}}` in body, no `{{activation_url}}` href). NOT template 47 (which is real SIEMA data — the test would have failed the moment Yaprak converts it to the greeting chain). Deleted via API in `finally`; cleanup SQL includes belt-and-braces `DELETE ... WHERE name LIKE '[SMOKE-VALIDATOR]%'` too.

**Six steps:**
- STEP 0 — create probe template + seed 3 G2 visitors on expo 11
- STEP 1 — `/segment` (shape + value assertions on all 10 count keys)
- STEP 2a — `/validate-template` wave=activate → MISSING_ACTIVATION_URL + BARE_NAME_FALLBACK
- STEP 2b — `/validate-template` wave=register → BARE_NAME_FALLBACK only, ok=true
- STEP 3 — `/build` with `skip_template_validation:true` and one step per wave
- STEP 4 — poll `/job/:id` (FLAT shape, not nested)
- STEP 5 — DB: 0 `email_queue` since jobStart, 2 `[SMOKE-WIZARD]%` drafts, 3 tokens, 5 recipients, 2 steps
- **STEP 6 — SECOND-RUN mailable + reuse invariant.** Runs `/segment` a second time against the same fixture (with 3 tokens now present) and asserts `g2_activate_mailable=3, existing_pending_tokens_hit=3, tokens_to_mint=0`. Then runs `/build` again and verifies **no new tokens minted** (still 3 total) and the recipient list rebuilt correctly.

This is the guardrail against the 2 Sep mailable bug re-appearing.

---

## 5. Verification — live click-through (Suer, browser, expo 17)

Done post-deploy after the mailable fix landed:

**Preview run 1** — fresh 5-row xlsx (`smoke-wizard-1..5@leena-test.local`), 3 seeded on expo 11:
- G1 = 0
- G2 mailable = 5, reused = 0, tokens to mint = 5
- G3 = 0 *(operator note — the click-through happened to seed all 5 to expo 11, giving 5/0/0 rather than the automated test's 3/2/0; both are correct per the fixture)*

**Templates panel** — probe wired to "Activate Badge Last Call" → ✓ OK pill. Register wave correctly shown as "(0 mailable — skip this wave)" and disabled.

**Confirm panel** — "ACTIVATE wave — 5 recipients, 1 step(s)", "Tokens to mint: 5 (existing reused: 0)".

**Build** — job #40 completed, 5/5, panel reported "Processed 5 recipient row(s) across 1 draft campaign(s)". **Correct** — the empty register wave was skipped by Phase 5's short-circuit (`if (steps.length === 0 && recipients.length === 0)`), so 1 campaign rather than 2. This is the intended behaviour when the operator picks a step for a wave that has zero mailable recipients: the wave is silently skipped; when they don't add a step at all, no campaign is created either.

**Preview run 2** — same file, same target, tokens now present:
- G2 mailable = 5
- Existing pending tokens = 5
- Tokens to mint = 0

This is what confirmed the mailable bug is fixed in the browser, not just in the automated suite. Before `8740dd7`, this same second run returned `g2_activate_mailable = 0` and disabled the entire activate wave.

**Regression check on Create Campaign tab** — Target Expo dropdown populated after Fix (b) (`loadExpos() → wInitTab()`). No regression on Yaprak's daily flow.

**Cleanup** — expo 17 and expo 11 clear of smoke data. One unrelated campaign remained on expo 17 (id 15, `[TEST] Bridge Verification 20260818`, completed, 5 recipients — from 18 Aug, deliberately left in place).

---

## 6. The mailable bug — timeline

Found in the browser, not in tests. This is the class of defect a wire smoke does not naturally catch on a first run.

**Symptom** — right after the G4 smoke run left 3 pending tokens on target expo 17, a browser preview against the same fixture returned:
```
g2_activate_raw               = 3
g2_activate_mailable          = 0    ← wrong
existing_pending_tokens_hit   = 3
```

Meanwhile `/build`'s own count at `:919` (`preview.g2_activate.filter(r => !r._unsub).length`) would have returned 3. The two contradicted.

**Consequence** — `wGoToTemplates()` in the UI gates on `c.g2_activate_mailable`; 0 disabled the whole activate wave AND cleared `wizard.activateSteps`. On any second wizard run — including the very common case of a user previewing twice before building, or building against an expo that already has pending tokens from an earlier campaign — the activate wave silently disappeared even though those recipients are precisely the ones who should get the activate mail with their existing token.

**Root cause** — `routes/campaignBuilder.js:472`:
```javascript
const g2_activate_mailable = g2_list.filter(r => !r._unsub && !r._hasToken).length;
```
The `!_hasToken` clause here duplicated `/build`'s `tokens_to_mint` formula at `:921` and mislabelled it "mailable". `_hasToken` should only ever gate *minting* (`:712` Phase 2 filter is correct), not *mailability*.

**Fix** — one clause removed, one new `tokens_to_mint` counter added to `/segment` counts, one new UI row ("... tokens to mint (new)") under G2 in the preview panel. `wGoToTemplates()` still gates on `g2_activate_mailable` — which is now the honest number.

**G3 not defective** — verified read-only: `:473` filters only `!_unsub`, `:468` doesn't even attach `_hasToken` to G3 rows (S_tokens is only populated from the target expo's tokens, and G3 by definition has no visitor row anywhere).

**Regression guard** — new STEP 6 in `test_wizard_silent.js`. The exact production shape that broke is now a locked-in assertion. Any future change that reintroduces the `!_hasToken` subtraction fails STEP 6 with the message: *"second-run g2_activate_mailable === 3 — pending-token rows STAY mailable — this is the regression the fix guards against"*.

**Lesson worth recording separately** — a wire smoke that runs on a clean slate does not exercise the "second time you preview" flow. Suer caught this within minutes of the click-through; a test-only sweep would not have. The takeaway is not "tests don't work" but "smoke against a clean slate ≠ smoke against production reality". Post-fair backlog: add a small handful of tests that deliberately run against a *not-clean* slate (leftover tokens, leftover visitors, unsubscribes present) rather than always resetting first.

---

## 7. Known gaps — explicit

None of these block SIEMA. Recording so they exist in one place.

- **From-expo source path never exercised live.** `/segment` accepts either a multipart file OR `{source_expo_ids: [...]}` in a JSON body (`campaignBuilder.js:366-393`). The wire smoke and the browser click-through both used Excel. The from-expo branch is the same code below the input-parsing branch, so segmentation shape is identical — but the JSON path itself has not been round-tripped end-to-end. Low risk; test on the first real from-expo campaign or add to the smoke.
- **Blocking-validation UI branch (400 + `blocking_templates`) never hit in a browser.** UI has a Fix (a) branch: on `/build` returning 400 with `blocking_templates`, land the user on step 3 and re-run `wRecomputeStep3BlockState()`. In practice the smoke uses `skip_template_validation:true` and the click-through picked a template that validated clean. The code path exists and is unit-covered by the validator tests — but not click-through-verified. Any operator who picks a template with `NO_GREETING_CHAIN` or `MISSING_ACTIVATION_URL` and skips the per-step Validate button will trigger it.
- **Wizard state is in-memory only.** `const wizard = {...}` at module scope. A page reload mid-flow drops everything back to step 1. Deliberate — the alternative (localStorage persistence) opens a stale-state class of bug that is not worth solving for SIEMA. Preview cache is server-side (30-min TTL), so re-running `/segment` after reload is cheap.
- **Polling does not resume after a tab switch.** `wBackTo()` and any switch to a non-wizard tab clears `wizard.pollTimer`. The backend `setImmediate` keeps running (visible in the standard reactivation UI's `import_jobs` list). Returning to the wizard tab does NOT auto-resume polling. Fine for SIEMA — jobs complete in seconds; if this becomes a real limit, add a job-ID persistence layer.
- **Preview cache dies on deploy.** The `PREVIEW_CACHE` `Map` at `campaignBuilder.js:41-70` is in Node heap. A Render restart mid-flow means `/build` returns 410 "preview_token expired or not found — re-run POST /reactivation/segment". Bounded blast radius; caught explicitly by the endpoint.
- **`DELETE /api/email-templates/:id` returns 500 when template is referenced by `campaign_steps`.** Observed 2 Sep during wizard smoke (probe template 70). Should be a 409 with a message naming the blocking campaigns. Logged as P3 in `todo.md`.
- **UI `c.tokens_to_mint` fallbacks are dead code.** Two sites in `reactivation-campaign.html` (`wRenderPreview`, `wGoToConfirm`) have `c.tokens_to_mint != null ? ... : ...` fallbacks. Since backend + HTML always ship together, `c.tokens_to_mint` is guaranteed present. Logged as P3.

---

## 8. Operator notes for Yaprak

- **Run order per wizard job:** Source → Preview → Templates → Confirm → Build. Every panel has a Back button; nothing writes until Build.
- **The target expo defaults to the sidebar's selected expo.** If you're on expo 5 in the sidebar but you want to run the wizard against expo 13, change the Target Expo dropdown on the Source panel. There is no cross-check between the two — the wizard will happily run against whatever you pick. *(Suer hit this in the click-through: targeted expo 11 by mistake and got G1=5 / G2=0 / G3=0 because the seeded visitors are on expo 11 itself. Correct behaviour, worth watching for.)*
- **Validation pill colours on the Templates panel:**
  - **Green** = OK, no errors, no warnings. Can proceed.
  - **Amber** = warnings only (e.g. `BARE_NAME_FALLBACK`, `NO_CTA`, `DEAD_UNSUB_URL`). Does not block — but read the messages. `NO_CTA` in particular is a hint that a template is announcement-only.
  - **Red** = errors present (e.g. `NO_GREETING_CHAIN`, `BARE_FIRST_NAME_IN_SUBJECT`, `MISSING_ACTIVATION_URL`, `UNRESOLVED_TOKEN`). Blocks the Next button. Fix the template in the Email Templates page, come back and re-Validate.
- **"Activate" wave = people who exist on your other expos (they get a link to activate a badge). "Register" wave = people the system has never seen (they get a link to a public form).** Segmentation is automatic; the wizard shows exactly how many rows land in each bucket in the Preview panel.
- **"Tokens to mint" vs "existing pending tokens".** Tokens to mint = new UUIDs being created for people who don't already hold one for this target expo. Existing pending tokens = people who already got a token from an earlier campaign against the same target expo and are now getting a fresh email with **the same token** (the link they'll receive is identical to the one they'd have received the first time — no duplicate registration risk).
- **The two campaigns land as DRAFTS in Email Campaigns.** Nothing is sent. Open Email Campaigns, review the campaign detail (recipients, steps, schedule), and click Activate when you're ready.

---

## 9. Cleanup SQL — reference

The wizard smoke test emits this at the end of every run. Also usable after a manual click-through:

```sql
-- Draft campaigns from any smoke or manual click-through
-- (campaign_recipients + campaign_steps CASCADE via FK, verified read-only):
DELETE FROM email_campaigns
WHERE expo_id = 17
  AND name LIKE '[SMOKE-WIZARD]%';

-- Reactivation tokens minted for smoke emails on target expo:
DELETE FROM reactivation_tokens
WHERE target_expo_id = 17
  AND email IN (
    'smoke-wizard-1@leena-test.local', 'smoke-wizard-2@leena-test.local',
    'smoke-wizard-3@leena-test.local', 'smoke-wizard-4@leena-test.local',
    'smoke-wizard-5@leena-test.local'
  );

-- G2 seed visitors on expo 11 (from the smoke's pre-import step):
DELETE FROM visitors
WHERE expo_id = 11
  AND email IN (
    'smoke-wizard-1@leena-test.local', 'smoke-wizard-2@leena-test.local',
    'smoke-wizard-3@leena-test.local'
  );

-- Belt-and-braces: any visitors on target expo (should be 0):
DELETE FROM visitors
WHERE expo_id = 17
  AND email IN (…same 5 emails…);

-- Belt-and-braces: in-flight probe templates from smoke runs:
DELETE FROM email_templates
WHERE name LIKE '[SMOKE-VALIDATOR]%';
```

---

## 10. Post-deploy sanity — final numbers

Recorded 2 Sep 14:49 UTC after `8740dd7`:

```
/health                                            → 200
POST /api/campaigns/reactivation/segment    (no auth) → 401
POST /api/campaigns/validate-template       (no auth) → 401
POST /api/campaigns/reactivation/build      (no auth) → 401
GET  /api/campaigns/reactivation/job/999999 (no auth) → 401
GET  /reactivation-campaign.html                   → 200 (113,878 bytes)
```

UI marker regression checks — every marker from every wizard commit still present on the deployed page; every existing "Create Campaign" tab wiring intact (`#targetExpo`, `#sourceExpo`, `#emailTemplate`, `loadExpos()`+`loadTemplates()` both defined and called).
