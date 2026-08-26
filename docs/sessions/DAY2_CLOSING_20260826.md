# Day 2 Closing — Nigeria Mega Project Expo 2026

**Date:** 26 Aug 2026, snapshot 17:52 Lagos (gates closing/closed)
**Expo:** id=13, Day 2 of 3 (25–27 Aug)
**Mode:** Read-only. All figures from live DB via `RENDER_DATABASE_READONLY_URL`.

---

## 1. Day-2 Scoreboard

### Final check-in totals

| | Scans | Unique visitors |
|---|---|---|
| **Day 1 (25 Aug)** | 1,116 | 1,047 |
| **Day 2 (26 Aug)** | **1,274** | **1,212** |
| **Δ D2 vs D1** | +158 (+%14.2) | **+165 (+%15.8)** |

### Predicted band vs actual

Predicted at 12:48 today: **1,050–1,150** (based on -%6.1 cumulative-through-hour-12 deficit).
Actual close: **1,212 unique — blew past the top of the band by 62 unique (+%5).**
Reason: hours 11–14 all overperformed D1 (11: +18%, 12: +57%, 13: +49%, 14: +28%). The 12:48 read caught the inflection at its start — the afternoon delivered.

### Hourly curve — complete

```
Saat   D1    D2    May D2   Δ D2vsD1
----   ---   ---   ------   --------
08       9     0        0    -100%
09     108    47       21   -%56.5
10     218   174       85   -%20.2
11     219   259      162   +%18.3
12     182   285      192   +%56.6
13     153   228      164   +%49.0
14     129   165       99   +%27.9
15      67    87       65   +%29.9
16      28    28       28     0%
17       3     1        —   -%66
----   ---   ---   ------
TOP   1116  1274      816  +%14.2
```

Peak hour shifted right: D1 peak was hour 10 (218); D2 peak was hour **12 (285)**. Same absolute peak height as D1's peak wasn't matched — beaten. May D2 total was 816 → Nigeria D2 is **+56% ahead of May D2 same-fair-day**.

### Two-day cumulative unique

| Fair | 2-day unique | Δ vs May |
|---|---|---|
| Nigeria D1+D2 | **2,221** | +44% |
| May D1+D2 | 1,541 | baseline |

---

## 2. Registrations Today

**Day total:** 1,028 new visitor rows (vs D1's 1,338 = -%23 registration momentum, expected as pre-fair pool tapers).

**Sources breakdown:**

| Source | Regs |
|---|---|
| public_form | 509 (%50) |
| Nigeria MP26 Visitor Registration - Pixad | 281 (%27) |
| Nigeria Mega Project Expo 2026 (Zoho default) | 132 (%13) |
| Landing Page | 46 (%4) |
| Email Marketing | 32 (%3) |
| reactivation | 23 (%2) |
| manual | 5 (%0.5) |

**Cumulative expo 13 total:** **10,387 registrations**.

### Same-day conversion (registered today AND checked in today)

| Day | Same-day reg | Same-day check-in | Conversion % |
|---|---|---|---|
| D1 | 1,338 | 577 | **43.12%** |
| D2 | 1,028 | **649** | **63.13%** |

**D2 conversion jumped +20 points.** Reading: Day 2 registration surface is dominated by walk-ins registering at the door and going straight in (public_form 50% + Pixad Meta lead-gen 27%). Fewer people register in advance for Day 2; more just show up.

---

## 3. "Missed Day 1" Mail Verdict

**8,184 recipients** sent the missed-Day-1 comeback mail. Full-day read now:

| | Value |
|---|---|
| Yesterday-registered total | 1,338 |
| Returned today | **88** |
| Return rate | **%6.58** |
| May D2 benchmark | %3.9 |
| Our vs May | **+69% ahead** (nearly 2× May's) |

Big afternoon comeback from the midday %2.17 read. The mail (or the fair's own gravity + local WhatsApp buzz) worked — the number is honest at end-of-day.

**Caveat:** these 88 aren't cleanly attributable to the mail alone — the same population also had ambient exposure (WhatsApp, Pixad Meta lead-gen, sales team calls). But %6.58 comeback of yesterday-reg-no-show is a strong number regardless.

---

## 4. Campaign Cohort — Cumulative 2-Day

Campaign-attributed = recipient of that campaign who checked in during D1 or D2.

| ID | Name | Status | Recipients | Reg via _lc | **Arrived 2d** | Arrival % |
|---|---|---|---|---|---|---|
| 16 | MP26 Activate Wave | completed 24 Aug | 14,941 | 992 | **220** | **%1.47** |
| 17 | MP26 Register Wave | completed 24 Aug | 26,262 | 318 | 124 | %0.47 |
| 18 | MP26 Final Activate Push | completed 21 Aug | 14,229 | 237 | **171** | **%1.20** |
| 19 | MP26 Final Register Push | **draft** (never sent) | 25,844 | 0 | 92 | %0.36 (organic overlap) |

**Campaign-attributed 2-day arrivals total: 515** (from campaigns 16 + 17 + 18 that actually sent).
**Non-campaign 2-day arrivals: 2,221 − 515 = 1,706** (~%77 of unique attendance).
**Campaign attribution rate: %23** of unique attendance across 2 days.

**SIEMA math input** (Thursday deadline):
- Best cost efficiency: **Campaign 16 Activate Wave (%1.47)** — targeting people already registered.
- Register Wave conversion is 3× worse (%0.47) — targeting cold prospects, expected but useful benchmark for SIEMA CAC modelling.
- Final Push %1.20 = healthy last-mile — validates the "final push" pattern for SIEMA.

**Campaign 19 never left draft** (updated 21 Aug 19:12, status=draft). If the intent was to send it 26 Aug morning to catch stragglers, that trigger didn't fire. Post-fair: was this deliberate (dropped to save spend) or forgotten?

---

## 5. Ops Sends Today — Full Picture

### 5.1 Campaigns activity: **zero new activity today**

| Campaign | Status | Last updated |
|---|---|---|
| 16 Activate Wave | completed | 2026-08-24 06:58 |
| 17 Register Wave | completed | 2026-08-24 07:25 |
| 18 Final Activate Push | completed | 2026-08-21 20:11 |
| 19 Final Register Push | **draft** | 2026-08-21 19:12 |

No campaign created, activated, edited, or completed on 26 Aug. Yaprak did **not** trigger a new campaign today.

### 5.2 email_queue since midnight — 1,640 sent, all traceable

| Template | Count | Purpose |
|---|---|---|
| **49** (Nigeria MP QR Badge) | **1,002** | Visitor confirmation on registration (matches today's ~1,028 registrations) |
| **NULL (Mode 1 direct HTML)** | **396** | Per-form notification block sends to elif@ + project@ (sales alerts, feature `a91ef7e`) |
| 50 (Nigeria MP Conference Badge) | 171 | Conference visitor confirmations |
| 48 (Nigeria MP Exhibitor Badge) | 39 | Late exhibitor badges |
| 28 (Morocco Siema Exhibitor) | 21 | Morocco expo prep (separate flow) |
| 47 (Morocco Siema Visitor) | 8 | Morocco prep |
| 46 (Mega Clima 2027 Visitor) | 2 | 2027 form testing |
| 24 (Mega Clima 2026 legacy) | 1 | stray |

**Mode 1 subject breakdown (the 396 sales notifications):**
- "Nigeria Mega Project Expo 2026 Conference Registration" — 340 (Yaprak's Conference form high volume)
- "Nigeria Mega Project Expo 2026 Visitor Registration" — 36
- "Morocco Siema Expo 2026 Visitor Registration" — 16
- "Mega Clima Nigeria 2027 Visitor Registration" — 4

**Notification block is working as designed** — sales team getting real-time alerts on every new form submission across all 4 active expo forms.

### 5.3 Segment/Send-Emails page: **NO activity detected**

Query: `email_logs` today with `visitor_id IS NULL` = 396 rows. All 396 match the notification block Mode 1 pattern (recipients elif@ + project@, no visitor context).

If Yaprak had run a segment send or Send-Emails bulk today, those would appear as sgMail direct sends into `email_logs` with sales-team recipients absent — none observed. **Segments page was not used on 26 Aug.**

### 5.4 Unsubscribed exposure today: **ZERO violations**

```
SELECT ... WHERE el.sent_at > eu.created_at AND el.sent_at >= today  →  0 rows
```

Clean day. The 4 violations flagged in yesterday's analysis were all older; no new violations produced by today's traffic.

### 5.5 Reactivation: 23 registrations today came in via `source='reactivation'`

Numbers are queue-driven and normal. No new reactivation batch triggered today.

### 5.6 abimbolaakinkugbe@gmail.com — the reply-request opt-out

**Landed:** id=377, organizer=1, reason=`reply_request`, created_at `2026-08-26 11:43:12`.

Confirmed manual insert by Suer via Render Shell after my earlier miscommunication. Row is live.

---

## 6. Conference

| Metric | Value |
|---|---|
| Certificates issued today | **0** |
| Cumulative certs expo 13 (all days) | **2** (still both smoke tests) |
| Check-in source split today | terminal 1,273 / badge-print 1 / **conference-cert 0** |
| Visitors with `conference_topic` field populated | 379 |
| **3-day certificate backlog** | **377** (379 − 2 smoke tests) |

### Did the page switch happen?

**No** — third day in a row. Zero `conference-cert` source scans on any of D1 or D2. Terminal scanners are still the only lane touching conference visitors. All 377 conference-topic holders will need catch-up cert distribution post-fair (email + certificate URL), matching the plan flagged earlier this week.

**This is now a firm post-fair item** — deferred through the entire fair, so pipe the mailmerge script during the debrief window.

---

## 7. System Day-2 Card

| | Value | Status |
|---|---|---|
| email_queue since midnight | 1,640 sent / 0 pending / 0 failed | 🟢 |
| email_logs failed today | **0** | 🟢 |
| Phantom / dup-guard | 62 duplicate scans (1,274 scans − 1,212 unique = re-scans, expected for lost badges / re-entry) | 🟢 normal |
| Notification block volume | 396 direct sends, 0 failures | 🟢 |
| Unsubscribe violations today | **0** | 🟢 |
| Anything red | — | 🟢 nothing |

**Zero red flags.** Second consecutive day the pipeline held clean under load.

---

## 8. Day 3 (Tomorrow) Inputs

### May D3 pattern (expo 7, 21 May 2026 — same 3-day structure)

| Hour | May D3 scans |
|---|---|
| 09 | 23 |
| 10 | 75 |
| 11 | 93 |
| 12 | **135** ← peak |
| 13 | 107 |
| 14 | 69 |
| 15 | 50 |
| 16 | 6 |
| **Total** | **558 scans / 542 unique** |

### Expected close for Nigeria D3

Nigeria's D1→D2 ratio: **1,047 → 1,212 = +%15.8**.
May's D2→D3 ratio: **816 → 558 = -%31.6** (typical last-day tail).

Two projections:
- **Conservative** (May tail pattern applied to Nigeria's D2 base): 1,212 × 0.68 ≈ **~825 unique**.
- **Optimistic** (Nigeria has outperformed May throughout — +56% at D2): 558 × 1.56 ≈ **~870 unique**.

**Expected close range: 800–900 unique on Day 3.** Peak still 12:00 Lagos. Gates likely quiet after 15:00. 3-day cumulative Nigeria target: **~3,000–3,100 unique** (vs May 3-day 2,099 = +45%).

### The one thing to pre-position tonight

**Deploy the unsubscribe-filter fix.** Reasoning:

1. **Gates closed = zero send activity between now and deploy.** Any hot-fix window is safest right now.
2. **Segments page usage today was zero** (§5.3). Deploying the filter doesn't disrupt any live workflow — Yaprak has not touched that surface all week during the fair.
3. **Tomorrow's segment sends land clean.** Given the SIEMA campaign spins up Thursday and will inevitably use the segments/emailSend surface for follow-ups, tomorrow's exit-Nigeria/enter-SIEMA transition is the natural cutover point.
4. **Reference implementation exists** (`email_worker.js:537-548`) — the fix is a single `isUnsubscribed(email, organizer_id)` helper wired into 3 call sites (`emailSegments.js:35`, `emailSend.js:10, 124`). Estimated ~30 minutes coding + 15 minutes verify.
5. **Compliance clock is running** — 4 documented violations from earlier this week (see `UNSUBSCRIBE_ANALYSIS_20260826.md` §3.2). One Gmail spam complaint from a violation recipient hurts sender reputation across the entire pipeline including the SIEMA sends we haven't sent yet.

If the filter deploy slips past tonight, the SIEMA campaign starts Thursday with the same hole open — and Yaprak's pattern this week suggests she'll blast segments hard once the follow-up phase begins.

**Runner-up pre-position items** (secondary, can wait until Wednesday post-close):
- Certificate mailmerge draft (377 backlog) — no urgency until fair closes fully.
- Campaign 19 status decision (draft with 25,844 recipients queued) — Suer needs to say "delete" or "activate for tomorrow morning".
- Import phone coercion fix (P1 #2) — not fair-blocking but SIEMA-blocking.

---

## TL;DR (one paragraph)

Day 2 closed at **1,212 unique** — blew past the predicted 1,050–1,150 band by +%5 on the strength of an unusually strong 12–14 Lagos window (peak hour 12 at 285 scans, +%57 vs D1). Two-day Nigeria is **2,221 unique** = **+44% ahead of May** at same fair-day. "Missed Day 1" mail delivered %6.58 comeback (2× May's %3.9). Campaigns 16/17/18 all completed, campaign 19 stuck in draft (25,844 waiting recipients), zero new ops sends today, zero segment/emailSend activity, zero unsub violations, zero red on the system card. Conference lane still terminal-only — 377-cert post-fair backlog is now firm. Tomorrow's D3 close projects **800–900 unique** for a 3-day total near 3,050. **The one pre-position tonight: deploy the unsubscribe-filter fix while gates are closed and segments page is untouched — tomorrow's SIEMA transition is the last chance to land it before the surface goes hot.**
