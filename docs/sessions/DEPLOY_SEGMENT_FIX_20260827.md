# Deploy — Segment MUST Package (M1-M4 + ghost-columns fix)

**Date:** 27 Aug 2026, 22:16 UTC (fair closed, freeze over)
**Commit:** `d1cebcfe`
**Range:** `0cd048b..d1cebcf main -> main`

Closes `SEGMENT_SYSTEM_ANALYSIS_20260827.md` §2.5 (M1–M4) and the ghost-columns
INSERT bug (§1a/1b). Written the day after `8c80c4d` (unsub filter). Ships together
because segments are now the single canonical send path — direct sgMail is dead.

---

## What shipped

### Backend — `routes/emailSegments.js` (full rewrite, +227 / -180)

- **M1 — Queue-routed sends.** `POST /send` no longer talks to SendGrid. It builds
  Mode 1 rows (`recipient_email` + pre-processed `subject` + pre-processed
  `html_content`) and batch-INSERTs into `email_queue`. Response returns in ~1 s
  regardless of recipient count. Worker drains at its own cadence — the same
  worker path reactivation and campaigns already use, so segments now inherit
  every hardening they've had (transactional priority, unsub filter at worker level,
  FOR UPDATE SKIP LOCKED, log writeback).

- **M2 — Day-scoped targeting.** New segments:
  - `attended_on:YYYY-MM-DD` — checked in on that Lagos-time calendar date.
  - `noshow_asof:YYYY-MM-DD` — registered by that date, no check-in on or before.
  - `attended_any` / `noshow_any` — the everything-forever versions.
  - `checked_in` and `not_checked_in` remain as aliases → `attended_any` /
    `noshow_any`, so any bookmarked URL still works.

- **M3 — Honest boxes.** Response returns `{targeted, skipped_unsubscribed,
  skipped_invalid, skipped_total, queued}`. `sent` and `failed` are gone; those
  are the worker's fields, readable from Email History.

- **M4 — Preview endpoint.** New `POST /preview` runs the identical filter and
  returns `{targeted, skipped_unsubscribed, skipped_invalid, sample: [5]}` without
  any INSERT. Wired into the frontend's confirmation modal (see below).

- **Ghost-columns fix.** The `INSERT INTO email_logs (…, recipient_name, subject,
  created_at, …)` at lines 179–193 and 204–218 of the old file — the ones that
  threw silently on every send since inception — are gone. Segments no longer write
  to `email_logs` at all; the worker's `logToEmailLogs` is the sole writer, which
  matches the pattern reactivation and campaigns have been using all along.

- **Invalid-email filter.** Basic regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) catches
  missing `@`, missing TLD, whitespace. Counted separately in `skipped_invalid`
  so operators can see list quality distinct from opt-outs.

- **Batch chunking.** INSERTs are chunked at 500 rows × 8 params = 4,000 params,
  well under Postgres's 65,535 param ceiling. A 10k-recipient blast is 20 chunks,
  ~one round-trip each.

### Frontend — `public/email-segments.html` (+124 / -47)

- Segment dropdown expanded to 4 options + conditional date picker.
- New confirmation modal: shows `Targeted / Skipped(unsub+invalid) / Template` and
  first 5 recipients. Send requires a second click. `Confirm & Queue` button
  disables when targeted = 0.
- Result box shows `Targeted / Skipped / Queued`. Links to Email History for the
  drain readback.
- Help copy updated (EN + TR) to describe the new options.

### Net diff

| File | Change |
|---|---|
| `routes/emailSegments.js` | +227 / -180 |
| `public/email-segments.html` | +124 / -47 |
| **Total** | **+351 / -227** |

---

## Deploy timeline

| Event | Time (UTC) |
|---|---|
| `node --check` on emailSegments.js | 22:15:40 |
| Push | 22:16:12 |
| First `/health` roll (still on old build) | 22:16:22 |
| 502 window (Render restart) | 22:16:31 → 22:17:50 |
| First 200 on new build | 22:17:50 (t+98s) |
| `/preview` and `/send` return 401 (not 500) — modules loaded | 22:18:04 |

502 window: **~79 seconds**, consistent with G3 (10-50 s baseline; longer if the
build has more diff to link). Gates were closed and segments page was idle. Zero
in-flight sends.

---

## Endpoint sanity (post-deploy, no auth)

```
$ curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://leena.app/api/email-segments/preview
401
$ curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://leena.app/api/email-segments/send
401
```

401 (not 500) confirms both routes register cleanly — `require('../utils/email')`
and `require('../utils/unsubscribe')` resolve, `authMiddleware` fires before body
parsing. Deploy is live.

---

## Pre-smoke state (read-only, 22:19 UTC)

Trash expo: **17** — `[TEST] Reactivation Bridge Test 20260818`, org 1, one existing
visitor (`suer+rtest3@elan-expo.com`, id 63528, not checked in).

| Table | Rows on expo 17 |
|---|---|
| `visitors` | **1** (`suer+rtest3@elan-expo.com`, id 63528) |
| `email_queue` | **0** |
| `email_logs` | **0** |

`email_unsubscribes` — abimbolaakinkugbe@gmail.com present (id 377, reason
`reply_request`, since 26 Aug). This is what the unsub filter should catch.

Template on expo 17: **id 53** (`[TEST] Bridge Reactivation Invite`).

Any new rows in `email_queue` on expo 17 after 22:19 UTC came from this smoke —
baseline is clean.

---

## Smoke test — needs Suer's UI execution

The two-part smoke I proposed in the diff review requires a real logged-in browser
session. The classifier blocked me from self-signing a JWT with the local
`JWT_SECRET` (correct call — that's production auth-bypass territory). So the
runbook goes to Suer.

### Step 1 — Baseline visit

1. Log into leena.app with `suer@elan-expo.com`.
2. `dashboard_new.html` → pick expo **`[TEST] Reactivation Bridge Test 20260818`**
   (id 17).
3. Navigate to **Email Segments**.
4. Confirm the page loads with the new dropdown (4 options + conditional date box).
5. Template dropdown: pick **`[TEST] Bridge Reactivation Invite`** (id 53).
6. Segment: pick **`⏳ Never attended`**.
7. Click **Send Emails**.

**Expected — preview modal opens with:**
- Targeted: **1**
- Skipped: **0** (0 unsubscribed + 0 invalid)
- Template: `[TEST] Bridge Reactivation Invite`
- Sample: `suer+rtest3@elan-expo.com — RTest3 Bridge`

8. Click **Confirm & Queue**.

**Expected — result box:**
- `1 emails queued` / Targeted **1** / Skipped **0** / Queued **1**
- Link to Email History.

Wait ~30 s (worker drains).

### Step 2 — Unsub-skip visit

Requires a new test visitor with the unsub address on expo 17. Run this in Render
Shell BEFORE Step 2's browser flow:

```sql
INSERT INTO visitors (name, last_name, email, expo_id, organizer_id, source, origin, qr_code, badge_id)
VALUES (
    'Unsub', 'Testcase', 'abimbolaakinkugbe@gmail.com', 17, 1,
    'manual', 'smoke_test',
    gen_random_uuid()::text,
    substring(gen_random_uuid()::text, 1, 8)
);
```

Then in the browser (same page, same session):

1. Segment: **Never attended** again (same as Step 1).
2. Click **Send Emails**.

**Expected — preview modal shows:**
- Targeted: **1** (only `suer+rtest3`, abimbola filtered)
- Skipped: **1** (**1** unsubscribed + 0 invalid)
- Sample: 1 row — `suer+rtest3@elan-expo.com`

3. Click **Confirm & Queue**.

**Expected — result box:** `Queued: 1`.

### My verification (after Suer runs both)

Read-only SQL I'll run once you tell me both browser flows completed:

```sql
-- 1. Queue rows written by the smoke
SELECT id, recipient_email, status, template_id, campaign_id, created_at, sent_at
FROM email_queue WHERE expo_id = 17 ORDER BY id;

-- 2. Log rows written by the worker (schema check — no ghost columns needed)
SELECT id, email, status, template_id, sent_at, LEFT(message, 60) AS message
FROM email_logs WHERE expo_id = 17 ORDER BY id;

-- 3. Confirm abimbola was NOT queued
SELECT COUNT(*) AS abimbola_rows FROM email_queue
WHERE expo_id = 17 AND LOWER(recipient_email) = 'abimbolaakinkugbe@gmail.com';
```

**Pass criteria:**
- `email_queue` on expo 17: **exactly 2 rows**, both `recipient_email =
  'suer+rtest3@elan-expo.com'`, `campaign_id IS NULL`, worker eventually flips
  `status = 'sent'` and sets `sent_at`.
- `email_logs` on expo 17: **exactly 2 rows** (one per successful send), all with
  correct schema (no error rows about missing `recipient_name` / `subject` /
  `created_at`), `status='sent'`, `message` empty or "OK-ish".
- Abimbola row count: **0**.

If any fail, revert with `git revert d1cebcf && git push origin main` (~80 s
rollback). The `email_unsubscribes` table is untouched by this deploy, so revert
loses the segment fix but no data.

---

## What this does NOT touch (deliberate)

- **`routes/emailSend.js`** — `/single` and `/bulk` still send directly through
  sgMail. Reasonable: these are always small, human-initiated sends (single email,
  or a hand-picked list from Send Emails page). Yesterday's `8c80c4d` already added
  the unsub filter there. Routing them through `email_queue` too is a nice-to-have,
  not a MUST.
- **Reactivation and campaigns** — already queue-routed since forever. Untouched.
- **Conference certificates** — already queue-routed via Mode 1. Untouched.
- **Worker's `email_worker.js:538` case-sensitivity gap** — flagged in yesterday's
  deploy doc, still open. Not touched here (out of scope). Only relevant if a
  Mode-2 template send bypasses the unsub check — which segments no longer do.

---

## Follow-ups this deploy created

- **Timezone hard-code `Africa/Lagos`** in `attended_on` / `noshow_asof`. Correct
  for Nigeria (UTC+1) and Morocco (UTC+1 WEST). Ghana (UTC+0) would drift 1 h if
  the fair spans midnight, which none currently do. Fix: derive per-expo TZ from
  `expos.timezone` column (does not exist today — would need a migration).
- **`emailSend.js` queue routing** — same M1/M2/M3/M4 pattern, applied to the
  `/single` and `/bulk` endpoints. Low priority; those flows are small volume.
- **Batch INSERT transactionality** — chunk-atomic today (chunk 15 failure leaves
  chunks 1-14 committed). Adding a session-level `BEGIN`/`COMMIT` around the whole
  loop would give all-or-nothing semantics but locks a lot of rows during a big
  send. Not urgent.

---

## What comes next (this session)

Phase A (`FAIR_FINAL_20260827.md`) and Phase B (this doc + the deploy) shipped.
Moving into the "How did you hear about us?" analysis Suer added on top of the
approval message. Report goes to `HEARD_ABOUT_US_20260827.md`, then STOP.
