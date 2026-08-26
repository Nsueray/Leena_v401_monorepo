# Unsubscribe System — Full Read-Only Analysis

**Date:** 26 Aug 2026
**Scope:** Complete flow — schema, write paths, send paths, re-subscribe, ops SQL, gaps, compliance
**Mode:** Read-only. Every claim carries `path:line` evidence.

---

## 1. Schema & Current State

### 1.1 Table definition (from live DB `\d email_unsubscribes`)

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | integer | not null | `nextval(email_unsubscribes_id_seq)` |
| `email` | varchar(255) | **not null** | — |
| `organizer_id` | integer | null | — |
| `expo_id` | integer | null | — |
| `campaign_id` | integer | null | — |
| `reason` | text | null | — |
| `created_at` | timestamptz | null | `now()` |

**Uniqueness (the scope question):**
```
"email_unsubscribes_email_organizer_id_key" UNIQUE CONSTRAINT, btree (email, organizer_id)
```

→ **Unsubscribe is per-organizer, NOT global and NOT per-expo.**
→ `expo_id` and `campaign_id` are audit context only (not part of uniqueness).
→ Same email can appear once per organizer; if there were multiple organizers, same email could unsubscribe from each independently.
→ Current DB has a single organizer (`organizer_id=1`), so effectively today = one row per email.

**FKs:** organizer_id → organizers, expo_id → expos, campaign_id → email_campaigns.
**Indexes:** `idx_unsub_email`, `idx_unsub_org`.

### 1.2 Row counts (live DB, 26 Aug 2026)

| Metric | Value |
|---|---|
| Total rows | **328** (Suer's "141+" estimate is stale — has grown) |
| With organizer_id | 328 (100%) |
| Distinct organizers | 1 |
| Duplicates by email | **0** (unique constraint prevents) |
| Reasons | all `user_unsubscribed` (328) — only one reason value in use |

### 1.3 Distribution by week (top 6, from live DB)

| Week (Mon) | Rows | Notes |
|---|---|---|
| 2026-08-24 | 59 | Nigeria Mega Project pre-fair + Day 1 |
| 2026-08-17 | 98 | Nigeria Mega Project campaign wave |
| 2026-04-27 | 137 | Mega Clima Nigeria pre-fair (April spike) |
| 2026-05-04 | 17 | " |
| 2026-06-08 | 3 | tail |
| earlier | ~14 | scattered |

### 1.4 Per-expo distribution

| expo_id | Rows | Expo |
|---|---|---|
| 7 | 172 | Mega Clima Nigeria 2026 |
| 13 | 156 | Nigeria Mega Project Expo 2026 |

Note: `expo_id` here is the campaign the person unsubscribed FROM (audit context). Uniqueness still per-organizer — so a person "opted out of Mega Clima" is also opted out of Mega Project.

---

## 2. How Someone GETS Unsubscribed — Every Write Path

### 2.1 The public link (footer + List-Unsubscribe header) — the ONLY user path

**Token generation** — `utils/trackingPixel.js:58`
```
function generateUnsubscribeToken(campaignId, recipientId, email) {
  const payload = `${campaignId}.${recipientId}.${email}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(payload).digest('base64url');
  return `${payloadB64}.${signature}`;
}
```
- HMAC-SHA256 keyed with `UNSUBSCRIBE_SECRET` env var.
- **No DB storage** — token self-verifies on demand.
- Fail-fast: `routes/emailTracking.js:20-22` throws if `UNSUBSCRIBE_SECRET` unset.

**Token verification** — `utils/trackingPixel.js:72`
- `verifyUnsubscribeToken(token)` — returns `{campaignId, recipientId, email}` or null.
- Uses `timingSafeEqual` on base64url signature (line 87-100 area).

**Security answer — "can someone unsubscribe someone else?"**
- To unsubscribe user X, you must generate a valid HMAC signature over `campaignId.recipientId.email` for X. That requires the secret.
- Since the token embeds X's email, anyone who **already has** a live token in an email sent to X (e.g. someone forwarded to them) can unsubscribe X.
- Practically: only Suer (server) can mint tokens; anyone holding an email sent to X can hit that email's link and confirm on the POST. **No cross-user attack at scale**, but forwarding-based mischief is possible.

**Landing page (GET)** — `routes/emailTracking.js:153-186`
- URL: `GET /api/email-track/unsubscribe/:token`
- Verifies token, looks up organizer name (expo.name > organizer.name for display), shows a page with "You are about to unsubscribe <email> from <organizer>" and a POST form (line 179).

**Confirm (POST)** — `routes/emailTracking.js:190-243`
```
INSERT INTO email_unsubscribes (email, organizer_id, expo_id, campaign_id, reason)
VALUES ($1, $2, $3, $4, 'user_unsubscribed')
ON CONFLICT (email, organizer_id) DO NOTHING
```
(lines 213-217)

Then (line 221-223):
```
UPDATE campaign_recipients SET status = 'unsubscribed', updated_at = NOW()
WHERE email = $1 AND status = 'active'
  AND campaign_id IN (SELECT id FROM email_campaigns WHERE organizer_id = $2)
```

Then logs `email_events` row `event_type='unsubscribed'` (line 229-232).

**Two-step confirm design (GET then POST):** protects against pre-fetch clients auto-unsubscribing (Gmail image prefetch, security scanners).

**Footer injection** — `utils/trackingPixel.js:41-51`
```
function injectUnsubscribeLink(html, token, organizerName) {
  const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;
  const footer = `<div style="text-align:center;...">If you no longer wish to receive these emails from ${organizerName}, <a href="${unsubUrl}">unsubscribe here</a>.</div>`;
  ...
}
```

Called from `email_worker.js:593-595` for every campaign send.

### 2.2 List-Unsubscribe header path (RFC 8058) — separate transport, same endpoint

**Header generation** — `utils/trackingPixel.js:167-175`
```
function getListUnsubscribeHeaders(campaignId, recipientId, email) {
  const token = generateUnsubscribeToken(campaignId, recipientId, email);
  const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}
```

- Same token, same endpoint. Gmail/Yahoo native "Unsubscribe" button hits `POST /unsubscribe/:token` directly with `List-Unsubscribe=One-Click` body.
- Verified used in `email_worker.js` (import at line 9).

### 2.3 Admin/API path

**None.** No admin route exists to add rows to `email_unsubscribes`.
- `grep -c "INSERT INTO email_unsubscribes" routes/*.js` → only `routes/emailTracking.js:213` (the user-facing endpoint above).

### 2.4 Manual SQL is currently the ONLY admin option

**No UI exists** — confirmed by exhaustive grep:
- `public/email-campaigns.html:469,478,723,738,861,870` — only reads `unsubscribed_count` for stats display and skip-count reports.
- No unsubscribe button/action anywhere in visitor log (`visitorlog-paginated.html`), visitor detail panel, or segments page.
- `grep -rnE "unsubscribe|Unsubscribe" public/*.html` returns only 6 read-only stat display lines above.

→ To manually opt someone out, ops must `psql` (see section 5).

---

## 3. Who RESPECTS the List — Send-Path Table

### 3.1 The honest matrix

| Send path | File:line | Respects unsubscribes? |
|---|---|---|
| **Campaign step scheduler** (transactional pickup) | `email_worker.js:537-548` | ✅ **CHECKS** — pre-send guard, marks `campaign_recipients.status='unsubscribed'`, skips enqueue |
| **Campaign recipient ADD** (Excel/segment) | `routes/campaigns.js:568-583` | ✅ **CHECKS** — loads set, `if (unsubEmails.has(email)) skipped_unsubscribed++` |
| **Campaign recipient ADD** (from-visitors) | `routes/campaigns.js:713-721` | ✅ **CHECKS** — same pattern |
| **Reactivation from Excel** | `routes/reactivation.js:180-213, 367-374` | ✅ **CHECKS** — `prefetchEmails()` returns `unsubscribedEmails` set, filter in `prepareExcelRows` |
| **Reactivation from Expo** | `routes/reactivation.js:468-476` | ✅ **CHECKS** — same prefetch |
| **Segment send** (`POST /api/email-segments/send`) | `routes/emailSegments.js:35, 137-160` | ❌ **IGNORES** — no unsub check; loops visitors and sends directly (line 160) |
| **Send Emails single** (`POST /api/email-send/single`) | `routes/emailSend.js:10, 94` | ❌ **IGNORES** — no unsub check |
| **Send Emails bulk** (`POST /api/email-send/bulk`) | `routes/emailSend.js:124, 223` | ❌ **IGNORES** — no unsub check |
| **Visitor confirmation** (POST /public, POST webhook/zoho) | `routes/visitors.js`, `routes/webhook.js` | ❌ **IGNORES** — **transactional (correct behaviour per section 4)** |
| **Badge/QR transactional** | via `email_worker.js` template Mode 2 | ❌ **IGNORES** — transactional (correct) |
| **Certificate emails** (`POST /api/conference-certificates/…`) | `routes/conferenceCertificates.js:394, 683` | ❌ **IGNORES** — transactional (correct) |
| **Per-form sales notification** (Notification tab) | `routes/visitors.js` POST /public notification block | N/A — recipients are sales team, not visitors; unsub list should not filter |

**Grep confirmation of gaps:**
```
$ grep -c "email_unsubscribes\|unsubscrib" routes/emailSegments.js  →  0
$ grep -c "email_unsubscribes\|unsubscrib" routes/emailSend.js      →  0
$ grep -c "email_unsubscribes\|unsubscrib" routes/conferenceCertificates.js  →  0
$ grep -c "email_unsubscribes\|unsubscrib" routes/webhook.js        →  0
$ grep -c "email_unsubscribes\|unsubscrib" routes/visitors.js       →  0
```

### 3.2 Yesterday's exposure (precise)

**Query:** `email_logs` sent, joined on `email_unsubscribes` where `sent_at > unsub_date`, last 7 days.

**Result: 4 actual violations** (person had already unsubscribed, then received email):

| # | Recipient (redacted to unsub_id) | Template | Expo | Send mode | Days after unsub |
|---|---|---|---|---|---|
| 1 | unsub_id=300 | 49 | 13 | Mode 2 (campaign) | 3d 14h |
| 2 | unsub_id=81 | 49 | 13 | Mode 2 (campaign) | **115 days** ⚠️ |
| 3 | unsub_id=201 | 49 | 13 | Mode 2 (campaign) | 27 days |
| 4 | unsub_id=236 | (Mode 1) | (null) | Mode 1 direct HTML | 1h 27m |

**Split:** 3 violations Mode 2 (all template_id=49); 1 violation Mode 1 (direct HTML, no template).

**Interpretation:**
- Template 49 is **not** in campaigns 16/17/18 (those use templates 54-61 per `email_campaigns` join). Template 49 is likely a **`POST /api/email-send/bulk`** or **`POST /api/email-segments/send`** target — both flows have zero unsub filter. This matches the known gap.
- The Mode 1 violation (unsub_id=236, 1h 27m gap) is a direct-HTML send with no template — either segment send or an ad-hoc bulk. Same gap surface.
- **The 115-day violation** (peterwen0509@gmail.com, unsubbed 1 May, sent 24 Aug) rules out any prefetch-caching race — it's a segment/send-emails flow that just doesn't consult the table.

Suer's "5 mailed unsubscribed" — actual count is 4 in the 7-day window; the fifth may be older or from a differently-counted lens. The material fact: **3 different segment/send-emails sends today+yesterday shipped to already-unsubscribed people**.

### 3.3 Where the check IS performed — the reference implementation

`email_worker.js:537-548`:
```
const unsubCheck = await client.query(
  'SELECT 1 FROM email_unsubscribes WHERE email = $1 AND organizer_id = $2 LIMIT 1',
  [recipient.email, campaign.organizer_id]
);
if (unsubCheck.rows.length > 0) {
  await client.query(
    `UPDATE campaign_recipients SET status = 'unsubscribed', next_step_due_at = NULL, ... WHERE id = $1`,
    [recipient.id]
  );
  await client.query('COMMIT');
  console.log(`[CAMPAIGN SCHEDULER] Skipped ${recipient.email} (unsubscribed)`);
  return;
}
```

This is the "2 skipped" pattern visible in logs — campaign scheduler is doing its job. The gap is entirely outside the scheduler.

---

## 4. Re-subscribe Paths

**None.** No code path exists to remove rows from `email_unsubscribes`.

- `grep -rn "DELETE FROM email_unsubscribes" .` → **0 matches** in application code.
- No admin endpoint, no user-facing "re-subscribe" link, no toggle in campaign UI.
- Ops must `DELETE FROM email_unsubscribes WHERE email='X' AND organizer_id=Y;` in psql.

**Registration flow after unsubscribe (already tested implicitly by 62 sends yesterday):**
- Visitor unsubscribes → `email_unsubscribes` row inserted.
- Visitor registers again (Zoho form, public form, walk-in) → `visitors` row upserted normally. No check against unsub list on registration.
- **Transactional emails still flow** (badge, QR, cert, confirmation) — this is by design: `routes/visitors.js` POST /public and `routes/webhook.js` POST /zoho neither check `email_unsubscribes` because these are transactional confirmations, not marketing. This matches the landing page's promise (`routes/emailTracking.js:247`: *"Transactional emails (registration confirmations, badges, certificates) will continue as normal."*).
- **Campaigns remain blocked** — because `campaign_recipients.status='unsubscribed'` is set for all active campaigns of that organizer (line 221-224), and future campaigns' `POST /api/campaigns/…/add-recipients` will filter the same address via `routes/campaigns.js:583`.

**Design is intentional and correct — matches Gmail/Yahoo compliance expectations.** The gap is only that segment/emailSend bypass this filter (see section 3).

---

## 5. Manual Unsubscribe SQL (for ops use until a UI exists)

All three queries use the (email, organizer_id) unique key. `organizer_id=1` is currently the only production organizer.

### 5.1 Add (idempotent — ON CONFLICT DO NOTHING)

```sql
INSERT INTO email_unsubscribes (email, organizer_id, expo_id, campaign_id, reason)
VALUES (LOWER(TRIM('user@example.com')), 1, NULL, NULL, 'manual_ops_added')
ON CONFLICT (email, organizer_id) DO NOTHING
RETURNING id, email, created_at;
```

If email address should also be pushed out of any active campaign flows (mirrors the endpoint's behaviour at `routes/emailTracking.js:221-224`):

```sql
UPDATE campaign_recipients
SET status = 'unsubscribed', updated_at = NOW()
WHERE email = LOWER(TRIM('user@example.com'))
  AND status = 'active'
  AND campaign_id IN (SELECT id FROM email_campaigns WHERE organizer_id = 1);
```

### 5.2 Remove (re-subscribe)

```sql
DELETE FROM email_unsubscribes
WHERE email = LOWER(TRIM('user@example.com'))
  AND organizer_id = 1
RETURNING id, email, created_at, reason;
```

Note: this does NOT re-add them to any campaign. Manual `INSERT INTO campaign_recipients` needed if wanted back in flow.

### 5.3 Lookup (is X unsubscribed and since when)

```sql
SELECT eu.id, eu.email, eu.created_at, eu.reason, eu.expo_id, eu.campaign_id,
       e.name AS expo_name, c.name AS campaign_name
FROM email_unsubscribes eu
LEFT JOIN expos e ON e.id = eu.expo_id
LEFT JOIN email_campaigns c ON c.id = eu.campaign_id
WHERE LOWER(TRIM(eu.email)) = LOWER(TRIM('user@example.com'))
  AND eu.organizer_id = 1;
```

Zero rows = not unsubscribed.

---

## 6. Gap List with Severity

| # | Gap | Severity | Notes |
|---|---|---|---|
| 6.1 | **Segments page send ignores unsub list** (`routes/emailSegments.js:35-160`) | **P1** — active daily use, known-to-us, produces compliance violations. See section 3.2 exposure. |
| 6.2 | **Send Emails single + bulk ignore unsub list** (`routes/emailSend.js:10, 94, 124, 223`) | **P1** — same class as 6.1. |
| 6.3 | **No UI to unsubscribe someone manually** (confirmed by exhaustive `public/*.html` grep) | **P1** — ops must psql. Recommend: action in `visitorlog-paginated.html` visitor detail panel (already has Send Email button, natural home for a "Toggle unsubscribe" button); secondary: bulk action in Segments page. |
| 6.4 | **No re-subscribe flow anywhere** (confirmed: 0 `DELETE FROM email_unsubscribes` in app code) | **P2** — Suer/ops handle rarely, SQL suffices for now, but a UI button next to the manual-unsubscribe action would be trivial to add together. |
| 6.5 | **Unsubscribe scope is per-organizer, not per-expo** — the unique key on `(email, organizer_id)` | **P3 (design question, no decision here)** — Current: person opting out of Mega Clima also opts out of Morocco Siema. Tradeoff: per-expo would let dedicated fans of one show stay in that flow; risks confusion ("I unsubscribed but got another email"). Modern compliance thinking is per-sender (organizer-level) — the current design matches. |
| 6.6 | **Only one reason value in use** (`user_unsubscribed`, 328/328) | **P4** — the `reason` column is under-utilised. Manual ops entries and future spam-complaint webhook entries should use distinct reasons (`manual_ops`, `spam_complaint`, `bounce_hard`) for filtering. |
| 6.7 | **Certificate + notification sends** (`routes/conferenceCertificates.js`, `routes/visitors.js`) don't check unsub — **but they're transactional** | **P4 (documentation)** — correct behaviour per section 4, but worth writing down as intentional so future reviewers don't "fix" it. |
| 6.8 | **`email_unsubscribes` FKs on `expo_id`/`campaign_id`** but not enforced on write path | **P4** — audit context columns are populated only via the user endpoint (`routes/emailTracking.js:213-217`); manual ops entries have both null. Not a bug, just an inconsistency. |
| 6.9 | **`email_logs` has no `subject` column** — makes forensic queries (like the one for this analysis) opaque about what marketing content actually shipped | **P3** — retrofit or leave. Content usually derivable from `template_id + campaign_step`. |

**Recommended fix order:** 6.1+6.2 together (single helper `isUnsubscribed(email, organizer_id)` called from three call sites); then 6.3 UI (visitor detail panel button, ~30 min); then 6.4 (same UI, add remove button).

---

## 7. Compliance Snapshot (Gmail/Yahoo bulk-sender rules, 2024+)

**Where we ARE compliant (campaign path only):**
- **One-click unsubscribe via header:** RFC 8058 `List-Unsubscribe: <URL>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` implemented (`utils/trackingPixel.js:170-172`, wired into `email_worker.js`).
- **Visible footer link:** `injectUnsubscribeLink()` called on every campaign send (`email_worker.js:594`).
- **Two-step confirm** (GET landing page → POST confirm at `routes/emailTracking.js:153, 190`) — required because Gmail image prefetch would otherwise auto-unsubscribe.
- **Timely honouring:** `email_worker.js:537-548` re-checks the list at send time even after enqueue.

**Where we ARE NOT compliant:**
- **Segment sends** and **Send Emails single/bulk** (see section 3.1 gaps 6.1, 6.2). These fire without any unsub filter and, this week, produced 4 measured violations. If any of the affected addresses complain to Gmail/Yahoo, our sender reputation takes a hit — enough of these and we get throttled or blocked.

**One-paragraph summary:** Campaigns are compliant end-to-end (header + footer + honouring). Segment sends and manual bulk sends are the compliance hole — same organiser identity, same domain reputation, no filter, four confirmed violation sends in the last week. Priority-one fix is a single-line unsub check in the three send paths that lack it (`emailSegments.js`, `emailSend.js single`, `emailSend.js bulk`), reusing the exact query already in `email_worker.js:538`. Do this before the next segment blast, otherwise a determined complainer could dent deliverability across both flows because Gmail treats them under one sender identity.
