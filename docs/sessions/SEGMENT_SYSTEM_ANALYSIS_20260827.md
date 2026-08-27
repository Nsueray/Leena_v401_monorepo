# Segment System — Full Analysis (fix ships Fri, design decides today)

**Date:** 27 Aug 2026 (Day 3, gates open)
**Scope:** `POST /api/email-segments/send` end-to-end. Read-only. Evidence with path:line.

---

## 1. Defect Inventory

### 1a. No persistence — segment sends leave zero DB trail

**Root cause:** the log INSERT in `routes/emailSegments.js` references three columns that do not exist in the `email_logs` schema. Every INSERT throws before returning, gets swallowed by the enclosing try/catch, but the send has already succeeded via SendGrid. The visitor gets the email; our DB remembers nothing.

**INSERT** (`routes/emailSegments.js:174-190`):
```
INSERT INTO email_logs (organizer_id, template_id, expo_id,
                        recipient, recipient_email, recipient_name,
                        subject, status, visitor_id, created_at)
VALUES (...)
```

**Actual `email_logs` schema** (verified against live DB via `\d email_logs`):
```
id, organizer_id, expo_id, visitor_id, template_id, email, status, message,
sent_at, recipient, recipient_email
```

Missing from schema, referenced in INSERT:
- `recipient_name` — column doesn't exist
- `subject` — column doesn't exist
- `created_at` — schema uses `sent_at`

Every segment INSERT throws `column "recipient_name" of relation "email_logs" does not exist`. The catch block at `routes/emailSegments.js:192-211` does the same INSERT with the same broken columns — silent double-fail. Nothing ever writes.

**Quantify what shipped invisibly this week:** we cannot reconstruct precisely from our side, only bracket it.

| Day | `email_logs` sent | `email_events.opened` | Gap (approx segment volume) |
|---|---|---|---|
| 25 Aug | 1,851 | 2,455 | ~600+ opens without send trail |
| 26 Aug | 1,729 | 1,679 | comparable |
| 27 Aug | 259 (in-progress) | 485 | opens exceed sends |

Opens attach to `email_event_id` written by `email_worker.js` during campaign enqueue — segment sends don't have that trail either, so opens for segment sends may not even register in `email_events`. Yaprak's 10,396 tonight and yesterday's 8,120 exist in SendGrid but are invisible in our tables. **Peter Azonobi is the case study** — no email_logs row for Wednesday's thank-you segment, yet his event_status = `checked_in` matches the filter, and he almost certainly received it.

### 1b. The "Failed" counter lie

**Frontend three-box display** (`public/email-segments.html:215-219`):
```
<div class="result-stat"><div class="value">${data.total_targeted || 0}</div><div class="label">Targeted</div></div>
<div class="result-stat"><div class="value">${data.total_sent || 0}</div><div class="label">Sent</div></div>
<div class="result-stat"><div class="value">${data.total_failed || 0}</div><div class="label">Failed</div></div>
```

**Backend counter loop** (`routes/emailSegments.js:161-213`):
```
for (const visitor of filteredVisitors) {
    try {
        const success = await sendEmailWithReplyTo(...);        // ← this SUCCEEDS
        if (success) { totalSent++; } else { totalFailed++; }   // ← totalSent++
        await pool.query(`INSERT INTO email_logs ...`);         // ← throws (§1a)
    } catch (err) {
        totalFailed++;                                          // ← totalFailed++ also
        // nested INSERT — same bug, silent
    }
}
```

The send is SUCCESSFUL. Then the INSERT throws on the broken columns. Control jumps to the outer catch, which increments `totalFailed`. Both counters get incremented for every successful send. **`Sent === Failed` for every successful blast.**

**What the three boxes should report:**
- **Targeted** — pre-filter total visitor set matching the segment
- **Queued** — actually enqueued after unsub filter (this is the number Yaprak needs to trust)
- **Skipped** — subdivided: unsubscribed / invalid email / other reason
- (Post-drain, from queue readback) **Delivered** and **Bounced**

### 1c. Date-blind `checked_in`

**Segment filter** (`routes/emailSegments.js:110-124`):
```
INNER JOIN visitor_event_status ves ON ves.visitor_id = v.id AND ves.expo_id = v.expo_id
WHERE ... AND ves.status = 'checked_in'
```

`visitor_event_status` has NO day dimension (`\d visitor_event_status`):
```
Columns: id, visitor_id, expo_id, status, created_at, updated_at
CHECK constraint: status IN ('registered','badge_printed','checked_in','revisit','nonshow')
UNIQUE (visitor_id, expo_id)
```

**One row per visitor per expo, permanent flag.** First scan writes `checked_in`; subsequent scans never touch it. There is no "checked in Tuesday", "checked in today", "checked in both days" — everyone who has ever scanned is one bucket. `not_checked_in` is everyone else, forever.

**Current expo 13 `checked_in` pool:** 2,449 visitors — every attendee since Day 1, including Peter (Tuesday-only). If tonight's thank-you targets `checked_in`, all 2,449 receive it — including 1,000+ people who came Tuesday and haven't returned since.

**What ops actually needed this week vs what the page can express:**

| Ops intent | Correct filter | What page can do |
|---|---|---|
| Thank Day-1 attendees on Day-2 morning | `checkins WHERE date='2026-08-25'` | ✗ has to send to all-time checked_in |
| "Missed Day 1" nudge to no-shows on Day-2 morning | `visitors registered<D1 AND NOT EXISTS(checkin D1)` | ✗ only "never checked in ever" |
| Thank all attendees post-fair (Fri evening) | `visitors WHERE EXISTS(any checkin)` | ✓ this is what `checked_in` does |
| No-show reminder before Day 3 | `visitors registered<D3 AND NOT EXISTS(checkin D1∪D2)` | ✗ only "never checked in ever" |

Three of four intents cannot be expressed. Yaprak has been shipping approximations (all-attendees when she wanted today-attendees; all-noshows when she wanted 2-day-noshows) and Peter is one of tens or hundreds of miscategorized recipients.

### 1d. Throughput — direct sgMail loop, no queue

**Send call** (`routes/emailSegments.js:166`):
```
const success = await sendEmailWithReplyTo(visitor.email, subject, html, 'reply@replies.leena.app');
```

Direct call into `utils/email.js` → `@sendgrid/mail`. No `email_queue` INSERT anywhere in the send path. **The worker's batching, retry, priority tiers, and campaign_id-null transactional lane are entirely bypassed.**

Rate limit is a hard-coded 300ms sleep per visitor (`routes/emailSegments.js:170`): `await new Promise(r => setTimeout(r, 300))`.

**For a 10k blast:**
- Wall time: 10,000 × 300ms = **50 minutes synchronous** blocking the HTTP request
- Single-threaded — no parallelism, no batch INSERT to queue
- If browser tab times out or Yaprak closes the window: request context dies, but the Node loop keeps running for another 30–45 minutes sending to SendGrid. No status endpoint to poll. No cancel. If the process restarts (Render deploy, crash, memory pressure) mid-loop, silently drops the rest.
- 8,120 last night = ~40 minutes wall time. 10,396 tonight = ~52 minutes.

**Risk statement:** a segment blast of 5k+ is a synchronous single-threaded HTTP request that outlives its own connection, cannot be observed while running, cannot be paused, is invisible to logging, and will lose the tail if the process bounces. This has been true all week.

### 1e. No preview, no confirm, no dry-run

**Frontend flow** (`public/email-segments.html`, `sendEmails()` function):
```
1. templateId + segment selected in dropdowns
2. Click Send button
3. btn.disabled = true; fetch(POST /send)   ← immediate blast
```

**Zero confirmation modal.** Zero recipient count preview. Zero dry-run mode. Yaprak's 8,120-recipient blast last night was one click. Same for the 10,396 tonight.

The response body (§1b) shows the "Targeted" count only AFTER the send completes — too late to reconsider.

### 1f. Yesterday's unsubscribe filter — verified in the deployed path

**Import** (`routes/emailSegments.js:15`): `const { loadUnsubscribeSet } = require('../utils/unsubscribe');`
**Preload + filter** (`routes/emailSegments.js:136-141`):
```
const unsubSet = await loadUnsubscribeSet(organizerId);
const filteredVisitors = visitors.filter(v => !unsubSet.has((v.email || '').toLowerCase().trim()));
const skippedUnsubscribed = totalPreFilter - filteredVisitors.length;
```

Commit `8c80c4d` deployed 26 Aug 18:43 UTC, verified live yesterday (Render restart signal seen, endpoints returning 401 not 500 → module loaded cleanly). **This part is working.** It runs before the send loop, so no unsubscribed visitor even enters the SendGrid call. But the log-INSERT bug still swallows the record afterwards, so unsub-filter effectiveness is only observable via the response body's `skippedUnsubscribed`, never through `email_logs`.

### Other findings

- **`sent_at` vs `created_at`**: the wider ecosystem uses `sent_at`. Segments code invents `created_at` which doesn't exist — suggests this route was written against an older schema or a wrong doc.
- **No `visitor_id` written for notifications**: separate design issue but visible in the same table — Mode 1 notification block sends have `visitor_id NULL` in the log. Not a bug for that flow, but worth noting as we design segment logging.

---

## 2. Design Proposal — Segments as a First-Class Citizen

### 2.1 Route through `email_queue` (the campaign-engine pattern)

Replace the direct-sgMail loop with a bulk INSERT into `email_queue`, pre-processed HTML per row (Mode 1). Worker takes it from there.

**Why this works free-of-charge:**
- `email_worker.js:fetchNextBatch` (line ~180+) already has transactional-priority pickup for `campaign_id IS NULL` rows — segment sends inherit priority-1 lane
- Worker handles rate limiting via `PROCESS_INTERVAL` + `BATCH_SIZE` env
- Worker writes `email_logs` with `status='sent'` (or 'failed') and populates `sent_at` correctly on drain
- Retry-on-failure via `try_count < MAX_RETRIES` already in the queue
- Unsubscribe re-check happens in worker anyway (defensive `email_worker.js:537-548`) — double safety
- Response returns in under a second regardless of blast size

**Sketch** (~35 net LOC change in emailSegments.js):
```js
// After filteredVisitors, pre-process everyone in memory
const rows = filteredVisitors.map(v => {
    const emailData = { name: v.name || 'Guest', ... };
    return {
        recipient_email: v.email,
        subject: processEmailTemplate(template.subject, emailData),
        html_content: processEmailTemplate(template.html_content, emailData),
        visitor_id: v.id, expo_id, organizer_id: organizerId, template_id
    };
});

// Bulk INSERT (one query, N rows via unnest or a VALUES chain)
await pool.query(
    `INSERT INTO email_queue (recipient_email, subject, html_content,
        visitor_id, expo_id, organizer_id, template_id, status, created_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[],
                          $5::int[], $6::int[], $7::int[], 'pending', NOW())`,
    [rows.map(r => r.recipient_email), rows.map(r => r.subject), ...]
);

res.json({ success: true, targeted, queued: rows.length, skippedUnsubscribed });
```

**Migration of response UX:**
- Sync-wait mental model dies. Response returns in ~1 second with `queued: N`.
- Frontend shows: "Queued 4,982 emails. Delivered progress will appear in Email History over the next ~15 minutes."
- Optional next step: a small `/api/email-segments/status?after=<timestamp>` endpoint that reads queue drain progress — but Yaprak can use the existing Email History page from day one, since worker will write `email_logs` correctly.
- Even simpler: link a "View progress" button to `email-history.html?since=<timestamp>&template_id=X` — reuses existing page.

### 2.2 Day-scoped targeting — from `checkins.checkin_time`, not `visitor_event_status`

Replace the `visitor_event_status` join with a `checkins` query keyed by date. `visitor_event_status` was a good idea for "has this person been here ever" but is the wrong data source for anything time-aware.

**Proposed segment options** (`segment` param values):
```
attended_on:2026-08-25          // exact-day attendees
attended_any_day                // ever checked in (existing "checked_in" behavior)
noshow_asof:2026-08-26          // registered by that date, no checkin ≤ that date
noshow_ever                     // registered but never scanned (existing "not_checked_in" but scoped)
registered_between:D1..D2       // for prospect-followup, optional
```

**Query for `attended_on:X`:**
```sql
SELECT v.id, v.name, v.email, ... FROM visitors v
INNER JOIN checkins c ON c.visitor_id=v.id AND c.expo_id=v.expo_id
  AND (c.checkin_time AT TIME ZONE 'Africa/Lagos')::date = $day
WHERE v.expo_id=$1 AND v.organizer_id=$2
  AND v.email IS NOT NULL AND v.email != ''
GROUP BY v.id
```

**Query for `noshow_asof:X`:**
```sql
SELECT v.id, ... FROM visitors v
WHERE v.expo_id=$1 AND v.organizer_id=$2
  AND (v.created_at AT TIME ZONE 'Africa/Lagos')::date <= $day
  AND v.email IS NOT NULL AND v.email != ''
  AND NOT EXISTS (
    SELECT 1 FROM checkins c WHERE c.visitor_id=v.id AND c.expo_id=v.expo_id
      AND (c.checkin_time AT TIME ZONE 'Africa/Lagos')::date <= $day
  )
```

Both use indexes we already have (`idx_checkins_expo_id`, plus we'd want `idx_checkins_visitor_expo_time` if we don't have it — cheap add).

### 2.3 Honest three boxes

Replace `total_sent/total_failed` (broken counters) with what actually happened:

```
Targeted:  N   ← count matching the segment filter, pre-anything
Skipped:   K   ← breakdown: unsubscribed=X, invalid_email=Y, other=Z
Queued:    Q   ← the bulk INSERT rowcount, = Targeted - Skipped
──────────────
[Live view] Delivered / Bounced from email_history — link to email-history.html?since=T
```

Frontend loses `Sent` and `Failed` boxes (they were lies). Gains a link to Email History for post-drain readback.

### 2.4 Confirmation modal + preview

Before the actual send POST, add a preview call:
```
POST /api/email-segments/preview  { expo_id, segment, template_id }
  → { targeted: 4980, skippedUnsubscribed: 47, sample_recipients: [...5 emails], html_preview: "..." }
```

Frontend renders modal: "You're about to send `<template subject>` to **4,980 people** (47 unsubscribed will be skipped). Sample recipients: alice@…, bob@…. Rendered preview below. **[Cancel] [Send to 4,980]**". Second click required to confirm.

This is the single biggest UX safety win. It's also a cheap query (only the count), no side effects.

### 2.5 Sizing — MUST vs NICE for SIEMA

**MUST (2 weeks before SIEMA follow-ups start):**

| # | Piece | Est. LOC | Est. time |
|---|---|---|---|
| M1 | Route through `email_queue` (drop direct sgMail, bulk INSERT, response returns Queued count) | ~40 LOC | 3-4h + smoke |
| M2 | Day-scoped filter options (`attended_on`, `noshow_asof`, keep existing as aliases) | ~30 LOC backend + dropdown redesign frontend | 3h |
| M3 | Fix the three-box lie (Targeted/Skipped/Queued), remove Sent/Failed | ~15 LOC | 1h |
| M4 | Confirmation modal with recipient count via new `/preview` endpoint | ~50 LOC (backend endpoint + modal) | 3h |
| **Total** | | **~135 LOC** | **~1 dev-day + verify** |

Everything reuses existing infrastructure: `email_queue` schema unchanged, `email_worker.js` unchanged, `email_history.html` unchanged. No migrations, no new tables.

**NICE (if time permits before SIEMA, else post):**
- N1: Template preview inside confirmation modal (needs iframe sandbox — 30 min)
- N2: `/api/email-segments/status` endpoint returning live drain % (2h)
- N3: Save-and-schedule (queue with `send_after` timestamp) — pattern already exists in campaigns
- N4: Segment save (name+params) so Yaprak can rerun "Day 2 no-shows" without rebuilding filter every time

**What reuses campaign-engine code directly:**
- `email_worker.js` pickup + rate + retry — zero change
- `email_history.html` display — zero change
- `email_logs` writes — happen automatically via worker

---

## 3. Tonight's Closing Sends — Residual Risks

Yesterday's unsub filter is live (§1f verified), so the compliance surface is closed — nobody on the 328-row unsubscribe list will actually receive tonight's ~3k thank-you or missed-D2 sends. That specific risk is off the board.

**What is still broken tonight, one-line per risk:**
- Sends will happen invisibly (§1a): the ~3k emails will land at SendGrid but leave no `email_logs` trail; if a recipient complains in a week, we can't prove or deny we sent, and can't tell you if we hit them once or three times.
- The "Failed" number will lie (§1b): whatever you see in the result panel, `Failed = Sent` — treat both as the same number and assume Sent is truth.
- The `checked_in` segment for the thank-you includes **every attendee since Day 1** (§1c), not just people who came today; Peter Azonobi and a few hundred like him get "thanks for coming today" when they came Tuesday.
- 3k × 300ms = ~15 min synchronous request that will pin the browser; don't close the tab, don't switch expos, don't touch the send page during the send.

**One-line ops guidance for tonight's send wording:**

> Write "thanks for attending the fair" not "thanks for attending today" — the segment cannot distinguish which day anyone came, so any today-specific language will be wrong for a large slice of the audience (the Peter case, scaled to ~1,000+ people).

Second-order guidance: hit send, walk away, watch email history for the drain start (should see rows appearing within 30s if the log INSERT were working — since it isn't, watch SendGrid Activity instead). If the browser tab dies mid-send, don't retry — the tail may still be delivering server-side, and a retry duplicates.
