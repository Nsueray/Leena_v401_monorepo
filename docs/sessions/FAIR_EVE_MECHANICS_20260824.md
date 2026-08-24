# MP26 fair-eve mechanics verification
**Taken:** 2026-08-24, evening · **Doors 25 Aug 10:00 Lagos.**
Read-only. Traced against expo 13's actual current config, and validated against
**May's 2,223 real check-ins** (expo 7) wherever the same code ran there.

Prior: `MONDAY_PREFAIR_20260824.md` → **this**.

---

## 1. Print → check-in chain — the SCAN writes it, not the print

**The check-in is written by the scan, before the badge popup opens.** The popup is a second,
independent writer that almost always no-ops.

T1 is terminal **37**, `kind=scanner`, `hall='Hall 1'`, `terminal_no='T1 Visitor'`,
`badge_template_id=12`, `allow_manual_registration=true` — confirmed live via
`GET /api/badge-templates/for-terminal/b3b32aae-…`.

```
hostess presses Enter in the scan box
  qrscanner.html:542   keypress Enter → handleQRScan()
  qrscanner.html:605   GET /api/terminal/visitor-by-qr        (x-terminal-key)
  qrscanner.html:612   if (autoCheckinEnabled && visitor.id)
  qrscanner.html:613       await performCheckin(visitor.id)
  qrscanner.html:726       POST /api/terminal/checkin          ← THE CHECK-IN
     terminalCheckins.js:438  isDuplicateCheckin(...)
     terminalCheckins.js:455  INSERT INTO checkins ... source='terminal'
     terminalCheckins.js:468  UPSERT visitor_event_status → 'checked_in'
  qrscanner.html:630   window.open(badge.html?qr=…&terminal_key=…)   ← display only
     badge.html:259        POST /api/terminal/badge-print       ← SECOND writer
     terminalCheckins.js:332  isDuplicateCheckin(...) → true → no row
```

Both endpoints insert into `checkins` and both run the **same** duplicate guard
(`terminalCheckins.js:53-65`: same `visitor_id` + `expo_id` + **`terminal`** within the
threshold). Because the scan fires ~1 s before the popup, `badge-print` sees the row the scan just
wrote and skips. Net: **exactly one row per scan, `source='terminal'`**.

**Confirmed empirically on May's expo 7** — the same code, the same operating model:

| source | rows | unique visitors |
|---|---:|---:|
| `terminal` | **2,212** | 2,046 |
| `badge-print` | 9 | 9 |
| `conference-cert` | 2 | 2 |

The 9 `badge-print` rows (0.4%) are the cases where the popup won — badge.html opened without a
preceding scan, or the scan-path call failed. **Duplicate-guard failures across all 2,223 rows:
0.** The model is proven, not theoretical.

### Badge fields for a visitor-type record — correct

Template 12 "Standard Badge Template", 75×55 mm landscape, QR 35 mm:
`show_qr ✅ show_name ✅ show_company ✅ show_job_title ✅` (role, phone, country, sector,
badge_id, booth all false).

Expo 13's visitor pool, **6,700 records**: `company` 6,700 (100%), `qr_code` 6,700 (100%),
`job_title` 6,612 (98.7%). The 88 without a job title render **no gap** — `badge.html:368` guards
on `content.show_job_title === true && displayJobTitle`, so an empty value simply omits the line.

Long values wrap rather than overflow (word-break + auto-size, thresholds 15/25): 1,239 companies
over 30 chars, 332 names over 25, 332 job titles over 30. Expect two-line fields on those, not
clipping.

---

## 2. Double-scan — one row, and the hostess sees nothing different

**Same badge, same terminal, twice inside a minute → 1 `checkins` row.** The second call returns
`200 {success:true, duplicate:true, message:"Check-in ignored: duplicate within 120 seconds"}`
(`terminalCheckins.js:438-446`).

**What the hostess sees: the badge popup opens again, and nothing else.** There is no duplicate
warning, no colour change, no message. `performCheckin` (`qrscanner.html:720-735`) only
`console.log`s the result — the `duplicate: true` flag never reaches the UI. This is by design for
speed, but it means a re-scan and a first scan are visually identical.

**Expo 13's setting, read from `expos.settings`:**
```json
{"auto_checkin_on_badge_print": true, "duplicate_threshold_seconds": 120}
```

**Day-2 rescans: no concern.** The window is 120 seconds and it is scoped to
`visitor + expo + terminal`. A Wednesday morning rescan is ~24 h outside it and correctly writes a
new row. May proves this works: **68 expo-7 visitors hold check-ins on 2+ distinct days.** The
120 s window exists only to absorb a double-trigger at the desk, and re-scanning at a *different*
terminal always writes a row regardless of timing.

---

## 3. Walk-in path — works, but **it needs the tablet to be logged in**

Client-side required: First Name, Last Name, Email, Company, and **"Why manual?"**
(`qrscanner.html:154-199`). Server-side, `/api/visitors/manual` requires **email only**
(`visitors.js:494`).

**No phone/job-title trap.** There is no phone field on this form at all, and Job Title is
optional — blank is submitted as the literal `'N/A'` (`qrscanner.html:673`). The `required`
attributes we added in August were on **`reactivate.html`**, a different page; they do not touch
this flow.

The one blocking gate is the reason dropdown: no selection → *"Please select a reason for manual
registration"*; picking **Other** without free text → *"Please specify the reason"*. Both are
one-tap fixes, but the hostess must know the field is mandatory.

End to end it does everything: creates the visitor (upsert on email+expo, QR preserved if they
already exist), returns `qr_code`, checks in via the same `performCheckin`, then opens the badge
popup.

### 🔴 The trap is not a field — it is authentication

| path | needs |
|---|---|
| **Scanning** | `terminal_key` in the URL. Nothing else. `checkRequiredData()` returns early when a terminal key is present (`qrscanner.html:509-512`) — no login redirect. |
| **Manual walk-in** | `localStorage.token` **and** `localStorage.selectedExpoId` (`qrscanner.html:646`), because it posts to `/api/visitors/manual` with `Authorization: Bearer` (`:689`), not the terminal key. |

A tablet opened with only `?terminal_key=…` scans perfectly and then fails on the first walk-in
with **"Missing required data. Please login again."** — mid-queue.

**Fix, tonight, on every tablet:** log in at `leena.app/login.html` as the organizer, pick Nigeria
Mega Project Expo 2026 on the expo screen (this sets `selectedExpoId`), *then* open the scanner
URL. Both credentials live in that browser's localStorage; the JWT lasts 30 days.

⚠️ **This path has never carried a real registration.** Expo 7 (May): **0** rows with
`source='manual'` or `origin='onsite'`, **0** with a `manual_reason`. Expo 13 so far: **0**.
Scanning is battle-tested; the walk-in path is not.

⚠️ **HYPOTHESIS, untested:** the manual path calls `window.open` inside a
`setTimeout(…, 500)` (`qrscanner.html:709`), which breaks the user-gesture chain and may be caught
by a popup blocker. The scan path opens the popup directly (`:630`) and is proven in production.
Worth one dry run per tablet tonight rather than discovering it in the queue.

---

## 4. Form 56 (onsite) — right template, but it does **not** check anyone in

**Template 49 is correct for onsite QR delivery.** Name
*"Nigeria Mega Project Visitor QR Code Badge Mail"*, subject *"Your Registration is Confirmed –
Your QR Code is Ready"*, placeholders `{{name}}` and `{{qr_code}}`, and the QR ships as an
**embedded image**, not a UUID string.

**It does not check in.** `POST /api/visitors/public` creates the visitor, sends the email, and
returns `qr_code`. There is no `INSERT INTO checkins` anywhere in that route. The person still
needs a scan at a terminal — either from the on-screen QR the success page now renders, or from
the email.

**How ops should use it:** form 56 (`leena.app/form-public.html?id=56`) is the *self-service*
lane — hand the tablet to the visitor, they type their own details, then they walk to a terminal
and get scanned like anyone else, which is what writes the check-in and prints the badge. The
terminal's own **manual registration** is the *hostess-driven* lane — she types for them and it
registers, checks in **and** prints in one action. Use form 56 to absorb a queue; use manual
registration when someone is already at the desk.

---

## 5. Dashboards will populate — join keys verified

Both consumers join on `visitor_id` / email and are **source-agnostic**, so `terminal`- and
`badge-print`-generated rows count identically.

- **`checkin-reports.html`** — `FROM checkins c JOIN visitors v ON v.id = c.visitor_id
  WHERE c.expo_id = $1` (`checkinReports.js:53-55`). No `source` filter. Hourly/daily curve,
  country, type, job title (now `COALESCE(NULLIF(...))`-hardened) all fill.
- **`checkins.html`** — same `visitor_id` join, includes `visitor_type`.
- **Campaign funnel "Checked in"** (`campaigns.js:245-255`) — `EXISTS (visitors v JOIN checkins ck
  ON ck.visitor_id = v.id WHERE lower(trim(v.email)) = lower(trim(cr.email)) AND v.expo_id = $2
  AND ck.expo_id = $2)`. Joined on **email**, deliberately — `campaign_recipients.visitor_id` is
  NULL on every uploaded recipient, so a `visitor_id` join would silently return 0.

The funnel row flips from *"target expo not yet open"* to a live count when `start_date`
(2026-08-25) ≤ now **in the viewer's browser timezone** — from Istanbul that is **tonight at
22:00 Lagos**, twelve hours before doors. Seeing `0 (0%)` between then and 10:00 is correct, not
a fault.

Current baseline: **13 check-ins**, all test rows from setup.

---

## 6. Things that could embarrass us at 10:00

**In the order I would fix them:**

1. 🔴 **Tablets that were never logged in.** Scanning works; the first walk-in dies with
   *"Missing required data. Please login again."* Fix: log in + select the expo on each tablet
   tonight (§3).
2. 🔴 **A failed check-in is completely silent.** `performCheckin` catches every error and only
   writes to `console` (`qrscanner.html:733`). **The badge still prints and the hostess sees a
   normal success.** If the API 500s or the tablet's wifi drops mid-request, people walk in and no
   row is written — and nobody notices until the numbers look thin. Fix: someone watches the
   check-in count on `checkin-reports.html` during the first hour and flags a flat line.
3. 🔴 **The "Auto Check-in" checkbox is a live switch, and it's client-side.**
   `qrscanner.html:402` renders it `checked`, `:551` binds it. Untick it — or reload a page where
   someone unticked it — and scans print badges **without checking anyone in**, silently. Tell the
   hostesses it must stay ticked.
4. 🟠 **`terminals.auto_checkin` does nothing.** It is stored, editable in the Terminals UI, and
   selected by `terminalAuth.js:33`, but **no route ever reads it**. The real switches are
   `expos.settings.auto_checkin_on_badge_print` (server) and the checkbox above (client).
   Turning it off in the UI would give false confidence in either direction.
5. 🟠 **T3 Speaker and T4 VIP have no audience and will mis-badge.** Expo 13 has **0 speakers and
   0 VIPs**. Badge layout comes from the *terminal's* template, not the visitor's type, so an
   ordinary visitor scanned at T4 gets a VIP badge with **no job title**. Fix: close them, or
   repoint both at template 12.
6. 🟠 **Conference lane still absent.** 85 conference visitors, no terminal, 0 certificates, and 8
   holding topics missing from form 55's dropdown.
7. 🟡 **Exhibitor bulk print** — still needs the one SQL statement from
   `MONDAY_PREFAIR_20260824.md` §3.5.
8. 🟡 **Popup blocker on the manual path** — hypothesis, one dry run per tablet settles it (§3).

### What is verified sound

Scan → check-in → badge, proven on 2,223 May check-ins with 0 duplicate-guard failures · one row
per scan · multi-day rescans work (68 May visitors did it) · T1 bound to the right template with
100% company/QR coverage · both dashboards join correctly · template 49 correct for onsite ·
0 missing QR codes, 0 duplicate emails, 0 duplicate QRs across 6,933 visitors · email queue
draining clean with 0 failures.
