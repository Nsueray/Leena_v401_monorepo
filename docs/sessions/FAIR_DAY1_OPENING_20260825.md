# FAIR DAY 1 — opening snapshot
**Taken:** Tuesday **25 Aug 2026, 09:51 Lagos** · read-only · all day boundaries `Africa/Lagos`.

> ⚠️ **This snapshot is from ~9 minutes BEFORE the 10:00 doors.** Everything below is the
> pre-opening picture: exhibitors on stands, staff, and early arrivals. Visitor-side numbers are
> not yet meaningful and the campaign harvest has barely started — see §4.

---

## 0. The five numbers to watch today

Baseline at **09:51**, before doors:

| # | metric | now | note |
|---|---|---:|---|
| 1 | **Check-ins today** | **100** (86 unique) | 91 at 09:51, moving ~1/min |
| 2 | **Registrations today** | **404** | already the 3rd-biggest day, before opening |
| 3 | **Walk-ins (terminal manual)** | **0** | ops is using form 56 instead — see §3 |
| 4 | **Campaign arrivals** | **3** of 1,368 attributed registrants | 0.22% — too early to read |
| 5 | **Conference scans** | **0** | terminal live and tested, nothing issued today |

Supporting: onsite form 56 **41** · cumulative registrations **8,422** · active terminals **6**.

---

## 1. Check-ins

**100 rows / 86 unique visitors today.** First at **08:26:39** — **the gates started 1h33m before
the advertised 10:00 opening**, which is normal for exhibitor move-in, not an error.

```
08:00  n=  9  uniq=  8  ████
09:00  n= 83  uniq= 71  █████████████████████████████████████████
```

Ramping steeply into opening: 9 in the 08:00 hour, 83 in the 09:00 hour.

### By terminal

| terminal | source | rows | unique |
|---|---|---:|---:|
| **T2 Exhibitor** | `terminal` | **53** | 49 |
| T1 Visitor | `terminal` | 38 | 33 |
| T1 Visitor | `badge-print` | 1 | 1 |
| Conference | — | **0** | 0 |

**Exhibitors dominate pre-opening (53 vs 38)** — exactly the expected shape at 09:51.

### Print-vs-scan split — distinguishable, and healthy

Two independent signals exist:

1. **`checkins.source`** — `terminal` (the scan) vs `badge-print` (the popup winning the race).
   **90 : 1.** The popup path fired first exactly once, matching May's 0.4% rate.
2. **`visitors.is_badge_printed`** — set when the badge page loads.
   **78 of 79** checked-in visitors today have it. **1 phantom candidate** (1.3%), against
   May's 0.15% — but on a base of 79, one row is noise, not a trend.

The phantom is **visitor 68532 "Confidence Eke", `visitor_type='visitor'`, scanned at 09:07:02 on
the T2 *Exhibitor* lane** — a visitor in the exhibitor queue whose badge never rendered. Consistent
with a mis-lane scan the hostess abandoned. **The check-in row is permanent** (no undo path).

### Yesterday for context (24 Aug): 77 check-ins

71 T2 Exhibitor + 4 T1 + 2 `conference-cert` — build-up day, plus ops smoke-testing.

## 2. Check-in integrity — clean

| check | result |
|---|---|
| Orphan rows (no visitor) | **0** |
| Unknown/revoked terminal labels | **0** — every row maps to one of the 6 active terminals |
| Cross-expo leakage | **0** |
| **Duplicate-guard violations** (same visitor + terminal < 120 s) | **0** ✅ |
| Repeat scans today (legitimate) | 8 visitors |

**The duplicate guard is holding perfectly.** Zero violations across 100 rows.

### 🟠 Fail-closed / retry evidence — and one thing worth a word to the desk

No red-panel retry is directly logged (a failed check-in writes nothing), so the only visible
proxy is repeat-scan bursts. Two patterns stand out:

| visitor | scans | terminals | span |
|---|---:|---|---:|
| **62664** | **7** | T1 **+** T2 | 997 s (16.6 min) |
| 62199 | 2 | T1 **+** T2 | **8 s** |

**Visitor 62199 was scanned at two different terminals 8 seconds apart** — physically impossible
for one person walking between lanes. **Visitor 62664 was scanned 7 times across both lanes in 17
minutes.** Neither is a duplicate-guard failure (different terminals, so the guard correctly does
not apply), but both look like **badges being used to test the lanes** — the exact behaviour
flagged in `FAIR_DAY_TOOLS_20260824.md` §D4.

Each test scan is a permanent, un-undoable check-in on a real attendee. **Worth one sentence to
the hostesses now: use the designated test badge, never an attendee's.**

## 3. Registrations today — 404, and walk-ins are flowing through form 56

| source | n |
|---|---:|
| Ads — Pixad/Meta (Zoho form 53) | 234 |
| **Onsite form 56 (public_form)** | **40** |
| Zoho generic (form 53) | 36 |
| Ads — landing page (form 53) | 31 |
| Campaign reactivation tail | 22 |
| Public form 52 — exhibitor | 15 |
| Public form 53 direct | 11 |
| Ads — email marketing | 7 |
| Conference form 55 | 3 |
| Other | 5 |

### The walk-in question, answered: **0 through the terminal, 41 through form 56**

The terminal's manual-registration path — the one rebuilt last night to work on a terminal key
alone — has **not been used once today**. Ops is instead running the **onsite tablet form (56)**,
which took **41 registrations** before doors.

**This is the better outcome, not a failure.** Form 56 captures phone, city, consent and six
qualification questions; the terminal form has **no phone field at all**. Every one of today's 404
registrations therefore lands with full data, and **the `N/A` / auto-`Nigeria` degradation
predicted in `FAIR_DAY_TOOLS_20260824.md` §C has not occurred** — there are zero `origin='onsite'`
rows to degrade.

The terminal path remains available for the queue-pressure case it was fixed for.

## 4. Campaign harvest — started, far too early to read

| campaign | recipients | registered | **arrived** |
|---|---:|---:|---:|
| 16 Activate | 14,941 | 928 | **3** |
| 17 Register | 26,262 | 302 | 0 |
| 18 Final Push | 14,229 | 232 | 0 |

Arrival rate, all expo-13 registrants:

| cohort | registrants | arrived | rate |
|---|---:|---:|---:|
| **Campaign-attributed** | 1,368 | 3 | **0.22%** |
| **Non-campaign** | 7,057 | 143 | **2.03%** |

⚠️ **Do not read a cost-per-attendee signal from this yet.** The gap is an artefact of *who is in
the building at 09:51*: the 143 non-campaign arrivals are overwhelmingly **exhibitors and staff**,
who were never campaign targets and who arrive hours before visitors. Campaign recipients are
prospective **visitors** — their arrival window starts at 10:00.

**The first honest read is end of day.** Re-run this table at 18:00; the ratio will move sharply.

## 5. Conference — armed and proven, nothing issued today

| | |
|---|---:|
| Certificates today | **0** |
| `conference-cert` check-ins today | **0** |
| Certificates total (expo 13) | 2 — both smoke tests, yesterday |

Both test certificates verified **MP26-branded with no Ghana leak**:

| cert | visitor | issued | branding |
|---|---|---|---|
| 612 | `elan02@elan-expo.com` | 24 Aug 10:03 | ✅ MP26, no leak |
| **614** | `yaprakguzelcik@gmail.com` | 24 Aug **10:29** | ✅ MP26, no leak |

**Cert 614 is ops' own test**, run independently after last night's deploy — so the certificate
path has been validated by someone other than me, end to end, and its email delivered (`status =
sent`). The conference lane is ready; sessions simply have not started.

## 6. System health — clean

| | |
|---|---:|
| `email_queue` **pending** | **0** |
| **failed** (all time) | **0** |
| **processing** (stuck) | **0** |
| Retries (`try_count > 1`) | **0** |
| `error_message` not null | **0** |
| Sent last 60 min | 128 |
| Sent last 15 min | 35 |
| Emails queued today for expo 13 | **454** |

**Badge emails are flowing** — 454 queued today against 404 registrations, the surplus being
certificates and re-sends. Nothing is backed up.

✅ **The 10 stuck emails from §D3 were recovered** — all ten show `status = sent` at
**24 Aug 12:10**. Suer's run of the recovery SQL worked.

**Last 3 hours:** 259 registrations · 100 check-ins · 315 emails sent · **0 duplicate emails** ·
**0 visitors missing a QR code** · 6 active terminals. No anomalies.

## 7. 🔴 Cleanup verification — **NOT done. Test rows are polluting today's counters.**

All five artefacts from last night are still in production:

| artefact | state |
|---|---|
| visitor **67234** (`suer+mrtest@elan-expo.com`) | **STILL PRESENT** |
| visitor **67237** (`suer+mrjwt@elan-expo.com`) | **STILL PRESENT** |
| checkin **20312** (certificate test) | **STILL PRESENT** |
| checkin **20313** (manual-reg test) | **STILL PRESENT** |
| certificate **612** | **STILL PRESENT** |

### What is actually polluted

**Today's opening numbers are clean.** All five rows are dated **24 Aug**, so they sit outside the
Lagos-day filters used throughout this report — today's 100 check-ins and 404 registrations contain
**none** of them.

**Cumulative and yesterday's figures are affected**, mildly: 2 of expo 13's 8,422 visitors and 2 of
its 180 check-ins are mine.

⚠️ **The one that will surface later:** certificates 612 **and 614** are both tests, so the
conference stats page will read **2 certificates issued** before a single real one exists. 614 is
ops' test, not mine — decide separately whether to keep it as evidence the path works.

### Exact SQL

```sql
BEGIN;
DELETE FROM checkins               WHERE id IN (20312, 20313);
DELETE FROM conference_certificates WHERE id = 612;   -- add 614 to also drop ops' test
DELETE FROM visitors               WHERE id IN (67234, 67237);
COMMIT;
```

⚠️ **Do not delete visitor 59725 (`elan02@elan-expo.com`) or 59726 (Yaprak)** — both are real
registration rows that were merely used as certificate test subjects.

⚠️ If check-in 20312/20313 was a visitor's **only** check-in, also clear the rollup, or they stay
flagged `checked_in` and drop out of any "never checked in" mailing:

```sql
DELETE FROM visitor_event_status ves
 WHERE ves.expo_id = 13
   AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = ves.visitor_id AND c.expo_id = 13);
```

**Not urgent before 10:00** — nothing here distorts today's live counters.

---

## Verdict at 09:51

**The system is behaving.** Zero failures anywhere: no queue errors, no orphan check-ins, no
duplicate-guard violations, no missing QR codes, no cross-expo leakage, and last night's stuck
emails recovered. Both new terminals are live, the certificate path has been independently
validated by ops, and registrations are running at 404 before doors.

**Three things to watch as the day develops:**

1. 🟠 **Badges being used to test lanes** — two visitors show implausible multi-lane scan patterns
   (§2). Each is a permanent check-in on a real attendee. One sentence to the desk fixes it.
2. 🟡 **The campaign arrival rate will look terrible until ~11:00** and must not be read before
   evening (§4).
3. 🟡 **Conference stats will show 2 certificates that are both tests** (§7).
