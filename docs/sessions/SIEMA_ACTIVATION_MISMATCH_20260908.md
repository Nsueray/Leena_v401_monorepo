# SIEMA activation-count mismatch — forensic recount (8 Sep 2026)

> Morning-after audit of the SIEMA26 launch numbers. Started as a 3-line contradiction
> ("701 activations at 17:00 IST" vs "at most 697 before 14:13 UTC"), ended with a
> root-cause on the campaign 'registered' counter, a 909-row backfill, and two small
> production fixes shipped the same day. Read-only investigation throughout — no
> writes until Suer ran the backfill SQL manually.

---

## 1. The trigger

Reading yesterday's session docs against the live DB, the following did not
reconcile:

- **DB now** (`2026-09-08 morning IST`): `reactivation_tokens` on `target_expo_id=9`,
  `status='activated'` = **897**, of which **200** have
  `activated_at > '2026-09-07 14:13+00'` (post-`a9a44fd` deploy). So at most **697**
  were activated before the deploy moment.
- **`SIEMA26_LAUNCH_DAY_20260907.md`**: `2,941` unique opens / `1,134` unique clicks
  / **704** activations / `63 / 702` empty-`last_name` ratio.
- **`DEPLOY_LAST_NAME_REQUIRED_20260907.md`**: `63 empty-last_name / 702` activations
  "at EOD".
- **Suer's 17:00 IST dictation** (verbal, not in docs): "701 activations."

`701 > 697` is impossible if both are monotonic counts of the same thing. Either
the docs are wrong, or the DB has been mutated after the fact.

---

## 2. Repo provenance (read-only)

Traced every writer to `reactivation_tokens`:

| path:line | Kind | Can it move a row OUT of `activated` or delete an activated row? |
|---|---|---|
| `routes/reactivation.js:124, 135` | INSERT (mint) | No — inserts `status='pending'` |
| `routes/reactivation.js:716, 800` | UPDATE — `/activate` handler | No — only pending → activated. Guarded at :704-706 by an explicit `if (tokenData.status === 'activated') return 409`. Idempotent. |
| `routes/campaignBuilder.js:1120` | UPDATE (wizard Phase 2b) | No — `WHERE rt.status = 'pending'`. Cannot touch activated rows. Sets `form_id` + `phone` only. |
| `migrations/007_test_email_cleanup.sql:162, 168` | DELETE (test-email cleanup) | Yes in principle — but only against the 5 hardcoded test addresses. Ran once on 14 May 2026, single transaction, backup preserved. Not in yesterday's window. |
| `tests/*.js` | DELETE (test cleanup) | Only against trash expos 11/17, not expo 9. |

**No route or worker in the current codebase can move an activated row back to
pending or delete it.** The Phase 2b UPDATE is `WHERE status='pending'` — explicitly.

---

## 3. DB forensics

### 3.1 Baseline

```sql
SELECT
  COUNT(*) FILTER (WHERE status='activated')                  AS activated,
  COUNT(*) FILTER (WHERE status='activated' AND activated_at IS NULL) AS null_ts,
  COUNT(*) FILTER (WHERE status='pending')                    AS pending
FROM reactivation_tokens WHERE target_expo_id=9;
```

- `activated=897`  ·  `null_ts=0`  ·  `pending=15,578`
- `COUNT(DISTINCT LOWER(email))` where activated = **897**. **No duplicates.**
- `MIN(activated_at)` = 2026-09-07 **08:03:34 UTC**  (=09:03 Casablanca — 3 min after C78 activation)
- `MAX(activated_at)` = 2026-09-08 **06:48:32 UTC**  (this morning)

### 3.2 Hourly timeline (UTC)

```
2026-09-07 08 → 201   (=09:00 Casablanca, C78 activation 08:00:21)
         09 → 210    (peak)
         10 → 123    (=11:00 Casablanca, C79 activation 10:00:22)
         11 →  70
         12 →  48
         13 →  35
         14 →  46    ← 701 and 702 land in this hour
         15 →  32
         16 →  20
         17 →  18
         18 →  12
         19 →  17
         20 →  15
         21 →  18
         22 →   7
         23 →  12
2026-09-08 00 →   2
         01-05 →  10
         06 →   2   (current baseline, morning of 8 Sep)
```

No visible gap, no reset, no evidence of a delete anywhere in the timeline.

### 3.3 Cumulative sweep — where do 697 and 701 come from?

```sql
SELECT ts_utc,
  (SELECT COUNT(*) FROM reactivation_tokens
   WHERE target_expo_id=9 AND activated_at <= ts_utc) AS cum
FROM (VALUES
  ('2026-09-07 14:00:00+00'::timestamptz),
  ('2026-09-07 14:13:00+00'::timestamptz),
  ('2026-09-07 14:15:00+00'::timestamptz),
  ('2026-09-07 14:17:00+00'::timestamptz),
  ('2026-09-07 14:18:00+00'::timestamptz),
  ('2026-09-07 23:59:59+00'::timestamptz),
  ('2026-09-08 06:00:00+00'::timestamptz)
) AS t(ts_utc)
ORDER BY ts_utc;
```

| Snapshot (UTC) | = Casablanca | = IST | Cum. |
|---|---|---|---:|
| 14:00 | 15:00 | 17:00 | **687** |
| **14:13** | 15:13 | 17:13 | **697** |
| **14:15** | 15:15 | 17:15 | **701** ✓ |
| **14:17** | 15:17 | 17:17 | **702** ✓ |
| 14:18 | 15:18 | 17:18 | 704 |
| 23:59 (day-1 close UTC) | 00:59 (+1) | 02:59 (+1) | **884** |
| 06:00 (this morning) | 07:00 | 09:00 | 896 |

### 3.4 The 701-vs-697 verdict — timing precision, no data loss

`697` is the cumulative count at exactly **14:13 UTC** (the user-assumed deploy
time; `a9a44fd` cutover completed 14:12:28 → 14:12:48 UTC per `/health` probe).

`701` was Suer's live psql read dictated as "17:00 IST." The IST clock is not
that precise; the actual read landed at **14:15 UTC** (17:15 IST). Between 14:13
and 14:15 UTC, four more tokens activated — the 14:00-15:00 UTC hour saw 46
activations = ~0.77/min, so 4 in 2 minutes is normal.

**`701 > 697` is not a paradox.** They measure different moments. No rows were
deleted, no counts moved backwards, and no duplicates.

### 3.5 The "702 EOD" verdict — mislabeled snapshot

Two docs (`SIEMA26_LAUNCH_DAY_20260907.md:108` and
`DEPLOY_LAST_NAME_REQUIRED_20260907.md:22`) cited **702** as
*"reactivation activations today"* under an "EOD" label. Cumulative reached 702
at **14:17 UTC (17:17 IST)** — right after the `a9a44fd` deploy, not at end of
day. Both docs were written that evening from the snapshot Suer took at deploy
time, and the "EOD" label was added without checking a true end-of-day read.

**Actual day-1 close** (`activated_at <= 2026-09-07 23:59:59+00`) = **884**.

The related "704 activated" in the `SIEMA26_LAUNCH_DAY` pool-state header sits
in the same window (14:18 UTC = 704). Same origin, same mislabel.

The **9% empty-`last_name` ratio** (63 of 702) itself remains representative —
the fix took effect at the same moment the snapshot was taken, so the
denominator is pre-fix activations and the ratio is against a homogeneous cohort.

---

## 4. The bigger surprise — campaign 78 Stats "Registered" = 0

While reconstructing the snapshots, one query returned a value that stopped me:

```sql
SELECT event_type, COUNT(*)::int
FROM email_events WHERE campaign_id=78
GROUP BY event_type ORDER BY 2 DESC;
```

- `sent=16,236`  ·  `opened=7,402`  ·  `clicked=2,356`  ·  `unsubscribed=35`
- **`registered` — not in the result set at all. 0 rows.**

Against 897+ real activations. `campaigns.js:212`'s "Registered" counter
(`SELECT COUNT(DISTINCT recipient_id) AS registered_count FROM email_events
WHERE campaign_id=$1 AND event_type='registered'`) would show **0** on the SIEMA
C78 detail page — a 100% miss.

Cross-check on C79 (register wave, same expo, same fair):
- `sent=16,259`  ·  `opened=3,838`  ·  `clicked=912`  ·  **`registered=72`**  ·  `unsubscribed=42`

C79 tracks correctly; C78 does not.

---

## 5. Root cause — the `reactivate-fr.html` matcher miss

`_lc` (the campaign tracking token) is appended to outbound URLs by
`appendCampaignTokenToFormLinks` at `email_worker.js:665-669`:

```js
html = appendCampaignTokenToFormLinks(html, unsubToken);   // append _lc first
html = wrapClickLinks(html, emailEventId);                 // base64 wrap last
```

The matcher at `utils/trackingPixel.js:177` (before this fix):

```js
if (url.includes('form-public.html') || url.includes('/form/') || url.includes('reactivate.html')) {
```

`'reactivate-fr.html'.includes('reactivate.html')` → **false** (the `-fr` breaks
the substring). Every C78 activation URL points at `reactivate-fr.html`
(confirmed by direct read of `campaign_recipients.extra_fields.activation_url`
— 16,472 rows FR, 0 rows EN). So `_lc` is never appended, the visitor lands
on `reactivate-fr.html?token=X` (no `_lc`), and when they submit,
`recordCampaignRegistration` in `routes/reactivation.js:41` sees a missing
`_lc` and returns early:

```js
async function recordCampaignRegistration(lcToken, ctx) {
  if (!lcToken) return;
  // ...INSERT INTO email_events ('registered'...)
}
```

Never reached. **Zero `email_events` for C78.**

### 5.1 Why the scheduler was NOT affected

`email_worker.js:565-585` (the `dedbcd0` block) evaluates `not_registered`
against **three** sources OR-fused:

```
(a) EXISTS in email_events (campaign path)     -- broken for C78
(b) EXISTS in visitors (any-route path)         -- irrelevant for reactivation
(c) EXISTS in reactivation_tokens WHERE status='activated'   -- catches all 909
```

Check (c) catches every activated C78 token by email regardless of whether (a)
fired. The block's original comment claimed *"(b) is currently redundant —
measured 0 activated tokens lacking a campaign event, i.e. the bridge is at
100%"* — that measurement was true on Aug 19 (before `reactivate-fr.html`
existed) and false for SIEMA. Check (c) is what kept Thursday's step 2 correct.
Comment rewritten in commit `194b646` to label it LOAD-BEARING.

### 5.2 Timeline

- **18 Aug (commit `fd0c503`)** — bridge added; matcher gate written as
  `'reactivate.html'` (only page then in existence).
- **3 Sep (commit `52cc517`)** — `reactivate-fr.html` created as byte-for-byte
  copy of `reactivate.html`. Matcher NOT updated (nobody thought to). Silent gap
  opens.
- **7 Sep 09:00 Casablanca** — C78 activates, sending 16,472 French-language
  activation URLs. Every click bypasses the bridge.
- **8 Sep morning** — discrepancy noticed while reconciling docs.

---

## 6. The fixes shipped 8 Sep

### 6.1 Commit `194b646` — matcher widened

`utils/trackingPixel.js:177` — `.includes('reactivate.html')` → `.includes('reactivate')`.
Also covers any future `reactivate-XX.html` variant. Cannot over-match — this
function runs before `wrapClickLinks`, so tracking-wrapper URLs and unsubscribe
URLs are never present at match time. Micro-tested on four hrefs (FR page, EN
page, siemamaroc.com, mailto:) — first two gain `&_lc=<token>`, last two byte-
identical.

`email_worker.js:549-559` — falsified 100% claim rewritten. Check (c) is now
labeled LOAD-BEARING with the SIEMA case as the reason.

### 6.2 Commit `97ffcac` — legacy routes send language-correct page

`routes/reactivation.js` — two hard-coded `reactivate.html` URLs in the legacy
Reactivation admin tab (`create-from-excel` at :143 via `processReactivationChunks`;
`resend-pending` at :1006) now mirror the wizard's per-expo language rule:

```js
const activationPage = (expoCountryCode === 'MA') ? 'reactivate-fr.html' : 'reactivate.html';
```

Mirrors `callcenter.js:647` and `campaignBuilder.js:1157`. Backward-compatible:
non-MA expos still render `reactivate.html` byte-identically.

### 6.3 Backfill — 909 `email_events` rows

Suer ran manually via Render Shell:

```sql
BEGIN;
INSERT INTO email_events (campaign_id, recipient_id, email, event_type, metadata, created_at)
SELECT
  78, cr.id, cr.email, 'registered',
  jsonb_build_object(
    'via', 'backfill_reactivate_fr_matcher_miss',
    'source', 'reactivation_tokens',
    'target_expo_id', 9,
    'new_visitor_id', rt.new_visitor_id,
    'backfilled_at', NOW()
  ),
  rt.activated_at
FROM campaign_recipients cr
JOIN reactivation_tokens rt
  ON LOWER(TRIM(rt.email)) = LOWER(TRIM(cr.email))
 AND rt.target_expo_id = 9 AND rt.status = 'activated'
WHERE cr.campaign_id = 78
  AND cr.status <> 'holdout'
  AND NOT EXISTS (
    SELECT 1 FROM email_events e
    WHERE e.campaign_id = 78 AND e.recipient_id = cr.id AND e.event_type = 'registered'
  )
RETURNING id;
COMMIT;
```

- 909 rows inserted (measured 8 Sep midday). Actual count at run time depends
  on drip (each activation between preview and run adds a row).
- Idempotent — the `NOT EXISTS` guard means a re-run inserts 0 rows.
- No unique constraint on `email_events(campaign_id, recipient_id, event_type)`
  in the schema (verified — only `pkey` on `id` + three btree indexes), so the
  guard is load-bearing; without it, a re-run silently doubles the count.
- `created_at = rt.activated_at` preserves the timeline for Stats charts.
- **Wednesday sweep pending** to sweep late-tail activations that landed after
  the first backfill.

---

## 7. Today's sweep — the copied-page-not-updated bug class

While the matcher was already fixed, we swept for other places in the repo that
match the same bug shape. Two more legacy references were hard-coded to
`reactivate.html`, reachable by SIEMA via the legacy Reactivation admin tab:

- `routes/reactivation.js:143` — `create-from-excel` inside `processReactivationChunks`
- `routes/reactivation.js:1006` — `resend-pending` per-token loop

Both fixed in commit `97ffcac` above.

**Every other reference to `reactivate.html`, `reactivate-fr.html`, and
`form-public.html`** across `routes/`, `utils/`, `email_worker.js`, and
`public/` was audited — path:line table produced. All other hits were either
doc comments, admin-UI URL-copy helpers (correct as-is), or code that already
chose the page by expo country (`callcenter.js:647`, `campaignBuilder.js:1157`).

### Zero logic drift between the two reactivate pages

`diff reactivate.html reactivate-fr.html` produces 217 lines. After stripping
translated strings, translated comments, and whitespace, **zero non-string
differences remain** other than the intentional `<html lang="…">` and
`toLocaleDateString(locale)` localisation. Both pages carry the `_lc` read
(`campaignToken = urlParams.get('_lc');` line 451 in both), the `last_name`
required attribute + inline error, the phone gate, the form-design inheritance
via `applyFormStyle(data.form_config)`, and the same error-handling shape. The
FR page is a genuine byte-for-byte clone of the then-current EN page (per
commit `52cc517`'s message), and the only commit to touch either file since
that fork touched both in one commit (`a9a44fd`, the `last_name required` fix).

### Clean over-match check on live SIEMA templates 74-81

Every `<a href>` extracted from `email_templates.html_content` on IDs 74-81
(SIEMA's live A + R waves):

- 74-78 (`01_invitation` … `05_dernier_appel`) — CTA is `{{activation_url}}`
  placeholder + `siemamaroc.com` + `mailto:` + `maps.app.goo.gl` (venue).
  `{{activation_url}}` resolves at send time to
  `https://leena.app/reactivate-fr.html?token=…` (confirmed in
  `campaign_recipients.extra_fields.activation_url` — 16,472/16,472 FR).
- 79-81 (`R1_invitation` … `R3_dernier_appel`) — CTA is
  `https://leena.app/form-public.html?id=59` + `maps.app.goo.gl`.

**Zero URLs contain the bare substring `'reactivate'` that are NOT one of our
two pages.** The widened matcher would tag CTA 74-78 correctly (desired), tag
CTA 79-81 via the unchanged `form-public.html` branch (already correct), and
leave every other href (`siemamaroc.com`, `mailto:`, `maps.app.goo.gl`)
untouched. **No over-match risk on SIEMA live templates.**

---

## 8. Related

- `docs/sessions/SIEMA26_LAUNCH_DAY_20260907.md` — launch day narrative (now
  annotated with the EOD-mislabel correction)
- `docs/sessions/DEPLOY_LAST_NAME_REQUIRED_20260907.md` — the deploy that
  landed at 14:12 UTC and produced the mislabeled snapshot
- Commits `194b646` (matcher fix), `97ffcac` (legacy routes fix), `a9a44fd`
  (last-name fix from 7 Sep)
- CLAUDE.md G43 — `/health` cutover measurement; the 14:12:28 → 14:12:48
  window is what made "at most 697 before 14:13" a defensible cutoff.
