# MP26 Launch — Night Health Snapshot
**Taken:** 2026-08-18 **21:17 Istanbul** / 19:17 Lagos / 18:17 UTC
**Mode:** read-only. No intervention made. Baseline for tomorrow morning.

Campaigns: **16 MP26 Activate Wave** (activated 20:52:42 IST) · **17 MP26 Register Wave** (activated 21:15:12 IST)
Target expo: **13 — Nigeria Mega Project Expo 2026**, opens Tue 25 Aug.

---

## 🟢 Overall: healthy. Zero failures, zero stuck rows, worker live.

But **two deviations from plan** are recorded below. Neither is breaking; both change tomorrow's
expectations and one may need a decision before Thursday. **No action was taken.**

---

## 1. Campaign counters — both advancing

| id | name | status | recipients | total_sent | started (IST) | % enqueued |
|---|---|---|---:|---:|---|---:|
| 16 | MP26 Activate Wave | active | 14,941 | **14,941** | 20:52:42 | **100%** |
| 17 | MP26 Register Wave | active | 26,262 | 1,625 → 3,620 rising | 21:15:12 | ~14% |

Counters are advancing. Campaign 16's step-1 enqueue is **complete**.

## 2. Queue depth

| campaign | enqueued | delivered to SendGrid | still pending |
|---|---:|---:|---:|
| 16 | 14,941 | 670 | **14,271** |
| 17 | 3,585 (rising) | 0 | 3,585 |

Global `email_queue`: **pending 19,539** · sent 234,722 · cancelled 42,077 (May test residue) · **failed 0**

## 3. Send rate — ⚠️ DEVIATION 1

| window | sent | per minute | per second |
|---|---:|---:|---:|
| **tonight, last 10 min** | 284 | **28.4** | **0.47** |
| historical best hour (13 May) | 18,785 | 313 | 5.2 |

Per-minute detail, steady and flat: `21:06→29  21:07→29  21:08→29  21:09→28  21:10→29
21:11→28  21:12→29  21:13→28  21:14→29  21:15→25`

**The worker is delivering at ~1/11th of its proven peak.** The rate is suspiciously constant
at ~28-29/min, which reads like a fixed pacing limit rather than contention.

**Consequence:** 19,539 pending at 28.4/min ≈ **11.5 hours** → drains ~08:45 IST Wednesday.
Once campaign 17 finishes enqueueing, total outstanding will be ~41,200 → **~24 hours** at this
rate, i.e. step-1 delivery would not complete until roughly **Wednesday evening / Thursday morning.**

**Why it matters:** step 2 is scheduled off **enqueue** time, not delivery time. Campaign 16's
step 2 fires Thu 07:52 (below). If step-1 delivery is still draining then, some recipients could
receive step 1 and step 2 within a short window — or step 2 could reach an inbox before step 1.

⚠️ **NOT investigated, NOT changed.** Possible explanations to check tomorrow: a SendGrid-side
rate cap, a worker `PROCESS_INTERVAL` setting, or reduced worker concurrency vs May. The May peak
was measured on the same code path, so the capability exists.

## 4. Stuck rows — none

| check | count |
|---|---:|
| status `processing` right now | **0** |
| `processing` older than 15 min | **0** |
| `pending` older than 2 h | **0** |
| status `failed` (all time) | **0** |
| rows with `error_message` | **0** |
| campaign 16/17 rows with errors | **0** |
| `email_logs` with status ≠ sent | **0** |

**Worker liveness: last send 21:17:13 IST — 0 seconds ago.** Actively draining.

## 5. ⚠️ DEVIATION 2 — step 2 will land ~1 hour earlier than the 09:00 target

Delays were computed against **assumed** activation times of 21:45 / 22:15 IST. Actual activation
was **20:52:42** and **21:15:12** — 53 and 60 minutes earlier. `delay_hours` is fixed at 37, so
both waves shift earlier by the same amount.

Computed from **real** enqueue timestamps + 37 h:

| campaign | step-2 first | step-2 last | intended | drift |
|---|---|---|---|---|
| 16 Activate | **Thu 07:52 Lagos** | Thu 07:57 | 08:45–09:15 | **~55 min early** |
| 17 Register | **Thu 08:15 Lagos** | Thu 08:16 | 09:15–10:08 | **~60 min early** |

Also note the enqueue window was **far tighter than predicted**: campaign 16 enqueued all 14,941
in **4 m 37 s** (20:52:47 → 20:57:24), not the ~30 min I projected from a 500/min batch limit. The
practical effect is good — step 2 arrives as a sharp burst rather than smeared over an hour — but
it means the whole wave lands at 07:52, not spread across the 09:00 hour.

**07:52 Lagos is still a reasonable business send time.** Recording it as a deviation, not a fault.
Changing it would require editing `campaign_steps.delay_hours` **before Thursday** — not done.

## 6. First engagement — the bridge is working in production

| campaign | sent | opened | clicked | registered |
|---|---:|---:|---:|---:|
| 16 Activate | 14,941 | **10 unique** (16 events) | 1 | **1** |
| 17 Register | 3,620 | 0 | 0 | 0 |

**First real activation, 17 minutes after launch:**

```
campaign_id  : 16
recipient_id : 75753
email        : segunademigoke@gmail.com
event_type   : registered
via          : reactivation_activate_new
at           : 21:09:47 IST
```

`via: reactivation_activate_new` confirms the bridge shipped this morning is firing on live
production traffic — `reactivate.html` → `_lc` → `/activate` → `email_events`. This recipient will
be correctly **skipped** by step 2's `not_registered` condition.

New visitors on expo 13 in the last 2 hours: **6 via `reactivation_campaign`** (1 post-launch,
5 from the earlier 9-17 Aug wave) and **26 via `zohoform`** (organic).

Token activations post-launch: **1** (21:09:47).

---

## Tomorrow's baseline — what to compare against

| metric | value at 21:17 IST |
|---|---|
| C16 enqueued / delivered | 14,941 / 670 |
| C17 enqueued / delivered | 3,585 / 0 |
| Global pending | 19,539 |
| Send rate | 28.4/min |
| Failed / stuck | 0 / 0 |
| C16 opens (unique) | 10 |
| C16 registrations | 1 |
| Expo-13 tokens | 24,036 (9,650 exp 09-09 · 14,386 exp 09-17) |

## Open items — flagged, not acted on

1. **Send rate 28.4/min vs 313/min historical.** Biggest open question. If it holds, step-1
   delivery runs ~24 h and overlaps step 2 on Thursday morning.
2. **Step 2 fires Thu 07:52 (C16) / 08:15 (C17) Lagos**, ~1 h earlier than intended. Adjustable
   via `campaign_steps.delay_hours` before Thursday if 09:00 matters.
3. Campaign 17 still enqueueing at snapshot time — final `total_sent` should reach 26,262.
4. **No bounce visibility.** LEENA records no bounce/complaint data; SendGrid dashboard is the
   only source. First 41 k send to a partly aged list — worth checking there tomorrow.

**Nothing was modified. Both campaigns left running as activated.**
