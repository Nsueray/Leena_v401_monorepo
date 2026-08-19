# Reactivation × Multi-Step — Option Analysis (A / B / C)
**Date:** 2026-08-18 · **Mode:** read-only code analysis. Nothing changed.
Paths relative to `backend/leena-v401-backend/`. SIEMA 2026 = `expo_id 9`, **35 days out**.
No recommendation — comparison only, per brief.

---

## THE FINDING THAT DRIVES ALL THREE OPTIONS

**`registered` — the condition every "resend to non-registrants" step depends on — cannot
see a reactivation activation. It only fires on public-form submissions carrying a `_lc`
token.**

Condition SQL, `email_worker.js:469-477`:
```js
469: if (condition === 'not_registered' || condition === 'registered') {
470:   const regRes = await pool.query(
471:     `SELECT id FROM email_events WHERE recipient_id = $1 AND event_type = 'registered'
472:      AND created_at >= $2 LIMIT 1`,
473:     [recipient.id, recipient.last_step_sent_at || new Date(0)]);
474:   const wasRegistered = regRes.rows.length > 0;
476:   if (condition === 'not_registered') return !wasRegistered;
```

The **only** writer of that event — `routes/visitors.js:452-468`, inside `POST /api/visitors/public`:
```js
452: // Campaign registration tracking: if _lc token present, log 'registered' event
454:   const lcToken = req.body._lc;
455:   if (lcToken) {
457:     const parsed = verifyUnsubscribeToken(lcToken);
459:       await pool.query(
460:         `INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata)
461:          VALUES ($1, $2, $3, 'registered', $4)`, …
```
`_lc` is attached by `appendCampaignTokenToFormLinks` (`email_worker.js:551`) — **to Leena
form links only**.

**`POST /api/reactivation/activate` emits no `email_events` of any kind.** Verified by
grepping the full 120-line handler body for `email_events` / `_lc` / `registered` /
`campaign` — the only hits are an unrelated user-facing string, the `'reactivation_campaign'`
origin literal, and a `form_id` comment.

**Consequence if ignored:** run reactivation links through campaign steps as-is and every
recipient stays `not_registered` forever. Steps 2 and 3 fire at **everyone**, including the
~3% who already activated. At 21,690 recipients × 3 steps that is ~65k sends with the
follow-ups mistargeted — worse than doing nothing, because it emails people who already
converted.

---

# OPTION A — Campaign module carries reactivation links

## A1. Per-recipient custom field — **EXISTS**

`campaign_recipients.extra_fields JSONB` (verified in `information_schema`).

**Populated by the Excel upload path** — `campaigns.js:468` *"Known columns — rest goes to
extra_fields"*, INSERTs at `campaigns.js:530` and `:543`:
```js
530: `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
```

**NOT populated by the from-expo path** — `campaigns.js:651-654`:
```js
651: `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, visitor_id)
652:  VALUES ($1, $2, $3, $4, $5, $6)
653:  ON CONFLICT (campaign_id, email) DO NOTHING`,
654: [campaign.id, email, v.name || null, v.last_name || null, v.company || null, v.id]
```
No `extra_fields` column in that INSERT. So building a recipient list *from an expo* cannot
carry a token today; building it *from Excel* can.

## A2. Placeholder resolution — **WORKS, zero changes needed**

`email_worker.js:511-529`:
```js
511:  // Parse extra_fields
514:  if (recipient.extra_fields) {
515:    extraFields = typeof recipient.extra_fields === 'string'
516:      ? JSON.parse(recipient.extra_fields) : recipient.extra_fields;
520:  const data = {
521:    name: recipient.first_name || 'Guest',
522:    first_name: …, last_name: …, email: …, company: …,
526:    date: new Date().toLocaleDateString(),
527:    ...extraFields          // ← spread as TOP-LEVEL keys
528:  };
531:  const subject = processEmailTemplate(template.subject || 'Notification', data);
532:  let html = processEmailTemplate(template.html_content || '', data);
```

Resolver, `utils/email.js:12-23`:
```js
15:  return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
16:    const parts = expr.split('|').map(p => p.trim());
17:    for (const part of parts) {
18:      if (/^".*"$/.test(part)) return part.slice(1, -1);
19:      if (data[part]) return data[part];
20:    }
21:    return '';
```

**Therefore:** `extra_fields = {"activation_url": "https://leena.app/reactivate.html?token=…"}`
makes `{{activation_url}}` resolve per recipient, today, with no code change. Supports
`{{activation_url|"fallback"}}` too. This is the same key name `resend-pending` already uses
(`reactivation.js:820`), so existing reactivation templates would work unmodified.

⚠️ `if (data[part])` is a **falsy** check — an empty or missing token silently renders `''`,
producing an email with a dead/blank link rather than an error. No guard exists.

## A3. Pre-generating tokens and joining at send time

- Token generator: `reactivation.js:22-25`, `crypto.randomBytes(32).toString('hex')`.
- Bulk INSERT: `reactivation.js:54` / `:64` inside `processReactivationChunks`.
- **`enqueueStepEmail` (`email_worker.js:484-586`) never references `reactivation_tokens`.**
  No join exists.

Two viable routes:

| route | mechanism | code change |
|---|---|---|
| **(a) Excel round-trip** | create reactivation campaign → export `token`+`email` → build CSV with an `activation_url` column → upload to campaign recipients → lands in `extra_fields` | **0 lines** (operational only) |
| (b) Join at send time | `enqueueStepEmail` looks up `reactivation_tokens` by `email`+`target_expo_id`, injects `activation_url` into `data` | ~10-15 lines, 1 file, touches the proven send path |

Route (a) needs no code but is a manual, error-prone data handoff at 21k rows and must be
redone if recipients change. Route (b) touches `enqueueStepEmail`, which is the function that
successfully sent 96,178 emails — modifying it carries real regression risk.

## A4. What is missing — the activation-tracking gap

To make `not_registered` mean "has not activated", an activation must emit a `registered`
event tied to `campaign_recipients.id`. That requires the campaign↔recipient identity to
survive the round trip through `reactivate.html`:

| # | change | file | est. lines |
|---|---|---|---:|
| 1 | Append `_lc` to the activation URL (or carry it in `extra_fields`) | build step / `campaigns.js` | ~3 |
| 2 | `reactivate.html` reads `_lc` from URL and forwards it in the `/activate` body — mirrors `form-public.html:375-377` verbatim | `public/reactivate.html` | ~3 |
| 3 | `/activate` verifies `_lc` and INSERTs the `registered` event — mirrors `visitors.js:452-468` verbatim | `routes/reactivation.js` | ~12 |
| 4 | *(optional)* `extra_fields` on from-expo path, to avoid the Excel round-trip | `campaigns.js:651` | ~5 |

**Estimated total: ~18 lines across 3 files (~23 with item 4).** Every piece has a working
precedent to copy — none of it is novel logic.

**What A gains that nothing else does:** open/click tracking (`injectTrackingPixel` `:544`,
`wrapClickLinks` `:554`), automatic unsubscribe links (`:548`), **RFC 8058 List-Unsubscribe
headers** (`:229-232`, gated on `task.campaign_id && task.campaign_recipient_id`), automatic
timing, and `not_opened`/`not_clicked` conditions. Given the priority finding — that the
bottleneck is **open → click**, not delivery — A is the only option that can *measure* the
stage that is actually failing.

---

# OPTION B — Reactivation module gains steps/delays/conditions

## B1. Current per-token state — **there is none**

`reactivation_tokens` columns (verified): `id, token, source_visitor_id, source_expo_id,
target_expo_id, organizer_id, email, name, last_name, company, country, job_title, phone,
status, created_at, activated_at, expires_at, new_visitor_id, form_id`.

**No `current_step`, no `next_step_due_at`, no `last_step_sent_at`.**
```
grep -c "current_step|next_step_due_at|last_step_sent_at" routes/reactivation.js → 0
```

`resend-pending` (`reactivation.js:773`) tracks **nothing** per wave. It re-selects
`status='pending'` on each invocation (`:798-800`). There is no record of which wave a token
received, how many emails it has had, or when the last one went. Two waves are
indistinguishable from one wave sent twice.

## B2. Scheduler infrastructure — **none exists in the module**

`routes/reactivation.js` contains only `setImmediate` at `:322` and `:432` — one-shot
background *import* jobs (`processReactivationChunks`), not a recurring scheduler. No
`setInterval`, no cron.

It would have to borrow `email_worker`'s. But that scheduler is hardcoded to the campaign
tables — `runCampaignScheduler` (`:270`) → `campaign_steps` / `campaign_recipients`, and
`enqueueStepEmail` (`:484`) writes `campaign_id`, `campaign_step_id`,
`campaign_recipient_id`, `email_event_id` into `email_queue`. Pointing it at
`reactivation_tokens` means a parallel code path, not a config switch.

## B3. Schema additions required

| target | change |
|---|---|
| `reactivation_tokens` | + `current_step INT`, + `next_step_due_at TIMESTAMPTZ`, + `last_step_sent_at TIMESTAMPTZ`, and a lifecycle state distinct from `pending`/`activated` (needs `completed`, `unsubscribed`) |
| new table | `reactivation_steps` (`step_number`, `template_id`, `delay_hours`, `condition`) — or overload `campaign_steps` with a nullable `campaign_id`, which is worse |
| migration | one, additive |

⚠️ Overloading `status` is a live-data hazard: `status='pending'` is what `resend-pending`
(`:800`) and the monitoring UI (`:173`, `:196`, `:738`) already select on. Adding step states
to that column changes the meaning of queries running in production today.

## B4. Logic that would be duplicated

| function | `email_worker.js` | approx. lines |
|---|---|---:|
| `runCampaignScheduler` | `:270-…` | ~60 |
| `evaluateCondition` | `:438-480` | ~43 |
| `enqueueStepEmail` | `:484-586` | ~103 |
| `advanceRecipient` | `:588-596` | ~9 |
| `computeNextDue` | `:598-620` | ~23 |
| `checkCampaignCompletion` | `:622-632` | ~11 |
| **Total** | | **~250** |

And it would arrive **less capable**: `not_opened` (`:447`) and `not_clicked` (`:458`) both
read `email_events`, which the reactivation path does not emit. To match A's conditions, B
would additionally have to duplicate `injectTrackingPixel`, `wrapClickLinks`,
`injectUnsubscribeLink`, `generateUnsubscribeToken` and the event-writing plumbing.

**Estimated: ~250-350 lines of duplicated scheduler + 1 migration + 4 new columns + 1 new
table, to reach less than Option A delivers in ~18.**

---

# OPTION C — Minimal glue, one-shot waves

## C1. What exists — `POST /api/reactivation/resend-pending`, `reactivation.js:773`

```js
775:  const { target_expo_id, template_id } = req.body;
797:  const pendingTokens = await pool.query(
798:    `SELECT token, email, name, last_name, company, country, job_title
799:     FROM reactivation_tokens
800:     WHERE target_expo_id = $1 AND organizer_id = $2 AND status = 'pending'`,
812:    const activationUrl = baseUrl + '/reactivate.html?token=' + row.token;
814:    const templateData = { name, last_name, email, company, country, job_title,
820:      activation_url: activationUrl, expo_name: expoName, date: … };
836:    await pool.query(`INSERT INTO email_queue (organizer_id, expo_id, visitor_id, template_id,
838:      recipient_email, subject, html_content, status, created_at)
839:      VALUES ($1,$2,NULL,$3,$4,$5,$6,'pending',NOW())`, …);
```

**Per-wave template selection: YES.** `template_id` is a request parameter, chosen per call —
wave 1 and wave 2 can use different templates with no code change.

**Tokens are reused, not regenerated** (`:812` uses the existing `row.token`), so links
already sent in wave 1 remain valid.

## C2. Does `pending` exclude activated tokens correctly? — **Yes, for link-clickers only**

Status flips to `activated` in both activation branches:
- `reactivation.js:565` — already-registered branch
- `reactivation.js:613` — new-visitor branch

So anyone who used their link is correctly excluded from wave 2.

⚠️ **But there is no dedup against the `visitors` table.** Someone who registers for SIEMA
through the public form, an ad, or a Zoho form *without clicking their token link* keeps
`status='pending'` and **will receive wave 2 anyway**. The SELECT at `:798-800` filters on
token status only. Given SIEMA will also be running paid acquisition, this overlap is not
hypothetical.

## C3. What C cannot do

| capability | C | why |
|---|---|---|
| Open-based conditions | ❌ | no pixel — `injectTrackingPixel` is called only at `email_worker.js:544`, inside `enqueueStepEmail` |
| Click-based conditions | ❌ | `wrapClickLinks` only at `:554`, same function |
| Any per-recipient tracking | ❌ | enqueue at `:836-842` sets no `campaign_id` / `email_event_id` |
| Automatic timing | ❌ | a human clicks the button; nothing schedules it |
| Auto unsubscribe link | ❌ | `injectUnsubscribeLink` only at `:548` |
| **RFC 8058 List-Unsubscribe headers** | ❌ | `:229-232` — `(task.campaign_id && task.campaign_recipient_id) ? … : undefined`. Reactivation rows have neither ⇒ header omitted |
| Excludes people who registered another way | ❌ | C2 |
| Per-wave template | ✅ | `template_id` param |
| Reuses existing tokens | ✅ | `:812` |

**The List-Unsubscribe gap is the one with outside consequences.** Gmail and Yahoo's bulk
sender rules require one-click unsubscribe for senders above 5,000 messages/day. A 21,690
send via C carries no such header, while the same send via A does.

## C4. ⚠️ Scaling risk — unverified and material

`resend-pending` is a **synchronous loop inside the HTTP request**: `for (const row of
pendingTokens.rows)` with `await pool.query(...)` per row (`:810-846`). No chunking, no
`setImmediate`, no job record.

Contrast the import path in the *same file*, which was explicitly refactored to avoid this —
`reactivation.js:318-326` creates an `import_jobs` row, returns 202, and processes via
`setImmediate` + `processReactivationChunks` in 1,000-row chunks.

At ~21,690 pending tokens, `resend-pending` would attempt ~21,690 sequential INSERTs in one
request. **NEEDS MORE INFO — the largest scale at which `resend-pending` has actually run.
I cannot determine this from the DB: its rows are indistinguishable in `email_queue` from
the create-from-* path (no campaign_id, no distinguishing marker).** The 32,200-token expo 7
campaign was created via `create-from-excel`, not resent. Treat "resend-pending works at
21k" as **untested**.

---

# RISK IF WE GET IT WRONG, 5 WEEKS OUT

| | Failure mode | Blast radius | Reversible? |
|---|---|---|---|
| **A** | `_lc` plumbing wrong ⇒ activations never recorded ⇒ steps 2-3 mail everyone including converts | 21,690 × 2 extra sends, ~43k mistargeted emails, unsubscribes and spam complaints against a domain that must survive to fair day | Emails are not recallable. Reputation damage is not reversible. |
| **A** | `enqueueStepEmail` regression (route b) | breaks the path that sent 96,178 emails — **also breaks conference/other campaigns** | code revert is easy; sent mail is not |
| **B** | New scheduler mis-fires: double-send, wrong delay, stuck tokens | same order as A, plus it touches `reactivation_tokens.status`, which the live monitoring UI reads (`:173`, `:196`, `:738`) | migration is additive and revertable; sent mail is not |
| **B** | Schedule overrun — ~250-350 lines of new concurrent code, 5 weeks out | may simply not land in time, leaving no campaign at all | — |
| **C** | `resend-pending` times out mid-loop at 21k | **partial send with no job record and no resume point.** Re-running re-selects `status='pending'` ⇒ everyone already emailed gets a **duplicate** | no way to tell who got wave 2; only forensic reconstruction from `email_queue.created_at` |
| **C** | Wave 2 hits people who registered via another channel | annoyance + unsubscribes, proportional to paid-acquisition overlap | not reversible |
| **all** | No bounce feedback (see the discovery report) — bad addresses stay invisible | reputation erosion across the whole 21,690 | — |

---

# WHAT IS TESTABLE ON A THROWAWAY EXPO

All three are testable end-to-end without touching SIEMA. `[TEST] Reactivation Smoke Test
Expo` (`expo_id 11`) already exists as precedent.

| | Test | Proves | Doesn't prove |
|---|---|---|---|
| **A** | New expo, 3 forms, 5 recipients via Excel with an `activation_url` column, 3 steps (`all` / +1h `not_registered` / +2h `not_registered`), activate 1 of the 5 | placeholder injection; that the activated recipient is **skipped** at step 2 while the other 4 receive it | behaviour at 21k; `enqueueStepEmail` throughput |
| **B** | n/a until built | — | — |
| **C** | Create ~20 tokens, activate 5, run `resend-pending` twice with different `template_id`s | that `pending` correctly excludes the 5; per-wave template selection | **the timeout risk — the whole point of the test — needs ~20k tokens to surface** |

**Use plus-addressing on a real mailbox** (`suer+a1@elan-expo.com`), never a fake domain —
the May `@leena-test.local` incident put 85,000 addresses on SendGrid's suppression list.

**A's decisive test is cheap and definitive:** with 5 recipients and 1 activation you learn
whether `not_registered` correctly detects a reactivation. That single fact is what separates
A-working from A-catastrophic, and it costs one throwaway expo and about an hour.

---

# REUSE vs DUPLICATION

| | Reuses (production-proven) | Duplicates / builds new |
|---|---|---|
| **A** | `runCampaignScheduler`, `evaluateCondition`, `enqueueStepEmail`, `computeNextDue`, `checkCampaignCompletion`, tracking pixel, click wrap, unsubscribe, List-Unsubscribe — **all of it; 32,218 recipients × 3 steps completed** | `_lc` capture in `reactivate.html` (copy of `form-public.html:375-377`); `registered` event in `/activate` (copy of `visitors.js:452-468`) |
| **B** | `reactivate.html`, `/activate`, token model, `resend-pending` | ~250-350 lines mirroring the entire worker scheduler; new table; 4 columns; migration |
| **C** | **100% existing code — zero new lines** | nothing |

---

# COMPARISON TABLE

| | **A — campaigns carry tokens** | **B — reactivation gains steps** | **C — manual waves** |
|---|---|---|---|
| Est. change | **~18 lines / 3 files** (+5 optional) | **~250-350 lines**, +1 table, +4 cols, +1 migration | **0 lines** |
| New schema | none | 1 table, 4 columns, migration | none |
| Multi-step | ✅ proven at 32,218 × 3 | ⚠️ to be built | ❌ manual repeat |
| Automatic timing | ✅ 60s scheduler `:666-667` | ⚠️ to be built | ❌ human click |
| `not_registered` works | ⚠️ **only after the ~18-line fix** | ⚠️ to be built | ➖ approximated by token status |
| Open/click conditions | ✅ | ❌ unless tracking also duplicated | ❌ |
| Open/click **measurement** | ✅ — the only option that measures the failing stage | ❌ | ❌ |
| Auto unsubscribe link | ✅ `:548` | ❌ | ❌ |
| List-Unsubscribe header | ✅ `:229-232` | ❌ | ❌ |
| Excludes registered-elsewhere | ✅ (via `registered` event) | ⚠️ if built | ❌ |
| Per-wave template | ✅ per step | ✅ if built | ✅ `template_id` param |
| Proven at ~20k+ scale | ✅ 32,218 | ❌ | ⚠️ **unverified — likely timeout** |
| Touches the 96k-email send path | ⚠️ route (b) only; route (a) no | ❌ | ❌ |
| Recipient list from expo directly | ⚠️ needs `extra_fields` (+5 lines) or Excel round-trip | ✅ native | ✅ native |
| Biggest single risk | mistargeted follow-ups if `_lc` plumbing is wrong | won't land in 5 weeks | silent partial send / duplicates at 21k |

---

## OPEN ITEMS

1. **NEEDS MORE INFO — largest scale `resend-pending` has ever run.** Not determinable from
   the DB; its `email_queue` rows are indistinguishable from the create-from-* path. Gates
   Option C entirely.
2. **NEEDS MORE INFO — is `reactivate.html`'s activation the only conversion that counts?**
   If a SIEMA registration via the normal public form also counts, `not_registered` already
   works for that route (`visitors.js:452`) and only the token route needs the fix.
3. Bounce blindness and no address validation apply equally to all three (see
   `SIEMA_REACTIVATION_DISCOVERY_20260818.md` Q4).
4. `campaign_recipients` has `UNIQUE (campaign_id, email)` (`campaigns.js:653`) — a recipient
   cannot appear twice in one campaign. Relevant if waves are modelled as separate campaigns.

No recommendation, per brief.
