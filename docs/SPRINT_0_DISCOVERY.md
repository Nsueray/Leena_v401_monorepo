# Sprint 0: Discovery & Verification

**Date:** 2026-04-24
**Status:** Complete — awaiting Suer's approval to proceed to Sprint 1

---

## 1. Confirmed Facts

### 1.1 email_queue Table Columns

**CONFIRMED.** initial.sql defines (lines 98-108):
```
id, organizer_id, expo_id, visitor_id, template_id, status, try_count, last_try, created_at
```

**Production extras (NOT in initial.sql, confirmed via INSERT/UPDATE statements across codebase):**
```
recipient_email, subject, html_content, sent_at, error_message
```

These 5 extra columns are used by:
- `email_worker.js:85` — `SET status='sent', sent_at=NOW()`
- `email_worker.js:91` — `SET status='failed', try_count=try_count+1, last_try=NOW(), error_message=$2`
- `visitors.js:328` — `INSERT INTO email_queue (recipient_email, subject, html_content, status, created_at)`
- `reactivation.js:626` — same Mode 1 INSERT pattern

### 1.2 email_worker.js FOR UPDATE SKIP LOCKED

**CONFIRMED.** Lines 29-37:
```sql
UPDATE email_queue SET status = 'processing'
WHERE id = (
  SELECT id FROM email_queue
  WHERE status = 'pending' AND try_count < $1
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id
```
- `PROCESS_INTERVAL = 2000` (line 19)
- `MAX_RETRIES = 5` (line 20)
- Transaction: `BEGIN → UPDATE+SELECT → COMMIT` (lines 26-73)

### 1.3 sendEmailWithReplyTo Signature

**CONFIRMED.** `utils/email.js:63`:
```javascript
async function sendEmailWithReplyTo(to, subject, html, replyToEmail)
```
Returns `Promise<boolean>` (true on success, false on error).

### 1.4 processEmailTemplate

**CONFIRMED.** `utils/email.js:12-23`. Does ONLY:
1. `Object.keys(data).forEach(key => result.replace({{key}}, data[key] || ''))`
2. `result.replace(/{{[^}]+}}/g, '')` — removes unused placeholders

No HTML sanitization, no tracking injection, no link wrapping.

### 1.5 Sidebar Structure

**CONFIRMED.** Sidebar is DUPLICATED in every HTML file (no shared component). Communication section:
```html
<div class="nav-section">
    <div class="nav-section-title">Communication</div>
    <a class="nav-item" href="email-templates.html"><i class="bi bi-envelope"></i><span>Email Templates</span></a>
    <a class="nav-item" href="email-send.html"><i class="bi bi-send"></i><span>Send Emails</span></a>
    <a class="nav-item" href="email-segments.html"><i class="bi bi-megaphone"></i><span>Email Segments</span></a>
</div>
```

"Email Campaigns" will be inserted between "Send Emails" and "Email Segments" in ALL admin pages.

### 1.6 SendGrid Event Webhook

**CONFIRMED: DOES NOT EXIST.** No endpoint handles:
- `/webhook/sendgrid`
- `/email-events`
- `/track` / `/pixel` / `/bounce` / `/unsubscribe`

The only webhook in the system is `routes/webhook.js` for INCOMING Zoho form submissions.
The `routes/emailInbound.js` handles SendGrid Inbound Parse (reply forwarding), NOT event tracking.

### 1.7 Tracking Infrastructure

**CONFIRMED: ZERO tracking exists:**
- No tracking pixel insertion in any code path
- No link wrapping / click redirect
- No bounce detection
- No unsubscribe mechanism
- `email_logs` tracks only `sent`/`failed`/`queued` — no engagement events

### 1.8 Libraries & Versions

| Library | Version | Usage |
|---------|---------|-------|
| `@sendgrid/mail` | ^8.1.5 | Email sending |
| `pg` | ^8.16.3 | PostgreSQL client |
| `express` | ^5.1.0 | Web framework (⚠️ Express 5!) |
| `jsonwebtoken` | ^9.0.2 | JWT auth |
| `multer` | ^2.0.2 | File uploads |
| `xlsx` | ^0.18.5 | Excel parsing |
| `papaparse` | ^5.5.3 | CSV parsing |
| `uuid` | ^11.1.0 | QR code generation |
| `bcrypt` | ^6.0.0 | Password hashing |
| `dotenv` | ^17.2.1 | Env vars |
| `qrcode` | ^1.5.4 | QR image generation |
| `body-parser` | ^2.2.0 | Request parsing |
| `cors` | ^2.8.5 | CORS |

**No scheduler libraries** (no node-cron, bullmq, agenda).

### 1.9 DB Pool Config (utils/db.js)

```javascript
max: 20,
connectionTimeoutMillis: 5000,
idleTimeoutMillis: 30000,
statement_timeout: 30000
```

### 1.10 Migrations Directory

3 existing migrations:
1. `001_floorplan_tables.sql` — Floor Plan Builder tables
2. `002_reactivation_form_id.sql` — form_id on reactivation_tokens
3. `003_exhibitors_table.sql` — expo_exhibitors + expo_stands.exhibitor_id

Next migration: `004_sequence_campaigns.sql` (or `v403_sequence_campaigns.sql` per spec)

### 1.11 Auth Middleware

Two JWT middlewares exist:
- `middleware/authMiddleware.js` — sets `req.organizer_id`. Used by most routes.
- `middleware/auth.js` — sets `req.user` object `{id, email, organizer_id}`. Used by some newer routes.

**For campaigns module:** Use `authMiddleware.js` (consistent with emailSend.js, emailSegments.js, and most other routes).

---

## 2. Discrepancies from Prior Analysis

### 2.1 email_logs Column Mismatch

The prior analysis stated email_logs columns as:
```
id, organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at
```

**emailSegments.js uses DIFFERENT column names (lines 169-183):**
```
organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at
```

This includes columns NOT in initial.sql: `recipient`, `recipient_email`, `recipient_name`, `subject`, `created_at`. The production email_logs table has more columns than initial.sql defines.

### 2.2 emailSend.js email_logs Status Value

Prior analysis said `'sent'` / `'failed'`. Actual code (emailSend.js:233):
```javascript
status: success ? 'sent' : 'failed'
```
Confirmed — but `success` is the return value of `sendEmailWithReplyTo`, which returns `true`/`false`.

### 2.3 Express Version

Express **5.1.0** — this is a major version. Express 5 has different error handling and routing compared to Express 4. The campaign module must be compatible with Express 5 patterns (e.g., async error handling).

---

## 3. New Findings

### 3.1 CSV Parsing in email-send.html

email-send.html uses XLSX library (CDN) for Excel files and manual string splitting for CSV:
```javascript
// CSV: reader.readAsText(file) → split by '\n' and ','
// Excel: reader.readAsArrayBuffer(file) → XLSX.read() → XLSX.utils.sheet_to_json()
```
The campaigns module should use the same XLSX library for consistency. It's already available as a CDN in the frontend and as an npm dependency (`xlsx: ^0.18.5`).

### 3.2 email_worker.js Has Its OWN Pool

`email_worker.js:10-17` creates its own `Pool` instance (NOT importing from utils/db.js):
```javascript
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  ...
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```
This is different from `utils/db.js` which always enables SSL. The campaign scheduler running inside email_worker.js will use this pool — no import needed.

### 3.3 Bulk Send Path Does NOT Use email_queue

**Critical for understanding:** When Yaprak sends bulk emails today via email-send.html → `POST /api/email-send/bulk`:
1. Frontend sends all recipients in one request body
2. Backend loops through recipients synchronously
3. Each email is sent DIRECTLY via SendGrid (not queued)
4. 100ms delay between sends
5. email_logs records each send

This means: if 55,000 recipients are sent via this path, the HTTP request would need to stay open for ~55,000 × 0.1s = 5,500 seconds (~92 minutes). **This will timeout.**

**The campaign module MUST use the queue for 55K recipients.** The scheduler puts emails into email_queue, and the worker processes them at its own pace (one per 2 seconds = ~30/minute = ~1,800/hour). For 55K emails, this would take ~30 hours.

**Question for Suer:** Is 30 hours acceptable for Step 1 delivery? Or should we increase worker throughput (process multiple per cycle)?

### 3.4 visitor_event_status Table Not in initial.sql

Referenced in `emailSegments.js` (lines 108, 121) and `terminalCheckins.js`, but NOT defined in `initial.sql`. Must exist in production via manual ALTER/CREATE.

### 3.5 Bootstrap Icons Version

Bootstrap Icons 1.8.1 is loaded. The icon `bi-envelope-paper` is available since v1.8.0, so it's valid for the campaigns sidebar link.

---

## 4. Questions for Suer

### Critical (Block Sprint 1)

1. **Worker throughput for 55K emails:** Current worker processes 1 email per 2 seconds = ~1,800/hour. For 55K recipients, Step 1 alone takes ~30 hours. Should we:
   - (a) Accept 30-hour delivery window?
   - (b) Process multiple emails per worker cycle (e.g., batch of 10 per 2-second cycle)?
   - (c) Temporarily reduce PROCESS_INTERVAL for campaigns (e.g., 200ms instead of 2000ms)?

2. **Migration naming:** Spec says `v403_sequence_campaigns.sql`. Existing pattern is `001_`, `002_`, `003_`. Should I use `004_sequence_campaigns.sql` for consistency?

### Non-Blocking (Can proceed with defaults)

3. **UNSUBSCRIBE_SECRET env var:** Will Suer set this on Render, or should I generate and provide a value?

4. **Default delay for Step 2:** Spec mentions user-configurable. Any default suggestion? (72 hours seems reasonable for "send to non-openers after 3 days")

---

## 5. Sprint 1 Readiness

All facts verified. No blocking discrepancies found. Ready to proceed with Sprint 1 (migration SQL) once Suer approves and answers the throughput question.

**Recommended next step:** Approve Sprint 0 → Begin Sprint 1 (migration file creation, no execution).
