# SIEMA Pre-Launch Audit — Morocco Siema Expo 2026 (expo 9)

**Date:** 2 Sep 2026, 16:00 UTC
**Read-only.** Every claim is cited to `path:line`, a DB query result, or a DNS record. Nothing written.
**Purpose:** go / no-go decision before activating the first SIEMA campaign built by the wizard shipped today.

---

## A. Wizard completeness — approved scope vs built

### A.1 MUST list (`CAMPAIGN_WIZARD_PLAN_20260901.md` §3.2) — shipped

| # | Piece | Verdict | Evidence |
|---|---|---|---|
| 1 | Segmentation preview endpoint | **BUILT** | `POST /api/campaigns/reactivation/segment` at `routes/campaignBuilder.js:293`. Read-only (no INSERT/UPDATE/DELETE in the handler, verified in G1 review). Response shape matches design §2.2(a): counts + `preview_token`. |
| 2 | Orchestrator endpoint | **BUILT** | `POST /api/campaigns/reactivation/build` at `routes/campaignBuilder.js:602`. Six phases in `setImmediate` per design §2.2(b). Reuses `processReactivationChunks` unchanged. |
| 3 | Job polling endpoint | **BUILT** | `GET /api/campaigns/reactivation/job/:id` at `routes/campaignBuilder.js:970`. Returns FLAT `import_jobs` row (`res.json(r.rows[0])`) — matches G3 UI reader shape. |
| 4 | Per-chunk error → `import_jobs.error_message` | **BUILT** | Patch at `routes/reactivation.js:171-181`, first-error-only, guarded by `IF NULL`. |
| 5 | Pre-flight length truncation | **BUILT** | `truncateRowFields()` at `routes/campaignBuilder.js:100-119`, called in Phase 2 at `:713`. Aggregate count surfaced via `import_jobs.error_message` if any truncations occurred. |
| 6 | Template validation endpoint + panel | **BUILT** | `POST /api/campaigns/validate-template` at `routes/campaignBuilder.js:535`. Frontend panel in G3 UI (`wRenderSteps` at `public/reactivation-campaign.html:~1680`). Blocks build on `severity: 'error'` via `wRecomputeStep3BlockState` + backend `blocking_templates` at `campaignBuilder.js:679`. |
| 7 | Wizard UI (5 steps) | **BUILT** | Third tab `data-tab="wizard"` at `public/reactivation-campaign.html:202`, five panels `wizardPanel1..5`. Vanilla JS, no Bootstrap JS. |
| 8 | Zero-template regression test | **BUILT** | `tests/test_wizard_silent.js` — STEP 5 asserts `SELECT COUNT(*) FROM email_queue WHERE expo_id = TEST_EXPO_ID AND created_at >= jobStart === 0` after a silent-mode build. Last local pass: 18/18 validator unit tests + full wire smoke via Suer's TEST_JWT (2 Sep 15:xx UTC live click-through). |

**All 8 MUST pieces built. Zero PARTIAL, zero MISSING.**

### A.2 Additions approved in review

| Addition | Origin | Verdict | Evidence |
|---|---|---|---|
| Bare `{{name}}` → **WARNING** `BARE_NAME_FALLBACK` (not ERROR) — worker at `email_worker.js:570` falls back to `first_name \|\| 'Guest'` | Suer post-G2 diff | **BUILT** | `campaignBuilder.js:183-189` case, unit test C2 in `tests/test_template_validator.js`. SIEMA templates 47/69/28 all use bare `{{name}}` in body — verified read-only. Under old rule they would have been blocked. |
| Bare `{{first_name}}` / `{{last_name}}` → **ERROR** `NO_GREETING_CHAIN` — worker at `email_worker.js:571-572` maps to `\|\| ''` (renders empty on miss) | Plan §3.4 | **BUILT** | `campaignBuilder.js:175-182`. Unit test C1. |
| Wave-appropriate CTA — activate wave MUST wire `{{activation_url}}` in `<a href>` (ERROR `MISSING_ACTIVATION_URL`); register wave requires any external href (WARNING `NO_CTA`) | Plan §3.4 + G2 review | **BUILT** | `campaignBuilder.js:211-232`. Unit tests E + F + G. |
| `DEAD_UNSUB_URL` (WARNING) for literal `{{unsubscribe_url}}` — unfillable in campaign mode per G7 | Plan §3.4 | **BUILT** | `campaignBuilder.js:234-240`. Unit test H. `unsubscribe_url` whitelisted in `KNOWN_TOKENS` at `:143` so this is the *only* fire, not a double-error. |
| `UNRESOLVED_TOKEN` (ERROR) for unknown `{{}}` and chain segments not in `KNOWN_TOKENS` | Plan §3.4 | **BUILT** | `campaignBuilder.js:159-171`. Unit test D (junk chain segment). |
| Silent-mode guarantee (no `template_id` ⇒ 0 `email_queue` rows) | Plan §3.5 | **BUILT** | Guard chain `reactivation.js:141` (`if (emailTemplate)`) + `:346/:380/:440`. Wizard orchestrator at `campaignBuilder.js:732-739` calls `processReactivationChunks(...{template_id: null, emailTemplate: null, ...})`. Test `test_wizard_silent.js` STEP 5 locks it in. Last green: today 15:xx UTC live wire smoke via TEST_JWT. |
| Per-chunk error persistence to DB (not console) | Plan §3.6 | **BUILT** | See MUST #4 above. |
| Holdout % option | Suer prompt | **MISSING** | No `holdout_percent` parameter in `/segment` or `/build`. No holdout column on `campaign_recipients`. **Deliberate deferral** — not on approved MUST list (plan §3.2), not in design (§2.2). Ops must manually withhold rows from source Excel if a holdout is desired for SIEMA. |
| In-process recipient inserts (no Excel round-trip) | Design §2.2(b) Phase 6 | **BUILT** | `campaignBuilder.js:857-876` batch INSERT into `campaign_recipients` in 500-row chunks with `ON CONFLICT DO NOTHING`. |
| ALL sends Mode 2 (G24) | Suer prompt | **N/A — wizard doesn't send** | Wizard's request path writes only `campaign_recipients` (~200 B/row). The actual send goes through the scheduler's `enqueueStepEmail` at `email_worker.js:531`, which is **Mode 1 per-row, scheduler-bounded** (not Mode 2). Plan §3.7 explicitly documents this: *"All send paths remain Mode 2 or scheduler-bounded Mode 1. G24 satisfied."* The G24 rule targets request-path OOM at N×template_bytes — not applicable to the scheduler's per-row trickle. |
| Step-1 backend normaliser (delay=0, condition='all') | Suer post-G3 review | **BUILT** | `campaignBuilder.js:653-682` normaliser mirrors `campaigns.js:383-384`. `test_wizard_silent.js` STEP 7 (third build with `activate_steps[0]={delay_hours:120, condition:'not_registered'}`, DB-asserted normalisation). |
| Mailable-formula fix (subtract only unsub, not `_hasToken`) | Suer live click-through | **BUILT** | `campaignBuilder.js:481` (formula), `:509` (`tokens_to_mint` counter). `test_wizard_silent.js` STEP 6 second-run assertion. |
| Step-column headers + tooltips + info box + step-1 disabled | Suer live use | **BUILT** | `public/reactivation-campaign.html` — `.wizard-step-header` CSS, `#wizardInfoBox` div, title= tooltips on `wRenderSteps` row template, `disabled` attribute on row 0's delay + condition. |

### A.3 Scope creep check — built but not approved

**None.** Every change is traceable to either the plan §3.2 MUST list, plan §3.4 template validation contract, plan §3.5 regression test contract, or a Suer approval logged in the commit stack. No changes to `email-campaigns.html`, `email_worker.js`, `routes/campaigns.js`, or any live-traffic route.

### A.4 Known gaps carried forward (design intent — NICE, not MUST)

- Results / funnel tab with 5-stage delivery visualisation on campaign detail (design §3.3, plan §3.2 NICE) — not shipped
- `campaign_recipients.visitor_id` backfill at build time (design §3.2 + plan §3.2 NICE) — 0% populated
- "Land on DATE at TIME" delay picker (design §1.3 step 3, plan §3.2 NICE) — hour-based, matches MP26
- Rendered email preview in Step 4 (design §1.3 step 4) — Step 4 currently shows recipient count + summary text, not a rendered HTML preview
- From-expo source path never exercised end-to-end in a browser click-through — code exists (`campaignBuilder.js:415-462`), no live proof

---

## B. Email path correctness — end-to-end trace of one activate mail

Follow a single recipient from wizard build to `sgMail.send()`.

### B.1 Wizard build → `campaign_recipients`

Phase 3 (`campaignBuilder.js:756-782`): for each G2 mailable recipient, INSERT into `campaign_recipients` with `extra_fields = {activation_url, country, job_title, expo_name}`. `activation_url = ${BASE_BADGE_URL || 'https://leena.app'}/reactivate.html?token=${token}` (`:773`). Token minted in Phase 2 via `processReactivationChunks` with `emailTemplate=null`, `template_id=null` — silent mode, guarded at `reactivation.js:141`.

### B.2 Scheduler pick-up

`email_worker.js:270-278` `runCampaignScheduler` runs every `CAMPAIGN_SCHEDULER_INTERVAL_MS = max(10, ENV) * 1000` (default 60 s, currently 10 s per env-set at `leena-email-worker`). `:352` picks up to `CAMPAIGN_SCHEDULER_BATCH_LIMIT = max(1, ENV)` recipients per cycle (default 500, currently 2000 per env-set per CLAUDE.md v4.0.7 §Worker environment).

For each due recipient: `:429 → enqueueStepEmail(campaign, recipient, step, organizerName)`.

### B.3 Unsubscribe check — at SEND time (defense-in-depth)

`email_worker.js:537-548`:
```sql
SELECT 1 FROM email_unsubscribes
WHERE email = $1 AND organizer_id = $2 LIMIT 1
```
If found, `UPDATE campaign_recipients SET status = 'unsubscribed'`, COMMIT, `return` — no enqueue.

**Also at BUILD time.** Wizard `/segment` at `campaignBuilder.js:429-431` prefetches `SELECT email FROM email_unsubscribes WHERE organizer_id = $1` into `S_unsub`; segmentation loop at `:463-471` sets `_unsub` on every row; Phase 3/4 build filters `!_unsub` at `:757` + `:786`. **So an unsubbed recipient is:** (a) excluded from `campaign_recipients` at build time entirely, (b) rejected again at send time in the defensive `enqueueStepEmail` check.

### B.4 Real-registration skip (dedbcd0 semantics)

`email_worker.js:495-527` `evaluateCondition` for `not_registered` checks THREE sources — not just the campaign event:
```sql
SELECT
  EXISTS(... email_events ... event_type='registered' AND recipient_id = $1) AS via_campaign,
  EXISTS(... visitors v WHERE v.expo_id = $4 AND lower(v.email) = lower($3))  AS via_visitor_row,
  EXISTS(... reactivation_tokens WHERE email = $3 AND target_expo_id = $4 AND status = 'activated') AS via_token
```
`wasRegistered = via_campaign || via_visitor_row || via_token`. **Applies to SIEMA (expo 9) exactly as it applied to MP26 (expo 13)** — no per-campaign toggle. So a recipient who registers via organic Zoho / walk-in / manual import between step 1 and step 2 is skipped at step 2.

### B.5 Template render (Mode 1, per row)

`email_worker.js:552-577`:
```js
const tplRes = await client.query('SELECT subject, html_content FROM email_templates WHERE id = $1', [step.template_id]);
...
let extraFields = typeof recipient.extra_fields === 'string' ? JSON.parse(recipient.extra_fields) : recipient.extra_fields;
const data = {
  name: recipient.first_name || 'Guest',   // ← BARE_NAME_FALLBACK maps here
  first_name: recipient.first_name || '',  // ← NO_GREETING_CHAIN maps here (empty on miss)
  last_name: recipient.last_name || '',
  email: recipient.email,
  company: recipient.company || '',
  date: new Date().toLocaleDateString(),
  ...extraFields                            // ← activation_url, country, job_title, expo_name spread
};
const subject = processEmailTemplate(template.subject, data);
let html = processEmailTemplate(template.html_content, data);
```

Greeting-chain resolver at `utils/email.js:12-23`: `expr.split('|').map(p => p.trim())`, walks parts, returns first `data[part]` that is truthy OR any `/^".*"$/` quoted literal. Matches the validator's chain semantics exactly.

### B.6 URL wrapping + tracking

`email_worker.js:595-602`, in order:
1. `generateUnsubscribeToken(campaign.id, recipient.id, recipient.email)` — HMAC base64url, no DB storage
2. `injectUnsubscribeLink(html, unsubToken, organizerName)` — appends footer with `${BASE_URL}/api/email-track/unsubscribe/${token}` (`utils/trackingPixel.js:44-51`)
3. `appendCampaignTokenToFormLinks(html, unsubToken)` — adds `?_lc=<token>` to `reactivate.html` and `form-public.html` hrefs. **This is the bridge that makes registration attributable to the campaign.**
4. `wrapClickLinks(html, emailEventId)` — base64-encodes each href through `/api/email-track/click/<eventId>/<encoded>` for click tracking. Wraps `_lc`-appended URLs so `_lc` survives the redirect.

### B.7 INSERT + send

`email_worker.js:606-612` INSERT into `email_queue` **Mode 1** (`html_content` populated). Row picked up by main worker loop (2 s tick, BATCH_SIZE=10) → `email_worker.js:229-241` builds `extraHeaders` via `getListUnsubscribeHeaders` (see §C.2) → `sendEmailWithReplyTo(to, subject, html, 'reply@replies.leena.app', extraHeaders)` at `:235`.

### B.8 Fair-anchored token expiry — expo 9

`routes/reactivation.js:89-95`:
```sql
SELECT GREATEST(
  COALESCE(end_date + INTERVAL '1 day', NOW() + INTERVAL '90 days'),
  NOW() + INTERVAL '30 days'
) AS expires_at
FROM expos WHERE id = $1
```

Live DB run against expo 9:

```
    token_expiry_for_expo_9    | expo_9_end_date | end_plus_one
-------------------------------+-----------------+--------------
 2026-10-02 15:59:35.590331+00 | 2026-09-24      | 2026-09-25
```

30-day floor wins (today + 30 d = 2 Oct > 25 Sep). Tokens minted today cover the entire fair 22-24 Sep + 8 days after. **Safe.**

### B.9 Expo 9 identity — canonical DB row

```
 id |          name           | start_date |  end_date  | country_code | organizer_id |          slug
----+-------------------------+------------+------------+--------------+--------------+-------------------------
  9 | Morocco Siema Expo 2026 | 2026-09-22 | 2026-09-24 | MA           |            1 | morocco-siema-expo-2026
```

`country_code=MA` is set → phone normaliser resolves to Morocco defaults (todo #4 acceptance verified 2 Sep). Fair dates 22-24 Sep 2026 confirmed.

### B.10 Throughput math — EMAIL_WORKER_BATCH_SIZE=10

CLAUDE.md v4.0.7 records the measured deploy: **BATCH_SIZE=10 → 274.4 emails/min** (10 × 2 s cycle = 300/min ceiling, 9% latency shortfall).

Scheduler enqueue rate: `CAMPAIGN_SCHEDULER_BATCH_LIMIT=2000` per `CAMPAIGN_SCHEDULER_INTERVAL_SECONDS=10` = 200/s = 12,000/min. Enqueue is **not the bottleneck** — worker send is.

Projected drain times per step (single-step wave, from launch to last-sent):

| recipients | enqueue completes | worker drain | landing window |
|---:|---:|---:|---:|
| 5,000 | +25 s | +18.2 min | ~18 min |
| 10,000 | +50 s | +36.5 min | ~36 min |
| 20,000 | +100 s | +72.9 min | ~73 min |
| 42,000 (MP26 scale) | +210 s | +153 min | **~2.5 h** |

**For SIEMA at the 21,303 G2-activate size** (see §D.5): step-1 landing window **~78 min**. Launching at 09:00 Casablanca means last recipient lands ~10:18. Well inside "morning."

### B.11 G23 delivered_count — expected UI behaviour during SIEMA

`checkCampaignCompletion` (`email_worker.js:632-645` per CLAUDE.md v4.0.8) snapshots `email_queue.status='sent'` into `email_campaigns.delivered_count` **at completion**, **in the same transaction that purges those sent rows**. Bug: the snapshot fires when the last recipient's last step is **enqueued**, not drained → `delivered_count` freezes ~70% of true delivered on multi-step campaigns.

**What Yaprak will see on SIEMA:**
- **While the campaign is `active`** (multi-step, days 1-11): the "Delivered" column on `email-campaigns.html` reads a live `COUNT(*) FROM email_queue WHERE status='sent'`. **Correct in real time**, up to the moment of completion.
- **After completion**: the same column reads `delivered_count` (snapshotted) — **under-reports by ~30%** for a 3-step campaign, roughly the same shape as MP26 C16 (30,990 stored / 43,466 sent) and C17 (52,410 / 78,145).
- **Open / click / registration rates** computed against `delivered_count` will therefore be **over-stated by ~30%** post-completion.

Send is unaffected. Display only. Flag for Yaprak: "the completed-campaign delivered number is a known under-count — don't panic when it drops after the last step drains."

---

## C. SendGrid / deliverability compliance

### C.1 DNS (measured from terminal, 2 Sep 16:xx UTC)

> ### ⚠️ CORRECTION — 2 Sep 2026 21:23, superseded by measurement
>
> **The SPF finding in this section is wrong. Do not act on it.** See
> `DEPLOY_FOOTER_AND_WIZARD_POLISH_20260902.md` §3.5 + §5 for the raw
> `Authentication-Results` header from a real Gmail delivery.
>
> **What is actually true:** SPF is evaluated on the **Return-Path**
> (`smtp.mailfrom`) domain, not the `From:` domain. SendGrid sends bounces
> from `bounces+…@em5759.leena.app` — a subdomain provisioned for this
> account, with its own SPF record served by SendGrid's DNS. Live Gmail
> delivery shows `spf=pass smtp.mailfrom="bounces+…@em5759.leena.app"
> (50.31.42.23 permitted)`. All three of DKIM, SPF, and DMARC pass on
> real mail today.
>
> **What the audit measured:** `dig +short txt leena.app` — only the apex.
> An apex SPF record would not have appeared in the SPF check at all (the
> check follows the Return-Path, not the From). Adding `-all` at the apex
> before a 21k send would have been risk without benefit.
>
> The recommendation *"Adding an SPF `v=spf1 include:sendgrid.net -all`
> record is a 60-second fix"* below is **withdrawn**. No todo carries it
> forward.

**SPF (`dig +short txt leena.app`):**
```
(empty — no TXT records at all on leena.app)
```

**⚠️ NO SPF RECORD.** DMARC alignment therefore relies **entirely on DKIM alignment**. Any Gmail path that strips DKIM (forwarders, mailing lists) will fail authentication and be dropped by `p=reject`.

> *(Superseded — see correction block above. SPF passes via the
> Return-Path subdomain `em5759.leena.app`, not the apex.)*

**DMARC (`dig +short txt _dmarc.leena.app`):**
```
"v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"
```

`p=reject` policy. Relaxed alignment on both DKIM and SPF (`adkim=r`, `aspf=r`) — subdomain DKIM (e.g. `d=em5759.leena.app`) still counts as aligned with `From: @leena.app`. Aggregate reports (`rua=`) go to onsecureserver.net (not our own inbox — worth noting).

**DKIM (SendGrid-issued CNAMEs, `dig +short cname <host>`):**
```
em5759.leena.app          → u52794868.wl119.sendgrid.net.
s1._domainkey.leena.app   → s1.domainkey.u52794868.wl119.sendgrid.net.
s2._domainkey.leena.app   → s2.domainkey.u52794868.wl119.sendgrid.net.
```

DKIM CNAMEs are resolving — SendGrid will sign as `d=leena.app` (via the `em5759` subdomain), which is what DMARC-DKIM alignment needs.

**Net authentication verdict:**
- DKIM: ✅ aligned, `d=leena.app`, DMARC-passing
- SPF: ❌ absent — DMARC-SPF alignment fails by default
- DMARC: ✅ passes (only DKIM alignment is needed)

**Risk:** any forwarding path (Google Groups, corporate MTA rewrites, mailman) that breaks DKIM signature will fail DMARC entirely and be rejected. Practical impact: probably <2% of recipients, but non-zero. **Adding an SPF `v=spf1 include:sendgrid.net -all` record is a 60-second fix** that removes this whole class of failure. Not a blocker for SIEMA — MP26 sent 96k mails on the same DNS state — but a one-line pre-launch improvement worth doing.

### C.2 Code — identities and RFC 8058 headers

**From:** `noreply@leena.app` — hardcoded fallback at `utils/email.js:41` + `:73`, overridable via `SENDER_EMAIL` env var. **Reply-To:** `reply@replies.leena.app` — hardcoded at `email_worker.js:239`.

**List-Unsubscribe + List-Unsubscribe-Post One-Click (RFC 8058) — `utils/trackingPixel.js:167-176`:**
```javascript
function getListUnsubscribeHeaders(campaignId, recipientId, email) {
  const token = generateUnsubscribeToken(campaignId, recipientId, email);
  const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}
```
Wired into every campaign send at `email_worker.js:229-232` — only when `task.campaign_id && task.campaign_recipient_id`. Non-campaign mail (badge, certificate, single-recipient) omits it, which is correct.

**Footer + unsub link (`utils/trackingPixel.js:44-51`):**
```javascript
const unsubUrl = `${BASE_URL}/api/email-track/unsubscribe/${token}`;
const footer = `<div ...>If you no longer wish to receive these emails from ${organizerName || 'this organizer'}, <a href="${unsubUrl}">unsubscribe here</a>.</div>`;
```

**⚠️ Physical postal address — MISSING.** The footer contains no street address. **US CAN-SPAM Act §316.5(a)(5) requires a valid physical postal address** for commercial email. Templates 54-59 (MP26) each carried "Elan Expo, Istanbul, Turkey" hand-written in the body — but the auto-appended footer does not. Suggested one-liner in `injectUnsubscribeLink`:
```
${footer.replace('unsubscribe here</a>.', 'unsubscribe here</a>.<br>Elan Expo, Istanbul, Turkey.')}
```
**Flag: SIEMA templates 47/69/28 do not include a physical address in their body either — verify Yaprak's SIEMA campaign template includes one before send, or add to the footer.**

### C.3 Gmail / Yahoo bulk-sender rules (Feb 2024) — checklist

| Requirement | Status | Evidence |
|---|---|---|
| SPF or DKIM aligned domain | ✅ (DKIM only) | §C.1 above |
| DMARC published, `p=none/quarantine/reject` at organisational domain | ✅ | `_dmarc.leena.app: p=reject` |
| One-click unsubscribe (RFC 8058) — `List-Unsubscribe: <URL>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | ✅ | `utils/trackingPixel.js:174-175` |
| Unsubscribe honoured within 2 days | ✅ (instant) | `routes/emailTracking.js:212-217` INSERT into `email_unsubscribes` happens on the POST handler — immediate `ON CONFLICT DO NOTHING`; same transaction marks campaign_recipients status='unsubscribed' at `:220-225` |
| Spam complaint rate < 0.3% | **UNMEASURABLE** | See §C.4 — no bounce/complaint ingestion |
| From address is at the sending domain | ✅ | `noreply@leena.app` matches `d=leena.app` DKIM |
| No misleading From / Subject | Manual review needed per-template | Not automatable |

### C.4 Bounce / complaint blind spot — G9, unchanged

`grep -rn "sendgrid.*event\|webhooks/sendgrid" routes/` returns **zero matches.** No `POST /api/webhooks/sendgrid` route exists. No `email_events` writer for bounce / dropped / spamreport event types.

**Practical impact for a 20 k+ SIEMA send:**
1. Any address SendGrid marks as a **hard bounce** stays in `email_unsubscribes`? **NO** — no ingestion. Same address will be re-mailed on step 2 and step 3.
2. Any **spam complaint** we get is invisible to us. We cannot suppress before re-mailing.
3. Our own dashboard shows `total_sent = enqueue count` (G14) — accurate to enqueue, blind to acceptance / rejection.
4. **The only source of truth for bounce and complaint rates is the SendGrid dashboard.**

**Concrete SIEMA risk:** if Yaprak's list has, say, 5% dead addresses (typical for a 2-year-old fair list) and 21 k activate recipients × 3 steps = 63 k mails, that's ~3,150 bounces. If SendGrid throttles the sender due to bounce rate, later steps degrade — but we won't see it in our UI.

**Mitigation, sized:** enable the SendGrid Event Webhook and wire a `POST /api/webhooks/sendgrid` route with a token-shared secret. Persists `bounce`/`dropped`/`spamreport` into `email_events` (schema already accepts `event_type`) and adds affected emails to `email_unsubscribes` for the organizer. **~40-60 lines, single file, no schema change.** Not built. Not a blocker (MP26 succeeded without it) but a plainly reasonable pre-SIEMA improvement.

### C.5 Suppression sanity — our list vs SendGrid-side

Our `email_unsubscribes` count for organizer 1: **345 rows** (measured 2 Sep 16:xx UTC).

**SendGrid-side suppressions we can't see from Leena:** global unsubscribes, group unsubscribes, bounces, spam reports, blocks, invalid emails. All maintained by SendGrid based on delivery history and its own suppression list uploads (which we did during the v4.0.5 test-address cleanup — CLAUDE.md v4.0.5 "test domain SendGrid suppression" — 85 k rows added).

**Blind spot:** we cannot cross-check "will this email get through?" until SendGrid attempts delivery. Our `/segment` filter excludes rows in `email_unsubscribes` (`campaignBuilder.js:432`) but does not exclude SendGrid-side suppressions. **A future Excel with 5 % SendGrid-suppressed addresses would pass our `/segment` filter unchanged and drop at SendGrid.** The user sees `sent=X` in our UI; only the SendGrid dashboard shows `X - suppressed` as the true delivered count.

Not a blocker. Ops discipline: check SendGrid dashboard alongside our UI on Day 1 of send.

---

## D. SIEMA launch readiness

### D.1 Templates 47 / 69 / 28 — current validator verdicts

Live DB row (`SELECT id, organizer_id, is_active, name FROM email_templates WHERE id IN (47,69,28)`):
```
 id | organizer_id | is_active |                       name
----+--------------+-----------+--------------------------------------------------
 69 |            1 | t         | Morocco Siema FoodExpo QR Code Badge Mail FR
 47 |            1 | t         | Morocco Siema FoodExpo QR Code Badge Mail
 28 |            1 | t         | Exhibitor Badge Mail Template Morocco Siema Expo
```

All 3 are **post-registration badge templates**, not campaign drip templates. Body pattern verified on 2 Sep: `body_has_bare_name = true`, `body_has_bare_first_name = false`, `body_has_activation_url_href = false`.

**If Yaprak accidentally selects any of them as an activate-wave step:**
- **wave=activate** → validator returns `ok=false` with 2 issues: `MISSING_ACTIVATION_URL` (ERROR — blocks build), `BARE_NAME_FALLBACK` (WARNING). **Build correctly blocked.**
- **wave=register** → `ok=true` with 1 issue: `BARE_NAME_FALLBACK` (WARNING). **Build allowed** — but the mail says "your registration is confirmed, here's your QR code" and points at an existing QR image that references the token-flow badge_id, which for an unregistered visitor doesn't exist. Ops error, not a validator gap. Yaprak's SIEMA templates should be **new drip templates**, not these post-registration ones. MP26 used dedicated templates 54-59 for this exact reason.

### D.2 Expo 9 forms — `hear_about_event` field carriage

Live DB (`SELECT id, name, visitor_type, jsonb_path_exists(fields::jsonb, '$[*] ? (@.name == "hear_about_event")') FROM forms WHERE expo_id = 9`):

| id | name | visitor_type | has `hear_about_event` | field count |
|---|---|---|:-:|---:|
| 38 | Exhibitor Registration Form | exhibitor | ❌ | 8 |
| 51 | Visitor Registration Form | visitor | ✅ | 17 |
| 59 | Formulaire d'inscription des visiteurs | visitor | ❌ | 14 |

**Form 51 (English visitor form) carries `hear_about_event`. Form 59 (French visitor form) does NOT.** Cross-reference `SIEMA_LANDING_FORM_INVENTORY_20260901.md` for context — French form 59 is a manual French translation of 51 and was not brought forward with the same field set.

**Impact on SIEMA campaign register-wave targeting:**
- Recipients who register via English form 51 land in `visitors` with `custom_fields.hear_about_event` populated (Yaprak can slice attribution).
- Recipients who register via French form 59 land in `visitors` with no `hear_about_event` — attribution is silently lost for the French sub-segment.

**Not a wizard defect** — the wizard doesn't touch forms. Yaprak needs to either (a) add `hear_about_event` to form 59, or (b) accept that French registrations won't be attributable. **Pre-launch decision, not a blocker.**

### D.3 Timezone handling — Lagos hardcoding

`grep -n "Africa/Lagos" routes/ email_worker.js` — **29 hits, all in `routes/reports.js`** (§797 comment: *"All time-bounded queries are Lagos TZ-aware"*).

**Send-path TZ dependency: ZERO.** The scheduler uses `delay_hours` added to `next_step_due_at` (`email_worker.js:531+`), all in UTC. Delays fire based on the previous step's enqueue timestamp — Casablanca / Lagos / anywhere makes no difference to when a step-2 mail hits SendGrid.

**Report-path TZ dependency for Yaprak:** the check-in reports she'll be looking at during the fair display hours in Lagos TZ (UTC+1 year-round). Morocco is UTC+1 in DST (SIEMA falls inside Morocco DST which runs to late October), so **the report clocks will happen to be correct** during SIEMA — but only by accident.

**Correction from Suer's prompt: "morning Lagos → Morocco TZ".** For campaign scheduling Yaprak should think in Morocco local time (Africa/Casablanca, UTC+1 in Sep). Setting `delay_hours=0` at 08:00 UTC on the activate day lands mail at 09:00 Casablanca. The system-level clock doesn't matter, only Yaprak's mental model does.

Post-fair backlog: replace `Africa/Lagos` hardcoding in reports.js with an expo-aware TZ derived from `country_code` (already listed in todo.md carried-forward as *"reports.js bare CURRENT_DATE on a UTC session → today rolls at 01:00 Lagos"*). Not a SIEMA blocker.

### D.4 Holdout recommendation

**No holdout mechanism built** (see A.2). If Yaprak wants a control group for SIEMA (recommended for a first-of-kind Morocco campaign to have a delta to compare against later):

- **Manual holdout, 5-10 %.** Randomly remove 5-10 % of the merged source Excel before upload. Keep those rows in a separate `siema_holdout.xlsx` file. **Do not send anything to them.** Compare fair-registration rate for the sent segment vs the holdout segment after the fair. 5% of 21k = ~1k held out — statistically enough to detect a >2pp difference in registration rate at 95 % confidence.
- **Do NOT include a token-holder holdout in G2** — every G2 recipient's token expires on 2 Oct; a held-out G2 recipient gets no reactivation email, no landing page, no way to convert. Holdout should be a random slice **before** segmentation.

### D.5 List source state — expo 9 today

**Visitors on expo 9 as of 2 Sep 16:xx UTC:** 671 rows, all with unique emails.

**Pending reactivation tokens on target expo 9:** 0 (no prior campaigns have minted for SIEMA).

**Segmentation projection — assuming Yaprak's source = expo 1 (Siema 2024 pool):**

| bucket | count | wizard label |
|---:|---|---|
| source pool size | **21,389** | (input) |
| G1 already registered on expo 9 (excluded) | **86** | `g1_already_registered_target` |
| G2 activate — has visitor row on another expo | **21,303** | `g2_activate_raw` = `g2_activate_mailable` (0 unsub in source, 0 existing tokens) |
| G3 register — no visitor row anywhere | **0** | (source-from-expo path can never produce G3 — all rows exist on some expo by definition) |
| unsub hits in source | **0** | |

**If Yaprak uploads a merged Excel** (MP26-style: past-fair pool + externally-verified new list), the split becomes real G2 / G3. MP26's 42 k input produced 15 k G2 + 26 k G3 — SIEMA is likely smaller (Morocco pool is 21 k vs Nigeria's larger corpus) and skewed toward G2 since Siema 2024 attendees are the primary audience.

**Unsubs in the source cannot be sized without the file** — organizer-1 has 345 total unsubs; the intersection with SIEMA's specific source depends on the file.

### D.6 Post-fair campaign doctrine — as config guidance

From MP26 outcomes recorded in v4.0.7-v4.0.9:

| variable | measured value | SIEMA config translation |
|---|---|---|
| Optimal drip cadence (hot list) | 1 shot, no follow-up | Single-step activate wave for **already-registered rebook** flows |
| Optimal drip cadence (cold list) | ≤ 2 mails | **Max 2 steps** in activate wave when source is >6 months old |
| Step-2 condition | `not_registered` (post-dedbcd0 semantics catches organic + walk-in + reactivate paths) | Same config |
| Step-2 delay | 37-96 h in MP26; 120 h (5 d) recommended for lower-cadence Morocco pool | **`delay_hours=120` on step 2** |
| Launch time-of-day | Morning local time | **09:00 Casablanca WEST = 08:00 UTC** step-1 launch |
| Holdout | Not tested in MP26 | **5-10 % random** as §D.4 |
| Register wave | Standalone form CTA, no drip in MP26 C17 | Same — 1-2 steps max, second step conditional on `not_registered` |

---

## E. GO / NO-GO

| section | verdict | blocking items |
|---|---|---|
| **A. Wizard completeness** | 🟢 GO | none |
| **B. Email path correctness** | 🟢 GO | none |
| **C. SendGrid / deliverability** | 🟡 CONDITIONAL GO | (see below — 1 minor code fix + 2 operational disciplines, none strict blockers) |
| **D. SIEMA launch readiness** | 🟡 CONDITIONAL GO | Yaprak must (i) NOT use templates 47/69/28 as drip content — build new SIEMA drip templates, (ii) decide French form 59 attribution, (iii) prepare source Excel with 5-10 % holdout slice removed |

### Blockers (STRICT) — none.

### Conditional items (do these before send, not blockers)

1. ~~**[Code, 60 sec]** Add `v=spf1 include:sendgrid.net -all` TXT record on `leena.app`~~ — **WITHDRAWN.** Superseded by measurement 2 Sep 21:23: SPF passes via the Return-Path subdomain `em5759.leena.app`. Adding an apex record is risk without benefit. See §C.1 correction block and `DEPLOY_FOOTER_AND_WIZARD_POLISH_20260902.md` §5.
2. ~~**[Code, ~5 min]** Add physical postal address to the auto-appended unsub footer~~ — **DONE.** Deployed 2 Sep as commit `3f4da63`. Address is `ELAN EXPO MAROC SARL / 30, Bd Rahal El Meskini, 2ème Etage, Appart N° 5, Casablanca, Morocco / +212 650 219 756` (Morocco entity, correct for SIEMA). Verified end-to-end via Gmail delivery — see `DEPLOY_FOOTER_AND_WIZARD_POLISH_20260902.md` §3.4. **New P2 todo: address is hardcoded; must move to per-organiser-office lookup before the next non-Morocco campaign.**
3. **[Ops discipline]** Do NOT reuse templates 47/69/28 for SIEMA campaign steps — create new SIEMA-branded drip templates in `email-templates.html` and run each through the wizard's Validate button before build.
4. **[Ops discipline]** Watch the SendGrid dashboard alongside our UI on Day 1 of send — until the Event Webhook is wired (post-SIEMA backlog), SendGrid is the only bounce/complaint source of truth.
5. **[Ops decision]** French form 59: either add `hear_about_event` field, or accept lost attribution for the French sub-segment.
6. **[Ops decision]** Whether to run a 5-10 % holdout — recommended.

### After-launch (post-SIEMA backlog)

- SendGrid Event Webhook + bounce/complaint ingestion (G9) — ~40-60 lines
- `Africa/Lagos` → expo-aware TZ in `reports.js` — 29 sites
- Wizard funnel tab (5-stage delivery viz) — design §3.3
- `campaign_recipients.visitor_id` backfill at build time — 10 lines
- Rendered email preview in wizard Step 4 — design §1.3

---

## F. Click-through script for Suer + Yaprak (once conditional items clear)

**Pre-flight, Suer:**
1. ~~Add SPF TXT record on `leena.app`~~ — **WITHDRAWN.** SPF passes via `em5759.leena.app` (measured 2 Sep 21:23 from a live Gmail delivery). Do nothing.
2. ~~Edit `utils/trackingPixel.js:45` to add postal address~~ — **DONE** in commit `3f4da63` (2 Sep). Morocco entity address deployed; verified in Gmail with intact UTF-8. See `DEPLOY_FOOTER_AND_WIZARD_POLISH_20260902.md`.

**Template prep, Yaprak (in `email-templates.html`):**
1. Create 3 new templates for SIEMA activate wave: `SIEMA26 Activate Step 1`, `Step 2`, `Step 3`. Body must include `<a href="{{activation_url}}">` and use the greeting chain `{{first_name|last_name|company|"Dear Visitor"}}` (not bare `{{first_name}}`). Include "Elan Expo, Istanbul, Turkey" address near the footer.
2. Create 2 new templates for register wave: `SIEMA26 Register Step 1`, `Step 2`. Body must include a link to `https://leena.app/form-public.html?id=51` (English) — French recipients would need a mirrored template pointing at form 59.

**Wizard run, Yaprak (on `reactivation-campaign.html`, Wizard tab):**
1. **Panel 1 — Source:** Excel upload OR from-expo. Target expo dropdown → **9 (Morocco Siema Expo 2026)**. If Excel: upload the merged list, holdout slice already removed. If from-expo: pick source expo(s) — likely expo 1 (Siema 2024 pool).
2. **Panel 2 — Preview:** verify counts. G1 excluded should be ~86 (existing SIEMA registrants). G2 mailable should be the vast majority. G3 mailable will be zero if source is from-expo. Read the "unsubscribed hits" line.
3. **Panel 3 — Templates:**
   - Activate wave: add 3 steps. Step 1 = SIEMA26 Activate Step 1 (delay 0h, condition `all` — both forced by UI + backend normaliser). Step 2 = Step 2 template, delay 120h, condition `not_registered`. Step 3 = Step 3 template, delay 120h, condition `not_registered`. Click **Validate** on each — expect green (0 errors).
   - Register wave: same shape if G3 > 0, else leave empty.
4. **Panel 4 — Confirm:** review summary. Verify "Tokens to mint: N" matches expectation (should equal G2 mailable minus already-tokenised, which for SIEMA today is 0 → all of G2). Click **Build**.
5. **Panel 5 — Build progress:** progress bar. On completion, click "Open Email Campaigns page →".

**Activate, Yaprak (on `email-campaigns.html`):**
1. Two new draft campaigns visible: `Morocco Siema Expo 2026 Activate Wave` and `... Register Wave` (or just Activate if G3=0).
2. Click each → Detail page → Activate button. Confirm the count matches Panel 4's summary. Activate the Activate wave first.
3. **09:00 Casablanca WEST = 08:00 UTC.** Step 1 fires immediately on activate. Step 2 fires 120 h later, step 3 fires 120 h after step 2.

**Post-launch monitoring:**
- **Our UI:** `email-campaigns.html` shows live sent count during drain. Delivery rate honest until completion.
- **SendGrid dashboard:** watch bounce rate + complaint rate on Day 1. If bounce > 3 % or complaint > 0.1 %, pause the campaign from `email-campaigns.html` (existing UI at `email-campaigns.html:945`).
- **The `delivered_count` display drops ~30 % on completion** (G23) — expected, cosmetic, no send impact.

**If step 2 blocks step 1 conversion attribution:** the dedbcd0 semantics catch registrations via ANY route (organic Zoho, walk-in, reactivate link, manual import). A recipient who registers on the SIEMA landing page (form 51 or 59) between step 1 and step 2 will be correctly excluded from step 2's send.
