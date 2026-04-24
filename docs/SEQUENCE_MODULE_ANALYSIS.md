# Email Sequence Module — Pre-Implementation Analysis

**Date:** 2026-04-24
**Author:** Claude Code (system analysis)
**Status:** Awaiting approval — NO code written
**Context:** Yaprak needs multi-step email campaign for conference invitations. Fair in ~20 days.

---

## Section 1: Current State Map

### 1.1 Email Sending Infrastructure

**Three distinct send paths exist, none use a unified campaign concept:**

| Path | File | Uses Queue? | Rate Limit | Logging |
|------|------|------------|------------|---------|
| Bulk Send | `emailSend.js:124` POST /bulk | **NO** — direct SendGrid loop | 100ms delay | email_logs (per-send) |
| Segments | `emailSegments.js:35` POST /send | **NO** — direct SendGrid loop | 300ms delay | email_logs (per-send) |
| Worker (queue) | `email_worker.js` | **YES** — processes email_queue | 2s poll interval | email_logs (via logToEmailLogs) |

**Who puts items into email_queue:**
- `webhook.js:278` — Zoho form submission (Mode 2: visitor_id + template_id)
- `visitors.js:328` — Public form registration (Mode 1: pre-processed HTML)
- `visitors.js:678` — Import existing visitor email (Mode 1)
- `visitors.js:793` — Import new visitor email (Mode 1)
- `reactivation.js:626` — Activation badge email (Mode 1)
- `conferenceCertificates.js:196` — Certificate email (Mode 1)

**emailSend.js /bulk and emailSegments.js /send BYPASS the queue entirely.** They call `sendEmailWithReplyTo()` directly in a loop. This means:
- No retry on failure
- No FOR UPDATE protection against duplicates
- Rate limiting is only via setTimeout delays
- These are the paths Yaprak would use for conference invitations

### 1.2 email_queue Table Schema

**initial.sql definition (lines 98-108):**
```
id, organizer_id, expo_id, visitor_id, template_id, status, try_count, last_try, created_at
```

**Additional columns in production (not in initial.sql):**
```
recipient_email, subject, html_content, sent_at, error_message
```

**Status values:** `pending`, `processing`, `sent`, `failed`

### 1.3 email_logs Table Schema (initial.sql:111-121)
```
id, organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at
```
**Status values:** `sent`, `failed`, `queued`

No campaign_id, no batch_id, no sequence_id — each log entry is independent.

### 1.4 email_templates Table Schema (initial.sql:86-95)
```
id, organizer_id, name, subject, body, html_content, is_active, created_at
```
**Production extras:** `expo_id` (added via ALTER for expo-based grouping)

### 1.5 Reactivation "Campaign" Model

**There is NO campaigns table.** Campaigns are derived by grouping `reactivation_tokens` rows on `target_expo_id`:

```sql
-- reactivation.js:33-48
SELECT target_expo_id, e.name,
  COUNT(*) as total_tokens,
  COUNT(*) FILTER (WHERE rt.status = 'pending') as pending,
  COUNT(*) FILTER (WHERE rt.status = 'activated') as activated
FROM reactivation_tokens rt
JOIN expos e ON rt.target_expo_id = e.id
GROUP BY target_expo_id, e.name
```

**reactivation_tokens columns:**
```
id, token, target_expo_id, organizer_id, email, name, last_name, company,
country, job_title, phone, form_id, status, created_at, expires_at,
source_visitor_id, source_expo_id, activated_at, new_visitor_id
```

The "resend to pending" feature (`POST /resend-pending`) allows re-sending with a DIFFERENT template to unactivated tokens. This is the closest thing to a "follow-up" concept in the system.

### 1.6 SendGrid Integration

- **SDK:** `@sendgrid/mail` v8.1.5
- **Single function:** `sendEmailWithReplyTo(to, subject, html, replyToEmail)` in `utils/email.js:63`
- Returns boolean (`true`/`false`)
- All emails use `reply@replies.leena.app` as reply-to
- Sender: `process.env.SENDER_EMAIL || 'noreply@leena.app'`
- **No SendGrid Event Webhook configured** (checked: no endpoint for delivery/open/click events)

### 1.7 Worker Concurrency Safety

**FOR UPDATE SKIP LOCKED pattern (email_worker.js:29-37):**
```sql
UPDATE email_queue SET status = 'processing'
WHERE id = (
  SELECT id FROM email_queue
  WHERE status = 'pending' AND try_count < 5
  ORDER BY created_at ASC LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id
```
- Atomic lock + status update in one statement
- Within BEGIN/COMMIT transaction
- Other workers skip locked rows (SKIP LOCKED)
- Retry up to 5 times (MAX_RETRIES = 5)
- 2-second polling interval

**Render deploy overlap risk:** Minimal. The old instance stops (SIGTERM) before new starts. Even if brief overlap, FOR UPDATE SKIP LOCKED prevents double-processing.

### 1.8 Database Pool Configuration (utils/db.js)
- `max: 20` connections
- `connectionTimeoutMillis: 5000`
- `idleTimeoutMillis: 30000`
- `statement_timeout: 30000`
- SSL: `rejectUnauthorized: false`

### 1.9 Scheduler/Cron
**NONE.** No `node-cron`, `bullmq`, `agenda`, or any scheduler library. The email_worker polls in a `while(true)` loop with 2-second sleep. All other processing is request-driven.

---

## Section 2: Tracking Gap Analysis

### Open Tracking
**Status: ❌ DOES NOT EXIST**

No tracking pixel is inserted into any email HTML. The `processEmailTemplate()` function (utils/email.js:12) is a simple `{{placeholder}}` replacer — it does not inject any additional content.

**Required for sequence MVP?** YES — "send follow-up to those who didn't open" is a core sequence condition.

**Implementation approach:** Insert a 1x1 transparent pixel image before sending:
```html
<img src="https://leena.app/api/email-track/open/{email_log_id}" width="1" height="1" style="display:none;">
```
Endpoint records open event in a new `email_events` table.

**Estimated effort:** 4-6 hours (endpoint + pixel injection in email_worker + DB table)

**Risk:** LOW — additive change, doesn't modify existing email content behavior.

### Click Tracking
**Status: ❌ DOES NOT EXIST**

Email links are not wrapped. The HTML sent is exactly what the template contains.

**Required for sequence MVP?** NICE-TO-HAVE but not essential for Phase 1. "Didn't open" is a stronger signal than "didn't click." Can be added in Phase 2.

**Implementation approach:** Replace links in email HTML with redirect URL:
```
Original: <a href="https://example.com">
Wrapped:  <a href="https://leena.app/api/email-track/click/{event_id}?url=https://example.com">
```

**Estimated effort:** 6-8 hours (link parsing regex, redirect endpoint, click logging)

**Risk:** MEDIUM — link wrapping regex can break HTML in edge cases. Requires thorough testing.

### Bounce Handling
**Status: ❌ DOES NOT EXIST**

No SendGrid Event Webhook is configured. Bounced emails are not detected or tracked. The `emailInbound.js` route handles inbound reply forwarding, NOT delivery events.

**Required for sequence MVP?** IMPORTANT but not Day 1 blocker. Bounce data from SendGrid can be checked manually in SendGrid dashboard.

**Implementation approach:** Configure SendGrid Event Webhook → `POST /api/email-events/webhook` → log to `email_events` table.

**Estimated effort:** 4-6 hours (endpoint + SendGrid dashboard config + event processing)

**Risk:** LOW — new endpoint, no existing functionality affected.

### Unsubscribe
**Status: ❌ DOES NOT EXIST**

No `List-Unsubscribe` header. No unsubscribe link in emails. No unsubscribe table/column.

**Required for sequence MVP?** YES — legally required for marketing emails in many jurisdictions (CAN-SPAM, GDPR). Critical for conference invitation sequences.

**Implementation approach:**
- Add `email_unsubscribes` table: `(id, email, organizer_id, expo_id, created_at)`
- Add unsubscribe link to email footer
- Check unsubscribe list before sending
- Add `List-Unsubscribe` header to SendGrid call

**Estimated effort:** 6-8 hours

**Risk:** LOW-MEDIUM — need to add check to ALL send paths (worker, emailSend, emailSegments).

### Email Event Log
**Status: ⚠️ PARTIAL**

`email_logs` table exists and records `sent`/`failed`/`queued` status. But:
- No open/click/bounce events
- No event timestamp granularity (only `sent_at`)
- No batch/campaign association

**For sequence:** Need a new `email_events` table for fine-grained event tracking:
```
email_events (id, email_log_id, event_type, metadata, created_at)
-- event_type: 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed'
```

### Tracking Summary

| Feature | Status | MVP Priority | Effort |
|---------|--------|-------------|--------|
| Open tracking (pixel) | ❌ Missing | **MUST** | 4-6h |
| Click tracking (redirect) | ❌ Missing | Phase 2 | 6-8h |
| Bounce handling (webhook) | ❌ Missing | SHOULD | 4-6h |
| Unsubscribe | ❌ Missing | **MUST** | 6-8h |
| Event log table | ⚠️ Partial | **MUST** | 2-3h |

---

## Section 3: Design Options

### Option A: Extend Reactivation Module

**Approach:** Add `step_number` and `parent_token_id` to `reactivation_tokens`. Each step is a new token row linked to the parent. Worker checks step conditions before sending next step.

**Pros:**
- Leverages existing token verification + activation flow
- Frontend (reactivation-campaign.html) already has campaign management UI
- No new tables needed (extend existing)

**Cons:**
- reactivation_tokens is designed for "invite → activate" flow, NOT general marketing sequences
- Adding generic email conditions (open/click) to a token-based system is awkward
- The "resend pending" feature is not the same as "send step 2 to non-openers"
- Couples two distinct concepts — maintenance risk
- reactivation_tokens already has 15+ columns — adding sequence fields makes it unwieldy

**Backward compatibility risk:** HIGH — changing the core reactivation model could break existing campaigns.

**20-day timeline fit:** POOR — requires significant refactoring of existing working code.

### Option B: New "Email Campaigns" Module (Full)

**Approach:** Three new tables:
```sql
email_campaigns (id, organizer_id, expo_id, name, status, created_at)
campaign_steps (id, campaign_id, step_number, template_id, delay_hours, condition, condition_value)
campaign_recipients (id, campaign_id, visitor_id, email, current_step, status, last_event)
```

New route file `routes/emailCampaigns.js`. New frontend page `email-campaigns.html`.

**Pros:**
- Clean separation from existing modules
- Proper data model for multi-step sequences
- Extensible: A/B testing, branching conditions, post-expo follow-ups
- No backward compatibility risk (entirely new tables/routes)

**Cons:**
- Largest implementation effort
- New frontend page to build from scratch
- Campaign scheduler needed (cron or worker extension)
- 20-day timeline very tight for full implementation

**Backward compatibility risk:** NONE — additive only.

**20-day timeline fit:** TIGHT — could work with aggressive scoping.

### Option C: Minimal Sequence Layer on email_queue

**Approach:** One new table + 2 columns on email_queue:

```sql
-- New table
email_sequences (
  id, organizer_id, expo_id, name, status,
  steps JSONB,  -- [{step: 1, template_id, delay_hours, condition}]
  recipient_source JSONB,  -- {type: 'expo_visitors', expo_id, filter}
  created_at, updated_at
)

-- Extend email_queue
ALTER TABLE email_queue ADD COLUMN sequence_id INTEGER REFERENCES email_sequences(id);
ALTER TABLE email_queue ADD COLUMN step_number INTEGER DEFAULT 1;
```

Worker checks: "Is this a sequence email? If step N just sent, schedule step N+1 based on condition."

**Pros:**
- Minimal new infrastructure — reuses existing email_queue + worker
- JSONB steps = flexible, no separate campaign_steps table
- Worker already has retry logic — add sequence logic alongside
- Quick to implement

**Cons:**
- email_queue becomes dual-purpose (immediate sends + scheduled sequence sends)
- JSONB steps harder to query than normalized table
- Worker becomes more complex (send logic + scheduling logic)
- No per-recipient tracking beyond email_logs (need to correlate manually)

**Backward compatibility risk:** LOW — new nullable columns on email_queue, worker ignores them when null.

**20-day timeline fit:** GOOD — minimal surface area.

---

## Section 4: Recommended Approach

**Option B (New "Email Campaigns" Module) — scoped aggressively for Phase 1.**

Rationale: Option A contaminates working reactivation code. Option C puts too much complexity in the worker and email_queue (already dual-purpose). Option B is the only approach that doesn't touch existing working code AT ALL. With aggressive Phase 1 scoping (see Section 5), it fits the 20-day timeline.

The key insight: Yaprak's immediate need is NOT a complex automation engine. It's:
1. Send email to a list
2. Wait N days
3. Check who didn't open
4. Send them a follow-up

This is 2 steps max, 1 condition (open tracking). That's achievable in 20 days with Option B's clean architecture.

---

## Section 5: Phase 1 MVP Scope (Fair Deadline — 20 Days)

### 5.1 New Database Tables

```sql
-- 1. Campaign definition
CREATE TABLE email_campaigns (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES organizers(id),
  expo_id INTEGER REFERENCES expos(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',  -- draft, active, paused, completed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Campaign steps (each step = one email in the sequence)
CREATE TABLE campaign_steps (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL DEFAULT 1,
  template_id INTEGER REFERENCES email_templates(id),
  delay_hours INTEGER DEFAULT 0,        -- hours after previous step (0 = immediate)
  condition VARCHAR(50) DEFAULT 'all',  -- 'all', 'not_opened', 'not_clicked', 'opened', 'clicked'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, step_number)
);

-- 3. Campaign recipients (per-person tracking)
CREATE TABLE campaign_recipients (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  visitor_id INTEGER REFERENCES visitors(id),
  name VARCHAR(255),
  current_step INTEGER DEFAULT 0,       -- last completed step
  status VARCHAR(20) DEFAULT 'active',  -- active, completed, unsubscribed, bounced
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, email)
);

-- 4. Email events (open/click/bounce tracking)
CREATE TABLE email_events (
  id SERIAL PRIMARY KEY,
  email_log_id INTEGER REFERENCES email_logs(id),
  campaign_id INTEGER REFERENCES email_campaigns(id),
  recipient_email VARCHAR(255),
  event_type VARCHAR(20) NOT NULL,      -- 'sent', 'opened', 'clicked', 'bounced'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_events_campaign ON email_events(campaign_id);
CREATE INDEX idx_email_events_email ON email_events(recipient_email);
CREATE INDEX idx_email_events_type ON email_events(event_type);

-- 5. Unsubscribe list
CREATE TABLE email_unsubscribes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  organizer_id INTEGER REFERENCES organizers(id),
  expo_id INTEGER REFERENCES expos(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, organizer_id)
);
```

### 5.2 New API Endpoints

```
POST   /api/campaigns              — Create campaign (name, expo_id)
GET    /api/campaigns?expo_id=X    — List campaigns for expo
GET    /api/campaigns/:id          — Campaign detail + steps + recipient stats
PUT    /api/campaigns/:id          — Update campaign (name, status)
DELETE /api/campaigns/:id          — Delete campaign (draft only)

POST   /api/campaigns/:id/steps    — Add step (template_id, delay_hours, condition)
PUT    /api/campaigns/:id/steps/:stepId — Update step
DELETE /api/campaigns/:id/steps/:stepId — Delete step

POST   /api/campaigns/:id/recipients — Add recipients (from expo visitors or CSV)
POST   /api/campaigns/:id/start    — Activate campaign (enqueue step 1)
POST   /api/campaigns/:id/pause    — Pause campaign

GET    /api/email-track/open/:eventId — Open tracking pixel (1x1 PNG response)
GET    /api/email-track/click/:eventId — Click redirect (log + redirect)
POST   /api/email-track/unsubscribe   — Unsubscribe endpoint
```

### 5.3 New Frontend Page

`email-campaigns.html` — Campaign management:
- Campaign list (name, status, recipients count, step progress)
- Campaign detail: step editor (template + delay + condition per step)
- Recipient source: "Import from expo" or "Upload CSV"
- Campaign stats: per-step open rates, completion funnel
- Start/Pause/Resume controls

### 5.4 Tracking — What's Required for Phase 1

| Feature | Phase 1? | Notes |
|---------|---------|-------|
| Open tracking pixel | **YES** | Required for "not_opened" condition |
| Click tracking redirect | No | Phase 2 |
| Unsubscribe link + table | **YES** | Legal requirement for marketing emails |
| SendGrid event webhook | No | Phase 2 (use our own pixel for opens) |
| Email events table | **YES** | Stores open/click events |

### 5.5 Campaign Execution Logic

**Option:** Extend email_worker.js with a campaign check cycle:

Every 60 seconds (separate from the 2-second queue poll):
1. Find active campaigns with pending next steps
2. For each campaign: find recipients at step N where delay_hours elapsed since step N was sent
3. Check condition: if condition = 'not_opened', check email_events for opens
4. Enqueue step N+1 emails into email_queue (Mode 1: pre-processed HTML)
5. Update campaign_recipients.current_step

**Alternative:** Separate `campaign_worker.js` (recommended — keeps concerns separate).

### 5.6 Estimated Sprint Plan

| Sprint | Duration | Scope |
|--------|----------|-------|
| Sprint 1 | 2-3 days | DB tables + campaign CRUD API + basic frontend page |
| Sprint 2 | 2-3 days | Open tracking pixel + email_events + unsubscribe |
| Sprint 3 | 2-3 days | Campaign execution logic (worker) + step scheduling |
| Sprint 4 | 2-3 days | Frontend: step editor, recipient management, stats |
| Sprint 5 | 1-2 days | Testing with real data, edge cases, Yaprak UAT |

**Total: ~10-14 days development** (fits 20-day timeline with buffer)

---

## Section 6: Phase 2 Scope (Post-Fair)

- Click tracking (link wrapping + redirect endpoint)
- SendGrid Event Webhook integration (delivered, bounced, dropped events)
- A/B testing (multiple templates per step, winner selection)
- Branching conditions (if opened → path A, if not → path B)
- Campaign templates (save & reuse campaign structures)
- Post-expo thank-you email sequence
- No-show follow-up sequence
- Campaign analytics dashboard (open rate trends, best-performing templates)
- Cross-expo campaign (target visitors from multiple expos)
- Campaign cloning between expos

---

## Section 7: Open Questions

### Product Decisions (Must answer before implementation)

1. **Recipient scope:** Should sequences target visitors (expo-scoped, visitor_id) or email addresses (global, cross-expo)? The visitors table has `(email, expo_id)` compound uniqueness — same person in two expos = two rows. If Yaprak wants to email "everyone who attended Nigeria 2025 AND Ghana 2026", we need cross-expo querying.

2. **Unsubscribe scope:** Per-organizer? Per-expo? Global? If someone unsubscribes from a conference invitation sequence, should they stop receiving badge emails too?

3. **SendGrid quota:** What's the daily send limit? A conference invitation to 5,000 people with 2-step follow-up = 10,000 emails over a week. Is this within the plan?

4. **SendGrid API key tier:** Does the current SendGrid plan support Event Webhook (for delivery events)? Or is it a free/basic tier?

5. **"Didn't open" timing:** How long to wait before classifying someone as "didn't open"? 24h? 48h? 72h? This is the `delay_hours` for step 2.

6. **Yaprak's exact workflow:** Is it:
   - Step 1: Conference invitation (day 0)
   - Step 2: Reminder to non-openers (day 3?)
   - Step 3: Final reminder (day 7?)
   Or something different? How many steps exactly?

7. **Template authoring:** Will Yaprak create the email templates herself (in email-templates.html) or does she need help? The template editor is HTML-based.

8. **Recipient list source:** Where does the "old visitor data" come from? A specific expo? An Excel export from Zoho? Import from CSV?

9. **Form registration link in email:** Should the conference invitation email contain a public form link (form-public.html) for registration? If yes, which form? This connects to the form design system.

10. **Multi-language:** Are emails in English only? Or English + Turkish?

### Technical Decisions

11. **Campaign worker:** Separate `campaign_worker.js` process on Render, or extend existing `email_worker.js`? Separate is cleaner but costs another Render Background Worker slot.

12. **Open tracking pixel hosting:** Self-hosted (on leena.app) or via SendGrid's built-in open tracking? Self-hosted gives full control but adds an endpoint. SendGrid's requires Event Webhook which we don't have yet.

13. **Tracking pixel privacy:** Some email clients (Apple Mail, Hey) block tracking pixels. The "not_opened" condition will have false negatives. Is this acceptable for the use case?

14. **email_queue vs direct send for campaign emails:** Should campaign step emails go through email_queue (async, retry-safe) or be sent directly like emailSend.js/bulk? Queue is safer but adds latency.

---

## Section 8: Risks

### Canlı Sistem Riski

| Risk | Severity | Mitigation |
|------|----------|------------|
| New tables on production DB | LOW | Additive only (CREATE TABLE IF NOT EXISTS), no existing tables modified |
| email_worker modification (if chosen) | MEDIUM | Use separate campaign_worker.js instead |
| email_queue schema change (Option C) | MEDIUM | Not recommended — use Option B instead |
| Tracking pixel endpoint under load | LOW | Simple DB INSERT + 1x1 PNG response, minimal compute |
| SendGrid rate limiting on bulk campaign sends | MEDIUM | Use email_queue with worker (built-in rate control via 2s poll) |
| Unsubscribe check slowing existing send paths | LOW | Simple SELECT before send, index on (email, organizer_id) |
| Fair 20 days away — rushed implementation | HIGH | Aggressive scope control, Phase 1 = minimum viable, Yaprak UAT before fair |

### Rollback Strategy

All changes are ADDITIVE:
- New tables: DROP TABLE IF EXISTS (no cascading impact on existing tables)
- New route files: Remove from index.js mount list
- New frontend page: Delete HTML file
- email_worker: If extending, revert to previous version (git)
- Tracking pixel: If endpoint removed, emails still work (pixel returns 404, email renders fine)

**Zero impact on existing webhook/reactivation/bulk send/import/check-in flows** — Option B ensures complete isolation.
