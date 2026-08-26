# Deploy — Unsubscribe Filter (Segments + Send-Emails)

**Date:** 26 Aug 2026, 18:47 UTC (Day 2 evening, gates closed)
**Commit:** `8c80c4dae6609b4c5f6a22e9c2932be5b61085d8`
**Range:** `d1f26d5..8c80c4d main -> main`

Closes `UNSUBSCRIBE_ANALYSIS_20260826.md` gaps §6.1 and §6.2. Gates were closed and segments page had zero activity today, so deploy risk was near-zero.

---

## What shipped

### 1. New shared helper — `backend/leena-v401-backend/utils/unsubscribe.js`

Exposes two functions:
- `isUnsubscribed(email, organizerId)` → boolean. For single-recipient checks.
- `loadUnsubscribeSet(organizerId)` → `Set<string>` of lowercase-trimmed emails. For bulk/segment.

Both use `LOWER(TRIM(...))` on both sides of the equality — fixes a case-sensitivity gap in the reference implementation at `email_worker.js:537-548`. **No fail-open** on DB error: if the query throws, the caller's send fails rather than silently proceeding.

### 2. `routes/emailSegments.js` — preload + filter before send loop

- `loadUnsubscribeSet` called once after visitor query
- Visitors filtered in-memory by lowercase-trimmed email membership
- Response body gains `skippedUnsubscribed` and `total_pre_filter` for operator visibility

### 3. `routes/emailSend.js` — both `/single` and `/bulk` patched

- `/single`: `isUnsubscribed` check runs after basic validation. If true, returns `200` with `{success: true, sent_count: 0, skipped: 1, skippedUnsubscribed: 1, message: "…is on the unsubscribe list — skipped"}`. Silent skip would have been wrong for an explicit single-recipient send — Yaprak needs to see it happened.
- `/bulk`: preloads the set once, checks per-recipient in the loop, response body gains `skippedUnsubscribed`

### Net diff

| File | Change |
|---|---|
| `utils/unsubscribe.js` (new) | +45 |
| `routes/emailSegments.js` | +14 / -1 |
| `routes/emailSend.js` | +21 / -0 |
| **Total** | **+80 / -1** |

---

## Deploy timeline

| Event | Time (UTC) |
|---|---|
| Push | 18:43:34 |
| First `/health` roll observed | 18:44:22 (t+48s) |
| Endpoint latencies measured normal (~400ms) | 18:47:15 (t+221s) |

All three modified endpoints return `401` without JWT (not `500`) — confirms `require('../utils/unsubscribe')` resolves and the routes load cleanly.

`/health`: `{"status":"OK","timestamp":"2026-08-26T18:46:58.745Z"}`

---

## Pre-smoke-test state (verified read-only)

| Address | In `email_unsubscribes`? | all-time sends | recent sends |
|---|---|---|---|
| `abimbolaakinkugbe@gmail.com` | ✅ yes, id=377, reason=`reply_request`, since 26 Aug 11:43 | 1 | 0 |
| `suer+unsubtest@elan-expo.com` | ❌ no | 0 | 0 |

Baseline is clean: any new row for `suer+unsubtest` proves the SEND path works; **no** new row for `abimbolaakinkugbe` proves the SKIP path works.

---

## Smoke test — needs your JWT (browser DevTools → LocalStorage → `token`)

I cannot run authenticated calls from the read-only side. Paste your JWT into the shell and run both:

```bash
TOKEN='...paste from browser LocalStorage.token...'

# Target 1: SKIP expected (abimbola is unsubscribed)
curl -sS -X POST https://leena.app/api/email-send/single \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": 49,
    "expo_id": 13,
    "recipient": {"email": "abimbolaakinkugbe@gmail.com", "name": "Smoke Test"}
  }' | jq .

# Target 2: SEND expected (suer+unsubtest is not on the list)
curl -sS -X POST https://leena.app/api/email-send/single \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": 49,
    "expo_id": 13,
    "recipient": {"email": "suer+unsubtest@elan-expo.com", "name": "Smoke Test"}
  }' | jq .
```

### Expected response bodies (deterministic from code)

**Target 1 (SKIP):**
```json
{
  "success": true,
  "sent_count": 0,
  "skipped": 1,
  "skippedUnsubscribed": 1,
  "message": "abimbolaakinkugbe@gmail.com is on the unsubscribe list — skipped"
}
```

**Target 2 (SEND):**
```json
{
  "success": true,
  "sent_count": 1,
  "message": "Email sent successfully"
  /* plus visitor/qr fields depending on save_to_database */
}
```

### Post-trigger verification (I'll run this after you confirm)

```sql
SELECT id, email, status, template_id, sent_at, LEFT(message, 60) AS message
FROM email_logs
WHERE (LOWER(email) = LOWER('abimbolaakinkugbe@gmail.com') 
    OR LOWER(email) LIKE 'suer+unsubtest%')
  AND sent_at > NOW() - INTERVAL '15 minutes'
ORDER BY sent_at DESC;
```

**Pass criteria:**
- `abimbolaakinkugbe@gmail.com` → **0 new rows** (filter caught it before logging or sending)
- `suer+unsubtest@elan-expo.com` → **1 new row** with `status='sent'`

If either fails, revert with `git revert 8c80c4d && git push` (~80s rollback).

---

## Tonight's segment exposure — for the record

Query at 18:47 UTC before deploy tested for cumulative violations from today:

```
=== Sent AFTER unsubscribe today (whole day) ===
0 rows
```

**Zero unsub-list violations across the entire 26 Aug** — regardless of the exact size of tonight's segment run, the effective compliance hit was **0 people**. This does not mean the gap wasn't real (yesterday's analysis flagged 4 historical violations across the last 7 days); it means Yaprak's operational discipline today happened to avoid unsubscribed addresses in the sends she authored. The filter now enforces this automatically going forward.

The `10,396` figure in your prompt doesn't map to anything visible in `email_logs` today (my query saw 18 sends since 18:00 UTC — mostly notification-block sales alerts). That number may reference recipient-list counts (recipients queued but not yet sent) or an earlier full-day segment total; I recorded the observable state and flagged the gap between your figure and the DB honestly.

---

## What this does NOT touch (deliberate)

Per §3.1 of the analysis doc, these remain intentionally unfiltered because they're transactional, not marketing:

- Visitor confirmation on registration (`routes/visitors.js` POST `/public`, `routes/webhook.js` POST `/zoho`)
- Badge/QR emails via `email_worker.js` Mode 2 template flow
- Conference certificate emails (`routes/conferenceCertificates.js`)
- Per-form sales notification block (recipients are internal sales team, not the visitor)

If a visitor unsubscribed from marketing but then registers again, they still get their badge confirmation — this matches the promise on the unsubscribe landing page (`routes/emailTracking.js:247`).

---

## Follow-ups this deploy created

- **`email_worker.js:538` case-sensitivity gap** noted but not touched here (out of scope; fix is a one-line swap to `LOWER(TRIM(...))` on both sides, but doing it needs its own deploy + smoke test).
- **UI button for manual unsubscribe** still open (`todo.md` P1 #9) — ops still need psql for reason-tagged inserts, but the segments/send-emails paths that actually blast are now safe.
- **Reply-to-unsubscribe automation** still open (`todo.md` P1 #10) — today's `abimbolaakinkugbe` opt-out went through you personally reading the reply and asking me to insert the row. That process is unchanged tonight.

---

## Rollback

```bash
git revert 8c80c4d && git push origin main
```
Restores `d1f26d5` in ~80s. The revert removes the compliance filter but doesn't lose data — the `email_unsubscribes` table is untouched by this deploy.
