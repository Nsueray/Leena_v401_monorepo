# MP26 Campaign Status — 19 August 2026, EOD
**Taken:** 19:20 Istanbul / 17:20 Lagos · **Mode:** read-only.
Record of the numbers as of end of day, day 1 after launch. Fair opens **Tue 25 Aug** (6 days).

Previous: `HEALTH_SNAPSHOT_20260818_NIGHT.md` (18 Aug 21:17) → `MORNING_CHECK_20260819.md`
(19 Aug 09:48) → **this**.

---

## Funnel

| stage | **C16 Activate** | **C17 Register** | combined |
|---|---:|---:|---:|
| Recipients | 14,941 | 26,262 | 41,203 |
| **Delivered** | **14,941** (100%) | **26,262** (100%) | **41,203** |
| Opened | 2,031 (**13.6%**) | 1,340 (**5.1%**) | 3,371 (8.2%) |
| Clicked | 271 (1.8%) | 436 (1.7%) | 707 (1.7%) |
| **Registered** | **190** (**1.27%**) | **23** (**0.09%**) | **213** (0.52%) |
| Checked in | 0 | 0 | 0 — *expo not yet open* |
| Unsubscribed | 6 | 11 | 17 (**0.04%**) |

**Both campaigns fully delivered.** Queue empty, 0 pending, 0 failed.

`delivered_count` is NULL on both — **correct**: the snapshot is taken at completion and both
are still `active` with step 3 pending Monday.

### Reading these numbers

- **C16 (Activate) converts 14× better than C17 (Register)** — 1.27% vs 0.09%. Group 2 already
  had a LEENA record and a one-click prefilled activation link; Group 3 had to fill in a form
  from scratch. The gap is the value of the reactivation token, quantified.
- **C17's open rate (5.1%) is roughly a third of C16's (13.6%).** C17 is a colder audience
  (no prior LEENA record) and its step 1 only finished delivering this morning, so it has had
  less time to accumulate opens. Both effects are real; their split is not separable yet.
- **Unsubscribe rate 0.04%** across 41,203 delivered — well inside tolerance.
- **Open rates are a floor, not a point estimate** — pixel tracking is undercounted by image
  blocking (Apple Mail Privacy Protection, corporate gateways).

## Expo 13 state

| metric | value |
|---|---:|
| Visitors total | **4,055** |
| — via `reactivation_campaign` | **546** |
| Reactivation tokens activated (all waves) | 556 |
| Check-ins | 13 *(test only)* |
| Terminals | 4 |

⚠️ The 546 `reactivation_campaign` visitors exceed the 213 `registered` campaign events because
activations also arrive from the earlier 9–17 Aug reactivation wave, which predates campaign
attribution. **546 is the operational number; 213 is the campaign-attributable subset.**

## Delivery infrastructure

| | value |
|---|---|
| Worker rate | 274.4/min *(was 28.5 before `EMAIL_WORKER_BATCH_SIZE` 1→10)* |
| Queue pending | 0 |
| Failed / stuck / retries / duplicates | 0 / 0 / 0 / 0 |
| Migration 029 | ✅ applied to production |
| Funnel endpoint | live, 380-485 ms end-to-end |

## Next scheduled event

**Step 2 fires Thu 20 Aug — 07:52 Lagos (C16) / 08:15 (C17).**

Condition `not_registered`, so the 213 who already registered are skipped — verified working:
bridge integrity was 100% at the morning check, every activated token carrying its attributed
event.

At 274/min the ~41k step-2 wave drains in **~2.5 hours** rather than the ~24 it would have taken
before the batch-size change. Step 3 follows Mon 24 Aug, one day before the doors open.

## Open before the fair

See `todo.md` → *ACTIVE — owners & deadlines*. The three OPS items due before Monday:

1. T1 Visitor is on a **test badge template** (`test visitor 80x40`)
2. That template has **`show_job_title` OFF** — 1,785 recovered job titles will not print
3. **No conference terminal** — 66 conference registrants have no check-in or certificate path

None of these are campaign problems; all three are gate-readiness.
