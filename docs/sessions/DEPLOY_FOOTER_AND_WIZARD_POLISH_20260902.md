# Deploy — Morocco CAN-SPAM footer + Wizard preview readability

**Date:** 2 Sep 2026, ~21:00-21:30 local
**Commit:** `3f4da63` — `feat: Morocco CAN-SPAM footer + wizard preview readability`
**Scope:** two files + one todo item.
  - `backend/leena-v401-backend/utils/trackingPixel.js` (Phase A — footer)
  - `backend/leena-v401-backend/public/reactivation-campaign.html` (Phase B — wizard preview panel)
  - `todo.md` (new P2 item, cross-referenced below)

Ship-together package after the SIEMA pre-launch audit surfaced two conditional items — the
CAN-SPAM postal address gap (§C.2 of the audit) and Suer's live misread of the wizard's
struck-through G1 line as "0 registered". Both closed here.

---

## 1. Phase A — Morocco CAN-SPAM footer

### 1.1 What changed

`utils/trackingPixel.js` `injectUnsubscribeLink`, +15 / −4. Physical postal address on its own
lines after the unsubscribe link. Built into the footer template string directly — **not**
appended via `.replace()` on the sentence, so any future wording change cannot silently drop the
address line. Long comment records the CAN-SPAM cite (§316.5(a)(5)), the "no .replace" reason,
and the campaign-only injection point.

**Rendered footer** (verbatim from a real Gmail delivery — see §3):
```
If you no longer wish to receive these emails from [TEST] Reactivation Bridge Test 20260818, unsubscribe here.
ELAN EXPO MAROC SARL
30, Bd Rahal El Meskini, 2ème Etage, Appart N° 5, Casablanca, Morocco
+212 650 219 756
```

### 1.2 Injection point — verified campaign-only

`grep -rn "injectUnsubscribeLink"` in the repo returns four hits: one comment, one definition
(`utils/trackingPixel.js:41`), one export, and **exactly one call site** at
`email_worker.js:596`. That call sits inside `enqueueStepEmail`, which has **exactly one
caller** at `email_worker.js:429` (`processRecipient` inside the campaign scheduler).

Non-campaign mail — badge (`:208-209`), certificate (`:222-223`), single-recipient sends — build
their own HTML at `email_worker.js:162-226` and call `sendEmail` / `sendEmailWithReplyTo`
directly. **They never pass through `injectUnsubscribeLink`.** Same for `injectTrackingPixel`.

### 1.3 UTF-8 preservation — measured

Source bytes for the two accented characters, verified end-to-end by rendering
`injectUnsubscribeLink` locally through the actual function and inspecting the byte sequence:

```
2ème : 32 c3 a8 6d 65      (è = U+00E8 → C3 A8)
N°   : 4e c2 b0             (° = U+00B0 → C2 B0)
Same bytes appear in rendered footer? true
```

**Confirmed live on Gmail** in §3 below: no mojibake, no `2Ã¨me`, no `N&#176;`.

### 1.4 Sender identity — unchanged

From stays `noreply@leena.app` (fallback at `utils/email.js:41,73`, overridable via
`SENDER_EMAIL`). Reply-To stays `reply@replies.leena.app` (`email_worker.js:239`). DKIM/DMARC/
SendGrid authentication is established on `leena.app`; only the postal identity in the footer
changes.

---

## 2. Phase B — Wizard preview panel readability

### 2.1 The bug caught by Suer's live use

Suer misread the struck-through grey G1 line on the wizard preview panel as "0 registered".
Under the old layout the line read `G1 — already registered on target (excluded) — 93` with
line-through styling — visually the "93" cancelled out. Ops interpretation matters more than
literal correctness.

### 2.2 The fix — cosmetic only, `/segment` response shape unchanged

`public/reactivation-campaign.html`, +88 / −12. Restructured the preview body into:

1. **Headline block (blue background):** three plain-English lines that answer the operator's
   real question ("who is this going to?") without any G1/G2/G3 jargon.
2. **G1 amber info row (light-amber, not struck-through):** surfaces the excluded-because-already-
   registered count with the target expo name in-line. Only visible when `g1 > 0`.
3. **Register-wave-empty note:** when `g3_register_mailable = 0`, hides the 3 G3 rows in the
   ledger (class `.wPvG3Row`) and shows one muted line
   *"Register wave: none in this source (everyone is already in our database)."*
4. **Collapsible `<details>Details</summary>` block:** wraps the full raw ledger. Every existing
   `wPv*` ID retained inside — 21 IDs verified present exactly once on the deployed page.

Templates panel untouched (already handles the "0 mailable — skip this wave" case correctly at
`:1636`). Page-level `#pageInfoBox` above the tab bar untouched (shared with Create Campaign +
View Campaigns tabs Yaprak uses daily).

### 2.3 Headline arithmetic — the invariants

```
will_receive = g2_activate_mailable + g3_register_mailable
excluded     = g1_already_registered_target + invalid_email + duplicates_in_list + unsubscribed_hits
to_mint      = tokens_to_mint  (server-supplied; fallback = max(0, g2_mailable − existing_pending_tokens_hit))
```

These are asserted client-side against every `/segment` response.

### 2.4 ID survival — verified on the deployed page

Post-deploy grep against `https://leena.app/reactivation-campaign.html`, all 21 wizard preview
IDs present exactly once each:

```
wPreviewTargetName / wPreviewSourceKind / wPreviewSourceSize / wPvTotal / wPvInvalid / wPvDup /
wPvG1 / wPvG1Note / wPvG1TargetName / wPvG2 / wPvG2Raw / wPvG2Tok / wPvG2Mint / wPvG3 /
wPvG3Raw / wPvG3NoneNote / wPvUnsub / wPvHeadlineReceive / wPvHeadlineExcluded /
wPvHeadlineExcludedBreakdown / wPvHeadlineToMint
```

Zero dangling `getElementById` targets. Backward-compatible with the old renderer semantics
(every old setter preserved; new setters appended).

---

## 3. Verification — endpoint captures + Gmail smoke

### 3.1 Pre-deploy `/segment` baseline (Suer, browser, 2 Sep ~21:02 local)

Wizard → source expo 1 → target expo 9 → Preview. Rendered figures **verbatim**:

```
Target: Morocco Siema Expo 2026 · Source: expo (21,389 rows)
Total verified emails ................. 21,389
Invalid email address ................. 2
Duplicates within source .............. 0
G1 already registered on target ....... 93
G2 activate wave, mailable ............ 21,294
  raw ................................. 21,294
  existing pending tokens (reused) .... 0
  tokens to mint (new) ................ 21,294
G3 register wave, mailable ............ 0
  raw ................................. 0
Unsubscribed hits (G2+G3) ............. 0
```

Arithmetic: 21,389 − 2 invalid − 93 G1 = **21,294** ✅.

### 3.2 Post-deploy `/segment` — headline-block render (Suer, browser, 2 Sep ~21:18 local)

Same browser click-through, ~16 minutes later, under the new layout:

```
Will receive emails:      21,286
Excluded:                 103   (101 already registered · 2 invalid emails)
New tokens to be minted:  21,286

Amber note visible:  "101 people are ALREADY registered on Morocco Siema Expo 2026 …"
Register-wave note visible.
Details collapsed by default.
```

**Arithmetic invariants held** against the new numbers:
- `will_receive = g2_mailable + g3_mailable` → **21,286 + 0 = 21,286** ✅
- `excluded = g1 + invalid + duplicates + unsubscribed` → **101 + 2 + 0 + 0 = 103** ✅
- `to_mint = 21,286` (no existing pending tokens to reuse) ✅

### 3.3 The drift between the two captures — G1 only, expected

| field | 21:02 | 21:18 | delta |
|---|---:|---:|---:|
| source_size | 21,389 | 21,389 | 0 |
| invalid_email | 2 | 2 | 0 |
| duplicates_in_list | 0 | 0 | 0 |
| **g1_already_registered_target** | **93** | **101** | **+8** |
| g2_activate_mailable | 21,294 | 21,286 | −8 |
| tokens_to_mint | 21,294 | 21,286 | −8 |
| g3_register_mailable | 0 | 0 | 0 |
| unsubscribed_hits | 0 | 0 | 0 |

**8 new SIEMA registrations arrived in the ~15 min between the two captures.** The source pool
(21,389) is a snapshot of expo 1's visitors and doesn't move. G1 (people already on target
expo 9) grew by 8; G2 shrank by exactly 8. Both figures are correct for their moment; the
invariants held in both. This is the *"counts drift daily"* dynamic Suer flagged earlier — the
audit's 86 and the review's 91 were also correct for their moments.

### 3.4 Footer smoke — real Gmail delivery (Suer, 2 Sep 21:23)

Real send via `email-campaigns.html` on trash expo 17, 1 recipient, delivered ~21:23. Verbatim
excerpt from the received message body:

```
If you no longer wish to receive these emails from [TEST] Reactivation Bridge Test 20260818, unsubscribe here.
ELAN EXPO MAROC SARL
30, Bd Rahal El Meskini, 2ème Etage, Appart N° 5, Casablanca, Morocco
+212 650 219 756
```

**UTF-8 intact end-to-end:** `2ème` and `N°` render as the correct glyphs, no mojibake, no
numeric entities. **RFC 8058 one-click working:** Gmail surfaced its native "Unsubscribe" control
next to the sender name — the `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header
(`utils/trackingPixel.js:175`) is being honoured by the receiver.

Cleanup ran:
```sql
DELETE FROM email_campaigns WHERE expo_id = 17 AND name ILIKE '%footer smoke%';
```

### 3.5 Authentication — read from raw .eml, CLOSES the SPF audit item

`Authentication-Results` header from the actual delivery, verbatim:
```
Authentication-Results: mx.google.com;
  dkim=pass  header.i=@leena.app header.s=s1
  spf=pass   smtp.mailfrom="bounces+52794868-e984-...@em5759.leena.app" (50.31.42.23 permitted)
  dmarc=pass (p=REJECT sp=REJECT) header.from=leena.app
Return-Path: <bounces+...@em5759.leena.app>
```

**All three pass.** DKIM signed with `d=leena.app s=s1` (matches the s1._domainkey CNAME to
SendGrid seen in the audit §C.1). SPF passes because the check is evaluated on the
**Return-Path / `smtp.mailfrom` domain** — `em5759.leena.app`, SendGrid's dedicated bounce
subdomain for this account — **not** on the apex `leena.app`. DMARC passes on both DKIM
alignment and SPF alignment (SendGrid's bounce subdomain aligns relaxed to `leena.app`).

**This supersedes the pre-launch audit's §C.1 SPF finding.** See §5 below.

---

## 4. Post-deploy sanity (measured 2 Sep 18:06 UTC after `3f4da63`)

Render 502 window: 18:05:44 → 18:06:09 = **~25 s**, inside G3's 10-50 s envelope.

```
/health                                              → 200 {"status":"OK",...}
POST /api/campaigns/reactivation/segment (no auth)   → 401
POST /api/campaigns/validate-template    (no auth)   → 401
POST /api/campaigns/reactivation/build   (no auth)   → 401
GET  /api/campaigns/reactivation/job/999999 (no auth)→ 401
GET  /reactivation-campaign.html                     → 200 (127,014 bytes, +5.6 KB vs prior)
```

Phase B markers (12 checks): all present. All 21 `wPv*` IDs: present exactly once each. Existing
Create Campaign tab wiring (`#targetExpo` / `#sourceExpo` / `#emailTemplate` /
`loadExpos()` / `loadTemplates()` — Yaprak's daily flow): intact, 7/7.

---

## 5. Correction to SIEMA_PRELAUNCH_AUDIT_20260902 §C.1

**The audit's SPF recommendation was based on an apex-only DNS check and is superseded by the
Gmail-delivered `Authentication-Results` header in §3.5 above.** SPF is evaluated on the
Return-Path domain, not the From domain. SendGrid signs bounces from `em5759.leena.app` — a
subdomain provisioned for this account with its own SPF record served by SendGrid's DNS.

Adding a `v=spf1 include:sendgrid.net -all` at the apex before a 21k send would have been
**risk without benefit**: no mail is sent via `MAIL FROM: @leena.app` (only `MAIL FROM:
bounces+…@em5759.leena.app`), so an apex SPF record would not appear in the SPF check at all,
while an errant `-all` on a shared apex could interfere with any future transactional or
cousin-domain sending path.

**Do not carry the SPF recommendation into any todo.** The audit's §C.1 has been amended in
place; the doc is updated in the same commit as this deploy record.

---

## 6. The Morocco address is HARDCODED — P2 todo added

`todo.md` new entry:

> **P2 — Footer postal address should come from the expo's organiser entity, not a hardcoded
> constant** — one address per country office. Today (2 Sep, footer commit) the Morocco address
> is hardcoded in `utils/trackingPixel.js` `injectUnsubscribeLink` for the SIEMA launch.
> Correct for SIEMA (Morocco) — WRONG for the next Nigeria / Ghana / Kenya campaign on the same
> code, which will show a Casablanca postal address for a Lagos event. Design: schema column on
> `organizers` (or a new `organizer_offices` table keyed by country) → derive at send time from
> `campaign.expo_id → expos.country_code → office row`. **Must land before the next non-Morocco
> campaign uses `enqueueStepEmail`.**

Cross-referenced in `utils/trackingPixel.js` inline comment at the address-line block. Any future
grep for "hardcoded" or "P2" surfaces both together.

---

## 7. Summary — what changed and what did not

**Changed:**
- Campaign email footer now includes ELAN EXPO MAROC SARL address (3 lines). CAN-SPAM compliant.
- Wizard preview panel restructured for readability. `/segment` shape unchanged.
- One P2 todo added for the hardcoded-address issue.

**Not changed:**
- `/segment`, `/build`, `/validate-template`, `/job/:id` response shapes — all identical.
- Sender identity, DKIM, DMARC configuration — unchanged.
- Non-campaign email paths — badge / certificate / single sends still bypass
  `injectUnsubscribeLink`, still carry no auto-appended footer, still don't need one (they are
  transactional per CAN-SPAM §316.3).
- Create Campaign + View Campaigns tabs on `reactivation-campaign.html` — untouched.
- Page-level `#pageInfoBox` above the tab bar — untouched.
- Backend business logic — zero changes.

**Verified by measurement, not assumption:**
- UTF-8 preservation (§1.3, local byte inspection + Gmail live delivery in §3.4)
- Injection-point campaign-only property (§1.2, grep call-graph)
- Headline arithmetic invariants (§3.2, arithmetic against real endpoint responses)
- ID survival (§2.4, grep against the deployed page)
- Authentication path — DKIM + SPF + DMARC all pass (§3.5, raw `Authentication-Results` header)
- Deploy 502 window ~25 s (§4, timed poll)

**Not verified, not blocking:**
- Behaviour with `g3_mailable > 0` — SIEMA source is expo-1, always yields G3=0. First
  Excel-upload run against a mixed source will exercise the code path; UI logic tested against
  the ID contract but not against a live non-zero G3 response yet.
