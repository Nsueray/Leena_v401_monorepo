# DAY 1 CLOSING — Nigeria Mega Project Expo 2026
**Taken:** Tue **25 Aug 2026, 20:44 Lagos** · read-only · `Africa/Lagos` throughout.
Gates ran **08:26 → 17:18**. Prior: `DAY1_MIDDAY_20260825.md`.

---

# 0. 🔴 The two segment sends — **the mail went out; the "Failed" count is real but wrong**

## Verdict first

> **All 9,286 emails were sent successfully. Nothing needs resending — and a resend would
> double-mail 9,286 people.** The "Failed" counter is not mislabeled: the backend genuinely
> returned `total_failed = 1102` and `8184`. It counted a **logging** failure that happens
> *after* a successful send.

## The mechanism, from code

`routes/emailSegments.js:160-183`, per recipient:

```js
const success = await sendEmailWithReplyTo(...);   // ← the email IS SENT here
if (success) { totalSent++; } else { totalFailed++; }

await pool.query(                                   // ← this THROWS, every time
  `INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient,
     recipient_email, recipient_name, subject, status, visitor_id, created_at) …`);

await new Promise(r => setTimeout(r, 300));         // ← never reached
```

caught at `:188` by `catch (err) { totalFailed++; … }`, whose fallback INSERT (`:195`) repeats the
**same broken column list** and is swallowed at `:209`.

**The column list does not match the table.**

| INSERT uses | exists in `email_logs`? |
|---|---|
| `organizer_id, template_id, expo_id, visitor_id, status` | ✅ |
| `recipient, recipient_email` | ✅ |
| **`recipient_name`** | ❌ |
| **`subject`** | ❌ |
| **`created_at`** | ❌ (column is **`sent_at`**) |

Actual schema: `id, organizer_id, expo_id, visitor_id, template_id, email, status, message,
sent_at, recipient, recipient_email`. Three missing columns ⇒ **PostgreSQL `42703`** on every row.

### The arithmetic proves the sends succeeded

Per recipient there are only two possible paths:

| SendGrid result | counters |
|---|---|
| success | `sent+1`, then INSERT throws → `failed+1` |
| failure | `failed+1`, then INSERT throws → `failed+1` (**+2**) |

Yaprak saw **Sent 1102 / Failed 1102** and **Sent 8184 / Failed 8184** — *exactly equal*. Had even
one send genuinely failed, Failed would **exceed** Sent. **Equality is proof that every send
returned success.**

### Frontend counters are honest

`public/email-segments.html:217-218`:
```html
<div class="value">${data.total_sent || 0}</div><div class="label">Sent</div>
<div class="value">${data.total_failed || 0}</div><div class="label">Failed</div>
```
It renders what the API returns. **The bug is in the backend, not the label.**

## 🟠 Two real side effects

1. **Zero database trace.** Both INSERTs throw, and `emailSegments` bypasses `email_queue`
   entirely (direct `sgMail.send`). **9,286 emails exist in no table.** Measured: `email_queue`
   holds **1,817** rows created today and `email_logs` **1,817** — badge/confirmation traffic only.
   The segment sends are invisible to every dashboard, to `email_status` filters, and to any future
   "already mailed?" check. **SendGrid's dashboard is the only record** (G9).
2. **Rate limiting was skipped.** The `300 ms` delay sits *after* the throwing INSERT, so it never
   ran. **9,286 emails were pushed as fast as SendGrid would accept**, instead of over ~46 minutes.
   No bounce visibility means we cannot see the reputation cost, if any.

## Targeting — ✅ correct, with one compliance gap

Replicating both queries against live data:

| | segment query | UI showed |
|---|---:|---:|
| `checked_in` | **1,102** | 1,102 ✅ |
| `not_checked_in` | **8,210** *(now)* | 8,184 *(at send)* |
| Expo 13 visitors with an email | **9,312** | — |

1,102 + 8,210 = 9,312 — **an exact partition, no gaps, no overlap.** The 26-row drift is people who
registered in the ~80 minutes since the send.

**"Not checked in" correctly excludes today's attendees.** The query uses
`visitor_event_status`, and that table is in **perfect sync** — `ves.status='checked_in'` = 1,102 =
`COUNT(DISTINCT visitor_id)` from `checkins`. No attendee received the "missed day 1" mail.

🟠 **Unsubscribed people were NOT excluded.** `routes/emailSegments.js` contains **zero**
references to `email_unsubscribes`. Measured exposure: **5 people** — 3 in the not-checked-in
segment, 2 in checked-in. Small, but they had opted out and were mailed anyway.

## Recovery path

**Do not resend.** The mail delivered.

| item | action | when |
|---|---|---|
| Broken INSERT | Fix the column list — drop `recipient_name`/`subject`, rename `created_at`→`sent_at` — **or** reuse the same INSERT `emailSend.js` uses | post-fair (P1) |
| Missing 300 ms throttle | Moves back into effect automatically once the INSERT stops throwing | same fix |
| No record of 9,286 sends | Backfill from SendGrid Activity export if the audit trail matters | optional |
| Unsubscribe filter | Add `NOT EXISTS (email_unsubscribes)` to both segment queries | post-fair (P1) |

⚠️ **Tell Yaprak tonight: the red "Failed" number is cosmetic. The emails arrived.** Otherwise the
natural reaction tomorrow is to press send again.

---

# 1. Final day-1 scoreboard vs May

| | May (19 May) | **Today** | delta |
|---|---:|---:|---:|
| **Check-ins** | 828 | **1,116** | **+34.8%** |
| **Unique attendees** | 797 | **1,047** | **+31.4%** |
| First / last | 09:32 / 16:46 | **08:26 / 17:18** | +66 min earlier, +32 min later |

| hour | May | Today | cumMay | **cumToday** |
|---|---:|---:|---:|---:|
| 08:00 | 0 | 9 | 0 | 9 |
| 09:00 | 6 | 108 | 6 | 117 |
| 10:00 | 159 | **218** | 165 | 335 |
| 11:00 | 164 | **219** | 329 | 554 |
| 12:00 | **211** ← May peak | 182 | 540 | 736 |
| 13:00 | 159 | 153 | 699 | 889 |
| 14:00 | 77 | **129** | 776 | 1,018 |
| 15:00 | 39 | **67** | 815 | 1,085 |
| 16:00 | 13 | **28** | **828** | 1,113 |
| 17:00 | 0 | 3 | 828 | **1,116** |

**Honest visitor-side split (10:00 onward): May 822 · Today 999 — +177, +21.5%.**

**Both predictions from the morning comparison held.** We were flatter at the peak — 182 against
May's 211, no conference forcing function — and carried a far longer tail: **129 vs 77 at 14:00
(+68%), 67 vs 39 at 15:00 (+72%), 28 vs 13 at 16:00**. May was finished by 16:46; we ran to 17:18.

### Walk-ins and same-day conversion

| | |
|---|---:|
| Registrations today | **1,291** |
| Onsite form 56 | **308** |
| Terminal manual walk-ins | **8** |
| **Same-day registrants who checked in** | **577 of 1,291 = 44.7%** |

⚠️ **44.7% is not comparable to May's 65.4%.** May's figure spans all three days — its day-1
walk-ups had two more days to return. Today's day-1 registrants can still attend Wednesday and
Thursday, so this number will rise. Compare at close of day 3, not now.

# 2. Campaign cohort — the day's verdict

Same-cohort, **pre-registered before today only**:

| cohort | pre-registered | arrived | rate |
|---|---:|---:|---:|
| **Campaign-attributed** | 1,341 | **45** | **3.36%** |
| **Non-campaign** | 6,680 | **425** | **6.36%** |

**Campaign-sourced registrants arrived at 52.8% of the non-campaign rate.** The gap narrowed over
the day (43% at midday → 53% at close) but did not close.

### The honest first read for SIEMA math

- Campaign delivered **1,341 pre-registered** people of whom **45 attended on day 1**.
- Had they behaved like the non-campaign cohort, **85** would have attended — a shortfall of **40**.
- **Per-attendee, campaign registrants are ~1.9× more expensive than the headline registration cost
  implies.**

⚠️ **Three caveats, all material:**
1. **Two days remain.** Campaign recipients skew toward the cold 41k reactivation list; cold
   audiences convert late if at all. Day 3 is the honest measurement point.
2. **Attribution ≠ causation, and there was no holdout.** A `registered` event only means the
   person arrived carrying our token; many are on the ad lists too.
3. Non-campaign includes **exhibitors and staff**, who attend by definition. Their inclusion
   inflates the 6.36% baseline.

**Do not commit SIEMA budget on this number yet.** Re-run Thursday evening.

# 3. Registrations

**1,291 today · cumulative 9,312** (from 8,021 at midnight).

| source | n |
|---|---:|
| Public forms (56 onsite, 52 exhibitor, 53, 55, 57, 58) | **491** |
| Ads — Pixad/Meta (Zoho) | 377 |
| Import — Meta/Pixad batch | 162 |
| Zoho MP26 generic | 114 |
| Ads — landing page | 64 |
| Campaign reactivation tail | 50 |
| Ads — email marketing | 20 |
| **Terminal manual walk-ins** | **8** |
| Other | 5 |

# 4. Conference — 🔴 the page switch **never happened**

**86 check-ins / 85 unique on the Conference lane, every one `source='terminal'`, last at 17:18.
Zero `conference-cert` scans all day. Zero certificates issued.**

Expo 13 still holds **2** certificates — both Sunday smoke tests.

### Tonight's decision, with the split that governs it

| | n |
|---|---:|
| Conference-lane visitors **with** a `conference_topic` | **11** |
| Conference-lane visitors **without** one | **74** |

**Only 11 of the 85 can be certified normally.** The other 74 would each require the **force**
path, which *adds* a topic they never registered for — a data-quality decision, not a mechanical
catch-up.

⚠️ The number grew all day: **9 at midday → 51 at 15:21 → 85 at close.** If the lane runs the same
page tomorrow it repeats at the same scale.

**Fix before Wednesday's doors:**
```
https://leena.app/conference-scanner.html?terminal_key=80b25686-a65e-4811-839a-35ea72024fc5
```
(`conference-scanner.html` + `terminal_key`, **not** the Copy-URL button's `qrscanner.html` — G22.)

### Test-artifact cleanup — still pending

No strays were added today. Same five rows as Sunday:

```sql
BEGIN;
DELETE FROM checkins                WHERE id IN (20312, 20313);
DELETE FROM conference_certificates WHERE id = 612;   -- add 614 to drop ops' test too
DELETE FROM visitors                WHERE id IN (67234, 67237);
DELETE FROM visitor_event_status ves
 WHERE ves.expo_id = 13
   AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = ves.visitor_id AND c.expo_id = 13);
COMMIT;
```
⚠️ Do **not** delete visitors 59725 / 59726 — real rows used as certificate test subjects.
All five are dated 24 Aug, so **day-1 figures in this report are unaffected**.

# 5. System day-1 report card

| subsystem | verdict |
|---|---|
| **Check-in write path** | 🟢 **Flawless** — 1,116 rows, 0 orphans, 0 unknown/revoked terminals, 0 cross-expo leakage |
| **Duplicate guard** | 🟢 **0 violations** across 1,116 scans |
| **Fail-closed scanner** | 🟢 **Zero incident in production on its first live day** |
| **Badge print** | 🟢 Phantom rate **1 in 1,047 = 0.10%**, better than May's 0.15%; the single phantom is the 09:07 mis-lane scan and it never grew |
| **Email queue** | 🟢 1,817 processed, **0 pending / 0 processing / 0 failed / 0 retries** |
| **Segment send** | 🔴 **Delivered but untraceable** — see §0. Not a delivery failure; a logging + counter failure |
| **Terminals** | 🟢 All 6 authenticated correctly · 🔴 conference lane on the wrong page |
| **Uptime** | 🟢 **No incidents.** No deploys during fair hours; no 502 windows |

Final terminal split: **T1 Visitor 677 · T2 Exhibitor 318 · Conference 86 · T4 VIP 31 · T3 Speaker 4.**

⚠️ **The 1,817 email figure does not include the 9,286 segment sends** — they bypass `email_queue`
and their logging throws (§0). True volume today was **~11,100**.

# 6. Day 2 inputs — Wednesday 26 Aug

### May's day 2 (Wed 20 May), for shape

| | |
|---|---:|
| Check-ins / unique | **816 / 774** — 98.5% of its day 1 |
| Window | 09:33 → 16:59, **peak 12:00 (192)** |
| Hourly | 09=21 · 10=85 · 11=162 · **12=192** · 13=164 · 14=99 · 15=65 · 16=28 |
| Registrations | **505** (down from 836) |
| **Returning from day 1** | **30 only (3.9%)** |
| **New faces** | **743 (96%)** |

**The single most important number here: May's day 2 was 96% new people.** Almost nobody came
twice. Day 2 is not a retention exercise — it is a fresh acquisition day, and the "missed day 1"
mail to 8,184 is aimed correctly.

### What to expect

If we hold our +21.5% visitor-side edge: **~950-1,000 check-ins Wednesday**. May's day 2 ≈ its
day 1; ours will likely track ours similarly, with the same flatter-peak/longer-tail shape.

### Pre-position tonight

| # | item | owner |
|---|---|---|
| 1 | 🔴 **Switch the conference lane URL** — or repeat 85 uncertified scans | OPS |
| 2 | 🔴 **Tell Yaprak the "Failed" count is cosmetic** — the mail delivered; do not resend | SUER |
| 3 | 🟠 **Decide the 11-with-topic / 74-without certificate question** | OPS + SUER |
| 4 | 🟡 Gates opened 08:26 today and it worked — keep the same early start for exhibitor move-in | OPS |
| 5 | 🟡 Run the cleanup SQL before Wednesday's counters start | SUER |
| 6 | 🟡 Onsite desk carried **308** of 1,291 registrations — staff it the same or heavier from 10:00 | OPS |

---

## Day 1 in one line

**1,116 check-ins / 1,047 unique — 34.8% above May's day 1 — with zero failures in the check-in
path, zero duplicate-guard violations, and a fail-closed scanner that ran its first production day
without a single incident.** Two things to fix before Wednesday: the conference lane is on the
wrong page, and the segment sender's "Failed" counter is frightening people about mail that
actually arrived.
