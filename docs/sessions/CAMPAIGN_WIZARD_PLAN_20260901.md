# Campaign Wizard — Plan (SIEMA target ~8 Sep)

**Date:** 1 Sep 2026, 18:20 UTC
**Scope:** todo #1 (P1). Yaprak must be able to run the SIEMA campaign
end-to-end from the UI, without Suer running Node scripts or SQL.

**Rules:** read-only Phase 1 inventory + plan. **No code, no diff, no
writes.** Suer approves scope before any implementation begins.

**DB pre-flight:** verified in this session (see IMPORT_PHONE_NORMALISATION §1).

---

## 1. What the Mega Projects (MP26) campaign actually was — reconstructed from DB

Data from live prod (`SELECT … FROM email_campaigns WHERE expo_id=13`):

| id | name | status | recipients | total_sent | delivered | started | completed |
|---|---|---|---:|---:|---:|---|---|
| 16 | MP26 Activate Wave | completed | 14,941 | 43,466 | 30,990 | 2026-08-18 17:52 | 2026-08-24 06:58 |
| 17 | MP26 Register Wave | completed | 26,262 | 78,145 | 52,410 | 2026-08-18 18:15 | 2026-08-24 07:25 |
| 18 | MP26 Final Activate Push | completed | 14,229 | 14,227 | 950 | 2026-08-21 20:07 | 2026-08-21 20:11 |
| 19 | MP26 Final Register Push | **draft** | 25,844 | 0 | — | — | — |

### Steps (`SELECT … FROM campaign_steps WHERE campaign_id IN (16,17,18,19)`)

| campaign_id | step | delay_hours | condition | template_id |
|---|---|---|---|---|
| 16 | 1 | 0 | all | 54 |
| 16 | 2 | 37 | not_registered | 55 |
| 16 | 3 | 96 | not_registered | 56 |
| 17 | 1 | 0 | all | 57 |
| 17 | 2 | 37 | not_registered | 58 |
| 17 | 3 | 96 | not_registered | 59 |
| 18 | 1 | 0 | all | 61 |
| 19 | 1 | 0 | all | 62 |

### What steps of the MP26 setup have UI today vs manual (`path:line`)

| Setup step | Manual on 18 Aug? | UI capability today | path:line |
|---|---|---|---|
| Segment 42k emails into G1/G2/G3 | **YES — local Node script** | **NONE** | — |
| Pre-flight token minting (silent, no email) | YES — `curl POST /api/reactivation/create-from-excel` without `template_id` | **NONE** — reactivation-campaign.html always requires a template | `routes/reactivation.js:133` (`if (emailTemplate)` guards the queue INSERT inside `processReactivationChunks`), `:346` (from-excel template fetch gated on `if (template_id)`), `:380` (from-excel `import_jobs` INSERT with `template_id \|\| null`), `:440` (same gate in the from-expo path). `public/reactivation-campaign.html` has no silent-mode toggle. |
| Build recipient sheet with `activation_url` | YES — local SQL + xlsx | **NONE** | — |
| Create the empty campaign object | curl `POST /api/campaigns` | ✅ exists — `openCreateModal()` at `public/email-campaigns.html:379` → `createCampaign()` at `:382` | `routes/campaigns.js:86` |
| Add step (delay, condition, template) | curl `POST /api/campaigns/:id/steps` | ✅ exists — `addStep()` at `public/email-campaigns.html:553`, modal at `:208` | `routes/campaigns.js:364` |
| Upload recipient Excel | curl multipart | ✅ exists — file input `public/email-campaigns.html:647` → `uploadRecipients()` at `:716` | `routes/campaigns.js:535` |
| Add recipients from an expo | curl JSON | ✅ exists — dropdown at `:653` → line `:734` calls `/recipients/from-expo` | `routes/campaigns.js:667` |
| Activate campaign | curl `POST /:id/activate` | ✅ exists — `showActivateModal()` at `:465` → `confirmActivate()` at `:484`. Guard at `:422`: `canActivate = steps.length > 0 && total_count > 0 && steps.every(s => s.template_id)` | `routes/campaigns.js:869` |
| Pause / Resume / Delete | ad-hoc curl | ✅ exists | `routes/campaigns.js:945/966/339` |

**The gap is not "campaign creation". Everything downstream of "here is my
recipient list" already exists in the UI.** What ops cannot do without
Suer:

1. **Segment a raw email list** (G1/G2/G3 preview + counts against
   `visitors`, `email_unsubscribes`, other expos).
2. **Mint activation tokens silently** (create-from-excel is backend-only
   for the no-template case; the frontend hides this path).
3. **Turn segmented tokens into `campaign_recipients` rows** without
   going through Excel export → upload.

Those three gaps are what the wizard has to close.

---

## 2. Re-validation of `CAMPAIGN_UI_DESIGN_20260819.md` against current code

The design was written the day of the 18 Aug launch. Since then, four
material commits have landed. Re-checking each assumption:

### 2.1 Placement — still valid

**Assumption:** wizard lives as a third tab of `reactivation-campaign.html`,
reusing source-radio + progress bar + polling patterns (design §1.1-1.2).

**Verified today:** `reactivation-campaign.html` still 1,236 lines, still
owns the "past people → new expo" mental model. Radio at `:214-221`,
progress bar at `:96-125`, polling at `:623` all present unchanged.
**Assumption holds.**

### 2.2 Backend surface — mostly still exists; two verified changes

**Assumption:** endpoints in design §2.1 all exist (`create-from-excel`
silent, `import_jobs`, campaign create/steps/recipients/activate, chunked
async).

**Verified today (source of truth: `grep -nE "^router" routes/campaigns.js`
and `routes/reactivation.js`):** all 8 endpoints listed still exist at the
same path shapes. `email_campaigns.total_recipients / total_sent /
delivered_count` all present (`\d email_campaigns`).

**Verified today for `evaluateCondition`:** the design assumed
`not_registered` was campaign-event-based only. After commit **`dedbcd0`**
(28 Aug), `email_worker.js:501-505` now checks THREE sources:
- campaign `registered` event (as before)
- OR `visitors` row exists on target expo
- OR `reactivation_tokens.status='activated'`

**Impact on the wizard:** GOOD. The `not_registered` condition on step 2/3
now catches recipients who registered via ANY route (organic Zoho,
walk-in, manual import, etc.). The wizard's step 3 UI can now honestly
label the condition "Skip if the recipient has registered anywhere on the
target expo" instead of the old "only skip if THIS campaign attributed the
registration". **The design assumed the old behaviour; the new behaviour is
what the wizard actually wants.** No design change needed, but the wizard's
help text must reflect the new semantics.

**Verified today for `delivered_count`:** commit **`6d798ab`** landed
migration 029 which populates `email_campaigns.delivered_count` at
completion. The design at §3.3 says "Compute rates against
`email_queue.status='sent'`, not the `sent` event" — this is now
**preferred behaviour, matching G14**: use `delivered_count` for completed
campaigns, `email_queue.status='sent'` while draining. The design's
Gotcha-G6 warning is preserved and reinforced.

### 2.3 Async pattern — still valid

**Assumption:** `import_jobs` + `setImmediate` + 1,000-row chunks +
per-chunk transaction (design §2.3).

**Verified today:** `processReactivationChunks` still at
`reactivation.js:31`, `CHUNK_SIZE=1000` still at `reactivation.js:20`,
per-chunk transaction still at `:53-113`. **Assumption holds unchanged.**

### 2.4 Per-chunk error persistence — still MISSING

**Assumption:** design §2.3(1) says "orchestrator should persist first
chunk error into `import_jobs.error_message`" — flagged as ~5 lines.

**Verified today:** `reactivation.js:96-103` still catches per-chunk
errors and console.errors them. `import_jobs.error_message` schema column
exists (verified via `\d import_jobs`) but is unpopulated. **This is still
open** and remains in scope for the wizard MUST list.

### 2.5 Pre-flight length validation — still MISSING

**Assumption:** design §2.4 — validate/truncate on values that would blow
the `VARCHAR(255)` limit.

**Verified today:** no truncation in `processReactivationChunks`. Still
open. In scope for MUST.

### 2.6 Funnel check-in join — still valid

**Assumption:** design §3.2 — join on `LOWER(TRIM(email))` since
`campaign_recipients.visitor_id` is 0% populated for Excel-uploaded lists.

**Verified today:**
```
SELECT COUNT(*) FILTER (WHERE visitor_id IS NOT NULL)::int AS with_vid
FROM campaign_recipients WHERE campaign_id IN (16,17,18,19);
```
→ **still 0** for all four MP26 campaigns. The Excel upload path
(`campaigns.js:530`) still does not backfill `visitor_id`. Design
assumption holds.

### 2.7 The segment `/send` architectural rewrite (d1cebcf → 90e2999) — no impact

**Verified today:** the M1-M4 → Mode-2 rewrite was for
`routes/emailSegments.js`, an entirely separate module from
`routes/campaigns.js`. The campaign scheduler path
(`email_worker.js:531 enqueueStepEmail` → `:604 INSERT INTO email_queue`)
is still Mode-1 (pre-rendered `html_content` per row). **This is
G24-scannable** but currently safe because the scheduler enqueues at most
`CAMPAIGN_SCHEDULER_BATCH_LIMIT` (2000) rows per 10s tick, not all at once.
For MP26 (26k recipients × 3 steps = 78k emails total), per-tick payload
was ~20 MB — well under the ~80 MB failure threshold observed for
segments.

**Design assumption unchanged for the wizard.** But: if the wizard's
orchestrator ever wanted to do a single-shot enqueue for all campaign
recipients (which it does not — see §3.3 below), G24 would apply. The
current design correctly writes only to `campaign_recipients` (small
rows), which the scheduler then drains. **G24 does not force any rewrite
here.**

### 2.8 Unsubscribe UI (34061f8) — small impact

**Verified today:** `/api/unsubscribes` POST/DELETE/status endpoints now
exist. Design §2.2(a) segmentation logic includes "minus
`email_unsubscribes`" — still correct, unchanged.

**New consideration:** the wizard's step 3 (steps & templates) could
optionally offer to auto-unsubscribe recipients who reply UNSUBSCRIBE to
prior campaign emails, but this belongs to a future SendGrid Inbound
Parse work item, not the wizard MUST.

### 2.9 Segment page's fail-closed error mode — cautionary tale

The M1-M4 → Mode-2 forensic exposed a new failure mode class: **a
supposedly-batched send that pre-renders in memory and OOMs at scale**
(G24). The wizard **must not** ever pre-render N × HTML in a single
request path. Design §2.2(b) phase 6 says "Insert campaign_recipients
directly" — this only inserts small rows (~200 bytes each). Confirming
that the wizard's design does NOT introduce a G24 violation.

### 2.10 Summary of design status

| § | Assumption | Status | Implication |
|---|---|---|---|
| 1 | Placement in reactivation-campaign.html | ✅ Holds | No change |
| 2.1 | Backend endpoints exist | ✅ Holds | No change |
| 2.2 (new) | `not_registered` now checks 3 sources | ➕ Improved | Wizard step 3 help-text update |
| 2.2 (new) | `delivered_count` snapshot works | ➕ Improved | Wizard step 5 preview can show projected accuracy |
| 2.3 | Async pattern (import_jobs + setImmediate) | ✅ Holds | No change |
| 2.4 | Per-chunk error persistence | ❌ Still missing | In wizard MUST |
| 2.5 | Pre-flight length validation | ❌ Still missing | In wizard MUST |
| 2.6 | Funnel joins on email, not visitor_id | ✅ Holds | Applied at NICE (funnel tab) |
| 2.7 | Segment rewrite doesn't affect campaigns | ✅ Holds | No G24 conflict for the wizard |
| 2.8 | Unsubscribe UI landed | ✅ Neutral | Segmentation filter already includes unsub |
| 2.9 | Wizard must not pre-render N × HTML | ⚠️ Design guard | Documented — no request-path violation |

**Design remains ~90% valid. Two small additions the design didn't
anticipate (Suer's explicit requirements):**
- **Template validation before send** — greeting chain, correct CTA, no
  unresolved `{{}}` tokens.
- **Zero-template regression test** — asserts wizard with no template
  enqueues zero `email_queue` rows.

Both are new. Both fit inside the design's scope with ~50 additional
lines.

---

## 3. The plan — what Yaprak can do on her own

### 3.1 What "self-service" means, end-to-end

Yaprak sits down alone at her laptop and does the following, in this
order, entirely through `leena.app`:

1. Opens `reactivation-campaign.html`, third tab **Reactivate via Campaign**.
2. Picks target expo (SIEMA = expo 9) and source (past expo(s) or Excel).
3. Reads the counts preview: "X have LEENA history → activate flow · Y
   are new → register flow · Z excluded (already registered / unsub /
   invalid)". Adjusts source and re-previews if needed. **Zero writes so far.**
4. Configures two campaigns' worth of steps: template + delay + condition
   per step. Sees a **template validation panel** for each selected template
   (greeting-chain check, CTA present, no unresolved `{{token}}`).
5. Previews a rendered email for one real activate recipient and one real
   register recipient. Sees final counts one last time.
6. Clicks **Build**. Async job runs: mint tokens (silent, no email) →
   insert campaign_recipients → mark both campaigns as **draft**. Progress
   bar polls, phase-aware.
7. Draft campaigns land on the existing **View Campaigns** tab. Yaprak
   clicks **Activate** on each when ready (this UI already exists).

**MP26 is the reference-run:** the wizard's output should match the shape
of campaigns 16 + 17 exactly — one Activate Wave (3 steps, templates
54/55/56) and one Register Wave (3 steps, templates 57/58/59), recipients
already segmented, no manual Excel.

### 3.2 MUST vs NICE for 8 Sep

Deadline is **Mon 8 Sep** — 7 days from today. Working days: **Mon 2 Sep –
Fri 6 Sep** = 5 days. Sat 7 buffer, Sun 8 Yaprak dry-run under Suer's
watch.

**MUST (~500 lines total across all pieces):**

| # | Piece | File | Est. lines | Rationale |
|---|---|---|---|---|
| 1 | Segmentation preview endpoint (read-only) | `routes/campaigns.js` | ~120 | Yaprak sees counts before writing. Reuses G1/G2/G3 SQL from `REACTIVATION_SEGMENTATION_SQL_20260818.md` |
| 2 | Orchestrator endpoint (async, phased) | `routes/campaigns.js` (or new `routes/campaignBuilder.js`) | ~200 | One call: mint tokens → insert recipients → create draft campaigns |
| 3 | Job polling endpoint | same | ~30 | Progress bar backing |
| 4 | Per-chunk error → `import_jobs.error_message` | `routes/reactivation.js:96` (patch) | ~5 | Design §2.3(1). Diagnostic |
| 5 | Pre-flight length truncation | orchestrator | ~15 | Design §2.4. Prevents 1000-row loss like 18 Aug |
| 6 | **Template validation endpoint + panel** | `routes/campaigns.js` + wizard UI | ~30 | Suer's explicit requirement. Blocks activation on greeting chain / bare `{{first_name}}` / unresolved `{{}}` / missing CTA |
| 7 | Wizard UI (5 steps, modal, polling) | `public/reactivation-campaign.html` | ~200 | Yaprak's actual seat |
| 8 | **Zero-template regression test** | `backend/leena-v401-backend/tests/test_wizard_silent.js` | ~40 | Suer's explicit requirement. Asserts wizard with no template_id enqueues zero email_queue rows |

**NICE (post-SIEMA, sizing per design):**

| Piece | File | Est. lines |
|---|---|---|
| Results/funnel tab (5 stages, email-join, honest labels) | `public/email-campaigns.html` | ~120 |
| Backfill `campaign_recipients.visitor_id` at build time | orchestrator (~10 lines) | ~10 |
| Delay entered as "land on DATE at TIME" with landing-window display | wizard UI | ~50 |

**Total MUST ≈ 640 lines across ~3 files** (2 backend, 1 frontend, 1
test). Roughly 55% frontend.

### 3.3 Daily sequence (working days, Mon 2 – Fri 6 Sep)

Every day ends with a **STOP + Suer approval** before the next day starts.

**Day 1 (Mon 2 Sep) — backend segmentation + orchestrator skeleton**

- Piece 1 (~120 lines): `POST /api/campaigns/reactivation/segment`. Read-only.
  Returns `{targeted_activate, targeted_register, excluded_already,
  excluded_unsub, excluded_invalid, preview_token}`. Preview token cached in
  memory (or `import_jobs.metadata`) for re-use in Day-2 orchestrator.
- Piece 2 skeleton (~50 lines of ~200): create job row, dispatch
  `setImmediate`, mark `job_type='reactivation_campaign'`.
- Piece 4 (~5 lines): patch `reactivation.js:96` catch to update
  `import_jobs.error_message` with first chunk failure.
- **Deliverable:** endpoint returns segmentation counts against expo 17
  (trash). Suer verifies with curl. STOP.

**Day 2 (Tue 3 Sep) — orchestrator phases + template validation**

- Piece 2 phases (~150 lines): finish orchestrator with 6 phases per design
  §2.2(b): re-segment → G2 mint tokens → G2 build recipients → G3 build
  recipients → create campaigns + steps → insert campaign_recipients.
  All inside one `import_jobs` row.
- Piece 5 (~15 lines): truncate VARCHAR(255) fields with warning count in
  job result.
- Piece 3 (~30 lines): `GET /api/campaigns/reactivation/job/:id`. Phase-aware
  status: `{phase, phase_progress, phase_total, overall_percent, error_message}`.
- Piece 6 backend (~15 of 30 lines): `POST /api/campaigns/validate-template`.
  Returns `{ok, issues: [{code, message, severity}]}` where issues include
  `NO_GREETING_CHAIN`, `BARE_FIRST_NAME`, `UNRESOLVED_TOKEN`, `NO_CTA`,
  `DEAD_UNSUB_URL`.
- **Deliverable:** full backend orchestrator smoke-tested on expo 17 (2 test
  recipients, 1 activate + 1 register). Verify 2 draft campaigns land + 2
  recipient rows. STOP.

**Day 3 (Wed 3 Sep) — wizard UI steps 1-3 + polling**

- Piece 7 first half (~100 of 200 lines): third tab wired into
  reactivation-campaign.html. Steps 1 (source), 2 (segment preview + retry),
  3 (steps configuration for both campaigns).
- Polling loop (~30 lines within Piece 7): reuse `reactivation-campaign.html:623`
  pattern with new phase-aware progress bar UI.
- Piece 6 frontend (~15 lines within Piece 7): template validation panel on
  step 3 — calls `/validate-template` for each selected template, shows
  inline issues with severity colors. Blocks proceed-to-step-4 if any issue
  is severity=error.
- **Deliverable:** Yaprak (Suer proxying) walks through steps 1-3 on expo 17,
  sees preview counts + template validation output. No writes. STOP.

**Day 4 (Thu 4 Sep) — wizard UI steps 4-5 + build integration**

- Piece 7 second half (~100 lines): steps 4 (preview rendered email + final
  counts) + 5 (Build button → orchestrator kickoff).
- Wire polling to show phase progress until job completes.
- On success: toast + redirect to View Campaigns tab, both new drafts
  highlighted.
- **Deliverable:** end-to-end wizard on expo 17 → 2 draft campaigns with 2
  recipients each. STOP.

**Day 5 (Fri 5 Sep) — testing + smoke + deploy**

- Piece 8 (~40 lines): `tests/test_wizard_silent.js`. Seeds 3 test
  recipients, calls orchestrator with `template_id=null` on step 1, asserts
  0 rows in `email_queue` for those campaigns, asserts 3 rows in
  `campaign_recipients`, asserts campaign status='draft'.
- Template validation edge-case tests: bare `{{first_name}}` → detected;
  `{{first_name|last_name|company|"Dear Visitor"}}` → passes; empty
  template → error `NO_TEMPLATE_BODY`; template with unclosed `{{name` →
  error `MALFORMED_PLACEHOLDER`.
- Deploy to prod. Endpoint sanity (401 without auth).
- Yaprak smoke-run on expo 17 with 5-10 real recipients from prior fair,
  observe end-to-end. STOP.

**Day 6 (Sat 6 Sep) — buffer, unblocked time for bugs.**

**Day 7 (Sun 7 Sep) — Yaprak's SIEMA dry-run** on the real SIEMA list,
under Suer's live supervision. Any issues surface here before Monday's
launch.

**Day 8 (Mon 8 Sep) — SIEMA campaign launch by Yaprak.** Suer available
for hand-holding but not driving.

### 3.4 Template validation — the 5-check contract (Suer's explicit ask)

Every template picked in wizard step 3 gets validated. The validation
endpoint returns issues at three severities:

| Code | Severity | Rule | Rationale |
|---|---|---|---|
| `NO_GREETING_CHAIN` | ERROR | If template's body contains ANY of `{{first_name}}`, `{{name}}`, `{{last_name}}` without being wrapped in a `\|` chain | CLAUDE.md v4.0.9 rule. G20 catches the double-greeting variant separately |
| `BARE_FIRST_NAME_IN_SUBJECT` | ERROR | Subject line contains bare `{{first_name}}` or `{{name}}` without chain | Same rule extended to subjects. Learnt from v4.0.9 |
| `UNRESOLVED_TOKEN` | ERROR | Any `{{token}}` in body/subject that is not in the wizard's known-resolvable set (`first_name`, `last_name`, `name`, `company`, `email`, `expo_name`, `qr_code`, `badge_url`, `activation_url`, `date`, or any custom_field key visible on the recipient) | Prevents "click here to {{missing_placeholder}}" going out |
| `NO_CTA` | WARNING | Body contains no `<a href=` link, or all `href` attrs are empty | Not a hard block; some templates are announcements. Warning surfaces to ops |
| `DEAD_UNSUB_URL` | WARNING | Body contains literal string `{{unsubscribe_url}}` (which does not resolve in campaign mode — G7) | Not a block; the worker's `injectUnsubscribeLink` still appends a working footer. But this warns before ops learns from Gmail complaints |

Error-severity issues block "Proceed to step 4". Warnings show inline but
don't block. All issues visible with the template preview so ops can
choose to override warnings.

### 3.5 Zero-template regression test — the exact contract (Suer's explicit ask)

`tests/test_wizard_silent.js`:

1. Setup: create test expo, 3 test visitors.
2. Call orchestrator with `{target_expo_id, source_expo_ids: [test_expo_id],
   activate_steps: [{template_id: null}], register_steps: []}`.
3. Poll job to completion.
4. **Assertions:**
   - Job status = `completed`.
   - `email_campaigns` — one row for activate (draft), `total_recipients = 3`.
   - `campaign_recipients` — 3 rows, all `status='active'`.
   - **`email_queue` — ZERO rows for these campaigns.** (This is THE
     regression assertion — the silent path must not enqueue.)
   - `email_events` — zero rows for these campaigns.
5. Cleanup.

**Why it matters:** the silent-mode path (`reactivation.js:346` +
`:440` template fetches gated on `if (template_id)`, `:380` `import_jobs`
INSERT with `template_id || null`, and `:133` `if (emailTemplate)` guarding
the per-row email queue INSERT inside `processReactivationChunks`) is
the load-bearing property of the token-minting flow. A future change that
"helpfully" required `template_id` or that logged an email in the queue
"for reference" would silently start emailing 40k people during token
generation. This test locks it down.

### 3.6 Per-chunk error persistence — 5-line fix, load-bearing

`reactivation.js:96-103` today:
```
} catch (err) {
    console.error(`Chunk ${chunkNum} failed: ${err.message}`);
    results.failed_count += chunk.length;
    // NOTE: error_message stays NULL — diagnosing 18 Aug's 1000-row
    // loss needed a manual DB hunt.
}
```

MUST addition:
```
} catch (err) {
    console.error(`Chunk ${chunkNum} failed: ${err.message}`);
    results.failed_count += chunk.length;
    if (!results.first_chunk_error) {
        results.first_chunk_error = `Chunk ${chunkNum}: ${err.message.slice(0, 500)}`;
    }
}
```
Then at job completion (`reactivation.js:~300`): `UPDATE import_jobs SET
error_message = $1 WHERE id = $2` when `first_chunk_error` present. ~5 lines.

### 3.7 G24 compliance — explicit statement

**The wizard's request path is O(1) in recipient count.**

- `POST /api/campaigns/reactivation/segment` — counts + preview_token only.
  No per-recipient data returned. O(1) response.
- `POST /api/campaigns/reactivation/build` — returns a job id immediately
  (`{job_id, status: 'pending'}`). Real work happens in `setImmediate`.
  O(1) response.
- `GET /api/campaigns/reactivation/job/:id` — phase counters only. O(1) response.
- Orchestrator writes to `campaign_recipients` — ~200 bytes/row, chunked
  1000 per statement (matches `processReactivationChunks` pattern). This
  is a background job, not a request path — G24 request-path rule does not
  apply, but the chunking bounds memory anyway.
- Actual campaign send goes through `enqueueStepEmail` at
  `email_worker.js:531` — Mode 1 today, bounded by scheduler batch size.
  Documented in §2.7 as still safe under current scheduler limits.

**All send paths remain Mode 2 or scheduler-bounded Mode 1. G24 satisfied.**

### 3.8 Risks logged (updates to design §4.3)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Orchestrator partial completion | 🔴 high | Phase-aware job state + `create-from-excel` idempotency (still holds — verified on 18 Aug) |
| 2 | `setImmediate` orphaned by deploy | 🔴 high | Don't deploy during a build; TODO stale-job detector; unchanged from design |
| 3 | Funnel query too slow to poll | 🟡 medium (NICE, deferred) | `EXPLAIN ANALYZE` before shipping; visitor_id backfill |
| 4 | Ops mis-sets delays | 🟡 medium | NICE: date/time picker. MUST: still hour-based, matches MP26 |
| 5 | Wizard writes before user is ready | 🟡 medium | Step 2 strictly read-only, all writes in Step 5 build |
| 6 | Silent-mode regression | 🔴 high | Piece 8 test locks it down |
| 7 | Template validation false negatives | 🟡 medium | 5-check list; ops can override warnings |
| 8 | **NEW: template validation false positives block a legitimate template** | 🟡 medium | All error-severity checks are structural (chain regex, unresolved tokens). Warnings never block. Escape hatch: skip validation in URL via `?skip_template_validation=1` — flagged in server log |
| 9 | **NEW: 8 Sep slips** | 🟡 medium | Day 5 smoke on Fri gives 3 days of runway before Yaprak's Monday launch |

### 3.9 Explicitly OUT OF SCOPE for the wizard (would be a scope creep)

- **Send Emails page changes** — segments page unchanged, single-recipient send unchanged.
- **Campaign scheduler changes** — no touching `email_worker.js:531`. The wizard produces the same shape of `campaign_recipients` + `email_campaigns` + `campaign_steps` rows as the existing manual path, so the scheduler sends them the same way.
- **Reactivation flow for non-wizard cases** — the existing "Create Campaign / Excel upload" tab of reactivation-campaign.html continues to work unchanged.
- **`email_unsubscribes` UI enhancements** — the visitor detail panel toggle (34061f8) is enough for individual ops.

---

## 4. What Suer is being asked to approve before Phase 2 begins

1. **The 8-piece MUST list at §3.2.** ~640 lines across ~3 files + 1 test.
2. **The daily sequence at §3.3** — 5 working days Mon–Fri, buffer Sat, dry-run Sun, launch Mon.
3. **The template validation contract at §3.4** — 5 checks, 3 ERROR + 2 WARNING.
4. **The zero-template regression test contract at §3.5** — assertions and setup.
5. **The scope boundaries at §3.9** — nothing else touched.
6. **STOP each night** for approval before the next day. If any day slips, the sequence shifts right; Yaprak's Sunday dry-run is the immovable milestone.

**Decisions Suer needs to make specifically:**

- Are ~640 lines in 5 days acceptable, or should NICE items be pulled into MUST (funnel tab is the most-asked-for)?
- Should the wizard offer a "dry-run" mode that runs the orchestrator but doesn't activate — belt-and-suspenders on top of "draft-only" default?
- Template validation `skip_template_validation=1` escape hatch — keep or remove? (Design defaults to keep for ops flexibility; removing means legitimate template with a warning cannot ship at all.)

**No code, no diff, no writes. Awaiting Suer's approval on the plan.**
