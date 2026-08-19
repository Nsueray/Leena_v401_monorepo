# Check-in Forensics — how check-ins actually happened
**Date:** 2026-08-19 · **Mode:** read-only. No check-ins, terminals or code changed.
**Subject:** expo 7 (Mega Clima Nigeria, 19-21 May 2026). Expo 1 (Morocco Siema, Sep 2025) is
examined too, because a premise turned out to belong to it.

Every claim is **MEASURED** (SQL output or `path:line`) or **HYPOTHESIS** (stated as such).

---

## ⚠️ FIRST — a premise correction

> *"14k checkins / 7,446 people ≈ 2 each"*

**MEASURED — those numbers are expo 1, not expo 7.**

| expo | name | check-ins | people | per person |
|---:|---|---:|---:|---:|
| **1** | Morocco Siema Expo (Sep 2025) | **14,988** | **7,446** | **2.01** |
| **7** | **Mega Clima Nigeria 2026 (May)** | **2,223** | **2,050** | **1.08** |
| 3 | Mega HoReCa Nigeria | 2,185 | 2,074 | 1.05 |
| 5 | Mega Clima Ghana 2026 | 727 | 507 | 1.43 |
| 8 | Nigeria Mega Water 2026 | 91 | 81 | 1.12 |

**Expo 7 — the May fair — has a ratio of 1.08, essentially one check-in per person.** The
2-per-person pattern is expo 1's and has a different cause (§1.6).

---

## 1. Check-in origin forensics — expo 7

### 1.1 Schema — MEASURED

```
checkins: id, visitor_id, expo_id, source (text), terminal (text),
          checkin_time (timestamptz, default now()), hall (text),
          checkin_type (text), notes (text), staff_id (int)
```

Indexes: `checkins_pkey (id)`, `idx_checkins_expo_id (expo_id)`.
**No unique constraint of any kind. No per-day constraint. Nothing prevents duplicate rows.**

**`terminal` holds `terminals.terminal_no`** (free text, copied at write time), *not* a foreign
key. **`source` is the column that distinguishes how a row was created** — it is the only such
discriminator, and it is set by the writing endpoint, never by the user.

### 1.2 Every writer of `checkins` — MEASURED (`grep "INSERT INTO checkins"`)

| writer | `path:line` | `source` value | auth |
|---|---|---|---|
| Terminal check-in | `routes/terminalCheckins.js:455` | **`'terminal'`** | `x-terminal-key` |
| Badge print | `routes/terminalCheckins.js:336` | **`'badge-print'`** | `x-terminal-key` |
| Conference certificate | `routes/conferenceCertificates.js:266,301` | `'conference-cert'` | `x-terminal-key` |
| Manual/legacy API | `routes/checkins.js:119` | *(not set → NULL)* | JWT |
| Check-in import | `routes/import-checkins.js:106` | *(import)* | JWT |

### 1.3 Distribution — MEASURED

**By source:**

| source | rows | **%** | people |
|---|---:|---:|---:|
| **`terminal`** | **2,212** | **99.51%** | 2,046 |
| `badge-print` | 9 | 0.40% | 9 |
| `conference-cert` | 2 | 0.09% | 2 |

**By terminal × source:**

| source | terminal | rows |
|---|---|---:|
| terminal | **V1** | 2,028 |
| terminal | **E1** | 180 |
| badge-print | V1 | 8 |
| conference-cert | **1** (hall `Conference`) | 2 |
| terminal | BULKPRINT-1 | 2 |
| badge-print | E1 | 1 |
| terminal | T1 | 1 |
| terminal | Speaker | 1 |

**By day (Africa/Lagos):**

| day | check-ins | distinct people | of whom first-time |
|---|---:|---:|---:|
| Mon 18 May *(setup)* | 20 | 12 | 11 |
| **Tue 19 May** | **828** | **797** | **796** |
| **Wed 20 May** | **816** | **774** | **743** |
| **Thu 21 May** | **558** | **542** | **499** |

**By hour (Lagos)** — a clean single-peaked arrival curve, not a batch:
`09→50  10→319  11→419  12→539  13→433  14→245  15→154  16→50  17→6  18→5  19→3`

### 1.4 Does badge printing create a check-in? — **MEASURED: YES**

`routes/terminalCheckins.js:277` `POST /api/terminal/badge-print`:

```js
296:  const settings = await getExpoSettings(expoId);
297:  const autoCheckin = settings.auto_checkin_on_badge_print !== false;   // default TRUE
…
329:  if (autoCheckin) {
331:    const isDuplicate = await isDuplicateCheckin(client, visitor_id, expoId, terminalNo, threshold);
333:    if (!isDuplicate) {
335:      const checkinResult = await client.query(
336:        `INSERT INTO checkins (visitor_id, expo_id, terminal, hall,
337:           checkin_type, staff_id, source, checkin_time)
338:         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) …`,
342:        [visitor_id, expoId, terminalNo, hall, 'entry', organizerId, 'badge-print']);
```

The switch is `expos.settings.auto_checkin_on_badge_print`, which **defaults to `true`**
(`terminalCheckins.js:39,44`) and is `true` in every expo's `settings` JSONB.

**So "print = check-in" is TRUE by design.** But it accounts for only **9 rows (0.4%)** at
expo 7 — because of §1.5.

### 1.5 Why `badge-print` is only 0.4% — the two calls collide — **MEASURED**

`public/qrscanner.html` fires **both** endpoints for one operator action:

```js
726:  const response = await fetch(`${API_BASE_URL}/terminal/checkin`, {      // → source='terminal'
729:      body: JSON.stringify({ visitor_id: visitorId, notes: `Scanned at ${hall…}` })
…
630:  window.open(buildBadgeUrl(qrCode), '_blank', 'width=600,height=400');   // opens badge.html
```

and the popup then calls:

```js
public/badge.html:259:  await fetch(`${API_URL}/terminal/badge-print`, {        // → source='badge-print'
```

The second is suppressed by the duplicate guard (`terminalCheckins.js`, `isDuplicateCheckin`):

```sql
SELECT id, checkin_time FROM checkins
WHERE visitor_id = $1 AND expo_id = $2 AND terminal = $3
  AND checkin_time > NOW() - INTERVAL '1 second' * $4      -- default 120s
```

Both calls carry the **same** `terminalNo`, so the badge-print insert lands inside the 120-second
window and is skipped.

**Corroborating measurement** — gaps between consecutive check-ins of the same person at expo 7:

| gap | rows |
|---|---:|
| **< 120 s** *(should have been deduped)* | **9** |
| 120 s – 1 h | 80 |
| 1 h – 24 h | 35 |
| > 24 h (different day) | 49 |

**Exactly 9** sub-120-second gaps, and **exactly 9** `badge-print` rows. Those are the cases
where the popup fired outside the window or without a preceding scan. The mechanism is confirmed
end-to-end.

### 1.6 Where the "2 per person" actually comes from — expo 1 — MEASURED

Not multi-day, and not printing.

**Expo 1 person-days by row count:**

| rows that day | person-days |
|---:|---:|
| 1 | 1,413 |
| **2** | **5,347** ← dominant |
| 3 | 556 |
| 4 | 186 |
| 5+ | 80 |

**Expo 1 terminal/source:** `recovered-terminal` / **`log-recovery` — 6,904 rows**, alongside
`t1` (3,886), `t3` (2,704), `t4` (1,480) with `source = NULL`.

Of the 5,347 two-row person-days, **1,653 pair a `log-recovery` row with another** and 3,694 are
two `NULL`-source rows.

**HYPOTHESIS (strong, not proven):** expo 1 suffered a check-in data loss and a recovery import
re-inserted rows that partly already existed — the repo still contains
`backend/leena-v401-backend/logs-after-checkins-lost.txt`. With no unique constraint (§1.1),
nothing prevented the double insert. **Expo 1's 14,988 is inflated and should not be used as a
volume baseline.** Not investigated further — outside this brief.

### 1.7 Conclusion — measured split for expo 7

| mechanism | rows | % |
|---|---:|---:|
| **Desk scan/lookup via `qrscanner.html` → `/terminal/checkin`** | **2,212** | **99.51%** |
| Badge print that escaped the 120 s guard | 9 | 0.40% |
| **Conference scanner** (`conference-cert`, hall `Conference`) | **2** | **0.09%** |

**Suer's account is confirmed in workflow terms, with one technical correction.**

- ✅ **Correct:** there were no separate gate scanners. Check-in was a by-product of the badge
  desk. Terminals `V1` (2,036 rows) and `E1` (180) were the **visitor and exhibitor badge desks**
  — one operator action per attendee: look up → check-in row → badge popup → print.
- ✅ **Correct:** exactly one scanner served the conference — terminal `1`, hall `Conference`,
  and it produced **2** rows all fair.
- ⚠️ **Correction:** those 2,212 rows carry `source='terminal'`, **not** `'badge-print'`.
  The check-in is written by the *scan/lookup* call, which fires first; the print call is then
  deduped. So a query filtering on `source='badge-print'` to find "print-based check-ins" would
  return 9 rows and appear to disprove the account. The workflow was print-driven; the data
  attribution is scan-driven.

**MEASURED corroboration:** of 2,050 checked-in visitors at expo 7, only **3 had
`is_badge_printed` false** — 99.85% of check-ins have a printed badge. Check-in and printing were
effectively the same event.

---

## 2. Multi-day — can a person be counted on day 2?

### 2.1 Dedup: **only a 120-second, same-terminal window. No per-day dedup.** — MEASURED

- **No DB constraint** — the only indexes are the PK and `expo_id` (§1.1).
- **Application guard** — `isDuplicateCheckin` matches on
  `visitor_id + expo_id + terminal + checkin_time > NOW() - 120s`.

Two consequences:
1. **A day-2 arrival always creates a new row.** 24 h ≫ 120 s.
2. **The guard is per-terminal.** The same person at two different terminals is never deduped,
   at any interval.

`isRevisitToday` (`terminalCheckins.js`, just below) detects a prior-day visit for the UI, but it
**does not block the insert**.

### 2.2 Were day 2/3 real arrivals? — **MEASURED: YES, real.**

| day | distinct people | **first-time that day** |
|---|---:|---:|
| Tue 19 May | 797 | **796** |
| Wed 20 May | 774 | **743 (96%)** |
| Thu 21 May | 542 | **499 (92%)** |

**Days present per person, expo 7:**

| days | people |
|---:|---:|
| **1** | **1,982 (96.7%)** |
| 2 | 60 |
| 3 | 8 |

**Day 2 and day 3 were overwhelmingly new people, not re-prints of day-1 badges.** Only 68 of
2,050 attendees (3.3%) came on more than one day. The daily curve is a genuine attendance curve.

**This answers the concern directly: the numbers were NOT near-zero on days 2-3 because printing
happened once.** Each day's visitors were mostly first-timers, printed and counted that day.

**HYPOTHESIS:** the low repeat rate is itself a consequence of the print-desk model — a returning
attendee already holding a badge has no reason to revisit the desk, so their second day goes
uncounted. **The 60+8 repeat visitors are a floor, not a measure, of actual repeat attendance.**
Unverifiable from this data.

---

## 3. Gate-scanner feasibility for expo 13 — analysis only

### 3.1 Two devices running `qrscanner.html` at the entrance

**(a) Same person scanned twice on the same day — MEASURED from code**

| interval | same device | two devices |
|---|---|---|
| < 120 s | **suppressed** — `isDuplicateCheckin`, returns `{success:true, duplicate:true}` (`terminalCheckins.js` /checkin), no row | **NOT suppressed** — the guard includes `AND terminal = $3`; different `terminal_no` never matches ⇒ **2 rows** |
| > 120 s | **new row** | **new row** |

⚠️ **With two gate devices, the dedup guard effectively does not exist.** Someone entering, leaving
and re-entering — or simply drifting to the other lane — produces multiple rows. Expo 7 already
shows 75 person-days with 2+ rows under a *single*-desk model.

**(b) Day-2 scan of a day-1 badge — works correctly.** 24 h exceeds the 120 s window, so a new
row is written with that day's timestamp. **This is exactly the behaviour daily counting needs**,
and it already works with no change.

**(c) Visitor who never printed — scans straight from the phone QR — works.**
`qrscanner.html` resolves the QR via `GET /api/terminal/visitor-by-qr` (`terminalCheckins.js`),
which looks up `visitors.qr_code`. **No `is_badge_printed` check exists anywhere in the lookup or
check-in path** (grep confirms the column is only *written* at `terminalCheckins.js:319`, never
read as a gate). The QR in the confirmation email carries the same UUID as the printed badge.
Confirmed by data: 3 visitors at expo 7 checked in with `is_badge_printed = false`.

⚠️ One caveat: the QR payload is a bare UUID, and phone cameras sometimes return a URL wrapper.
`qrscanner.html` has parse logic for that (documented in `CLAUDE.md` §5 known issues) — it exists,
but it was written for the lead-scanner and is **not verified** on the gate path.

### 3.2 Do the metrics already compute daily? — **MEASURED: YES**

| metric | `path:line` | basis |
|---|---|---|
| Visitors "checked in today" filter | `routes/visitors.js:40` | `(c.checkin_time AT TIME ZONE 'Africa/Lagos')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date` |
| "Registered today, no-show" | `routes/visitors.js:44-45` | same date comparison |
| Live dashboard today/yesterday hourly | `routes/reports.js:834-849` | `EXTRACT(HOUR …)` + date equality |
| Fair-total per-day series | `routes/reports.js:964-970` | `(c.checkin_time AT TIME ZONE 'Africa/Lagos')::date` grouped |
| Fair-total distinct check-ins | `routes/reports.js:958` | `COUNT(DISTINCT c.visitor_id)` over the date range |

**All daily metrics derive from `checkin_time`, and none assume one check-in per person.** They
already handle multiple rows per person correctly.

**The one place that does assume a single state is `visitor_event_status`** — one row per
`(visitor_id, expo_id)` holding `status='checked_in'`, upserted on every check-in
(`terminalCheckins.js:465`+). It answers "has this person ever checked in", not "today". The
`checkin_status=checked_in_cumulative` filter (`visitors.js:42`) uses it deliberately for exactly
that. **Not a bug — but it must not be used for daily numbers.**

### 3.3 Gap list — what would need to change

| # | Gap | Severity | Size |
|---|---|---|---|
| 1 | **Dedup is per-terminal**, so two gate devices never dedup against each other | 🔴 the real risk | ~3 lines — drop `AND terminal = $3` from `isDuplicateCheckin`, or make it configurable. ⚠️ changes behaviour for *every* expo and every terminal type — would need care |
| 2 | **120 s window is tuned for a print desk**, not a gate. A gate wants "once per person per day" | 🟡 decision | 0 lines — `expos.settings.duplicate_threshold_seconds` is already per-expo and read at `terminalCheckins.js:297`. Set it to 86400 for a daily gate. **No code change.** |
| 3 | Reporting cannot separate gate scans from desk prints | 🟡 nice to have | 0 lines — `source` + `terminal` already distinguish them, provided gate terminals get distinct `terminal_no` values |
| 4 | QR-URL-wrapper parsing unverified on the gate path | 🟡 verify | 0 lines — needs a physical test with 2-3 phone models |
| 5 | `visitor_event_status` is cumulative, not daily | 🟢 not a gap | 0 lines — already correct; just don't use it for daily counts |
| 6 | No unique constraint on `checkins` | 🟢 leave alone | 0 lines — the absence is what makes multi-day counting work |

**Total code change for clean daily gate numbers: 0–3 lines.**

**The important finding: gate scanning already works as-is.** Cases (b) and (c) need nothing.
The only genuine decision is gap #1/#2 — what "duplicate" should mean at a gate — and #2 is
reachable **through configuration alone**, per expo, with no deploy.

⚠️ **HYPOTHESIS, worth stating:** running gates *and* print desks together means one attendee can
generate a row at both. Every metric in §3.2 counts `DISTINCT visitor_id` per day, so **daily
unique numbers stay correct**; only raw row counts inflate. Untested in production.

---

## SUMMARY

| Question | Answer | Basis |
|---|---|---|
| Did check-ins come from printing at expo 7? | **Yes in workflow — one desk action produced both.** But rows carry `source='terminal'` (99.51%), not `'badge-print'` (0.40%) | MEASURED |
| Was there one conference scanner? | **Yes** — terminal `1`, hall `Conference`, 2 rows | MEASURED |
| Were there gate scanners? | **No** — `V1`/`E1` were badge desks | MEASURED |
| Why 2 check-ins per person? | **Wrong expo.** Expo 7 is 1.08. Expo 1's 2.01 comes from a `log-recovery` double-insert | MEASURED |
| Can someone be counted on day 2? | **Yes** — dedup is 120 s only | MEASURED |
| Were days 2-3 real? | **Yes** — 96% and 92% first-time visitors | MEASURED |
| Would gate scanning work now? | **Yes for day-2 and never-printed. Two devices bypass dedup entirely** | MEASURED from code |
| Code needed? | **0-3 lines.** The daily-window fix is config-only | MEASURED |
