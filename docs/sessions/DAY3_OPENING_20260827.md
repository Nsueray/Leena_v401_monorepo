# Day 3 Opening — Nigeria Mega Project Expo 2026

**Date:** 27 Aug 2026, snapshot 10:22 Lagos (~2h into final day)
**Expo:** id=13, Day 3 of 3 (final)
**Mode:** Read-only.

---

## 1. Last night's deploy

**Unsub-filter commit `8c80c4dae6609b4c5f6a22e9c2932be5b61085d8` pushed 26 Aug 18:43 UTC, Render restarted within ~90s, endpoints healthy** (health rolling, POST returns 401 not 500 → modules loaded).
**Smoke test NEVER RAN** — zero `email_logs` rows for `abimbolaakinkugbe@gmail.com` or `suer+unsubtest@elan-expo.com` after 18:47 UTC. The two curl commands in `DEPLOY_UNSUB_FILTER_20260826.md` are still waiting for your JWT. Filter is live regardless — first live traffic through segments/send-emails paths today will exercise it, but a deliberate two-address confirm is still owed.

---

## 2. Day 3 Scoreboard so far (10:22 Lagos)

### Cumulative
- **63 scans / 59 unique**
- Duplicate scans: 4 (normal re-scan level)

### Hourly, all three days + May D3

```
Saat   D1    D2    D3    May D3
----   ---   ---   ---   ------
08       9     0     4        0
09     108    47    17       23    ← Nigeria D3 at 74% of May D3
10*    218   174    42       75    ← 42 at 10:22, extrapolates ~65 by close
```

*hour 10 partial — 22 min into it. Direct extrapolation: 42 × (60/22) ≈ 115 by 11:00, but empirically the curve steepens further into the hour so 60-70 more likely.

### Vs D2 same hour
- 09: D3 17 vs D2 47 = **-%64**
- 10 (partial): D3 42 vs D2 174 = **-%76**

### Vs May D3 same hour
- 09: D3 17 vs May 23 = -%26
- 10 (partial): D3 42 vs May 75 = **-%44**

**Reading:** Day 3 opening is materially weaker than both prior Nigeria days AND weaker than the May D3 baseline. Nigeria D3 is currently tracking around **55-60% of May D3's pace**.

### On pace for 800-900 band?

**No — not remotely.** At current pace, close projection is **300-400 unique**, ~%40-50 of the predicted band. Reasons:
- Day 2 overperformed (+15.8% vs D1) — likely pulled forward attendance that would have arrived today
- Friday final-day effect is stronger than a normal Wed/Thu D3
- No indication of a mid-morning surge yet — hour 09 was the third-weakest Nigeria hour of the fair so far

**3-day cumulative unique now: 2,274.** Revised final-fair projection: **2,600–2,700** (was 3,000-3,100).

---

## 3. Overnight + morning registrations

Since yesterday 17:00 UTC (18:00 Lagos, gates closed):

| Source | Regs |
|---|---|
| Nigeria MP Pixad | 57 |
| Nigeria MP (Zoho default) | 37 |
| public_form | 35 |
| reactivation | 10 |
| Landing Page | 7 |
| Email Marketing | 5 |
| **Total** | **151** |

Slow relative to D2 morning's flood — ad-driven acquisition (Pixad) still dominant but volume down. Consistent with Day-3 fatigue narrative.

---

## 4. "Missed Day 2" mail — 8,120 recipients

**2-day no-show pool** (registered on or before D2, no check-in D1 or D2) = **8,224 people** — close to your 8,120 figure (difference likely because I'm reading the resolved no-show set, not the exact mail recipient list).

**Returned today: 29 (%0.35)**

Too early to declare — this is the 10:22 read. Yesterday's midday equivalent was %2.17 and the full day settled at %6.58. If the same afternoon-recovery pattern repeats, the number will climb through the day. But given the overall D3 weakness (§2), don't expect to match D2's %6.58 — a landing in the %3-4 range would be a decent outcome and match the May D2→D3 falloff.

---

## 5. Campaign cohort — 3-day cumulative arrivals

| ID | Name | Status | Recipients | Arrived 3d | Δ vs D2 close |
|---|---|---|---|---|---|
| 16 | MP26 Activate Wave | completed | 14,941 | **220** | 0 |
| 17 | MP26 Register Wave | completed | 26,262 | 125 | +1 |
| 18 | MP26 Final Activate Push | completed | 14,229 | **171** | 0 |
| 19 | MP26 Final Register Push | **draft** (never sent) | 25,844 | 93 | +1 |

**Campaign-attributed 3-day total: 516** (was 515 after 2 days — only +1 movement this morning).

Non-campaign cumulative: 2,274 − 516 = 1,758. Campaign attribution rate holds around **%23**.

Campaign 19 still in draft with 25,844 queued recipients — decision point remains open. Post-fair debrief needed.

---

## 6. System card + last-night send exposure

### Today so far (since midnight Lagos)
- email_queue: 141 sent / 0 pending / 0 failed 🟢
- email_logs failed today: 0 🟢
- Duplicate scans: 4 of 63 total (normal) 🟢

### Yesterday (full 26 Aug)
- **1,725 total sends, 1,725 sent, 0 failed** 🟢
- Bounce/complaint keyword scan in `message` column: **0 hits** 🟢
- New unsubscribes last 36h: **7** (organic pace, not a spike) 🟢

**Note on the "10,396 segment sends" figure:** yesterday's total sends across all paths were 1,725. Even generously interpreting "sends" as recipients queued (including notification-block Mode 1), I can't reconstruct 10,396 from the DB. If a large segment blast happened via a channel I can't see (SendGrid dashboard direct?), our-side visibility is limited to `email_logs` and shows no distress signal — no failures, no bounces surfaced in message bodies, no unsubscribe spike. Deliverability read from our side: **clean.**

---

## 7. Five-Number Monitoring Baseline (today)

Peak hour is likely 12:00 Lagos (all three prior days + May D3 all peaked at 12). Watch these five checkpoints:

| Hour | May D3 | **Nigeria D3 target (60% of May)** | Nigeria D3 actual |
|---|---|---|---|
| 09 | 23 | ~14 | ✓ **17** |
| 10 | 75 | ~45 | ⏳ 42 @ 10:22 (partial) |
| **11** | 93 | ~56 | — |
| **12** (peak) | 135 | ~80 | — |
| 13 | 107 | ~64 | — |
| **Total** | **558/542u** | **~340 unique** | — |

**Green:** hitting ≥90% of the "60% of May" line = 340+ unique close = 2,614+ three-day.
**Yellow:** 70-90% of that line = 240-305 close = 2,514-2,579 three-day.
**Red:** below 240 close = below 2,514 three-day (would signal a real problem, not just fatigue).

Currently hour 09 came in **above the target** (17 vs 14 needed), so opening isn't in red. Hour 10 partial is on track. If the noon peak lands at 80-95 the picture is fine; below 65 turns yellow.

The single most informative next data point is the **11:00 hour count** — if it holds ≥50, we're closing near 340; if it drops below 40, expect the 240-280 range and update the three-day total to 2,510-2,550.
