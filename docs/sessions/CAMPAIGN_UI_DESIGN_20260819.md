# "Reactivate via Campaign" — self-service flow design
**Date:** 2026-08-19 · **Design analysis only. No code written.**
**Goal:** ops runs the next campaign (SIEMA, expo 9, ~3 weeks out) entirely from the UI —
no SQL, no scripts, no Excel surgery.

Paths relative to `backend/leena-v401-backend/`. Claims are **MEASURED** (`path:line` or query
output) or **DESIGN** (proposed, not existing).

---

## What tonight's run actually cost — the thing being automated

**MEASURED** — the 18 Aug MP26 launch required, in order:

| # | step | how it was done | automatable? |
|---|---|---|---|
| 1 | Segment 42,212 emails into G1/G2/G3 | local Node + `papaparse` against read-only DB | ✅ |
| 2 | Build a token-seed sheet from the freshest LEENA row per email | local Node + `xlsx`, `DISTINCT ON … ORDER BY updated_at DESC` | ✅ |
| 3 | Generate tokens silently | `POST /api/reactivation/create-from-excel` **without `template_id`** | ✅ already an API |
| 4 | Export tokens, build recipient sheet with `activation_url` | local SQL + `xlsx` | ✅ |
| 5 | Create 2 campaigns + 6 steps | 8 `curl` calls | ✅ already APIs |
| 6 | Upload 2 recipient sheets | 2 `curl` multipart calls | ✅ already an API |
| 7 | Fix a 303-char `company` that rolled back a 1,000-row chunk | manual truncation + re-upload | ⚠️ needs a guard |

Steps 3, 5 and 6 are already API-driven. **Steps 1, 2, 4 and 7 are the automation gap.**

---

## 1. Where the wizard fits

### 1.1 Placement — **DESIGN: `reactivation-campaign.html`, as a third tab**

`reactivation-campaign.html` (1,211 lines) already owns the mental model — "take past people,
bring them to a new expo" — and already has the source-selection UI:

```html
214-221:  <div class="radio-group">
            <input type="radio" name="sourceType" value="excel" checked onchange="toggleSourceType()">
            <input type="radio" name="sourceType" value="expo"  onchange="toggleSourceType()">
```
```js
689:  const sourceType = document.querySelector('input[name="sourceType"]:checked').value;
690:  document.getElementById('excelSection').style.display = sourceType === 'excel' ? 'block' : 'none';
```

**MEASURED.** Putting the wizard on `email-campaigns.html` instead would mean re-implementing
source selection, token generation and job polling that already live here.

**DESIGN:** a third tab — *Create* · *View Campaigns* · ***Reactivate via Campaign*** — reusing
the existing tab switcher.

### 1.2 UI patterns to follow — all MEASURED as already present

| pattern | where | reuse |
|---|---|---|
| **Modal without Bootstrap JS** | `email-campaigns.html:74-78` CSS + `:307` `openModal(id){ …classList.add('show') }` | Pure class toggle on `.modal-overlay.show`. **No `new bootstrap.Modal`, no `data-bs-*`.** |
| **Progress bar** | `reactivation-campaign.html:96-125` (`.campaign-progress-bar`, `-fill`, `.completed`, `.stalled`) | Lift as-is for the async job |
| **Polling loop** | `reactivation-campaign.html:623` `setInterval` + `GET /api/reactivation/job/:id` | Same shape, new job type |
| **Toasts** | `reactivation-campaign.html:360` `<script src="/leena-toast.js">` | `showToast(msg, type)` |
| **Radio source select** | `:214-221` | Extend with multi-expo |

⚠️ **Constraint confirmed MEASURED:** Bootstrap **JS** is loaded on some admin pages
(`qrscanner.html:409`) but the campaigns UI drives modals through CSS classes only. A wizard
must follow the class-toggle pattern — `.wizard-step.active` — not Bootstrap's stepper.

### 1.3 Step flow — DESIGN

```
[1 Source] → [2 Segment preview] → [3 Steps & templates] → [4 Preview] → [5 Create drafts]
```

**Step 1 — Source.** Target expo (dropdown); source = one or more past expos (multi-select,
extending the existing radio) **or** an Excel upload. Multi-expo matters: SIEMA's pool is
expos 1 + 9, and tonight's was a single file.

**Step 2 — Segmentation preview. The core of the design: counts before anything is created.**

```
Verified list ......................... 42,212
├ Already registered for target ..........  887   excluded
├ Has LEENA history → ACTIVATE ......... 14,967   → tokens + activation_url
└ Unknown → REGISTER .................. 26,358   → public form link
   ├ unsubscribed (excluded) ................ 121
   └ invalid / no email ....................... 0
Mailable: 14,942 activate · 26,262 register
```

**Read-only. Nothing written.** Ops can change the source and re-run. Tonight's numbers were
produced exactly this way before any writes — that discipline is what the wizard institutionalises.

**Step 3 — Steps & templates.** Per campaign (activate / register), 1-N steps: template
dropdown, delay, condition. **DESIGN: enter delays as "land on <date> at <time>"** and let the
UI compute `delay_hours`, because tonight's offsets were computed by hand from assumed
activation times and drifted ~1 h when activation ran early. Show the resulting landing window,
including enqueue spread.

**Step 4 — Preview.** Rendered email with a real recipient's data, both campaigns; the
resolved `activation_url` for one activate recipient; a final count reconciliation.

**Step 5 — Create as draft.** Async job. On completion: two campaigns in `draft`, recipients
uploaded, **nothing activated.** Ops presses Activate on each, as tonight.

---

## 2. Backend — exists vs needed

### 2.1 Already exists — MEASURED

| capability | endpoint | note |
|---|---|---|
| Silent token generation | `POST /api/reactivation/create-from-excel` | `template_id` **optional** (`reactivation.js:26-35`); email queueing gated on it (`processReactivationChunks:68-69`). **Verified silent on expo 17 and used for all 14,077 MP26 tokens.** |
| Token generation from an expo | `POST /api/reactivation/create-from-expo` | same silent property |
| Async job + polling | `import_jobs` table + `GET /api/reactivation/job/:id` | schema has `job_type, target_expo_id, source_expo_id, template_id, form_id, total_count, processed_count, skipped_count, failed_count, status, error_message, completed_at` |
| Chunked background processing | `processReactivationChunks` (`reactivation.js:31`) | `CHUNK_SIZE=1000`, per-chunk transaction, `setImmediate` (`:322`, `:432`) |
| Campaign create | `POST /api/campaigns` | |
| Steps | `POST /api/campaigns/:id/steps` | validates `condition` against `VALID_CONDITIONS` (`campaigns.js:47`) |
| Recipients from Excel | `POST /api/campaigns/:id/recipients/upload` | unknown columns → `extra_fields` (`:468-475`) |
| Recipients from expo | `POST /api/campaigns/:id/recipients/from-expo` | ⚠️ does **not** write `extra_fields` (`:651`) |
| Activate | `POST /api/campaigns/:id/activate` | |

**Roughly 70% of the machinery exists.** The gap is orchestration and segmentation.

### 2.2 Needed — DESIGN

**(a) `POST /api/campaigns/reactivation/segment` — read-only, returns counts.**

Input: `target_expo_id`, plus `source_expo_ids[]` **or** an uploaded file.
Output: the Step-2 block plus a server-side `preview_token` (a cached row id) so Step 5 can
re-use the exact same set rather than recomputing.

Logic is tonight's, already proven:
- G1 = exists in `visitors` for target expo → exclude
- G2 = exists in `visitors` on any other expo → activate
- G3 = neither → register
- minus `email_unsubscribes`

⚠️ **Must be read-only and must not stage rows.** Tonight's segmentation ran three times against
different assumptions before anything was written; that has to stay cheap.

**(b) `POST /api/campaigns/reactivation/build` — one orchestrating endpoint, async.**

**DESIGN decision: one orchestrator, not three endpoints.** Tonight's failure mode argues for
it — the 1,000-row chunk failed and left 13,061 tokens created, 1,000 missing, with the campaign
not yet built. A single job owning all phases can report partial state coherently and resume.

Phases, all inside one `import_jobs` row with `job_type='reactivation_campaign'`:

1. Re-segment from `preview_token`
2. G2 → generate tokens (reuse `processReactivationChunks` **unchanged**, no `template_id`)
3. G2 → build recipient rows **in-process** with `activation_url` from the tokens just written
4. G3 → build recipient rows
5. Create both campaigns + steps (draft)
6. Insert `campaign_recipients` directly — **no Excel round trip**

**Step 6 is the biggest simplification.** Tonight's Excel export/import existed only because the
two modules had no in-process path. `campaign_recipients` insertion is a plain INSERT
(`campaigns.js:530`) — the orchestrator can write rows directly, eliminating steps 2, 4 and 7
of the manual run entirely.

**(c) `GET /api/campaigns/reactivation/job/:id`** — poll. Could reuse the reactivation job
endpoint; **DESIGN: a separate one**, because phase reporting ("generating tokens 8,200/14,967"
vs "uploading recipients") is richer than the existing counters.

### 2.3 Async pattern — follow ADR-022 exactly

`import_jobs` + `setImmediate` + 1,000-row chunks + per-chunk transaction, as
`processReactivationChunks` does. **MEASURED as the right precedent:** it survived 14,967 rows
tonight, and when one chunk failed the other 13 committed and the job still reported
`completed` with `failed_count=1000`.

⚠️ Two known weaknesses to carry into the design, both **MEASURED**:

1. **Per-chunk errors are console-only.** `error_message` stayed `NULL` when the chunk failed
   (`reactivation.js:96-103` catches, increments `failed_count`, logs). Diagnosing the 303-char
   `company` needed a manual DB hunt. **The orchestrator should persist the first chunk error
   into `import_jobs.error_message`.** ~5 lines.
2. **`setImmediate` orphans on restart.** A Render deploy mid-job loses it with no recovery —
   already logged as risk R8 in `todo.md`. Not new, but a 40k job runs long enough to matter.

**(d) Pre-flight length validation — the fix for tonight's 1,000-row loss.**

`reactivation_tokens` columns are `VARCHAR(255)`; one 303-char `company` rolled back its whole
chunk. **DESIGN: validate/truncate in the build phase before insert, and report the count** —
~10 lines, and it turns a silent 1,000-row loss into a visible "3 values truncated".

---

## 3. Results tab on campaign detail

### 3.1 What exists — MEASURED

`GET /api/campaigns/:id` (`campaigns.js:146`) already returns:
- **Per step**: `sent`, `opened`, `clicked` as both unique-recipient and raw-event counts
  (`campaigns.js:~170-186`, grouped by `ee.step_id`)
- **Campaign level**: `registered_count` = `COUNT(DISTINCT recipient_id) … event_type='registered'`
  (`campaigns.js:196-199`)

`GET /api/campaigns/:id/steps/:stepId/recipients` (`:411`) gives per-recipient
`was_sent / opened / clicked / registered` flags.

**So four of the five funnel stages already exist.**

### 3.2 What's missing — the check-in stage

**MEASURED — and there is a trap.** `campaign_recipients.visitor_id` is **0% populated**:

| campaign | recipients | with `visitor_id` |
|---|---:|---:|
| 16 | 14,941 | **0** |
| 17 | 26,262 | **0** |

Only the `from-expo` path sets it (`campaigns.js:651`); the Excel path does not (`:530`, `:543`).
**A join on `visitor_id` would silently return zero.**

**DESIGN — join on email instead.** Prototyped read-only tonight and it runs:

```sql
COUNT(DISTINCT cr.id) FILTER (WHERE EXISTS(
  SELECT 1 FROM visitors v JOIN checkins ck ON ck.visitor_id = v.id
  WHERE lower(trim(v.email)) = lower(trim(cr.email))
    AND v.expo_id = :target AND ck.expo_id = :target)) AS checked_in
```

Returned `0` for campaign 16 — **correct**, expo 13 has not opened (13 check-ins, all test).
Sent/opened/registered returned 14,941 / 1,805 / 163, matching the morning report.

⚠️ **Performance not measured.** A correlated `EXISTS` with `lower(trim())` on both sides over
14,941 recipients cannot use an index. **HYPOTHESIS: acceptable for an on-demand tab, too slow
to poll.** Needs `EXPLAIN ANALYZE` before shipping. Two mitigations, both DESIGN:
backfill `campaign_recipients.visitor_id` at build time (the orchestrator knows the visitor for
G2 — it just read it), or materialise the funnel per campaign on a timer.

### 3.3 Proposed funnel — DESIGN

```
Recipients   41,203  ████████████████████  100%
Sent         41,203  ████████████████████  100%
Opened        2,126  █                     5.2%
Clicked         290  ▌                     0.7%
Registered      170  ▏                     0.4%
Checked in        0  ▏                     0.0%   ← target expo not open
```

Two honesty requirements, both **MEASURED** as real traps:

1. **Compute rates against `email_queue.status='sent'`, not the `sent` event.** The event is
   written at *enqueue* (`email_worker.js:537-539`). Campaign 17 showed 26,262 `sent` events
   against 6,765 actually delivered — a 4× overstatement. This is Gotcha G6.
2. **Label the check-in stage "target expo not yet open"** when the expo hasn't started, rather
   than showing 0% and implying failure.

---

## 4. Sizing, reuse, risks

### 4.1 Sizing — DESIGN estimates, not measured

| # | Piece | File | Est. lines |
|---|---|---|---:|
| 1 | Segmentation endpoint (read-only) | `routes/campaigns.js` | **~120** |
| 2 | Orchestrator endpoint + phases | `routes/campaigns.js` (or new `routes/campaignBuilder.js`) | **~250** |
| 3 | Job polling endpoint | same | ~40 |
| 4 | Length validation / truncation guard | orchestrator | ~15 |
| 5 | Persist chunk error to `import_jobs.error_message` | `routes/reactivation.js:96-103` | ~5 |
| 6 | Funnel endpoint (5 stages) | `routes/campaigns.js` | ~60 |
| 7 | Backfill `visitor_id` on recipient insert | orchestrator | ~10 |
| 8 | Wizard UI (5 steps, modal, polling) | `public/reactivation-campaign.html` | **~400** |
| 9 | Results/funnel tab | `public/email-campaigns.html` | ~120 |
| | **Total** | **~4 files** | **~1,020** |

Roughly **60% frontend**. No migration — `import_jobs` already has every column needed.

### 4.2 Reusable from tonight's work

| asset | reuse |
|---|---|
| Segmentation SQL (G1/G2/G3 + unsubscribe) | **Direct** — `REACTIVATION_SEGMENTATION_SQL_20260818.md`, already parameterised on `:target_expo_id` |
| Freshest-row-per-email `LATERAL` | **Direct** — same doc |
| `processReactivationChunks` | **Unchanged** — call it, don't fork it |
| Progress bar CSS + polling | **Direct** — `reactivation-campaign.html:96-125`, `:623` |
| Modal pattern | **Direct** — `email-campaigns.html:74-78`, `:307` |
| Funnel SQL incl. check-in join | **Direct** — prototyped and run tonight |
| Delay-offset arithmetic | **Direct** — the "land at 09:00 Lagos" computation, with the drift lesson built in |

### 4.3 Risks

| # | Risk | Severity | Mitigation (DESIGN) |
|---|---|---|---|
| 1 | **Orchestrator partially completes**, as tonight (13,061 of 14,061 tokens) | 🔴 high | Phase-aware job state + a resume that skips already-tokenised emails. `create-from-excel` is already idempotent — it skipped 906 duplicates tonight — so re-running is safe by construction. |
| 2 | **`setImmediate` orphaned by a deploy** (R8) | 🔴 high | Don't deploy during a build; add a stale-job detector. Real fix is a job runner — out of scope. |
| 3 | **Funnel query too slow to poll** | 🟡 medium | `EXPLAIN ANALYZE` first; backfill `visitor_id`; cache |
| 4 | **Ops mis-sets delays** | 🟡 medium | Date/time picker + show computed landing window + spread. Tonight's manual offsets drifted ~1 h. |
| 5 | **Wizard writes before the user is ready** | 🟡 medium | Step 2 strictly read-only; all writes in Step 5; always create as **draft** |
| 6 | **Silent-mode regression** — a future change makes `template_id` required and the wizard starts emailing during token generation | 🔴 **high, under-appreciated** | The silent path is load-bearing and **undocumented as such**. Needs a test asserting "no `template_id` ⇒ zero `email_queue` rows". ~20 lines. |
| 7 | **`from-expo` recipients lack `extra_fields`** (`campaigns.js:651`) | 🟢 low | Orchestrator inserts rows directly, bypassing it |
| 8 | Excel with 300+ char fields | 🟢 low | Risk 4 above, ~15 lines |

### 4.4 Scope note

**~1,020 lines is not a 3-week-out change for SIEMA.** SIEMA is expo 9, 22-24 Sep — about 5
weeks from today, but a campaign would launch ~2-3 weeks before that.

**DESIGN observation, not a recommendation:** the pieces are independently shippable, and their
value is very unevenly distributed. Items 1 (segmentation preview) and 6 (funnel) are ~180 lines
and remove the two things ops cannot currently do at all — see the counts before committing, and
see the outcome afterwards. Items 2 and 8 — the orchestrator and wizard, ~650 lines — replace a
manual process that *does* work when someone with DB access drives it.

**No code written. No files changed beyond this document.**
