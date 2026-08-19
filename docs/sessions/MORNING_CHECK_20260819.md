# MP26 Launch — Morning Check
**Taken:** 2026-08-19 **09:48 Istanbul** / 07:48 Lagos
**Mode:** read-only. No changes, no interventions.
Baseline: `HEALTH_SNAPSHOT_20260818_NIGHT.md` (18 Aug 21:17 IST).

---

## 🟢 Status: healthy. Zero failures, zero stuck rows, worker live.

C16 step 1 **fully delivered**. C17 on track, drains this evening with 13 h margin before step 2.
Bridge integrity **100%** — every activated token has its campaign event.

---

## 1. Queue and send rate

| metric | last night 21:17 | **now 09:48** |
|---|---:|---:|
| Send rate | 28.4/min | **28.5/min** (10 m: 28.4 · 1 h: 28.6 · 3 h: 28.5) |
| Global pending | 19,539 | **19,528** |
| Failed / stuck / errors | 0 / 0 / 0 | **0 / 0 / 0** |
| Last send | 1 s ago | **1 s ago** (09:48:43) |

**Rate unchanged — still capped.** Hourly deliveries since launch, flat to within ±0.3%:

`21:00→1701  22:00→1694  23:00→1697  00:00→1694  01:00→1697  02:00→1698`
`03:00→1700  04:00→1702  05:00→1702  06:00→1707  07:00→1708  08:00→1712`

Cause confirmed last night: `email_worker.js:21` `PROCESS_INTERVAL = 2000` (hardcoded) ×
`:23` `BATCH_SIZE = EMAIL_WORKER_BATCH_SIZE || 1` → 1 email / 2 s ≈ 30/min ceiling.
`EMAIL_WORKER_BATCH_SIZE` is unset on the Render worker. **Not changed.**

### Campaign delivery

| campaign | enqueued | delivered | pending | % | last delivered |
|---|---:|---:|---:|---:|---|
| **16 Activate** | 14,941 | **14,941** | **0** | **100%** ✅ | 19 Aug 05:48 IST |
| 17 Register | 26,262 | 6,738 | 19,524 | 25.7% | 19 Aug 09:48 IST |

**C16 step 1 completed 05:48 IST**, ~9 h after activation.

### C17 ETA at measured rate

19,524 pending ÷ 28.5/min = **11.4 h → Wed 19 Aug 21:13 IST / 19:13 Lagos.**

## 2. Failures / stuck / liveness

| check | count |
|---|---:|
| `processing` now | **0** |
| `processing` > 15 min | **0** |
| `failed` (all time) | **0** |
| rows with `error_message` | **0** |
| `email_logs` status ≠ sent | **0** |

Worker last send **09:48:43 IST — 1 second ago.** Continuously draining, no gaps overnight.

## 3. Overnight results

⚠️ **Read C17's rates against DELIVERED, not sent.** The `sent` event is written at *enqueue*
(`email_worker.js:537-539`), so C17 shows 26,262 `sent` events while only 6,765 have actually
been handed to SendGrid. Rates below use delivered as the denominator.

| campaign | delivered | opened | open % | clicked | **registered** | unsubscribed |
|---|---:|---:|---:|---:|---:|---:|
| **16 Activate** | 14,941 | 1,217 | **8.15%** | 161 | **98** | 4 |
| **17 Register** | 6,765 | 321 | **4.75%** | 129 | **7** | 1 |

Unsubscribes since launch: **5 total** (4 + 1) = **0.05% of delivered.** Well within tolerance.

### C16 registration attribution

| via | count |
|---|---:|
| `reactivation_activate_new` | **95** |
| `reactivation_activate_existing` | **2** |
| `public_form_submission` | **1** |
| **total** | **98** |

The single `public_form_submission` on C16 came through **#54's secondary form link** — the one
flagged during the audit as a token-bypassing path. It is being used, at ~1% of C16 conversions.
That visitor created a fresh record; their reactivation token stays `pending`.

### New expo-13 visitors since launch

| origin | count |
|---|---:|
| `zohoform` (organic) | 176 |
| **`reactivation_campaign`** | **102** |
| `public` | 9 |

## 4. Bridge integrity — ✅ 100%

```sql
-- activated tokens belonging to a C16 recipient with NO registered event
→ 0
```

**Zero gaps.** Every C16 recipient who activated has the event attributed and **will be correctly
skipped at step 2.**

Reconciliation of the raw counts:

| | |
|---|---:|
| Tokens activated since launch (expo 13, all sources) | **105** |
| — of which belong to a C16 recipient | 97 |
| — of which are from the earlier 9–17 Aug wave (not in C16) | **8** |
| C16 `registered` events | **98** = 97 token activations + 1 public-form |

105 = 97 + 8 ✅ · 98 = 97 + 1 ✅ — fully reconciled, nothing missing.

### C17 (Group 3) — the token IS landing

7 unique recipients registered, all `via: public_form_submission`, each carrying a `visitor_id`:

```
gabriel.onifade@korkmazcooling.com.ng  06:44  visitor 63782
fadeyiayo@yahoo.com                    07:16  visitor 63788
chisomonwubiko@gmail.com               07:43  visitor 63798
olopade_ronke@yahoo.com                08:18  visitor 63812
ismotech23@yahoo.com                   08:59  visitor 63831
chavadagroup@yahoo.com                 09:03  visitor 63833
chavadagroup@yahoo.com                 09:04  visitor 63836   ← duplicate submission
archpoint2000@yahoo.com                09:35  visitor 63860
```

This confirms the Group 3 chain end-to-end: campaign email → `form-public.html?id=53` with `_lc`
appended → `visitors.js:452-468` writes the event → `not_registered` will skip them at step 2.

**Minor:** `chavadagroup@yahoo.com` submitted twice a minute apart (8 events / 7 unique
recipients), creating two visitor rows. The `/public` upsert should have caught this —
worth a look post-fair, no action now.

## 5. Step-2 fire times — confirmed, and step 1 drains well before

Computed from **actual** step-1 enqueue timestamps + 37 h:

| campaign | step-2 first | step-2 last | (Istanbul) |
|---|---|---|---|
| 16 Activate | **Thu 20 Aug 07:52 Lagos** | Thu 07:57 | Thu 09:52 IST |
| 17 Register | **Thu 20 Aug 08:15 Lagos** | Thu 08:23 | Thu 10:15 IST |

Matches last night's projection exactly. Both ~1 h earlier than the 09:00 intent (activation ran
53–60 min ahead of the assumed times) — recorded, not corrected.

**Drain-vs-fire margin:**

| | |
|---|---|
| C16 step 1 drained | Wed 05:48 IST — **26 h before** its step 2 ✅ |
| C17 step 1 drains | Wed 21:13 IST / 19:13 Lagos |
| C17 step 2 fires | Thu 08:15 Lagos |
| **Margin** | **13.0 hours** ✅ |

**Step 1 will be fully delivered before step 2 fires, on both campaigns.** No overlap.

## ⚠️ The downstream problem is unchanged

Step 2 enqueues **~41,200 emails at once** on Thursday morning. At 28.5/min that is **24.1 hours**
to deliver — running Thu 08:15 → **Fri 21 Aug ~08:20 Lagos**.

Consequences if the rate stays capped:
- Step 2's later recipients receive it a full day after it fires.
- Step 3 (Mon 24 Aug) would likewise take ~24 h, delivering **into Tue 25 Aug — fair opening day.**
- With `EMAIL_WORKER_BATCH_SIZE=10` the same 41,200 drains in **~2.4 h** instead of 24.

**No change made.** Decision point is before Thursday 08:15 Lagos.

---

## Baseline for the next check

| metric | 19 Aug 09:48 IST |
|---|---|
| Rate | 28.5/min |
| Global pending | 19,528 |
| C16 delivered | 14,941 / 14,941 (100%) |
| C17 delivered | 6,738 / 26,262 (25.7%) |
| C16 opened / clicked / registered | 1,217 / 161 / 98 |
| C17 opened / clicked / registered | 321 / 129 / 7 |
| Unsubscribes since launch | 5 |
| Bridge gaps | 0 |
| Failed / stuck | 0 / 0 |

## Open items — flagged, not acted on

1. **Send rate capped at 28.5/min.** `EMAIL_WORKER_BATCH_SIZE` unset → default 1. Matters for
   step 2 (Thu) and step 3 (Mon, delivering into fair opening day).
2. **No bounce visibility in LEENA.** 21,700 emails delivered to a partly-aged list overnight;
   SendGrid dashboard is the only place to see bounce/complaint rates. Unchecked.
3. #54's secondary form link bypasses the token — 1 conversion so far.
4. Duplicate public-form submission created two visitor rows (`chavadagroup@yahoo.com`).

**Nothing was modified. Both campaigns running as activated.**
