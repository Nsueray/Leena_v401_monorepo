# Fair-day tools audit — A/B/C/D
**Taken:** 2026-08-24, night · **Doors 25 Aug 10:00 Lagos.** Read-only, no code changes.

> ⚠️ **The full text of A and B did not reach me.** The request referenced *"[önceki mesajdaki A
> aynen]"* / *"[önceki mesajdaki B aynen]"*, but no earlier message in this session carried those
> specs — only the bracket hints. Rather than block on fair eve I worked to the hints, and each
> section states the question I answered. **If either interpretation is wrong, the section is
> wrong — say so and I will redo it.** C and D were fully specified and are answered as written.

Severity key: 🔴 blocks or misleads at the gate · 🟠 real gap, workaround exists · 🟡 cosmetic

---

# A. "Missed day 1" email path

**Interpreted as:** *can we email people who registered but did not check in, e.g. on Tuesday
night to pull them back for day 2 — what exists today, end to end?*

## ✅ It exists, end to end, with no code change

`buildVisitorFilter` (`routes/visitors.js:47-55`) already supports a `checkin_status` filter with
five values, and **`POST /api/visitors/bulk-email` reuses the same builder** (`:1127`), so any
filter you can see in the UI you can also send to.

| value | SQL basis | use |
|---|---|---|
| `checked_in_today` | `EXISTS checkins … Lagos date = today` | who is in the hall now |
| `checked_in_cumulative` | `EXISTS visitor_event_status = 'checked_in'` | attended any day |
| `registered_today_no_show` | registered today **AND** no check-in today | same-day drop-off |
| **`never_checked_in`** | `NOT EXISTS visitor_event_status = 'checked_in'` | **← the "missed day 1" pool** |

All five are exposed as radio pills in `visitorlog-paginated.html:248-252` ("Never checked in" is
the last one). The send path is the existing bulk-email modal → template picker → Mode 2 queue
(`visitor_id` + `template_id`), transaction-wrapped, **10,000-row cap** (`:1134`).

**Use `never_checked_in`, not `registered_today_no_show`.** The latter is scoped to people who
*registered* today, so on Wednesday morning it would miss everyone who registered before Tuesday —
i.e. almost the entire pool.

## Verified sound

`visitor_event_status` is **exactly in sync** with `checkins`, so the filter is trustworthy:

| | checkins (distinct visitors) | visitor_event_status |
|---|---:|---:|
| expo 7 (May) | 2,050 | **2,050** ✅ |
| expo 13 | 3 | **3** ✅ |

Date logic uses `AT TIME ZONE 'Africa/Lagos'` — correct for this fair.

## 🟠 Two things to know before using it

1. **The pool tomorrow night will be ~7,245 minus whoever checked in** — today it is 7,245 of
   7,250. The 10,000 cap holds, but only just; a second fair on this list would breach it.
2. **The bulk-send button requires an active filter** (added 7 May as an accident guard), which
   the `never_checked_in` pill satisfies. Do not clear filters before pressing send.
3. 🟡 There is no "day 1 only" filter — `never_checked_in` is cumulative. On Wednesday night it
   correctly means "has not attended at all", which is what you want; there is no way to say
   "came Tuesday but not Wednesday" without SQL.

**Verdict: 🟢 ready. No code needed.** Pick the pill, pick a template, send.

---

# B. Live dashboard audit

**Interpreted as:** *which dashboards will populate correctly from tomorrow's check-ins, and which
numbers will lie?*

All four dashboard endpoints answer **HTTP 200** against expo 13 right now with a live JWT.

| surface | endpoint | state |
|---|---|---|
| Expo stat cards | `GET /api/expos/13/stats` | ✅ populates · **one wrong stat, see B1** |
| Check-in summary | `GET /api/checkins/stats/summary` | ✅ correct |
| Check-in analytics | `checkin-reports.html` | ✅ correct (job-title fix `52cc27e` live) |
| Reports summary | `GET /api/reports/summary` | ✅ populates · timezone caveat B2 |
| Conference sessions | `GET /api/visitors/conference-topics` | ✅ correct |
| Campaign funnel "Checked in" | `campaigns.js:245-255` | ✅ email-join verified |

Live sample, taken tonight: `total_visitors 7250 · visitors_today 574 · total_checkins 16 ·
unique_checkins 3 · checkins_today 3`, and `by_hall {"Hall 1": 16}`.

## 🟠 B1 — the expo stat card's country numbers are wrong

`routes/expos.js:628-629` reads the **JSONB key**, not the column:

```sql
(SELECT COUNT(*) FROM visitors WHERE expo_id=$1 AND custom_fields->>'country' IS NOT NULL) as visitors_with_country,
(SELECT json_agg(DISTINCT custom_fields->>'country') …)                                   as countries
```

| | dashboard says | truth (`visitors.country` column) |
|---|---:|---:|
| Visitors with a country | **437** | **7,249 of 7,250** |
| Distinct countries | **10** | **32** |

This is the same JSONB-key-vs-column defect fixed in `checkinReports.js` on 18 Aug (`52cc27e`), on
an endpoint that was never touched. **Nothing operational depends on it** — badges, exports and
reports all read the column — but it is exactly the sort of number someone screenshots. Treat the
country figures on the expo card as meaningless tomorrow. Post-fair one-liner.

## 🟡 B2 — "today" is UTC on the reports endpoint

`routes/reports.js` uses bare `CURRENT_DATE` (77-88, 195). The database session is **UTC**;
Lagos is **UTC+1**. So `registrations_today` / `checkins_today` roll over at **01:00 Lagos**, not
midnight.

During fair hours (10:00-18:00) the UTC and Lagos dates are identical, so **no visible error while
anyone is watching**. The only wrong window is 00:00-01:00 Lagos, when those counters still show
the previous day. `visitors.js` and `checkinReports.js` use `AT TIME ZONE 'Africa/Lagos'` and are
correct throughout — so the two surfaces can disagree in that hour.

## 🟡 B3 — `by_source` on the check-in summary is the *visitor's* source

`{"public_form":15,"manual":1}` describes how the person **registered**, not how they were checked
in. The check-in's own `source` (`terminal` / `badge-print` / `conference-cert`) is not in that
breakdown. Not wrong, just easy to misread as scanner activity.

**Verdict: 🟢 dashboards are fit for tomorrow**, with the country card ignored.

---

# C. Manual-registration field parity

## C1 — what the manual form renders, and where it comes from

**Entirely hardcoded.** `qrscanner.html` contains **zero** references to `/api/forms`, `fields`, or
any form config — the block at `:164-213` is static markup.

| field | line | required? |
|---|---|---|
| First Name | `:165` | ✅ `required` |
| Last Name | `:169` | ✅ `required` |
| Email | `:174` | ✅ `required` |
| Company | `:178` | ✅ `required` |
| **Why manual?** | `:194` | ✅ `required` (+ free text if "Other") |
| Visitor Type | `:182` | optional, defaults **Visitor** (7 options) |
| **Job Title** | `:209` | ❌ **optional** |
| **Country** | `:213` | ❌ **optional** |
| Phone / City / Nature of business | — | ❌ **do not exist** |

## C2 — 🟠 Yes. A hostess can submit without fields ops made mandatory

Form 53 (public visitor registration) marks **10 fields required**:
`name, last_name, title (job title), company, email, mobile, city, country,
nature_of_your_company, agree`.

| ops requires on form 53 | manual form |
|---|---|
| Job Title | **optional** → silently `'N/A'` |
| Country | **optional** → silently `'Nigeria'` |
| Mobile phone | **field absent** → stays NULL |
| City | **field absent** → NULL (no column; lives in `custom_fields`) |
| Nature of your company | **field absent** → NULL |
| Consent (`agree`) | **field absent** → never recorded |

Form 56 (the new onsite form) requires the same set **plus six qualification questions**, and it
is the only path that captures any of them.

## C3 — every silent default

**Frontend** (`qrscanner.html:696-700`):

| field | default |
|---|---|
| `job_title` | **`'N/A'`** — a literal string, not blank |
| `country` | **`'Nigeria'`** |
| `origin` | `'onsite'` (hardcoded) |
| `source` | `'manual'` (hardcoded) |

**Backend** (`routes/visitors.js` `/manual`): `email` is the **only** hard requirement.
Everything else coalesces — `name/last_name/company/job_title/country → ''`,
`visitor_type → 'visitor'`, `origin → 'onsite'`, `source → 'manual'`. Since last night's change,
terminal mode additionally **forces** `expo_id`/`organizer_id` from the terminal row and clamps
`visitor_type` to the seven form values.

⚠️ **`'N/A'` is the one that hurts.** It is not empty, so every "is job_title missing" check —
exports, reports, the badge's `displayJobTitle` guard — treats it as a real value. **A walk-in who
skips Job Title gets a badge that literally prints `N/A`.**

## C4 — measured

| | |
|---|---:|
| **expo 7 (May) manual rows** | **0** ✅ confirmed — the path has never been used in production |
| expo 13 manual rows | 2 (both mine, tonight's tests) |

Test row **67234**: `job_title='QA'` · `country='Nigeria'` · **`phone=NULL`** ·
`custom_fields={"manual_reason":"retry sim"}`. Country was **defaulted, not chosen** — the request
never sent one.

**Pre-registered baseline on expo 13 (n=7,246):** `company 100%` · `country 100%` ·
`phone 99.8%` · `job_title 98.7%`.

## C5 — 🟠 Verdict and the one-line mitigation

Walk-ins will be **structurally poorer than every other row on this expo**, in a way that is
invisible in aggregate because the defaults look like data:

- **phone: 0%** against a 99.8% baseline — walk-ins become unreachable for any post-fair follow-up
- **country**: will read `Nigeria` for everyone who skips it, silently inflating the domestic share
- **job_title**: `N/A` where it was skipped — present in exports, printed on the badge
- **city / nature of business / consent**: absent entirely

Volume is the saving grace: May produced **0** manual rows, so this is likely tens, not thousands.

> **Crib sheet line for the hostess desk:**
> **"Always pick the Country and type the Job Title — blank prints `N/A` on the badge. If they have
> a phone number, send them to the onsite tablet (form 56) instead of typing it here."**

Form 56 is the freeze-compatible answer for anyone who is not in a hurry: it captures phone, city,
consent and the six qualification questions. The terminal's manual path is the *fast* lane, and it
should be used when speed matters more than completeness.

---

# D. Scan-without-print = phantom check-in

## D1 — 🔴 Yes, the row is written. But there **is** a distinguishing signal.

**Confirmed from code.** `qrscanner.html:612-620` awaits `performCheckin()` → `POST
/terminal/checkin` → `INSERT INTO checkins` (`terminalCheckins.js:455`), and **only then**
`openBadgeAndReset()`. A scan that resolves a visitor writes the check-in **before** the badge
window exists. If the hostess closes the popup, cancels the print dialog, or scanned the wrong
person, **the `checkins` row stays.**

Last night's fail-closed reorder did not create this — the pre-existing code also checked in before
opening the popup (`:612` then `:630`). What changed is that the check-in is now *guaranteed* to
have succeeded before the badge appears.

**The signal exists and I was wrong to imply it might not.** `POST /terminal/badge-print`, which
`badge.html:259` fires on load, writes:

```sql
UPDATE visitors SET is_badge_printed = TRUE, badge_printed_at = NOW() WHERE id = $1
```
(`terminalCheckins.js:319-322`)

So `is_badge_printed = false` on a checked-in visitor means **the badge page never even loaded**.

⚠️ Two limits, both real:
- it is a flag **per visitor, never reset** — it answers "did a badge ever render for this person",
  not "did it render for this scan"
- it means the **page loaded**, not that **paper came out**. A cancelled print dialog still sets it.

## D2 — 🔴 No undo path. Anywhere.

Measured: **zero** `router.delete` handlers in `routes/checkins.js`, no delete endpoint in
`checkinReports.js` or `terminalCheckins.js`, and no `deleteCheckin`/`removeCheckin` affordance in
any page under `public/`.

The **only** `DELETE FROM checkins` in the entire codebase is `routes/expos.js:548` — part of
**deleting the whole expo**. There is no per-row undo at any granularity.

**A mis-scan is therefore permanent until someone runs SQL in Render Shell.**

## D3 — How big was this in May: **3 in 2,050 (0.15%)**

| expo 7 (May) | |
|---|---:|
| Check-in rows | 2,223 |
| Distinct visitors checked in | **2,050** |
| …with `is_badge_printed = TRUE` | **2,047 (99.85%)** |
| …with `is_badge_printed` false/null | **3** |

So at most **3 people** were scanned without a badge page ever rendering. This is an **upper
bound**, not an exact count, because of the per-visitor-flag limit in D1: a visitor scanned twice
where only one scan produced a badge still shows `TRUE`. Within that limit, phantom check-ins were
**negligible in May** — the fear is real but the observed rate is 0.15%.

## D4 — Freeze-compatible mitigation

**The instruction — "never scan a real badge to test":**

> **X = the designated test badge.** One disposable visitor is created for testing; every "does the
> scanner work?" check uses **that** badge and no other. Its check-ins are deleted nightly.
> **Never scan an attendee's badge to test anything** — it checks them in and there is no undo.

A re-scan is **not** a safe test: it is duplicate-safe only within **120 seconds on the same
terminal**, so testing on a real attendee tomorrow morning who was scanned yesterday writes a
genuine extra row.

Tonight's test visitor **67234** (`suer+mrtest@elan-expo.com`, QR `6f23a4e3-…`) can serve as the
designated test badge if it is **not** deleted — otherwise create one before doors.

**Nightly cleanup template** — delete a known-bad check-in by visitor + time window. Always run the
SELECT first; there is no undo for the undo:

```sql
-- 1. LOOK
SELECT c.id, c.visitor_id, v.name, v.last_name, v.email, c.terminal,
       c.source, c.checkin_time AT TIME ZONE 'Africa/Lagos' AS lagos_time
FROM checkins c JOIN visitors v ON v.id = c.visitor_id
WHERE c.expo_id = 13
  AND v.email = 'PUT_EMAIL_HERE'
  AND c.checkin_time AT TIME ZONE 'Africa/Lagos'
      BETWEEN '2026-08-25 09:00' AND '2026-08-25 10:00'
ORDER BY c.checkin_time;

-- 2. DELETE by the explicit ids from step 1 — never by the predicate
BEGIN;
DELETE FROM checkins WHERE id IN (/* ids */);
-- If this was their ONLY check-in, also clear the rollup:
-- DELETE FROM visitor_event_status
--  WHERE visitor_id = /* id */ AND expo_id = 13
--    AND NOT EXISTS (SELECT 1 FROM checkins WHERE visitor_id = /* id */ AND expo_id = 13);
COMMIT;
```

⚠️ **`visitor_event_status` does not clean itself up.** Deleting the last check-in leaves the
person flagged `checked_in`, which would wrongly exclude them from A's `never_checked_in` mailing.

**Find candidates at end of day** — checked in but no badge ever rendered:

```sql
SELECT c.visitor_id, v.email, count(*) AS checkins
FROM checkins c JOIN visitors v ON v.id = c.visitor_id
WHERE c.expo_id = 13 AND COALESCE(v.is_badge_printed, false) = false
GROUP BY 1, 2 ORDER BY 3 DESC;
```

On May's data that query returns **3 rows out of 2,050**. Expect a similarly short list.

## D5 — Post-fair backlog one-liners

- **Per-check-in print signal**: add `checkins.badge_printed_at`, set by `/terminal/badge-print`
  matching on the check-in it deduped against — turns D3's per-visitor upper bound into an exact
  per-scan measurement.
- **Undo**: `DELETE /api/checkins/:id` (JWT, expo-scoped, soft-delete preferred) plus a row action
  in `checkins.html` — today a mis-scan needs Render Shell.
- **Test mode**: a `?test=1` flag on the scanner that skips the `checkins` INSERT and watermarks
  the badge, removing the need for a designated test badge at all.

---

# Summary

| | severity | state |
|---|---|---|
| A — missed-day-1 mailing | 🟢 | works today, use the **Never checked in** pill + bulk email |
| B — dashboards | 🟢 | all populate; **ignore the expo card's country numbers** (🟠 B1) |
| C — manual field parity | 🟠 | walk-ins lose phone/city/consent, and default `N/A` / `Nigeria` — crib-sheet line in C5 |
| D — phantom check-ins | 🔴 no undo · 🟢 rate | irreversible without SQL, but May ran at **0.15%**; designated test badge + nightly query |

**Nothing here needs code before 10:00.** The two items worth putting on paper for the desk are
C5's crib-sheet line and D4's "never scan a real badge to test".
