# SIEMA 2026 Reactivation — Read-Only Discovery
**Date:** 2026-08-18 · **Mode:** discovery only. No code changes, no DB writes, nothing deployed.
All SQL run read-only as `claude_readonly` on `leena_v401_db`. Code refs are `path:line`
relative to `backend/leena-v401-backend/`.

---

# PRIORITY QUESTION — conversion or delivery?

## Answer: **CONVERSION. Delivery is not the problem, and the drop-off is at open → click.**

### Stage 1-3: the queue delivers 100%. There is no leak.

Funnel per reactivation campaign. Tokens matched to `email_queue` on
`lower(trim(email))` + `expo_id`:

| target expo | campaign | tokens created | distinct emails | **enqueued** | **sent** | cancelled | never enqueued | activated | activation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | Mega HoReCa Nigeria | 7,562 | 7,562 | **7,562** | **7,562** | 0 | **0** | 242 | **3.20%** |
| 7 | Mega Clima Nigeria 2026 | 32,200 | 32,200 | **32,200** | **32,200** | 0 | **0** | 864 | **2.68%** |
| 13 | Nigeria Mega Project 2026 | 9,976 | 9,976 | **9,976** | **9,976** | 0 | **0** | 344 | **3.45%** |
| 11 | `[TEST]` Reactivation Smoke | 85,000 | 85,000 | 85,000 | 42,924 | **42,077** | 0 | 1 | 0.00% |

**`tokens created` = `enqueued` = `sent`, exactly, for all three real campaigns.**
Zero never-enqueued. Zero cancelled. Zero failed.

Expo 11 is **not a real campaign** — it is the documented May stress test that inserted
85,000 `@leena-test.local` addresses; 42,077 were deliberately cancelled mid-flight and the
85,000 addresses were pushed to SendGrid's global suppression list. Exclude it from all
analysis.

**So `enqueued ≫ sent` is false. The premise behind "maybe the emails never went out" does
not hold.** Everything downstream is meaningful.

### Current `email_queue` status distribution + stuck check

| status | rows |
|---|---:|
| `sent` | 233,923 |
| `cancelled` | 42,077 |

**Those are the only two statuses that exist in the table.** There are **no** `pending`,
`processing`, or `failed` rows at all — not now, not historically.

```sql
SELECT COUNT(*) FILTER (WHERE status='processing'), COUNT(*) FILTER (WHERE status='pending')
FROM email_queue;   → 0, 0
```
**Nothing is stuck. The queue is fully drained.**

### Stage 4: bounced/failed — **this data does not exist in LEENA**

| source | what it holds |
|---|---|
| `email_queue.status` | only `sent` / `cancelled` — no failure state ever recorded |
| `email_logs.status` | **only `sent`** (224,772 rows). Zero `failed`. |
| `email_events.event_type` | `sent`, `opened`, `clicked`, `registered`, `unsubscribed` — **no `bounce`, `dropped`, `spamreport`, or `deferred`** |
| `email_unsubscribes` | 171 rows total, 171 distinct emails |

**There is no SendGrid bounce/complaint webhook integration.** This is the open backlog item
recorded in `CLAUDE.md` ("SendGrid bounce/complaint webhook integration → automated
`email_unsubscribes` population"), still unbuilt.

**Consequence, stated plainly:** "sent" in LEENA means *SendGrid accepted the API call*. It
does **not** mean delivered to an inbox. **Bounce and spam rates are invisible from inside
LEENA and can only be read from the SendGrid dashboard.** That is a real gap for a 64k send
to 7-year-old addresses — see Q4.

### The actual drop-off — measured, from the one system that tracks opens

The reactivation module emits **no** `email_events` at all (verified: `email_events` requires
a `campaign_id`; rows with `campaign_id IS NULL` = **0**). So for the 3% campaigns we are
blind on opens by construction.

The **campaign/sequence module** does track them, on the same sender domain and overlapping
audience. Distinct emails per event type:

| campaign | sent | opened | clicked | registered | unsub |
|---|---:|---:|---:|---:|---:|
| **13** Conference Invitation Verify New | 32,218 | **9,103** | 1,419 | 667 | 134 |
| **14** Conference Invitation Risk Data | 5,471 | **1,617** | 168 | 123 | 37 |

Converted to rates:

| stage | campaign 13 | campaign 14 | verdict |
|---|---:|---:|---|
| sent → opened | **28.25%** | **29.55%** | ✅ healthy — proves delivery works |
| opened → clicked | **15.59%** | 10.39% | ❌ **the bottleneck** |
| clicked → registered | **47.00%** | 73.21% | ✅ strong |
| sent → registered | 2.07% | 2.25% | matches the ~3% complaint |

**A 28-30% open rate is normal-to-good for B2B event mail. Emails are arriving and being
read.** If this were a delivery problem the open rate would be in low single digits.

**The loss is concentrated in one stage: of 9,103 people who opened campaign 13, only 1,419
clicked.** ~7,700 opened the email and did nothing. Meanwhile nearly half of everyone who
clicked went on to register — the landing/registration path converts well.

Note the reactivation module's 2.68–3.45% activation and the campaign module's 2.07–2.25%
registration land in the same band from two independent systems, which corroborates that ~3%
is a real end-to-end conversion rate rather than an artefact of either pipeline.

**⚠️ One caveat on the open rate:** open tracking is pixel-based and is undercounted by image
blocking (Apple Mail Privacy Protection, corporate gateways) — the true open rate is likely
*higher* than 28%, which strengthens rather than weakens the conclusion. Click tracking is
not affected by this.

---

# Q1 — Which expo is SIEMA 2026?

**`expo_id = 9` — "Morocco Siema Expo 2026" — 2026-09-22 → 2026-09-24 — 35 days from today.**

```sql
SELECT id,name,start_date::text,end_date::text,(start_date-CURRENT_DATE)::int AS days_away,
       status,location FROM expos WHERE name ILIKE '%siema%' OR name ILIKE '%morocco%';
```

| id | name | start | end | days away | status | location |
|---|---|---|---|---:|---|---|
| 1 | Morocco Siema Expo | 2025-09-09 | 2025-09-11 | −343 | announcement | O.F.E.C, Casablanca |
| **9** | **Morocco Siema Expo 2026** | **2026-09-22** | **2026-09-24** | **35** | announcement | O.F.E.C. Casablanca, Morocco |

Expo 1 is the 2025 edition and is the primary source pool (see Q2).
`status='announcement'` is not meaningful — every expo in the DB carries that default.

**It exists in LEENA. Setup state:**

| asset | count | detail |
|---|---:|---|
| Forms | **2** | id 38 `Exhibitor Registration Form` (exhibitor, active, template 28); id 51 `Visitor Registration Form` (visitor, active, template 47) |
| Email templates | **2** | scoped `expo_id=9` |
| **Reactivation tokens** | **0** | ⚠️ no reactivation campaign has ever been created for SIEMA 2026 |
| Email campaigns | 1 | id 1 "Test", 5 recipients, completed 2026-05-05 — a test, not a real campaign |
| Visitors | 349 | |
| Terminals | **0** | not relevant at 35 days out, but noted |

So: forms ✅, templates ✅, **reactivation setup ❌ (nothing exists yet)**.

---

# Q2 — Addressable pool

### Distinct emails (all figures `lower(trim(email))`, non-empty)

| measure | count |
|---|---:|
| **Distinct emails, all expos** | **50,406** |
| Visitor rows, all expos | 62,275 |
| **SIEMA-specific (expos 1 + 9)** | **21,707** |
| Non-SIEMA only | 28,699 |
| Overlap SIEMA ↔ other expos | **15** |

**The SIEMA audience is almost completely disjoint from the Nigeria/Ghana/Kenya audience —
only 15 shared addresses out of 50,406.** Morocco is a separate market with no meaningful
cross-pollination.

Per-expo distinct emails (top rows):

| expo | distinct emails | rows |
|---|---:|---:|
| **1 — Morocco Siema Expo (2025)** | **21,387** | 30,444 |
| 7 — Mega Clima Nigeria 2026 | 12,083 | 12,083 |
| 3 — Mega HoReCa Nigeria | 9,801 | 9,801 |
| 5 — Mega Clima Ghana 2026 | 4,693 | 4,693 |
| 13 — Nigeria Mega Project 2026 | 3,390 | 3,390 |
| 2 — Mega Clima Ghana | 1,150 | 1,152 |
| **9 — Morocco Siema Expo 2026** | **349** | 349 |

### Ever checked in

| measure | count |
|---|---:|
| Distinct emails with ≥1 check-in, any expo | **9,690** |
| Distinct emails with ≥1 check-in, SIEMA (1+9) | **5,104** |

Per expo — note the difference between events and people:

| expo | check-in **rows** | distinct **visitors** | distinct **emails** |
|---|---:|---:|---:|
| **1 (SIEMA 2025)** | **14,988** | **7,446** | **5,100** |
| 7 | 2,223 | 2,050 | 2,050 |
| 3 | 2,185 | 2,074 | 2,074 |
| 5 | 727 | 507 | 507 |
| 8 | 91 | 81 | 81 |

### ⚠️ Two corrections to the numbers in the brief

- **"~27k records in LEENA"** — SIEMA holds **30,444 visitor rows** but only **21,387
  distinct emails** on expo 1 (21,707 including expo 9). The row count is inflated by
  duplicates; the addressable figure is ~21.7k, not 27k.
- **"14k with check-ins"** — 14,988 is the **check-in event count** on expo 1. The distinct
  people behind it is **7,446 visitor rows / 5,100 distinct emails**. So roughly **5.1k
  addressable people ever attended SIEMA**, not 14k. Multiple scans per visitor per day
  account for the difference (14,988 ÷ 7,446 ≈ 2.0 scans each).

### Exclusions and the real reachable count

| exclusion | count |
|---|---:|
| Unsubscribed (total in `email_unsubscribes`) | 171 |
| — of which appear in the visitor pool | **37** |
| **Previously bounced** | **UNKNOWN — not recorded anywhere in LEENA** (see priority section) |

| pool | reachable after exclusions |
|---|---:|
| All expos | **50,369** (50,406 − 37) |
| SIEMA-specific (1 + 9) | **~21,690** (21,707 minus its share of the 37) |

**The bounce exclusion cannot be computed from LEENA.** With no bounce webhook, addresses
that hard-bounced in 2019-2025 are still sitting in the pool indistinguishable from good
ones. That is the single largest unknown in this whole analysis.

### The 64k Zoho records — **not verifiable**

Nothing in LEENA corresponds to a ~64k SIEMA-since-2019 Zoho archive. Total distinct emails
across every expo in LEENA is 50,406, of which 21,707 are SIEMA. **The Zoho archive is
outside this database and I cannot confirm its size, its overlap with the 21,707 already in
LEENA, or its address quality.** Any figure for it is unverified.

---

# Q3 — Multi-step capability

## Two separate systems exist. Only one does conditional multi-step.

### (a) Reactivation module — single-shot + a manual blunt resend

`POST /api/reactivation/resend-pending` — `routes/reactivation.js:773`

```js
773: router.post('/resend-pending', authMiddleware, async (req, res) => {
775:   const { target_expo_id, template_id } = req.body;
     …
798:   `SELECT token, email, name, last_name, company, country, job_title
800:    WHERE target_expo_id = $1 AND organizer_id = $2 AND status = 'pending'`
```

- **Model:** no steps, no delays, no conditions. It selects every token still
  `status='pending'` and enqueues one email with a manually chosen `template_id`.
- **Trigger:** manual — an admin clicks it. Nothing schedules it.
- "Non-registrants" is approximated by `status='pending'`, which is accurate for this module
  since a token flips to `activated` only on successful activation
  (`reactivation.js:611`).
- **Has run in production:** yes — this is the documented "resend to pending" flow from the
  v4.0.2 era.

### (b) Campaign / sequence module — **real conditional multi-step, and it works**

**Schema** — `campaign_steps`:

| column | type |
|---|---|
| `campaign_id` | integer |
| `step_number` | integer |
| `template_id` | integer |
| **`delay_hours`** | integer |
| **`condition`** | varchar |

**Condition vocabulary actually implemented** — `email_worker.js:438-480`:

```js
438: async function evaluateCondition(condition, recipient, stepsMap) {
439:   if (condition === 'all') return true;
447:   if (condition === 'not_opened' || condition === 'opened') { … }
458:   if (condition === 'not_clicked' || condition === 'clicked') { … }
469:   if (condition === 'not_registered' || condition === 'registered') {
470:     const regRes = await pool.query(
471:       `SELECT id FROM email_events WHERE recipient_id = $1 AND event_type = 'registered'
472:        AND created_at >= $2 LIMIT 1`,
473:       [recipient.id, recipient.last_step_sent_at || new Date(0)]);
480:   return true; // Unknown condition → proceed
```

Seven conditions: `all`, `opened`/`not_opened`, `clicked`/`not_clicked`,
`registered`/`not_registered`. Note `not_registered` is evaluated **relative to
`last_step_sent_at`**, i.e. "has not registered since the previous step went out".

**Wired up?** Yes — `email_worker.js:666-667`:
```js
666: setInterval(runCampaignScheduler, CAMPAIGN_SCHEDULER_INTERVAL_MS);
667: runCampaignScheduler(); // Run once immediately on startup
```
Interval default 60s (`:266`, `CAMPAIGN_SCHEDULER_INTERVAL_SECONDS`).

**Unsubscribe safety:** checked defensively at enqueue time, not just at build time —
`email_worker.js:~489`, flipping the recipient to `status='unsubscribed'` if they opted out
between pickup and send.

**Has it completed successfully in production at scale? YES.**

| campaign | recipients | steps | total_sent | status | recipient outcome |
|---|---:|---:|---:|---|---|
| **13** Conference Invitation Verify New | 32,218 | 3 | 96,178 | **completed** | 32,108 completed + 110 unsubscribed = 32,218 ✅ |
| **14** Conference Invitation Risk Data | 5,471 | 3 | 16,285 | **completed** | 5,437 completed + 34 unsubscribed = 5,471 ✅ |

Every recipient reached a terminal state. `total_sent` ≈ 3 × recipients, consistent with all
three steps firing.

**The exact "send now, resend to non-registrants later" pattern is already in production** —
campaigns 6, 13 and 14 all use this step model verbatim:

| step | delay_hours | condition |
|---|---:|---|
| 1 | 0 | `all` |
| 2 | 24 | `not_registered` |
| 3 | 72 | `not_registered` |

### The May completion bug — current state

**Fixed and verified working.** `email_worker.js:598-620`, `computeNextDue()`:

```js
600:   const nextStep = stepsMap[currentStepNum + 1];
601:   if (!nextStep) {
602:     // No more steps — mark recipient completed
604:     `UPDATE campaign_recipients
605:      SET status = 'completed', next_step_due_at = NULL, updated_at = NOW()
608:      WHERE id = $1`
```
and `checkCampaignCompletion()` at `:622-630` flips the campaign itself to `completed` once
no `active` recipients remain.

Evidence it holds today: **zero recipients are stranded in `active` on any started
campaign.** The only `active` recipients in the table belong to campaigns **6** (32,084) and
**10** (5,434) — and both of those are `status='draft'` with `started_at IS NULL`. They were
built and never launched. That is un-launched draft state, **not** the May stranding bug.

### Summary for Q3

| capability | reactivation module | campaign module |
|---|---|---|
| Multi-step | ❌ | ✅ `campaign_steps` |
| Delays | ❌ | ✅ `delay_hours` |
| Conditions | ❌ (blunt `status='pending'`) | ✅ 7 conditions |
| Automatic scheduling | ❌ manual click | ✅ 60s scheduler |
| Open/click tracking | ❌ **emits no events at all** | ✅ `email_events` |
| Proven at scale | ✅ 32,200 (single shot) | ✅ 32,218 × 3 steps |
| Produces a reactivation token / prefilled landing page | ✅ | ❌ (not verified — see gap below) |

**Unresolved:** whether the campaign module can carry a per-recipient reactivation token /
prefilled activation link the way `reactivate.html` does, or whether it only sends templated
mail to a list. I did not verify this and it matters, because the reactivation module's 47%
click→register strength may depend on the prefilled landing page. **NEEDS MORE INFO — read
`routes/campaigns.js` recipient build + template placeholder handling.**

---

# Q4 — Deliverability posture

### SendGrid plan

**Documented, not independently verified:** `CLAUDE.md` records a 13 May 2026 upgrade —
**Pro 100K → Pro 300K ($89.95 → $249/mo)** — made because month-to-date usage had already
reached ~84k and a 70k reactivation send would have breached the 100K cap.

**NEEDS MORE INFO — current plan tier, current month-to-date usage, remaining headroom, and
sender reputation. I have no SendGrid dashboard or API access in this session and did not
call the SendGrid API.** A `SENDGRID_API_KEY` exists in `.env`; I did not use it, since
calling an external service was outside the read-only scope. Say the word if you want me to.

### Bounce / spam history

**Not available inside LEENA — there is no bounce data anywhere** (full evidence in the
priority section: no `failed` in `email_queue`, no `failed` in `email_logs`, no bounce event
types in `email_events`).

What LEENA does hold:

| signal | count |
|---|---:|
| `email_unsubscribes` | 171 |
| `unsubscribed` events (campaign module) | 202 events / 171 distinct |
| Campaign 13 unsubscribe rate | 134 / 32,218 = **0.42%** |
| Campaign 14 unsubscribe rate | 37 / 5,471 = **0.68%** |

Those unsubscribe rates are healthy (industry tolerance is ~0.5%, spam-complaint danger
starts ~0.1% of *complaints*, which is a different metric we cannot see).

**One documented historical incident** (`CLAUDE.md`, 13 May): 85,000 `@leena-test.local`
addresses were queued in error; 42,924 reached SendGrid before 42,077 were cancelled. All
85,000 were then pushed to SendGrid's global suppression list to stop the 72-hour deferred
retry cycle escalating into hard bounces. Reputation was recorded as preserved at ~98%.
**That figure is from May and I have not re-verified it.**

### ZeroBounce

**Not integrated. Not present in the codebase in any form.**
```
grep -rni "zerobounce|zero_bounce|ZB_API" routes/ email_worker.js utils/ public/ index.js
→ no matches
```
No validation step exists anywhere in the send path. Addresses go from the DB to SendGrid
unvalidated.

### Email worker measured throughput

Peak sustained hours ever recorded (`email_queue.sent_at`):

| hour (UTC) | emails sent |
|---|---:|
| 2026-05-13 10:00 | **18,785** |
| 2026-05-12 12:00 | 17,500 |
| 2026-05-12 13:00 | 17,430 |
| 2026-05-13 09:00 | 13,574 |
| 2026-08-10 15:00 | 5,458 |

**Measured ceiling ≈ 18,800/hour ≈ 5.2 emails/second**, which matches the ~5/sec figure the
reactivation monitor's ETA formula assumes. Sustained across at least 4 consecutive hours on
12-13 May with no stalls.

Current baseline load is trivial by comparison — today's busiest hour was 367.

**Implication for scheduling (arithmetic only, no recommendation):** at the measured
5.2/sec ceiling, 64,000 addresses = **~3.4 hours** of continuous sending; 21,700 = ~1.2
hours. Throughput is not a constraint. The constraints are the SendGrid monthly cap and
reputation risk on aged unvalidated addresses — neither of which I can currently measure.

---

# EVIDENCE GAPS — what I could not verify

| # | Gap | How to close |
|---|---|---|
| 1 | **Bounce/spam rates for every past send** | SendGrid dashboard → Suppressions + Stats. Not in LEENA at all. |
| 2 | **Current SendGrid plan, MTD usage, reputation** | SendGrid dashboard, or authorise me to call their API with the key in `.env` |
| 3 | **The 64k Zoho archive** — size, quality, overlap with the 21,707 already in LEENA | Export from Zoho; nothing in LEENA describes it |
| 4 | **Whether the campaign module can carry reactivation tokens / prefilled links** | Read `routes/campaigns.js` recipient build + placeholder handling |
| 5 | True open rate | Pixel tracking undercounts; 28% is a floor, not a point estimate |
| 6 | Whether the ~7,700 who opened-but-didn't-click on campaign 13 were blocked by content, CTA, or language | Not answerable from stored data |

---

## Facts most likely to matter, restated without interpretation

1. Queue delivery is 100% on all three real reactivation campaigns; nothing is stuck.
2. Open rate 28-30%; click rate 15.6% of openers; register rate 47% of clickers.
3. No bounce tracking exists anywhere in LEENA.
4. No email validation (ZeroBounce or otherwise) exists anywhere in LEENA.
5. SIEMA 2026 is expo 9, 35 days out, with forms and templates but zero reactivation setup.
6. SIEMA addressable pool is 21,707 distinct emails, of which 5,104 ever checked in.
7. The SIEMA audience shares only 15 addresses with all other expos combined.
8. The campaign module supports conditional multi-step and has completed 32,218 recipients
   × 3 steps in production; the reactivation module does not and has not.
9. Worker ceiling is ~18,800 emails/hour measured.

No recommendations and no campaign design, per brief.
