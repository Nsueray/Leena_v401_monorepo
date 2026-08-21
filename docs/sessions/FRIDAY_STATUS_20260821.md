# MP26 Friday Status Sweep — 21 August 2026
**Taken:** 11:54 Istanbul / 09:54 Lagos · **Mode:** read-only, nothing changed.
**Fair opens Tue 25 Aug — 4 days.** Step 3 fires Mon 24 Aug, fair eve.

Prior: `HEALTH_SNAPSHOT_20260818_NIGHT.md` → `MORNING_CHECK_20260819.md` →
`CAMPAIGN_STATUS_20260819_EOD.md` → **this**. Ops baseline: `TERMINAL_CHECK_20260819.md`.

---

## 1. Campaign health

### Step 2 fired exactly as predicted, and drained 10× faster

| | **C16 Activate** | **C17 Register** |
|---|---|---|
| Predicted fire (19 Aug) | Thu 07:52 Lagos | Thu 08:15 Lagos |
| **Actual fire** | **Thu 20 07:52:54** ✅ | **Thu 20 08:15:25** ✅ |
| Enqueue window | 07:52:54 → 07:57:42 (4 m 48 s) | 08:15:25 → 08:24:27 (9 m 02 s) |
| Enqueued | **14,649** | **26,148** |
| Delivery window | Thu 07:52 → 08:49 | Thu 08:49 → 10:28 |
| **Drain** | **56 min** | **100 min** |
| Step-1 drain, for contrast | **535 min** | **320 min** |

**The `EMAIL_WORKER_BATCH_SIZE` 1→10 change is what made this possible.** Step 1 took 8h55m
(C16) and 5h20m (C17) at 28.5/min; step 2 moved ~41k emails in **under 3 hours total**. Had the
rate not been raised, step 2 would still have been draining into Friday and step 3 would have
delivered into fair opening day.

Enqueued counts came in **below** the 19 Aug projection (14,713 / 26,193) — the correct
direction, as more recipients registered overnight and were suppressed.

### Step-2 skips, by reason

| | C16 | C17 | total |
|---|---:|---:|---:|
| Recipients | 14,941 | 26,262 | 41,203 |
| Received step 2 | 14,649 | 26,148 | 40,797 |
| **Skipped** | **292** | **114** | **406** |
| — unsubscribed | 7 | 23 | 30 |
| — **campaign `registered` event** | 225 | 40 | 265 |
| — **Wednesday's real-registration fix** | **60** | **51** | **111** |
| — of which visitor row | 60 | 51 | 111 |
| — of which activated token | 1 | 0 | 1 |
| **unexplained** | **0** | **0** | **0** |

**Wednesday's fix (`dedbcd0`) suppressed 111 emails at step 2** that the old condition would
have sent — people who had already registered, mostly through organic Zoho traffic the campaign
event structurally cannot see. Zero unexplained skips: every skip is accounted for.

*(The token column overlaps the visitor column — one recipient satisfied both.)*

### Failures, stuck rows, queue

| check | value |
|---|---:|
| `failed` | **0** |
| `processing` / stuck | **0** |
| `pending` | **0** |
| rows with `error_message` | **0** |
| Queue rows, C16 / C17 | 29,590 / 52,410 (both steps, all `sent`) |
| Last send | 21 Aug 11:54 |

⚠️ Queue rows are still present because **both campaigns are `active`** — the completion purge
has not run. `delivered_count` remains NULL on both, correctly.

### Registrations and engagement

| | **C16 Activate** | **C17 Register** |
|---|---:|---:|
| Delivered (both steps) | 29,590 | 52,410 |
| Opened (unique) | 5,005 (**33.5%** of 14,941) | 6,370 (**24.3%** of 26,262) |
| Clicked (unique) | 670 | 713 |
| **Registered total** | **510** | **176** |
| **Registered, last 24 h** | **150** | **124** |
| Unsubscribed | 13 (0.09%) | 64 (0.24%) |

**C16 converts 5.1× better than C17** — 3.41% vs 0.67% of recipients. Consistent with Tuesday's
14× gap narrowing as C17 accumulates: the register flow is slower to convert but not inert.

**Step 2 more than doubled total registrations** — C16 190 → 510, C17 23 → 176 since Wednesday
evening. The follow-up step is doing real work, not just repeating step 1.

Expo 13 registrations in the last 24 h, all channels: **654** —
`zohoform` 364 · `reactivation_campaign` 158 · `public` 132.

---

## 2. Step 3 — Monday, fair eve

**Confirmed scheduled:** C16 **Mon 24 Aug 07:52 Lagos**, C17 **Mon 24 Aug 08:15 Lagos**.
`next_step_due_at` is set on all active recipients; matches the 96 h offset from step 2.

**Projection if it fired right now:**

| | active | would send | would skip |
|---|---:|---:|---:|
| C16 | 14,928 | **14,314** | **614** |
| C17 | 26,198 | **25,938** | **260** |
| total | 41,126 | **40,252** | **874** |

The skip count will keep climbing — organic registration is running at ~360/day and each one
converts a would-be recipient into a skip. Expect **appreciably more than 874** by Monday.

⚠️ At 274/min the ~40k step-3 wave drains in **~2.5 h**, landing mid-morning Monday — a full
day before doors open. No collision with fair day.

---

## 3. Ops readiness — diff against `TERMINAL_CHECK_20260819.md`

### ⚠️ Nothing has changed since Tuesday.

| # | Item | Tue 19 Aug | **Fri 21 Aug** | Status |
|---|---|---|---|---|
| 1 | T1 Visitor badge template | `test visitor 80x40` (17) | **`test visitor 80x40` (17)** | 🔴 **UNCHANGED** |
| 2 | `show_job_title` on T1's template | **false** | **false** | 🔴 **UNCHANGED** |
| 3 | Conference terminal | none | **none** | 🔴 **UNCHANGED** |
| 4 | Bulk-print terminal | none | **none** | 🟡 unchanged |
| 5 | Terminal count | 4 | 4 (same ids 37-40, created 18 Aug) | — |
| 6 | `allow_manual_registration` | all TRUE | all TRUE | 🟡 unverified intent |
| 7 | Conference form topics | *reported as 1* | **4** | ✅ **see correction** |

### ✅ Correction to my Tuesday report

**`TERMINAL_CHECK_20260819.md` item 12 was wrong.** It stated form 55 exposes "only 1 topic
option". My query counted the *field* named `conference_topic` (there is 1), not the *options
inside it*. Form 55 actually carries **4 topic options**, and `forms.updated_at` is
**10 Aug 12:37** — before Tuesday's check — so **the form has not changed; my measurement was
faulty.** The four sessions:

1. Panel — Building the Future of Nigeria: State Infrastructure…
2. Panel — Smart Cities, Green Technology, and Sustainable Urbanisation…
3. Plenary — Institutionalizing ESG for Risk Reduction in Emerging…
4. Panel — Decarbonizing the Built Environment: Pathways to Net…

**Item 12 is withdrawn, not resolved.** The conference *programme* is fine. The conference
*terminal* (item 3) is still missing and remains blocking.

### Expo 13 counters

| metric | Tue 19 Aug | **Fri 21 Aug** | Δ |
|---|---:|---:|---:|
| Visitors | 3,809 | **5,185** | **+1,376** |
| — with `job_title` | 3,721 (97.7%) | **5,097 (98.3%)** | +1,376 |
| Conference registrants | 66 | **85** | +19 |
| Check-ins | 13 (test) | 13 (test) | 0 |
| Terminals | 4 | 4 | 0 |

### Verdict — 4 days out

| item | verdict | consequence if unresolved |
|---|---|---|
| **T1 on a test badge template** | 🔴 **STILL OPEN** | The gate serving ~5,000 visitors prints from a template named "test" |
| **`show_job_title` = false** | 🔴 **STILL OPEN** | **5,097 job titles (98.3%) will not print.** The 1,785-row backfill delivers nothing at the gate. |
| **No conference terminal** | 🔴 **STILL OPEN** | **85 conference registrants** have no check-in and no certificate path. Certificates authenticate by `x-terminal-key`; with no terminal the flow cannot run. |
| No bulk-print terminal | 🟡 open | No batch pre-printing. Create fresh — **never clone** (G15: clone drops `kind`). |
| Manual-registration intent | 🟡 unverified | All 4 gates allow manual registration; May ran a deliberate mix. |
| Conference form topics | ✅ **withdrawn** | Was my measurement error. 4 sessions configured. |

**Campaign side is healthy and needs nothing. Every remaining risk is gate readiness, and none
of it has moved in three days.**

---

## 4. Saturday bonus-wave pool

**Target: C16 recipients who have neither registered nor activated.**

| | count |
|---|---:|
| C16 total recipients | 14,941 |
| — unsubscribed (exclude) | 13 |
| — already converted (event / visitor row / activated token) | 614 |
| **BONUS POOL (C16)** | **14,314** |
| C17 equivalent, for reference | **25,938** |

### ✅ Existing tokens are valid for reuse — no regeneration needed

| check | result |
|---|---:|
| Pool members holding a token | **14,314 / 14,314 (100%)** |
| Token status `pending` | **14,314** |
| **Not expired** | **14,314** |
| Missing a token | **0** |
| Expiry range | **2026-09-09 → 2026-09-17** |

Every expiry falls **well after the fair ends (27 Aug)** — the earliest is 13 days clear. The
fair-anchored expiry work from Tuesday (`5866a0a`) plus the 30-day floor is what guarantees
this: had the original hardcoded 30-day rule applied from the 10 Aug wave, the earliest tokens
would still have been fine, but tokens minted for a later fair would not have been.

**A one-step Saturday campaign can reuse the existing `activation_url` values directly.** The
build is: export `email` + `activation_url` for the 14,314 → upload as recipients to a new
one-step campaign → template with `{{activation_url}}` → activate.

⚠️ Two cautions:
- The pool **overlaps step 3 on Monday**. A Saturday send plus a Monday send is two emails in
  three days to the same 14,314 people, on top of two already received. Unsubscribes are low
  (0.09% on C16) but this is the highest-frequency stretch of the whole campaign.
- The pool is measured **now**; it shrinks continuously at ~360 registrations/day across all
  channels. Rebuild it at send time rather than reusing this figure.

---

## Summary

| area | state |
|---|---|
| Step 2 delivery | ✅ on time, 10× faster, 0 failures |
| Wednesday's `not_registered` fix | ✅ suppressed 111 wrong sends, 0 unexplained |
| Step 3 | ✅ scheduled Mon 07:52 / 08:15 Lagos, ~874+ will be skipped |
| Registrations | ✅ 686 campaign-attributed, 274 in last 24 h |
| Queue health | ✅ 0 failed / 0 stuck / 0 pending |
| **Gate readiness** | 🔴 **3 blocking items, unchanged for 3 days** |
| Saturday pool | ✅ 14,314 with valid reusable tokens |
