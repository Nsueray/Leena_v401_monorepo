# MP26 Monday pre-fair inspection
**Taken:** 2026-08-24 08:32 Lagos / 10:32 Istanbul · **Doors open TOMORROW 25 Aug 10:00 Lagos.**
Read-only. One authorised write attempted — **blocked, see §3.5**.

Prior: `SATURDAY_CHECK_20260822.md` → **this**.

---

## 1. This morning's step-3 sends — both fired, both on time

| | C16 → #56 | C17 → #59 |
|---|---|---|
| Enqueue window (Lagos) | **07:52:55 – 07:58:31** (5.6 min) | **08:15:25 – 08:25:17** (9.9 min) |
| Projected send (Sat) | 13,971 | 25,795 |
| **Actual enqueued** | **13,876** | **25,735** |
| Projected skip (Sat) | 950 | 397 |
| **Actual skipped** | **1,042** | **453** |

Both fired inside the predicted 07:52–07:57 / 08:15–08:24 windows. Skips came in **higher** than
Saturday's projection in both cases (+92, +56) — exactly as expected, since two more days of
registrations moved more people into the "already registered" set between the projection and the
send.

### Skip attribution — 0 unexplained

| check | C16 | C17 |
|---|---:|---:|
| (a) campaign `registered` event | 587 | 226 |
| (b) visitor row on expo 13 | 1,039 | 388 |
| (c) activated reactivation token | 806 | 5 |
| **(b) but NOT (a)** — invisible to the campaign event alone | **455** | **227** |
| **no signal at all (unexplained)** | **0** | **0** |

**682 people were suppressed only by the email-matched checks `dedbcd0` added.** Every one of
them would otherwise have received a "last chance to register" email this morning having already
registered. The series: **66** (19 Aug) → **573** (22 Aug) → **682** (today).

### Delivery

| | |
|---|---|
| Drain rate | **~250/min** (2,506 in the last 10 min) |
| C16 step 3 | 8,470 sent · 5,406 pending at 08:26 |
| C17 step 3 | 0 sent · 25,735 pending — queued behind C16 |
| Total pending | **29,731** → ETA **~10:30 Lagos** |
| Failed / stuck / retries / errors | **0 / 0 / 0 / 0** |

### Registrations since the sends landed

78 new visitors on expo 13 since 07:00 Lagos, in the ~90 minutes since C16's step 3 started
landing: reactivation 47 · Pixad 23 · MP26 generic 5 · email marketing 2 · landing page 1.
Campaign-attributed today: **C16 44**, C18 3, **C17 0** — C17's step 3 has not been delivered yet,
so its response has not started.

| now | |
|---|---:|
| **Expo 13 visitors** | **6,805** (+587 since Saturday) |
| Tokens activated | 1,229 |
| Campaign-attributed cumulative, deduped | **1,065** |
| `job_title` populated | 6,717 / 6,805 = 98.7% |
| visitor 6,580 · exhibitor **148** · conference 85 | |

---

## 2. Campaign closure — and a correction to Saturday's diagnosis

| | status | completed (Lagos) | `delivered_count` | queue rows left |
|---|---|---|---:|---|
| C16 | **completed** | 24 Aug 07:58 | **30,990** | 5,406 pending + 8,470 sent |
| C17 | **completed** | 24 Aug 08:25 | **52,410** | 25,735 pending, 0 sent |
| C18 | completed | 21 Aug 21:11 | 950 | 14,227 sent |
| C19 | draft | — | NULL | — |

### ⚠️ CORRECTION — the snapshot defect is NOT single-step-only

Saturday's doc said the `delivered_count` timing defect "holds for multi-step campaigns, whose
steps are days apart; it fails for **single-step** campaigns". **That was wrong.** It fails
identically for multi-step campaigns, and today it did — at far greater magnitude.

The cause is not step count. `checkCampaignCompletion` fires when no `campaign_recipients` row is
still `active` — that is when the last recipient's last step has been **enqueued**. The final
step's drain is *always* still in flight at that moment, whatever the step count.

| | true final delivered | snapshot says | error |
|---|---:|---:|---:|
| C16 | 43,466 | **30,990** | **−12,476 (−28.7%)** |
| C17 | 78,145 | **52,410** | **−25,735 (−32.9%)** |

C17 is the pure case: it completed at 08:25 with **zero** step-3 rows sent, so the snapshot
captured steps 1+2 exactly and **the entire step 3 is missing from it**.

Worse than C18's version, because the purge in the same transaction deleted the older sent rows:
C16 lost its 29,590 step-1/2 rows, C17 its 52,410. The live count can no longer recover the truth,
and since `delivered_count` is non-null the reader prefers it permanently. Both funnels will
under-report delivery by roughly a third, and every rate (open/click/registered **per delivered**)
will be correspondingly **over**-stated.

**What is NOT affected:** sending. C16 is marked `completed` while 5,406 of its emails are still
pending, and they are draining normally — verified empirically (8,350 → 8,470 sent across two
consecutive reads). The worker drains `email_queue` independently of campaign status.

### Funnel screens

- **C16 / C17** — will render, understated as above.
- **C18** — 950 delivered against 14,227 actual; open rate clamps at 100%.
- **C19** — draft, nothing to show.

No campaign renders `delivered_unknown`; all four have either a snapshot or live rows.
Post-fair fix, logged. Nothing to do before the fair — this is a reporting defect only.

---

## 3. Terminals & gate readiness

### 3.1 T1 badge template — ✅ FIXED

| terminal | kind | badge template | `show_job_title` |
|---|---|---|---|
| **T1 Visitor** | scanner | **12 "Standard Badge Template"** | **true ✅** |
| T2 Exhibitor | scanner | 13 Exhibitor Badge Template | true ✅ |
| T3 Speaker | scanner | 16 Speaker Badge Template | true ✅ |
| T4 VIP | scanner | 15 VIP Badge Template | false (shows `role` instead) |

Ops reassigned T1 off `test visitor 80x40` (17) onto Standard (12). **Both of the two open
badge items from 19/22 Aug are now closed** — 6,717 job titles will print at the visitor gate.

### 3.2 Conference terminal — ❌ STILL MISSING

Four terminals, all `kind='scanner'`, all Hall 1. No conference terminal exists.
**85 conference-type visitors, 107 holding a topic, 0 certificates issued.**

Form 55 is **unchanged** (`updated_at` 10 Aug 13:37): still 4 canonical options, and the
**8 orphan holders persist** — topics numbered 6 and 7 plus one `Choice One`. Those 8 cannot be
matched from the hostess dropdown and would require force.

### 3.3 Terminal keys — clean

All four expo-13 keys are valid UUIDs on `is_active=true` terminals.
**The 18 Aug rotation risk is closed:** both May bulk-print keys (expo 7 id=33, expo 8 id=34 —
the ones printed in plaintext in CLAUDE.md) are now `is_active=false`. `dualAuth` rejects an
inactive key at `middleware/dualAuth.js:60` before the kind check, so those keys are inert.
**No `bulk_print` terminal is active anywhere.**

### 3.4 Form 56 — built, not wired

`Onsite Visitor Registration Form`, id 56, `visitor_type='visitor'`, active,
`email_template_id=49`, 16 fields, `updated_at` 23 Aug 21:05, **0 submissions**.

It is a **public form**, not a terminal flow — reachable at
`https://leena.app/form-public.html?id=56`. It is not bound to any terminal and does not appear
in the scanner path. Whoever staffs onsite registration needs that URL on a tablet; the terminals'
own `allow_manual_registration=true` path is a separate, simpler flow inside `qrscanner.html`.

### 3.5 🔴 Exhibitor bulk print — BLOCKED, needs one SQL statement

**Confirmed first:** no active `bulk_print` terminal exists for expo 13 (or anywhere).

**I could not create it.** `POST /api/terminals` (`routes/terminals.js:94-119`) destructures only
`hall, terminal_no, auto_checkin, is_active, badge_template_id, allow_manual_registration` — it
**does not accept `kind`**, and neither does `PUT /api/terminals/:id` (`:135`). The word `kind`
appears nowhere in `routes/terminals.js`. Any terminal created through the API falls to the DB
default `'scanner'`, which `dualAuth.js:68` then rejects with `403 WRONG_TERMINAL_KIND`.

This is the same family as G15 (clone drops `kind`): **there has never been an API path that
creates a bulk-print terminal.** The two May keys were made by direct SQL in Render Shell, exactly
as CLAUDE.md v4.0.5 records.

I deliberately did **not** create a scanner-kind terminal via the API — that would leave a
dead-on-arrival key on production the night before the fair, indistinguishable from a working one
until someone tries it at the stand.

**Run this in Render Shell** (key pre-generated so the URL below is already final):

```sql
BEGIN;
INSERT INTO terminals
  (organizer_id, expo_id, hall, terminal_no, kind,
   auto_checkin, is_active, terminal_key, badge_template_id, allow_manual_registration)
VALUES
  (1, 13, 'Bulk Print', 'MP26 Exhibitor Bulk Print', 'bulk_print',
   false, true, '15b1182e-632d-493d-9201-7d01e0d63d59', 13, false);
SELECT id, expo_id, hall, terminal_no, kind, is_active, badge_template_id, terminal_key
  FROM terminals WHERE terminal_key = '15b1182e-632d-493d-9201-7d01e0d63d59';
COMMIT;
```

Field notes, because the request does not map 1:1 onto the schema:
- **There is no `name` column.** `terminals` has only `hall` + `terminal_no`; the requested name
  goes in `terminal_no`, which is what the UI displays.
- **There is no visitor-type filter column either.** The filter comes from the **bound badge
  template**: `bulk-badge-print.html:186` reads `boundTemplate.visitor_type` and falls back to
  `'exhibitor'`. Template **13 is `visitor_type='exhibitor'`**, so `badge_template_id=13` produces
  exactly the Exhibitor-only pool asked for — the filter and the layout come from the same field.
- `auto_checkin=false` and `allow_manual_registration=false` — a print station must not check
  people in or create records.

**URL for the hostess** (`bulk-badge-print.html:125` reads `key`, *not* `terminal_key`):

```
https://leena.app/bulk-badge-print.html?key=15b1182e-632d-493d-9201-7d01e0d63d59
```

**Pool it will see, verified read-only** — `expo_id` is forced from the terminal row
(`dualAuth.js:85`), so the page cannot reach another expo:

| | |
|---|---:|
| `visitor_type='exhibitor'` on expo 13 | **148** ✅ matches Yaprak's screen |
| …with `qr_code` | 148 (100%) |
| …with `company` | 148 (100%) |
| …with `job_title` | 148 (100%) |

Template 13 prints QR, name, company, country, job title — every field is populated for all 148,
so no badge will render with a blank line.

I cannot smoke-test the key until the row exists. After Suer runs the SQL, the one-command check:

```bash
curl -s "https://leena.app/api/badge-templates/for-terminal/15b1182e-632d-493d-9201-7d01e0d63d59"
```

Expect `kind:"bulk_print"` and the Exhibitor template. If it returns 404, the row did not commit.

---

## 4. Tomorrow-morning runbook — 25 Aug, doors 10:00 Lagos

### What happens automatically

Nothing is scheduled. **No campaign fires tomorrow** — C16/C17 are completed, C18 completed, C19
is draft and stays draft unless activated. The only automatic traffic is:

- **Zoho + public forms** keep creating visitors and sending confirmation emails (transactional,
  `TRANSACTIONAL_BATCH_SIZE=10`, priority 1 — always ahead of campaign mail).
- **The worker** finishes today's step-3 drain by ~10:30 **today**; from then the queue is idle
  apart from confirmations.

### Check-in paths that go live

| lane | URL | badge |
|---|---|---|
| T1 Visitor | `qrscanner.html?terminal_key=b3b32aae-d70a-4370-a9f0-d35129929ff4` | Standard (12) |
| T2 Exhibitor | `qrscanner.html?terminal_key=29279c38-4e72-4bf4-81bd-1eb997d2e957` | Exhibitor (13) |
| T3 Speaker | `qrscanner.html?terminal_key=4399d46d-f16c-493e-b979-f589d7e9e5f2` | Speaker (16) |
| T4 VIP | `qrscanner.html?terminal_key=492e20c3-4eea-47b0-87e0-87843f9dde32` | VIP (15) |

All four have `auto_checkin=true` (scan writes a `checkins` row + upserts `visitor_event_status`)
and `allow_manual_registration=true` (walk-ups can be registered on the spot). The scanner also
accepts an **email address** typed into the QR box — worth telling the hostesses, it is the
fastest recovery when a phone screen will not scan.

Badge print opens as a **popup** (600×400); the scanner page stays open behind it.

### Where the data shows up

- **Check-ins** — `checkins.html` and `checkin-reports.html` (hourly/daily curve, source, country,
  type, no-show table, CSV). Currently **13 rows**, all test.
- **Visitors** — `visitorlog-paginated.html`, live.
- **Campaign funnel Checked-in column** — flips from *"target expo not yet open"* to
  *"campaign recipients who checked in"* when `start_date` (2026-08-25) ≤ now, evaluated in the
  **viewer's browser timezone** (`email-campaigns.html:796-799`). From Istanbul that is
  **25 Aug 00:00 IST = 24 Aug 22:00 Lagos** — twelve hours before doors. Percentages appear at the
  same moment. It joins on **email**, not `visitor_id` (which is NULL on every uploaded
  recipient), and it is an **upper bound on attribution**, not proof the email caused the visit.

### The 3 most likely things to break at the gate

1. **Conference attendees have no lane.** 85 conference visitors, no conference terminal, 0
   certificates, and 8 of them hold topics absent from form 55's dropdown.
   *Fix:* create a conference terminal and open
   `conference-scanner.html?terminal_key=<key>`; for the 8 orphans the hostess uses the force
   path, which is already guarded by the confirm modal.
2. **T3 and T4 have no audience — and will mis-badge anyone who queues there.** Expo 13 has
   **0 speakers and 0 VIPs**. The badge layout comes from the *terminal's* bound template, not the
   visitor's type, so an ordinary visitor scanned at T4 gets a VIP badge showing `role` and **no
   job title**.
   *Fix:* either close T3/T4 or point them at Standard (12) via Terminals → edit.
3. **Exhibitor bulk print does not exist yet** (§3.5) — 148 exhibitors with no pre-print path, and
   no API route can create it.
   *Fix:* run the one SQL statement above; the URL is already final.

### Data quality — clean

0 visitors without `qr_code` · 0 without `badge_id` · 0 duplicate emails · 0 duplicate QR codes ·
0 empty names, across all 6,805.

---

## 5. Standing

**Campaign side is finished and needs nothing.** Both step 3s fired on time, 0 failures, 0 stuck,
0 unexplained skips, 682 wrong sends suppressed. The one campaign-side defect found today is a
reporting understatement, not a delivery problem — and it corrects a claim I made on Saturday.

**Two gate items remain, both needing a human:** the conference lane, and the one SQL statement
for exhibitor bulk print. T1's badge template — open since 19 Aug — is now fixed.
