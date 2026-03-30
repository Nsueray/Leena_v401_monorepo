# Email Stabilization Analysis — Leena EMS

> **Date:** 1 March 2026
> **Scope:** Read-only analysis of 5 backend files with direct SendGrid calls
> **Goal:** Map every email sending point, assess migration risk to email_queue, propose order

---

## 1. General Status Table

### Email Sending Points Matrix

| # | File | Line | Endpoint | Send Function | email_logs | Volume | Delay |
|---|------|------|----------|--------------|------------|--------|-------|
| 1 | webhook.js | 269 | POST /api/webhook/zoho/:org/:expo/:form | `sendEmailWithReplyTo()` | NO | 1/call | None |
| 2 | visitors.js | 294 | POST /api/visitors/public | `sendEmailWithReplyTo()` | NO | 1/call | None |
| 3 | visitors.js | 615 | POST /api/visitors/import | `sendEmailWithReplyTo()` | NO | 0-N/call | 100ms |
| 4 | visitors.js | 710 | POST /api/visitors/import | `sendEmailWithReplyTo()` | NO | 0-N/call | 100ms |
| 5 | emailSend.js | 89 | POST /api/email-send/single | `sendEmailWithReplyTo()` | YES | 1/call | None |
| 6 | emailSend.js | 211 | POST /api/email-send/bulk | `sendEmailWithReplyTo()` | YES | N/call | 100ms |
| 7 | emailSegments.js | 159 | POST /api/email-segments/send | `sendEmail()` | YES | N/call | 300ms |

### Key: email_worker.js (Reference Implementation)

| Property | Value |
|----------|-------|
| Send Function | `sendEmailWithReplyTo()` |
| Polling Interval | 2000ms |
| Max Retries | 5 (via try_count) |
| Locking | `FOR UPDATE SKIP LOCKED` (atomic) |
| Modes | 3 (Direct HTML, Visitor+Template, Template-only) |
| Tracking | status, sent_at, error_message, try_count, last_try |
| Shutdown | SIGINT + SIGTERM graceful handlers |

---

## 2. File-by-File Detail

### 2.1 webhook.js — Line 269

**Endpoint:** `POST /api/webhook/zoho/:organizer_id/:expo_id/:form_id`
**Auth:** x-webhook-token header (no JWT, no authMiddleware)
**Trigger:** Zoho form submission (external)

```
Send: await sendEmailWithReplyTo(email, subjectLine, html, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | `forms JOIN email_templates` via form's `email_template_id` |
| Recipient type | Single visitor (webhook payload) |
| QR included | Yes (`<img>` tag, existing or newly generated) |
| Custom fields | Yes — spread into emailData |
| visitor_id available | Yes (INSERT/UPDATE RETURNING) |
| template_id available | Yes (from forms table) |
| Error handling | try/catch around email block — email failure logged but doesn't fail webhook response |
| email_logs written | **NO** |
| Post-send operations | Console.log only |
| Synchronous expectation | **None** — webhook returns success regardless of email outcome |
| Caller waits for email result | No (email send is inside `if (email && emailTemplate)` block, webhook responds after) |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id both available)
- visitor_id: Available from INSERT/UPDATE RETURNING (line ~190-220)
- template_id: Available from forms table query (line ~225)
- No email_logs dependency to maintain
- Webhook caller (Zoho) doesn't care about email status
- **Easiest migration target** — fire-and-forget pattern already exists

---

### 2.2 visitors.js — POST /public — Line 294

**Endpoint:** `POST /api/visitors/public`
**Auth:** None (public endpoint)
**Trigger:** Public form submission by visitor

```
Send: await sendEmailWithReplyTo(visitorData.email, emailSubject, emailHtml, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | Form's `email_template_id` → `email_templates` |
| Recipient type | Single visitor (form submitter) |
| QR included | Yes (`<img>` tag) |
| Custom fields | Yes — `...(custom_fields \|\| {})` spread into emailData |
| visitor_id available | Yes (INSERT/UPDATE RETURNING) |
| template_id available | Yes (form's `email_template_id`) |
| Error handling | **WEAK** — email error bubbles up to endpoint catch, returns 500 to user |
| email_logs written | **NO** |
| Post-send operations | None |
| Synchronous expectation | **Partial** — response includes success message but email failure kills entire request |
| Resend logic | Existing visitor gets "(Resent)" subject suffix |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id)
- **Critical bug found:** If `sendEmailWithReplyTo` throws, the entire form submission returns 500 even though the visitor was already saved to DB. Migration to queue would fix this — visitor save succeeds, email is async.
- No email_logs dependency
- Form submitter sees "Registration successful" regardless of email — behavior improves with queue

---

### 2.3 visitors.js — POST /import (existing visitors) — Line 615

**Endpoint:** `POST /api/visitors/import`
**Auth:** authMiddleware (JWT)
**Trigger:** Excel import, per-row for existing visitors (when `existing_email_option` is 'resent' or 'first_time')

```
Send: await sendEmailWithReplyTo(email, emailSubject, emailHtml, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | `existing_template_id` (separate from main import template) |
| Recipient type | Existing visitor (matched by email + expo_id) |
| QR included | Yes (`<img>` tag, existing QR preserved) |
| Custom fields | Yes — `...customFields` spread into templateData |
| visitor_id available | Yes (from SELECT existing.rows[0].id) |
| template_id available | Yes (`existing_template_id` from request) |
| Error handling | try/catch per row — email failure logged, import continues |
| email_logs written | **NO** |
| Post-send operations | `results.email_sent_count++` |
| Delay | 100ms per email |
| Synchronous expectation | **Counter dependency** — `email_sent_count` in response requires knowing how many succeeded |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id)
- **Volume risk:** Large imports (500+ rows) = 500+ synchronous SendGrid calls. This is the #1 timeout risk in the system.
- Counter dependency: `email_sent_count` would become "emails queued" instead of "emails sent" — needs frontend messaging change
- Import already tolerates email failure (try/catch per row) — queue is natural fit
- `import_logs` table stores `email_sent_count` — semantics would change to "emails queued"

---

### 2.4 visitors.js — POST /import (new visitors) — Line 710

**Endpoint:** `POST /api/visitors/import` (same endpoint as 2.3)
**Auth:** authMiddleware (JWT)
**Trigger:** Excel import, per-row for new visitors (when `emailTemplate` is set)

```
Send: await sendEmailWithReplyTo(email, emailSubject, emailHtml, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | `email_template_id` (main import template) |
| Recipient type | New visitor (just inserted) |
| QR included | Yes (`<img>` tag, newly generated) |
| Custom fields | Yes — `...customFields` spread into templateData |
| visitor_id available | Yes (INSERT RETURNING) |
| template_id available | Yes (`email_template_id` from request) |
| Error handling | try/catch per row — email failure logged, import continues |
| email_logs written | **NO** |
| Post-send operations | `results.email_sent_count++` |
| Delay | 100ms per email |
| Synchronous expectation | **Same as 2.3** — counter dependency |

**Migration notes:**
- Identical pattern to 2.3. Same risks, same queue mode (Mode 2).
- Points 2.3 and 2.4 must be migrated together (same endpoint, same response structure).

---

### 2.5 emailSend.js — POST /single — Line 89

**Endpoint:** `POST /api/email-send/single`
**Auth:** authMiddleware (JWT)
**Trigger:** Admin sends single email from Send Emails page

```
Send: const success = await sendEmailWithReplyTo(recipient.email, subject, html, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | `email_templates` by `template_id` |
| Recipient type | Single recipient (admin-specified) |
| QR included | Yes (`<img>` tag, looks up existing visitor QR) |
| Custom fields | **NO** — emailData does NOT spread custom_fields |
| visitor_id available | Yes (from save_to_database or existing lookup) |
| template_id available | Yes |
| Error handling | Catch fails entire request (returns 500) |
| email_logs written | **YES** — `(organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)` |
| Post-send operations | email_logs INSERT + response with `visitor_id` and `badge_url` |
| Synchronous expectation | **HIGH** — response tells admin if email succeeded or failed |
| Return value used | `success` boolean determines email_logs status ('sent' vs 'failed') |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id)
- **Synchronous dependency:** Admin expects immediate "Email sent" or "Email failed" feedback. With queue, response would be "Email queued" — UX change needed.
- **email_logs dependency:** Currently written immediately after send. With queue, email_worker would need to write email_logs — or the endpoint writes "queued" status and worker updates to sent/failed.
- **Missing custom_fields:** emailData doesn't include `...custom_fields`. This is a pre-existing gap (not related to migration).
- Most complex migration due to email_logs + synchronous UX expectations

---

### 2.6 emailSend.js — POST /bulk — Line 211

**Endpoint:** `POST /api/email-send/bulk`
**Auth:** authMiddleware (JWT)
**Trigger:** Admin sends bulk email from Send Emails page

```
Send: const success = await sendEmailWithReplyTo(recipient.email, subject, html, 'reply@replies.leena.app')
```

| Property | Value |
|----------|-------|
| Template source | `email_templates` by `template_id` |
| Recipient type | Multiple recipients (admin-specified array) |
| QR included | Yes (`<img>` tag, per-recipient existing QR lookup) |
| Custom fields | **NO** — emailData does NOT spread custom_fields |
| visitor_id available | Yes (from save_to_database or existing lookup) |
| template_id available | Yes |
| Error handling | try/catch per recipient — collects errors array |
| email_logs written | **YES** — same columns as single, per recipient |
| Post-send operations | email_logs INSERT + counters (sent_count, saved_count, errors[]) |
| Delay | 100ms between recipients |
| Synchronous expectation | **HIGH** — response includes `sent_count`, `saved_count`, `errors[]` |
| Return value used | `success` boolean per recipient |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id per recipient)
- **Volume risk:** Bulk sends can target 100s of recipients. Current 100ms delay means 100 recipients = 10 seconds minimum.
- **Synchronous counter dependency:** `sent_count` in response requires knowing actual delivery status. Queue would change to "queued_count".
- **email_logs dependency:** Same as single — immediate write needed.
- save_to_database logic runs BEFORE email — visitor creation is separate from email sending. Queue migration wouldn't affect visitor creation.
- **Hardest migration target** due to email_logs + synchronous counters + per-recipient error tracking

---

### 2.7 emailSegments.js — POST /send — Line 159

**Endpoint:** `POST /api/email-segments/send`
**Auth:** authMiddleware (JWT, applied via `router.use()`)
**Trigger:** Admin sends segment-based email (checked_in / not_checked_in)

```
Send: const success = await sendEmail(visitor.email, subject, html)
```

**CRITICAL DIFFERENCE:** Uses `sendEmail()` NOT `sendEmailWithReplyTo()`

| Property | Value |
|----------|-------|
| Template source | `email_templates` by `template_id` |
| Recipient type | All visitors matching segment (checked_in or not_checked_in) |
| QR included | Yes (`<img>` tag) |
| Custom fields | **NO** — emailData does NOT spread custom_fields |
| visitor_id available | Yes (from visitor query) |
| template_id available | Yes |
| Error handling | try/catch per visitor — logs failed emails to email_logs too |
| email_logs written | **YES** — but **DIFFERENT columns**: `(organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)` |
| Post-send operations | email_logs INSERT + counters (total_sent, total_failed) |
| Delay | **300ms** between recipients (3x more than emailSend bulk) |
| Synchronous expectation | **HIGH** — response includes `total_targeted`, `total_sent`, `total_failed` |

**Migration notes:**
- Queue mode: **Mode 2** (visitor_id + template_id)
- **Send function mismatch:** Uses `sendEmail()` while email_worker uses `sendEmailWithReplyTo()`. Migration would change email behavior (adds reply-to header). Need to verify this is acceptable.
- **email_logs column mismatch:** emailSegments uses `recipient, recipient_email, recipient_name, subject` columns that emailSend does NOT use. These may exist in production but not in initial.sql. email_worker doesn't write email_logs at all currently.
- **Longer delay (300ms):** Segment sends are more conservative. 300 recipients = 90 seconds minimum. Queue would handle this better.
- Failed emails are ALSO logged to email_logs (line 192-207) — good practice, but shows different error flow.

---

## 3. Cross-Cutting Analysis

### 3.1 email_logs Column Schema Conflict

Two different INSERT schemas exist:

**emailSend.js** (single + bulk):
```sql
INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
```

**emailSegments.js:**
```sql
INSERT INTO email_logs (organizer_id, template_id, expo_id, recipient, recipient_email, recipient_name, subject, status, visitor_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
```

| Column | emailSend | emailSegments | Conflict? |
|--------|-----------|---------------|-----------|
| organizer_id | Yes | Yes | OK |
| expo_id | Yes | Yes | OK |
| visitor_id | Yes | Yes | OK |
| template_id | Yes | Yes | OK |
| email | Yes | No | emailSegments uses 'recipient' instead |
| recipient | No | Yes | emailSend uses 'email' instead |
| recipient_email | No | Yes | **Extra column** |
| recipient_name | No | Yes | **Extra column** |
| subject | No | Yes | **Extra column** |
| status | Yes | Yes | OK |
| message | Yes | No | emailSend stores "Subject: X \| To: Y" |
| sent_at | Yes (NOW()) | No | emailSegments uses 'created_at' |
| created_at | No | Yes (NOW()) | emailSend uses 'sent_at' |

**Impact:** The `email-history.html` endpoint reads `email, status, message, sent_at` — emailSegments rows may not populate `email` or `sent_at` correctly. Need to verify production column existence.

### 3.2 Send Function Divergence

| File | Function | Reply-To Header |
|------|----------|----------------|
| webhook.js | `sendEmailWithReplyTo()` | reply@replies.leena.app |
| visitors.js (all 3 points) | `sendEmailWithReplyTo()` | reply@replies.leena.app |
| emailSend.js (both) | `sendEmailWithReplyTo()` | reply@replies.leena.app |
| emailSegments.js | `sendEmail()` | **NONE** |
| email_worker.js | `sendEmailWithReplyTo()` | reply@replies.leena.app |

**Impact:** emailSegments emails currently have NO reply-to header. Migrating to email_worker would ADD reply-to. This changes email behavior — replies that currently go to the from-address would go to reply@replies.leena.app instead.

### 3.3 Custom Fields in Email Templates

| File | custom_fields spread | {{conference_topic}} works? |
|------|---------------------|---------------------------|
| webhook.js | Yes | Yes |
| visitors.js /public | Yes | Yes |
| visitors.js /import | Yes | Yes |
| emailSend.js /single | **NO** | **NO** |
| emailSend.js /bulk | **NO** | **NO** |
| emailSegments.js | **NO** | **NO** |
| email_worker.js Mode 2 | Yes | Yes |

**Impact:** emailSend and emailSegments don't support custom_field placeholders. This is a pre-existing gap. Migration to email_worker Mode 2 would automatically fix emailSend (worker spreads custom_fields), but emailSegments would also gain this — which is a behavior change.

### 3.4 Error Resilience

| File | Email failure impact | Caller impact |
|------|---------------------|---------------|
| webhook.js | Logged only | None (webhook returns 200 regardless) |
| visitors.js /public | **Kills entire request** (bubbles to catch) | User sees 500 error despite visitor being saved |
| visitors.js /import | Per-row catch | Import continues, email_sent_count not incremented |
| emailSend.js /single | Kills request | Admin sees "Email send failed" |
| emailSend.js /bulk | Per-recipient catch | Collected in errors[] array |
| emailSegments.js | Per-visitor catch + fail logged | Counter incremented, total_failed returned |

**Critical finding:** visitors.js /public has a bug where email failure causes 500 response even though the visitor record was already successfully created. Queue migration fixes this automatically.

---

## 4. Migration Order (Safest to Riskiest)

### Priority 1: webhook.js (RISK: LOW)

**Why safest:**
- Single email per call (no batch/loop concerns)
- No email_logs dependency (nothing to replicate)
- External trigger (Zoho) doesn't care about email delivery timing
- Already fire-and-forget pattern (email failure doesn't affect response)
- visitor_id + template_id both immediately available

**Migration approach:**
```javascript
// Replace: await sendEmailWithReplyTo(email, subjectLine, html, 'reply@replies.leena.app');
// With:
await pool.query(`
  INSERT INTO email_queue (visitor_id, template_id, status, created_at)
  VALUES ($1, $2, 'pending', NOW())
`, [visitor.id, templateId]);
```

**Concerns:** None significant. Custom fields would be handled by email_worker Mode 2's custom_fields spread.

---

### Priority 2: visitors.js /public (RISK: LOW)

**Why safe:**
- Single email per call
- No email_logs dependency
- Public form submitter expects registration confirmation, not delivery guarantee
- **Bonus:** Fixes the email-failure-kills-request bug

**Migration approach:** Same as webhook — Mode 2 INSERT into email_queue.

**Concerns:**
- Subject line "(Resent)" logic currently happens before sending. Queue would need this logic either:
  - Pre-processed and stored in email_queue (extra column or direct HTML mode)
  - Or email_worker Mode 2 enhanced with "resent" flag
- Simpler: Use direct HTML mode (Mode 1) to send pre-processed HTML

---

### Priority 3: visitors.js /import (RISK: MEDIUM)

**Why medium:**
- High volume (100s-1000s of emails per import)
- Two separate email points (existing line 615 + new line 710) — must migrate both
- Counter dependency: `email_sent_count` becomes "queued" not "sent"
- import_logs stores `email_sent_count` — semantics change

**Migration approach:**
```javascript
// Replace each sendEmailWithReplyTo with:
await pool.query(`
  INSERT INTO email_queue (visitor_id, template_id, status, created_at)
  VALUES ($1, $2, 'pending', NOW())
`, [visitorId, templateId]);
results.email_sent_count++; // Now means "email_queued_count"
```

**Concerns:**
- Frontend import.html shows "Emails sent: X" — would need label change to "Emails queued: X"
- Import response time dramatically improves (no more 100ms × N delay)
- import_logs `email_sent_count` column semantics change
- Custom field placeholders still work (email_worker Mode 2 spreads custom_fields)
- "(Resent)" subject logic for existing visitors needs pre-processing

**Recommended sub-step:** Rename `email_sent_count` to `email_queued_count` in import_logs and frontend, or keep column name but update tooltip/label.

---

### Priority 4: emailSend.js /single (RISK: MEDIUM-HIGH)

**Why riskier:**
- email_logs currently written synchronously with exact sent/failed status
- Admin expects immediate feedback ("Email sent" vs "Email failed")
- UX change required: "Email sent" → "Email queued"

**Migration approach:**
- Option A: Queue only — INSERT email_queue, return "queued", email_worker writes email_logs after send
- Option B: Hybrid — INSERT email_queue + INSERT email_logs with status='queued', worker updates to sent/failed

**Concerns:**
- email-history.html reads email_logs — new "queued" status would need frontend handling
- email_worker currently does NOT write to email_logs — requires email_worker enhancement
- visitor_id is available but may be null (when save_to_database=false and no existing visitor)
- Pre-existing gap: custom_fields not spread in emailData — queue won't fix this unless template_id mode is used

---

### Priority 5: emailSend.js /bulk (RISK: HIGH)

**Why risky:**
- Same as single, plus:
- Response includes `sent_count`, `saved_count`, `errors[]` — all depend on synchronous email results
- Batch INSERT into email_queue needed (N recipients)
- Per-recipient error tracking lost (queue processes async)
- save_to_database creates visitors first, then sends — visitor creation MUST remain synchronous

**Migration approach:**
- Visitor creation (save_to_database) stays synchronous
- Email sending moved to queue: bulk INSERT into email_queue
- Response changes: `sent_count` → `queued_count`, `errors[]` only for non-email errors
- email_worker handles email_logs writing

**Concerns:**
- Significant UX change for admin
- Error tracking granularity reduced
- Need bulk INSERT pattern for email_queue (N values in one query, or loop INSERT)

---

### Priority 6: emailSegments.js (RISK: HIGH)

**Why riskiest:**
- **Send function mismatch:** Uses `sendEmail()` not `sendEmailWithReplyTo()` — migration changes email behavior
- **email_logs column mismatch:** Uses different column names (`recipient`, `recipient_email`, `recipient_name`, `subject` vs `email`, `message`)
- Response includes sync counters: `total_targeted`, `total_sent`, `total_failed`
- Volume can be very large (entire segment of visitors)

**Migration approach:**
- Segment query stays synchronous (determine target list)
- Bulk INSERT into email_queue for all targeted visitors
- Response: `total_targeted`, `total_queued` (not `total_sent`)
- email_worker would need to write email_logs with emailSegments' column schema — OR normalize both to one schema

**Concerns:**
- **email_logs normalization required first** — must unify column schema between emailSend and emailSegments before migrating either
- Reply-to behavior change: emails gain reply-to header they didn't have before
- 300ms delay disappears (queue processes at its own rate) — SendGrid rate limit risk if worker processes faster
- Failed email logging currently happens in both success and catch blocks — worker would handle this differently

---

## 5. Risk Assessment Summary

| Priority | File:Line | Risk | Queue Mode | email_logs | UX Change |
|----------|-----------|------|------------|------------|-----------|
| 1 | webhook.js:269 | LOW | Mode 2 | N/A (none to migrate) | None |
| 2 | visitors.js:294 | LOW | Mode 2 | N/A (none to migrate) | None (fixes bug) |
| 3 | visitors.js:615,710 | MEDIUM | Mode 2 | N/A (none to migrate) | "sent" → "queued" label |
| 4 | emailSend.js:89 | MEDIUM-HIGH | Mode 2 | Must add to worker | "sent/failed" → "queued" |
| 5 | emailSend.js:211 | HIGH | Mode 2 | Must add to worker | Major: counters/errors |
| 6 | emailSegments.js:159 | HIGH | Mode 2 | Schema conflict | Major: counters + reply-to |

---

## 6. Prerequisites Before Any Migration

### 6.1 email_logs Schema Normalization
Before migrating emailSend.js or emailSegments.js, unify email_logs INSERT columns:
- Decide on canonical column set
- Add missing columns to both flows (or deprecate extras)
- Verify production DB has all referenced columns

### 6.2 email_worker Enhancement
Current email_worker does NOT write email_logs. For Priority 4-6 migration:
- Add email_logs INSERT to `markAsSent()` and `markAsFailed()`
- Need `organizer_id`, `expo_id`, `template_id` in email_queue (or joined)
- Current email_queue already has `visitor_id` and `template_id` — missing `organizer_id` and `expo_id`

### 6.3 email_queue Schema Check
Verify email_queue has (or can be extended with):
- `organizer_id` (for email_logs writing)
- `expo_id` (for email_logs writing)
- Mode 2 JOINs through `visitor_id → visitors.expo_id/organizer_id` — may work without extra columns

### 6.4 Frontend Messaging Update
Any queue migration changes "sent" to "queued". Pages affected:
- import.html: "Emails sent: X" label
- email-send.html: success/failure toast messages
- email-segments.html: result counters

---

## 7. Rollback Strategy

### Per-Priority Rollback

| Priority | Rollback Method | Data Impact |
|----------|----------------|-------------|
| 1 (webhook) | Revert to direct send | None (no email_logs affected) |
| 2 (public form) | Revert to direct send | None |
| 3 (import) | Revert to direct send | email_sent_count semantics revert |
| 4-5 (emailSend) | Revert to direct send + keep email_logs writes | Pending queue items need manual flush |
| 6 (emailSegments) | Revert to direct send | Pending queue items need manual flush |

### General Rollback Steps
1. Revert route file to pre-migration version (git revert)
2. Check email_queue for `status='pending'` items from the reverted flow
3. Either: let email_worker process remaining items, OR mark as 'cancelled'
4. Verify email_logs data integrity
5. No DB schema rollback needed (email_queue columns are additive)

### Emergency: email_worker Down
If email_worker crashes after migration:
- Emails queue up in email_queue with status='pending'
- No data loss — emails are saved with all required data
- Restart worker → emails process automatically (FIFO)
- MAX_RETRIES=5 prevents infinite retry loops

---

## 8. Quick Win Recommendations (No Migration Needed)

These issues can be fixed WITHOUT migrating to queue:

1. **visitors.js /public email error handling (line 294):** Wrap email send in its own try/catch so email failure doesn't return 500 to form submitter. Visitor is already saved at this point.

2. **email_logs for webhook.js and visitors.js:** Add email_logs INSERT after each direct send (same pattern as emailSend.js). This gives visibility into ALL email operations, not just admin-triggered ones.

3. **emailSegments sendEmail → sendEmailWithReplyTo:** Align send function with all other flows. Adds reply-to header for consistency.

4. **emailSend custom_fields gap:** Add `...custom_fields` spread to emailData in single and bulk routes. Pre-existing bug — custom_field placeholders don't work in admin Send Emails.

5. **email_logs column normalization:** Align emailSegments' INSERT columns with emailSend's schema. Both should use the same column names.

---

## Appendix: email_worker Mode Compatibility

| Current Flow | Best Queue Mode | Required Data | Available? |
|-------------|----------------|---------------|------------|
| webhook.js | Mode 2 (visitor+template) | visitor_id, template_id | Yes |
| visitors.js /public | Mode 2 | visitor_id, template_id | Yes |
| visitors.js /import (existing) | Mode 2 | visitor_id, existing_template_id | Yes |
| visitors.js /import (new) | Mode 2 | visitor_id, template_id | Yes |
| emailSend.js /single | Mode 2 | visitor_id, template_id | Yes (may be null) |
| emailSend.js /bulk | Mode 2 | visitor_id, template_id | Yes (per recipient) |
| emailSegments.js | Mode 2 | visitor_id, template_id | Yes |

**Note:** emailSend.js visitor_id can be null when `save_to_database=false` and visitor doesn't exist. In this case, Mode 3 (recipient_email + template_id) would be used, but custom email content (name, company from request body, not DB) would be lost. This edge case needs Mode 1 (direct HTML) for full compatibility.
