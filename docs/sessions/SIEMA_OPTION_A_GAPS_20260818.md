# Option A — Gap Closure (read-only)
**Date:** 2026-08-18 · Nothing implemented. Paths relative to `backend/leena-v401-backend/`.
Plan under evaluation: two campaigns — **Group 2 "reactivate"** (past LEENA visitors) and
**Group 3 "register"** (Zoho-only contacts). SIEMA 2026 = `expo_id 9`, 2026-09-22 → 09-24.

---

## 🔴 BLOCKING FINDING — reactivation tokens expire 5 days BEFORE SIEMA opens

`expires_at` is **hardcoded** at token creation, `reactivation.js:50` and `:60`:
```sql
… ,'pending',NOW(),NOW()+INTERVAL '30 days')
```
No parameter, no config, no override anywhere in the module.

Enforced in both public entry points — `reactivation.js:485` (verify) and `:548` (activate):
```js
485: if (new Date(tokenData.expires_at) < new Date()) {
486:   return res.status(410).json({ success: false, error: 'This activation link has expired' });
```

Measured against production dates:

| today | token expires if created today | SIEMA start | SIEMA end | gap |
|---|---|---|---|---|
| 2026-08-18 | **2026-09-17** | 2026-09-22 | 2026-09-24 | **expires 5 days early** |

**Every Group 2 token generated today dies before the fair opens and stays dead for its
entire duration.** A visitor clicking a wave-1 or wave-2 link during the final week — the
week that matters most — gets "This activation link has expired."

This affects **all three options**, not just A. It is a one-line change (`'30 days'` →
parameterised or `'90 days'`) but it must be decided before any token is generated,
because **existing tokens are not retroactively extended** — `expires_at` is written at
INSERT time. Tokens created now would need a DB UPDATE later.

---

# Q1 — The bridge

## 1a. `appendCampaignTokenToFormLinks` does NOT touch `reactivate.html`

`utils/trackingPixel.js:147-159`, quoted in full:
```js
147: function appendCampaignTokenToFormLinks(html, campaignToken) {
148:   if (!html || !campaignToken) return html || '';
150:   return html.replace(/<a\s([^>]*?)href=["']([^"']+)["']/gi, (match, before, url) => {
151:     if (url.includes('form-public.html') || url.includes('/form/')) {
152:       const separator = url.includes('?') ? '&' : '?';
153:       return `<a ${before}href="${url}${separator}_lc=${campaignToken}"`;
154:     }
155:     return match;
156:   });
157: }
```

**Answer: it neither interferes nor coexists — it simply does not match.** A link to
`reactivate.html?token=X` falls through `return match` at `:155` untouched. No `_lc` is ever
appended, so the campaign/recipient identity never reaches the activation page.

**Coexistence, if the matcher is extended, is already handled correctly.** Line 152 computes
the separator from the existing URL, so `reactivate.html?token=X` becomes
`reactivate.html?token=X&_lc=<token>`. Both parameters survive.

## 1b. Click-wrapping preserves both parameters

Order is deliberate — `email_worker.js:550-554`:
```js
550:  // Append _lc campaign token to Leena form links FIRST (before click wrap)
551:  html = appendCampaignTokenToFormLinks(html, unsubToken);
553:  // Wrap <a href> links for click tracking LAST (so wrap engulfs the _lc URL)
554:  html = wrapClickLinks(html, emailEventId);
```

`wrapClickLinks` (`trackingPixel.js:125-141`) base64url-encodes the **entire** URL:
```js
138:  const encoded = Buffer.from(trimmed).toString('base64url');
139:  return `<a ${before}href="${BASE_URL}/api/email-track/click/${eventId}?url=${encoded}"`;
```

And the redirect decodes it whole — `routes/emailTracking.js:96-115`:
```js
104:  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
105:  if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
106:    targetUrl = decoded;
114:  res.redirect(302, targetUrl);
```

**Query string is preserved intact.** `?token=X&_lc=Y` survives the round trip. Click
tracking and the token can coexist.

## 1c. The `_lc` token carries exactly the identity we need

`trackingPixel.js:58-66` / `:72-…` — HMAC-signed, returns `{ campaignId, recipientId, email }`:
```js
61:  const payload = `${campaignId}.${recipientId}.${email}`;
63:  const signature = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(payload).digest('base64url');
```

## 1d. ⚠️ Why the "zero-code, embed `_lc` in the Excel" route is impossible

`generateUnsubscribeToken(campaignId, recipientId, email)` needs `recipientId` — which is the
`campaign_recipients.id` **assigned by the INSERT**. You cannot know it before uploading the
row. **The `_lc` value cannot be pre-computed into an Excel column.** It must be generated at
send time, which is what `enqueueStepEmail` already does (`:547`).

**So extending the matcher at `trackingPixel.js:151` is not optional — it is the only route.**

## 1e. Confirmed change set

| # | change | file:line | est. |
|---|---|---|---:|
| 1 | add `\|\| url.includes('reactivate.html')` to the matcher | `utils/trackingPixel.js:151` | **1** |
| 2 | read `_lc` from URL, forward in `/activate` body — copy of `form-public.html:375-377` | `public/reactivate.html` (~504, ~513-524) | ~3 |
| 3 | verify `_lc`, INSERT `registered` event — copy of `visitors.js:452-468` | `routes/reactivation.js` `/activate` (~611) | ~12 |
| 4 | **token expiry** `'30 days'` → longer/parameterised | `routes/reactivation.js:50, :60` | ~2 |

**~18 lines across 3 files.** Original estimate holds, with item 4 newly identified as
mandatory.

⚠️ **`UNSUBSCRIBE_SECRET` is not in the local `.env`** (verified: 0 matches; the file has
`BASE_URL, JWT_SECRET, PG*, RENDER_DATABASE_READONLY_URL, SENDER_EMAIL, SENDGRID_API_KEY`).
`generateUnsubscribeToken` **throws** without it (`trackingPixel.js:59`), and it is called
unconditionally at `email_worker.js:547`. Production has it (campaigns 13/14 completed), but
**the campaign send path cannot be exercised locally** — the throwaway-expo test must run on
Render.

---

# Q2 — Group 2 (reactivate) data flow

## 2a. Tokens can be generated silently — **zero code needed**

`template_id` is **optional** in `create-from-expo` — `reactivation.js:25-35`:
```js
25:  // Get email template
26:  let emailTemplate = null;
27:  if (template_id) {
28:    const templateResult = await pool.query(
29:      'SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2', …);
32:    if (templateResult.rows.length) emailTemplate = templateResult.rows[0];
```
Only `source_expo_id` and `target_expo_id` are required (`:6`).

And email queueing is gated on it — `processReactivationChunks:68-69`:
```js
68:  // Queue emails (per-row: unique rendered HTML)
69:  if (emailTemplate) {
```

**Calling `create-from-expo` with `source_expo_id=1`, `target_expo_id=9` and NO `template_id`
creates tokens and sends nothing.** That is exactly the silent pre-generation Option A needs,
using existing production-proven code.

It also dedups on the way in — `prefetchEmails` (`:56`) returns
`existingVisitorEmails, existingTokenEmails, unsubscribedEmails`.

## 2b. `create-from-expo` does NOT populate `campaign_recipients`

It writes only `reactivation_tokens` (`:54` / `:64`). It has no knowledge of campaigns.
So the two systems must still be joined by one of:

| route | mechanism | code |
|---|---|---:|
| **(a) Excel round-trip** | `create-from-expo` (no template) → export `email` + `token` → build CSV with an `activation_url` column → campaign Excel upload → lands in `extra_fields` (`campaigns.js:530`, `:543`) | **0** |
| (b) extra_fields on from-expo | add token lookup + `extra_fields` to `campaigns.js:651` | ~5-8 |

## 2c. What pre-fills on `reactivate.html` — a **frozen snapshot**, not a live join

Source of the data — `reactivation.js:39-40`, inside `create-from-expo`:
```sql
39:  SELECT v.id, v.email, v.name, v.last_name, v.company, v.country, v.job_title, v.phone
40:  FROM visitors v
41:  WHERE v.expo_id = $1 AND v.organizer_id = $2 AND v.email IS NOT NULL AND v.email != ''
```
copied into `reactivation_tokens` columns at INSERT (`:50-54`).

Served by verify — `reactivation.js:503-521`:
```js
505:  visitor: {
506:    name: tokenData.name, last_name: tokenData.last_name, email: tokenData.email,
509:    company: tokenData.company, country: tokenData.country,
511:    job_title: tokenData.job_title, phone: tokenData.phone },
```
`tokenData` is the `reactivation_tokens` row (`:481`) — **there is no join back to `visitors`.**

Consumed by the page — `public/reactivate.html:470-474`:
```js
470:  document.getElementById('email').value = data.visitor.email || '';
471:  document.getElementById('company').value = data.visitor.company || '';
472:  document.getElementById('country').value = data.visitor.country || '';
473:  document.getElementById('jobTitle').value = data.visitor.job_title || '';
474:  document.getElementById('phone').value = data.visitor.phone || '';
```

**Implication:** prefill quality is frozen at token-generation time. Generate tokens *after*
any data cleanup, not before. Also relevant: expo 1 has 30,444 rows but 21,387 distinct
emails — `create-from-expo` has no per-email dedup on the source side beyond
`existingTokenEmails`, so **NEEDS MORE INFO — whether duplicate source rows produce duplicate
tokens for the same address.** Worth checking before a 21k run.

---

# Q3 — Group 3 (register) flow

## 3a. Personalization from Excel columns alone — **YES, works today**

`email_worker.js:520-528`:
```js
520:  const data = {
521:    name: recipient.first_name || 'Guest',
522:    first_name: recipient.first_name || '',
523:    last_name: recipient.last_name || '',
524:    email: recipient.email,
525:    company: recipient.company || '',
526:    date: new Date().toLocaleDateString(),
527:    ...extraFields
528:  };
```
Every field comes from the `campaign_recipients` row. **No `visitors` lookup anywhere in
`enqueueStepEmail` (`:484-586`).**

Available with no code change: `{{name}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`,
`{{company}}`, `{{date}}`, plus **any** Excel column outside `knownCols` (`campaigns.js:468`)
via `extra_fields`.

## 3b. `not_registered` for Group 3 — **YES, works today, zero changes**

The chain is already complete for the public-form route:

1. Template contains a link to `form-public.html` (SIEMA form 51, `expo_id 9`).
2. `appendCampaignTokenToFormLinks` **matches** it (`trackingPixel.js:151` — `form-public.html`) and appends `_lc`.
3. Visitor submits; the page forwards the token — `public/form-public.html:375-377`:
```js
375:  const urlParams = new URLSearchParams(window.location.search);
376:  const lcToken = urlParams.get('_lc');
377:  if (lcToken) visitorData._lc = lcToken;
```
4. The event is written — `routes/visitors.js:452-468`:
```js
452:  // Campaign registration tracking: if _lc token present, log 'registered' event
454:    const lcToken = req.body._lc;
455:    if (lcToken) {
457:      const parsed = verifyUnsubscribeToken(lcToken);
458:      if (parsed) {
459:        await pool.query(
460:          `INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata)
461:           VALUES ($1, $2, $3, 'registered', $4)`,
462:          [parsed.campaignId, parsed.recipientId, parsed.email,
463:           JSON.stringify({ form_id, visitor_id: visitor?.id, via: 'public_form_submission' })]);
467:  } catch (trackErr) {
468:    console.warn(`[TRACKING] Registration tracking failed (non-fatal): …`);
```
5. `evaluateCondition` reads it — `email_worker.js:471-473`.

**Group 3 requires no code changes at all.** It is the flow campaigns 13 and 14 already ran
(32,218 and 5,471 recipients, both completed).

⚠️ Two caveats:
- The tracking INSERT is wrapped in a **non-fatal** try/catch (`:467-468`). A failure is
  logged as a warning and swallowed — the registration still succeeds but the recipient stays
  `not_registered` and will receive follow-ups. Silent under-counting is possible.
- `parsed.recipientId` is trusted from the signed token; if a visitor forwards their email to
  a colleague, the colleague's registration is attributed to the original recipient.

---

# Q4 — Is a LEENA import required for Group 3?

## **No. `campaign_recipients` rows work with no `visitors` row.**

**Evidence 1 — the upload path never sets `visitor_id`.** `campaigns.js:530` / `:543`:
```js
530:  `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
```
Column absent ⇒ NULL. Only the from-expo path sets it (`:651`).

**Evidence 2 — `visitor_id` is never read by the send path.** Grepping `campaigns.js` and
`email_worker.js` for reads of `campaign_recipients.visitor_id` returns nothing. The only
`visitor_id` in `email_worker.js` is `:226`, which validates an **`email_queue`** Mode 2 task
— a different table and a different code path from `enqueueStepEmail`, which enqueues Mode 1
(pre-rendered HTML) at `:539-546`.

**Evidence 3 — every tracking join uses `recipient_id`, not `visitor_id`:**
- `email_events.recipient_id` ← `campaign_recipients.id` (`email_worker.js:537-539`)
- open: `emailTracking.js:29`; click: `:96`; registered: `visitors.js:461`
- conditions: `email_worker.js:449, 460, 471`
- stats: `campaigns.js:197, 428, 701`

## What breaks if Group 3 is not imported — **nothing in tracking**

| capability | works un-imported? | why |
|---|---|---|
| Personalized send | ✅ | Q3a — data from `campaign_recipients` |
| Open / click tracking | ✅ | keyed on `recipient_id` |
| `registered` event | ✅ | keyed on `recipient_id`; `visitor_id` only decorates `metadata` (`visitors.js:463`) |
| `not_registered` step condition | ✅ | Q3b |
| Unsubscribe + List-Unsubscribe | ✅ | keyed on campaign+recipient (`trackingPixel.js:61`) |
| Unsubscribe suppression at build | ✅ | `campaigns.js:637-640` checks `email_unsubscribes` by email |
| Appears in expo 9 visitor counts / exports / badge & QR | ❌ **until they register** | no `visitors` row exists yet |

**Pre-importing Group 3 would be actively counterproductive:** it would inflate expo 9's
visitor count with people who have not registered, and — since `create-from-expo` and
`prefetchEmails` dedup against existing visitor rows — could interfere with later
segmentation. The correct flow is that the public-form submission creates the visitor row at
conversion time, which `visitors.js` already does.

⚠️ One genuine consequence: **un-imported Group 3 contacts are invisible to
`email_unsubscribes` enforcement outside the campaign module.** The campaign build checks it
(`campaigns.js:637-640`) and `enqueueStepEmail` re-checks defensively (`email_worker.js:489-499`),
so within Option A they are protected — but any *other* send path that filters via `visitors`
would not see them.

---

# SUMMARY

| # | Question | Answer | Code needed |
|---|---|---|---:|
| 1 | `_lc` vs `?token=X` | Does **not** match `reactivate.html` — no interference, no help. Separator logic + click-wrap both handle coexistence correctly once matched. `_lc` **cannot** be pre-computed into Excel (needs `recipientId` from INSERT). | **1 line** `trackingPixel.js:151` |
| 1 | Bridge total | matcher + `_lc` capture + `registered` INSERT + expiry | **~18 lines / 3 files** |
| 2 | Group 2 token generation | `create-from-expo` **without `template_id`** generates tokens silently — existing code | **0** (+Excel round-trip) or ~5-8 for `extra_fields` |
| 2 | Prefill source | `reactivation_tokens` snapshot frozen at creation; **no live `visitors` join** | — |
| 3 | Group 3 personalization | ✅ from `campaign_recipients` + `extra_fields` | **0** |
| 3 | Group 3 `not_registered` | ✅ full chain already works via `form-public.html` + `_lc` | **0** |
| 4 | Group 3 import | **Not required.** `visitor_id` is written but never read; all tracking keys on `recipient_id` | **0** |

**🔴 Blocking, newly found:** token `expires_at` is hardcoded `NOW() + 30 days`
(`reactivation.js:50`, `:60`). Tokens made today expire **2026-09-17**, five days before
SIEMA opens, and are dead throughout the fair. Must be resolved before generating any token,
since `expires_at` is fixed at INSERT and is not retroactively extended.

## Remaining unknowns

1. **NEEDS MORE INFO — does `create-from-expo` emit duplicate tokens for duplicate source
   rows?** Expo 1 has 30,444 rows / 21,387 distinct emails. Not verified.
2. **NEEDS MORE INFO — the largest scale `resend-pending` has run** (carried over; only
   affects Option C).
3. `UNSUBSCRIBE_SECRET` absent locally ⇒ the campaign send path is **not testable off
   Render**.
4. Bounce blindness and absent address validation still apply to both groups.

No implementation, per brief.
