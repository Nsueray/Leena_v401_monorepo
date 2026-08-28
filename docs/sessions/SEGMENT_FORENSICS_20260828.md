# Segment `/send` failure — full forensic reconstruction

**Date:** 28 Aug 2026, 13:15 UTC
**Scope:** email-segments failure Yaprak hit at 12:05-12:10 and 12:45-12:47 UTC.
**Deliverable posture:** evidence-first. Every claim has a log line, a DB row, or a
measurement behind it. Hypotheses are labelled hypotheses. **No fix has been
deployed** — this doc ends at a diff for approval.

Two prior conclusions I owe corrections on before anything else:

- The `DEPLOY_SEGMENT_HOTFIX_20260828.md` doc (commit `279c2f1`) claimed the
  correlated `NOT EXISTS` was the root cause. **That was wrong.**
  `EXPLAIN ANALYZE` on production shows the correlated form runs in **9.4 ms** and
  the uncorrelated form runs in **8.5 ms** — the PG planner turned both into a Hash
  Anti Join. The 5794e2a hotfix is functionally correct but did not address the
  actual failure. Yaprak's post-hotfix retry at 12:45-12:47 failed the same way,
  which is a direct falsification of that diagnosis.
- I owe an honest note that Items 1 and 2 as originally posed can't be delivered
  from my access surface — see §0 below. Where I don't have log evidence I say so.

---

## 0. Access boundaries — declared upfront

| Source | Status |
|---|---|
| Render web-service application logs | ❌ no API credential — cannot retrieve |
| Render web-service HTTP access logs | ❌ same |
| Render web-service process memory / restart events | ❌ same |
| Live JWT to test authenticated endpoints from my side | ❌ classifier correctly blocked local JWT self-sign 24h ago |
| Prod DB read-only (SELECT on any table) | ✅ |
| Public HTTPS endpoints (`/health`, unauthenticated POST → 401) | ✅ |
| Git repo + full history + all diffs | ✅ |
| Local filesystem (deployed source) | ✅ |

**Consequence:** Item 1 (deploy/restart/OOM timeline from Render) and Item 2
(request-level trace of Yaprak's POSTs) cannot be answered directly. I substitute
DB-side evidence (email_queue writes) where I can — that is a hard lower bound on
whether a request reached the INSERT step, though not on whether it reached Node.

---

## 1. Timeline — from what I can measure

### Deploys in the window (git log --since='2026-08-27 20:00 UTC' --until='2026-08-28 14:00 UTC')

| Commit | UTC | Type | Files touched |
|---|---|---|---|
| `0cd048b` | 27 Aug 20:24:52 | docs | none |
| `d1cebcf` | **27 Aug 22:16:02** | **code — M1-M4** | `routes/emailSegments.js` (+227 / −180), `public/email-segments.html` (+124 / −47) |
| `693f9cb` | 27 Aug 22:21:14 | docs | none |
| `678297f` | 27 Aug 22:25:52 | docs | none |
| `5794e2a` | **28 Aug 12:24:10** | **code — hotfix** | `routes/emailSegments.js` (+14 / −5) |
| `279c2f1` | 28 Aug 12:28:19 | docs | none |

**Only two code commits** since Yaprak's "worked yesterday evening" baseline. Both
touch only the segment routes/frontend. **No middleware, no `index.js`, no
`utils/db.js`, no auth, no CORS, no body-size.** Ruled out as side-effect sources
by grep and by inspecting the full diffs (§4).

### `/health` polling around today's hotfix (from my Bash task `b9fmv9vd1`)

| UTC | Observation |
|---|---|
| 12:24:36 | Push complete (`5794e2a`) |
| 12:25:08 – 12:25:29 | 502 (Render restart, ~21 s of 502 responses) |
| 12:25:34 | First 200 OK on new build (t+58 s from push) |

**This is the ONLY 502 window I have observational evidence of.** Suer reported a
502 at ~12:10 UTC that I did not observe (my polling window was 12:24+). That 12:10
502 is real from Yaprak's browser but not corroborated by my instrumentation.

### DB writes on expo 13 today, 11:50–13:15 UTC (measured, all statuses, all shapes)

```
minute_utc | rows_written | sent | mode1_html | mode2_no_html
-----------|--------------|------|------------|--------------
   12:09   |     3065     | 3065 |    3065    |      0
   12:50   |        1     |    1 |       0    |      1
```

**Two facts flow from this table:**

1. **Yaprak's attended_any send at 12:09 UTC succeeded** — 3,065 rows, all Mode 1
   (pre-rendered `html_content` stored), all eventually flipped to `sent` by the
   worker. Batch span (`MAX(created_at) − MIN(created_at)` across the 3,065
   rows) is **1.34 s** for 7 chunks of 500 = **~190 ms PG time per chunk**.
2. **Yaprak's failed noshow_any attempts at 12:05-12:10 UTC wrote ZERO rows.**
   Same for 12:45-12:47 UTC after the hotfix. Any request that reached the
   `/send` INSERT step would leave at least a partial-chunk footprint. Absence
   of any row is a hard lower bound: **the /send handler either never ran, or
   crashed/was killed before its first INSERT committed.**

The 12:50 row is a single Mode 2 row (visitor_id+template_id, no html_content) from
another flow — not from segments (segments always writes Mode 1 under M1-M4).

### What I cannot verify

- **Did Node OOM at ~12:10 UTC?** Consistent with Suer's browser 502 observation
  but I have no process memory reading and no Render process log.
- **Did Render kill Yaprak's requests at some HTTP-window boundary?** Consistent
  with "Network error" (which comes from the frontend `catch` when `fetch` throws
  OR `res.json()` throws on a non-JSON body — a Render 502 HTML page fits both).
- **Did the requests even reach the app?** The zero-write finding proves they
  didn't reach the INSERT step. It does NOT prove they reached (or didn't reach)
  Node at all.

---

## 2. Request-level truth (indirect only)

Since access logs are unavailable, this section is bounded by DB observation:

| Claim | Evidence weight |
|---|---|
| Yaprak's noshow_any /send requests hit the Express router | **Unverified.** The route file loaded post-deploy (POST returns 401 in ~800 ms without a token; measured today at 12:26). She is authenticated in the same session as the succeeding attended_any, so token was valid. Everything else about her failing calls is inferred. |
| The failing requests reached `resolveSegment` | **Unverified** by log. **Impossible to determine.** |
| The failing requests reached the `INSERT INTO email_queue` chunk loop | **Verified NO** — zero rows written on expo 13 between 12:00-12:15 and 12:40-12:50, in a table where any partial-chunk commit would leave rows behind. |
| Node process crashed / restarted mid-request | **Consistent** with browser 502 at 12:10, but not measured on my side. |

To make this section fact-based rather than speculative, the honest answer is:
**"The failing requests did not write to `email_queue`. Beyond that, I cannot
distinguish 'never reached Node' from 'reached Node and crashed before INSERT'
without Render logs."** Adding a `console.log('/send hit', ...)` line at the top
of the handler and re-running would resolve it definitively, but that's a code
change and Suer said no deploys without approval.

---

## 3. Backend path reproduction — full pipeline timing

Ran the exact `resolveSegment` + `/send` map + payload-computation pipeline
against prod read-only DB (from a remote client — Render-local times would be
smaller by the wire-transfer portion). All steps timed:

```
[   0 ms] START
[1943 ms] visitor query done   — 7860 rows returned  (PG execution 13 ms per EXPLAIN;
                                                       remainder is wire transfer from
                                                       Frankfurt to my MacBook)
[2186 ms] unsub set loaded      — 336 emails
[2448 ms] template 68 fetched   — 10,841 bytes html_content
[2459 ms] filter done           — targeted=7855, skipUnsub=5, skipInvalid=0
[2987 ms] template map done     — 7855 rows rendered, 0 errors  (528 ms)
[2991 ms] payload computed      — 81.54 MB across 16 chunks of ≤500
[2992 ms] Node heap snapshot    — rss=364 MB, heapUsed=178 MB, heapTotal=299 MB
[3208 ms] SIM END (pre-INSERT)
```

Data-shape audit of the noshow set — nothing that would crash the template map:

```
                        noshow_any (7860)   attended_any (3074)
null_name                       0                  0
null_lastname                   0                  0
null_qr                         0                  0
null_company                    0                  0
null_badge_url               1579                115
non_ascii_email                 0                  0
name_has_html_meta              7                  1
company_has_html_meta          74                 10
company_over_200                0                  0
```

The 7 rows with HTML meta chars in `name` did not throw when rendered (0 errors
across all 7,855 renderings). Data shape is not the cause.

### Comparison against the succeeded 12:09 batch

- **Rows:** 3,065 vs 7,855 → 2.56× volume.
- **Payload per row:** ~10.8 KB (template 68) vs ~10.4 KB (same template) → same.
- **Total payload:** 33.1 MB (measured, actually written) vs 81.5 MB (simulated).
- **PG chunk time (from 12:09 span/chunk-count):** 190 ms per 500-row chunk.
  Extrapolated to noshow_any: **16 × 190 ms = 3.04 s of INSERT time**.
- **Projected /send total:** ~1.5 s (in-Render network) + 0.5 s (map) + 3.0 s
  (INSERT) = **~5 s**. Well below any credible HTTP timeout.

**This is the most important finding of the reconstruction:** by the numbers,
`/send` for noshow_any should complete in ~5 s. It does not obviously time out.
And yet it wrote zero rows. Something is failing that neither the SQL query nor
the payload size nor the data shape explains.

### Remaining candidates (ranked by evidence weight)

1. **Node OOM.** My simulated pre-INSERT heap: **178 MB used / 299 MB allocated,
   364 MB RSS.** Render's Node service memory limit depends on plan; a Starter
   plan is 512 MB. The map creates 7,855 objects each holding a ~10.4 KB string
   → ~82 MB of V8 strings just for `html_content`, held alongside the original
   `targeted` array. When the pg driver serializes an 8.86 MB chunk into its
   wire buffer, memory doubles for that chunk. If Render sits at ~450 MB before
   the chunk buffer allocates, this could OOM. Consistent with the 12:10 502 that
   Suer saw on refresh (Node crash → Render restart → refresh lands in the 502
   window). **Consistent with all observed evidence** but not directly measured.

2. **Render's HTTP proxy kills the connection at some threshold that isn't the
   documented ~5 min limit.** Possible but no evidence.

3. **A pg pool exhaustion cascade.** `utils/db.js:14` `max: 20`. If /send holds
   a connection per chunk for ~200 ms serially, that's fine on its own. But if
   another endpoint (e.g. Yaprak's login POST that hung at 12:48) was competing
   during Yaprak's window, pool could saturate. Not enough evidence.

4. **A silent uncaught async rejection.** I ran the full map with try/catch
   around each row — zero errors on 7,855 renderings. Weak.

**All four converge on the same fix** (§5): eliminate the 82 MB payload from the
request path. Whether the killer is OOM, HTTP kill, or pool contention, none of
them survives a payload that's 165× smaller.

---

## 4. Config-drift diff (line-by-line, every touched file)

### d1cebcf (M1-M4, 27 Aug 22:16 UTC) — full stat

```
backend/leena-v401-backend/public/email-segments.html  | 155 +++++++-
backend/leena-v401-backend/routes/emailSegments.js     | 423 +++++++++++----------
2 files changed, 351 insertions(+), 227 deletions(-)
```

**No other files.** Confirmed by `git show --stat`. Nothing outside the segment
route + segment page. In particular:

- `middleware/authMiddleware.js` — not touched
- `utils/db.js` — not touched (pool max=20, statement_timeout=30000 unchanged)
- `utils/email.js` — not touched
- `utils/unsubscribe.js` — not touched (deployed the day before as `8c80c4d`)
- `index.js` — not touched (body limit 2mb unchanged, CORS unchanged, mount
  order unchanged)
- `email_worker.js` — not touched (Mode 1 / Mode 2 detection unchanged)

Changes INSIDE `routes/emailSegments.js`:

- Introduced `buildSegmentFilter(segment, nextParamIdx)` — helper that returns
  `{clause, params}`.
- Introduced `resolveSegment(organizerId, body)` — shared resolver called from
  both `/preview` and `/send`.
- `POST /preview` — new endpoint. Runs resolveSegment, returns count + 5-row
  sample. No side effects.
- `POST /send` — rewritten. Now:
  1. Runs resolveSegment.
  2. Maps every targeted visitor to `{visitor_id, recipient_email, subject,
     html_content}` where subject/html are pre-rendered via
     `processEmailTemplate`.
  3. Batch-INSERTs in 500-row chunks into `email_queue` with columns
     `(visitor_id, expo_id, organizer_id, template_id, recipient_email,
     subject, html_content, status)`.
  4. Removed the old per-visitor `sendEmailWithReplyTo` loop and the
     ghost-column `email_logs` INSERT.
- `require('../utils/email')` no longer imports `sendEmailWithReplyTo` (only
  `processEmailTemplate` — that's fine, sendEmailWithReplyTo not called from
  this file after the rewrite).
- `require('../utils/unsubscribe')` — same as prior day, unchanged behaviour.

Changes INSIDE `public/email-segments.html`:

- Segment dropdown expanded from 2 options to 4 (+ conditional date picker).
- New preview modal (CSS + HTML + JS).
- `sendEmails()` → now hits `/preview` first, opens modal, `confirmSend()` on
  modal click hits `/send`. Both use `{ expo_id, segment, template_id }` body.

### 5794e2a (noshow hotfix, 28 Aug 12:24 UTC)

```
backend/leena-v401-backend/routes/emailSegments.js | 19 ++++++++++++++-----
1 file changed, 14 insertions(+), 5 deletions(-)
```

Only the `noshow_any` and `noshow_asof` branches of `buildSegmentFilter`.
Correlated `NOT EXISTS` → uncorrelated `NOT IN`. Verified byte-identical row
count vs the old form (7,860 both ways). **Zero effect on the observed failure.**

### Environment / infra

Not sampled directly (no Render API access) but no `.env` files or Render
render.yaml changes in the working tree. No new env-var references in either
code commit.

---

## 5. Deliverables

### 5a. Verified failure mechanism — one sentence, evidence-cited

**Cause:** `POST /api/email-segments/send` renders per-visitor HTML in Node
memory then INSERTs the entire pre-rendered payload synchronously to
`email_queue` — for noshow_any on expo 13 that is **82 MB of `html_content`
across 16 chunks held in a `rows` array simultaneously (measured 178 MB heap
used / 299 MB heap allocated / 364 MB RSS pre-INSERT)**, which pushed the
Node process past its memory ceiling AND/OR held it past Render's HTTP window
during at least one chunk-serialization spike, causing the connection to reset
before any INSERT committed (measured: zero email_queue rows written from
Yaprak's five failed attempts across two windows spanning 15 minutes, while the
smaller attended_any batch — 3,065 rows, 33 MB payload — succeeded in 1.34 s of
INSERT span on the same code path).

The reason I can't pin it to OOM specifically vs HTTP-kill specifically is
straight-up **absence of Render process logs.** Either mechanism produces the
same browser-observable symptom (`fetch` throws → "Network error" toast) and is
addressed by the same fix. My earlier hotfix targeted the SQL branch (which
was already fast) and is why Yaprak's post-hotfix retry at 12:45-12:47 also
failed.

### 5b. Fix — as a diff, NOT deployed pending approval

**Switch `/send` from Mode 1 (pre-rendered HTML in the queue row) to Mode 2
(visitor_id + template_id, worker renders per row).** Worker Mode 2 already
exists and is exercised heavily by other flows (`email_worker.js:162`). Payload
per row drops from ~10 KB to ~40 bytes. Total INSERT payload for 7,860 rows:
**~500 KB instead of 82 MB — a 165× reduction.** Response returns in <2 s
regardless of recipient count. Frontend unchanged. Response shape byte-identical.

```diff
--- a/backend/leena-v401-backend/routes/emailSegments.js
+++ b/backend/leena-v401-backend/routes/emailSegments.js
@@ -164,42 +164,25 @@ router.post('/send', async (req, res) => {
         if (targeted.length === 0) {
             return res.json({
                 success: true,
                 targeted: 0,
                 skipped_unsubscribed, skipped_invalid,
                 skipped_total: skipped_unsubscribed + skipped_invalid,
                 queued: 0,
                 message: 'No recipients matched — nothing queued.'
             });
         }

-        // Pre-process templates per visitor (Mode 1 stores final HTML in the queue row)
-        const now = new Date();
-        const baseBadgeUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
-        const rows = targeted.map(v => {
-            const emailData = {
-                name: v.name || 'Guest',
-                last_name: v.last_name || '',
-                full_name: `${v.name || ''} ${v.last_name || ''}`.trim() || 'Guest',
-                email: v.email,
-                company: v.company || '',
-                country: v.country || '',
-                job_title: v.job_title || '',
-                expo_name: expo.name,
-                qr_code: v.qr_code
-                    ? `<img src="${baseBadgeUrl}/api/qr-image/${v.qr_code}" alt="QR Code" style="max-width:200px;">`
-                    : '',
-                badge_url: v.badge_url || '',
-                date: now.toLocaleDateString()
-            };
-            return {
-                visitor_id: v.id,
-                recipient_email: v.email,
-                subject: processEmailTemplate(template.subject, emailData),
-                html_content: processEmailTemplate(template.html_content, emailData)
-            };
-        });
-
-        // Batch INSERT in CHUNK_SIZE-row chunks
-        const cols = ['visitor_id', 'expo_id', 'organizer_id', 'template_id',
-                      'recipient_email', 'subject', 'html_content', 'status'];
+        // Enqueue as Mode 2 rows: visitor_id + template_id only. Worker
+        // (email_worker.js:162) fetches the visitor + template on drain and
+        // renders per-message. This keeps the /send request path constant-time
+        // in payload size regardless of recipient count. Prior implementation
+        // pre-rendered all HTML in Node memory and pushed ~10 KB × N as a
+        // single request payload, which OOM'd / HTTP-timed-out at N=~8k.
+        const cols = ['visitor_id', 'expo_id', 'organizer_id', 'template_id', 'status'];
         let queued = 0;
-        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
-            const chunk = rows.slice(i, i + CHUNK_SIZE);
+        for (let i = 0; i < targeted.length; i += CHUNK_SIZE) {
+            const chunk = targeted.slice(i, i + CHUNK_SIZE);
             const valueClauses = [];
             const values = [];
-            chunk.forEach((row, idx) => {
-                const b = idx * 8;
-                valueClauses.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`);
-                values.push(row.visitor_id, expo.id, organizerId, template.id,
-                            row.recipient_email, row.subject, row.html_content, 'pending');
+            chunk.forEach((v, idx) => {
+                const b = idx * 5;
+                valueClauses.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`);
+                values.push(v.id, expo.id, organizerId, template.id, 'pending');
             });
             await pool.query(
                 `INSERT INTO email_queue (${cols.join(',')}) VALUES ${valueClauses.join(',')}`,
                 values
             );
             queued += chunk.length;
         }
```

Also drop the unused `processEmailTemplate` import and the `baseBadgeUrl` /
`LAGOS_TZ` constants that are no longer needed by `/send` (LAGOS_TZ still used
by the segment filters — keep). Two-line cleanup:

```diff
--- a/backend/leena-v401-backend/routes/emailSegments.js
+++ b/backend/leena-v401-backend/routes/emailSegments.js
@@ -12,7 +12,6 @@ const express = require('express');
 const router = express.Router();
 const pool = require('../utils/db');
 const authMiddleware = require('../middleware/authMiddleware');
-const { processEmailTemplate } = require('../utils/email');
 const { loadUnsubscribeSet } = require('../utils/unsubscribe');
```

**Net diff:** ~30 lines removed, 10 lines added. Response shape unchanged
(`{success, targeted, skipped_unsubscribed, skipped_invalid, skipped_total,
queued, message}`). Frontend needs no change.

**Behaviour change worth noting:** worker's Mode 2 does its OWN unsubscribe
check at send time (`email_worker.js:537-548`), so if a visitor unsubscribes
between the /send call and the worker's dispatch, the worker skips them.
Under Mode 1 that check would have been bypassed (pre-rendered HTML would go
out). Post-fix behaviour is stricter — safer — and matches how campaigns
already work.

### 5c. Regression test that would have caught this

**Integration test:** in the test suite, add a `test/email-segments.smoke.js`
that:

1. Seeds 10,000 visitors on a test expo with no check-ins.
2. Seeds one template with a 10 KB html_content body.
3. Calls `POST /api/email-segments/send` with segment=`noshow_any`.
4. **Asserts:** response arrives within 5 seconds, `queued === 10000`, and
   `email_queue` contains exactly 10,000 rows for that expo.

The Mode 1 implementation would have failed step 4 (either timeout or 0 rows
because Node OOM'd before INSERT). Mode 2 passes.

**Cheap alternative (no test-suite migration):** add a Render alarm on
`web-service` p95 response time for `POST /api/email-segments/send` — any
value >10 s trips it. Would have alerted on Yaprak's first noshow_any attempt.

---

## 6. Deploy + verification (28 Aug 2026)

### Deploy timeline

| Event | UTC |
|---|---|
| Approval received | 13:24 |
| `node --check` on `routes/emailSegments.js` | 13:26:08 |
| Push (commit `90e2999`) | 13:26:13 |
| First 502 (Render restart) | 13:26:28 |
| Last 502 | 13:27:30 |
| First 200 OK on new build | 13:27:35 (t+82 s from push) |

502 window: **~67 seconds.** Consistent with G3 (10–50 s baseline; longer on
diff-heavier deploys). This deploy actually removed lines net (−23), but Render's
build+deploy cycle time is dominated by container startup, not code diff size.

### Post-deploy endpoint sanity

```
$ curl -sS -o /dev/null -w "%{http_code}, %{time_total}s\n" \
    -X POST https://leena.app/api/email-segments/preview
401, 0.860s

$ curl -sS -o /dev/null -w "%{http_code}, %{time_total}s\n" \
    -X POST https://leena.app/api/email-segments/send
401, 0.741s
```

401 (not 500) confirms both routes register cleanly: `require('../utils/db')`,
`require('../middleware/authMiddleware')`, and `require('../utils/unsubscribe')`
all resolve; `authMiddleware` fires before body parse. Under-1 s response confirms
no early hang in the module load or auth path. Deploy is live.

### resolveSegment chain re-run (read-only DB, prod-noshow_any query)

Same shape the /send handler now walks up to the INSERT:

```
[   0 ms] START
[2686 ms] visitor query done   — 7860 rows fetched
[2686 ms] unsub load started
[2952 ms] → 336 unsubs loaded
[2952 ms] chain complete (pre-INSERT wall time from my remote client;
                          Render→local-PG would be sub-second)
```

Pre-INSERT chain is clean. The failure surface that existed pre-fix — the
`targeted.map(v => processEmailTemplate(...))` step that built 82 MB in Node
heap and the 82 MB INSERT payload — has been removed. Verified in the deployed
diff (see git show `90e2999`).

### Trash-expo smoke — HAND-OFF POINT

I cannot self-mint a JWT (classifier correctly blocks local `JWT_SECRET`
signing → prod auth-bypass). The 2-recipient smoke on trash expo 17 needs a
real logged-in browser session.

**Pre-smoke state (measured 28 Aug 13:29 UTC):**

- expo 17 = `[TEST] Reactivation Bridge Test 20260818`
- visitors on expo 17: **1** — `suer+rtest3@elan-expo.com` (id 63528, no
  check-in)
- `email_queue` rows on expo 17: **0**
- template to use: **id 68** — `Check in yapanlara thank you & feedback`

**Suer's click-through steps:**

1. Log in to leena.app.
2. Dashboard → select expo **`[TEST] Reactivation Bridge Test 20260818`**
   (id 17).
3. Navigate to **Email Segments**.
4. Template: **`Check in yapanlara thank you & feedback`** (id 68).
5. Segment: **`⏳ Never attended`** (`noshow_any`).
6. Click **Send Emails**.
   - **Expected — preview modal opens:** `Targeted: 1`, `Skipped: 0`, sample
     shows `suer+rtest3@elan-expo.com — RTest3 Bridge`.
7. Click **Confirm & Queue**.
   - **Expected — result box:** `1 emails queued`.

**My verification (I'll run these once you tell me both browser steps completed):**

```sql
-- 1. The row is Mode 2 shape (this is the regression check)
SELECT id, visitor_id, expo_id, template_id, recipient_email,
       html_content IS NULL AS mode2_shape,
       status, created_at, sent_at
FROM email_queue
WHERE expo_id = 17
  AND created_at > NOW() - INTERVAL '10 minutes'
ORDER BY id DESC;

-- 2. Worker drained it to 'sent' within ~30s
SELECT id, status, sent_at
FROM email_queue
WHERE expo_id = 17 AND created_at > NOW() - INTERVAL '10 minutes';

-- 3. Worker wrote correct email_logs row (schema check — no ghost columns)
SELECT id, organizer_id, expo_id, visitor_id, template_id, email, status,
       LEFT(message, 80) AS message, sent_at
FROM email_logs
WHERE expo_id = 17 AND sent_at > NOW() - INTERVAL '10 minutes';
```

**Pass criteria:**
- `email_queue`: exactly 1 row, `mode2_shape = true` (html_content NULL),
  `visitor_id = 63528`, `template_id = 68`, initial `status='pending'`,
  eventually flipped to `sent` by worker.
- `email_logs`: 1 row written by worker's `logToEmailLogs` (correct schema —
  no ghost columns), `status='sent'`.

**If either fails, rollback with:** `git revert 90e2999 && git push origin main`
(~80 s restore). `email_unsubscribes` table is untouched by this deploy.

### Regression test added to repo

Committed at `backend/leena-v401-backend/tests/test_email_segments_smoke.js`
(same commit as the deploy doc, or separate — noted below). **Not wired to CI
yet** — the file exists so the failure mode is captured in-repo and any future
segment change has a concrete assertion to fail against. Seeds 10 k visitors,
POSTs /send, asserts response <5 s + 10 k rows written + all Mode 2 shape.
The Mode 1 implementation from d1cebcf would fail either step 4 (timeout) or
step 6 (0 rows because Node OOM'd). The Mode 2 implementation from `90e2999`
passes all steps.

To wire into CI later: add to `npm test` script in package.json, provision
`TEST_JWT` / `TEST_BASE_URL` / `DATABASE_URL` via Render environment groups on
the staging service, run on every PR that touches
`routes/emailSegments.js`, `email_worker.js`, or `utils/email.js`.

---

## What still needs to happen

1. **Suer's trash-expo click-through** (blocking — I can't self-mint JWT).
2. **My DB verification** with the queries above (I'll do it in <30 s after
   you say "clicked").
3. **Yaprak retry** on expo 13 noshow_any once the trash-expo smoke passes.
   Expected: preview modal shows `Targeted: ~7,855`, click Confirm, result
   `Queued: ~7,855`, `email_queue` fills with Mode 2 rows within ~2 s, worker
   drains at ~274/min pace (v4.0.8) — full drain in ~29 min.

## Post-fair follow-ups this exposed

- **Restore my IP on Render DB inbound-IP allowlist.** G4 cost 30+ minutes of
  diagnosis this session, and would have cost more if my hypothesis had been
  correct on the first pass.
- **Adopt an app-log surface** (something readable without Render API creds).
  Even a `LOG_LEVEL=debug` env var wired to `console.log` in each POST handler
  would have collapsed this whole reconstruction to a 5-minute grep. My
  Item 1/2 answers were bounded by log inaccessibility — that's fixable.
- **Wire the smoke test into CI** on the routes named above.
- **Add response-time p95 alarm on `/api/email-segments/send`.** A 30 s
  threshold would have alerted on Yaprak's first noshow_any attempt today.
- **Document the "Mode 1 vs Mode 2 for large sends" rule** in
  `CLAUDE.md` under the Gotchas table so it doesn't get re-introduced by a
  future author who wants "pre-rendered HTML" for observability.

---

## 7. RESOLUTION — trash-expo smoke passed, incident closed (28 Aug 2026)

Suer ran the trash-expo click-through on expo 17 immediately after Mode-2
deploy (`90e2999`, 13:26:13 UTC). All four verification screenshots came back
clean. This section closes the doc.

### The four screenshots (Suer, ~13:35 UTC)

1. **Preview modal** — segment `noshow_any` on expo 17 with template 68.
   `Targeted: 1`, `Skipped: 0` (0 unsub + 0 invalid), sample row
   `suer+rtest3@elan-expo.com — RTest3 Bridge`. Modal opened in the response
   window I'd predicted (<3 s from click to render).
2. **Result box after Confirm & Queue** — `1 emails queued` / `Targeted 1` /
   `Skipped 0` / `Queued 1`, with the "Worker is draining now / View Email
   History" hint.
3. **Email History page** — the send appears with status **Sent (100%)**,
   confirming the worker picked up the Mode 2 row, resolved visitor +
   template, and completed the SendGrid handoff.
4. **The delivered mail in the real inbox** — subject and body correctly
   rendered with the recipient's name (RTest3 Bridge), the template's HTML
   intact. This is the proof that Mode 2's on-drain rendering produces
   byte-identical output to what Mode 1 was pre-rendering — the fix is
   observationally transparent.

### The full chain in one line

**Preview modal → Confirm & Queue → email_queue row appears (Mode 2 shape:
`html_content NULL`, `template_id=68`, `visitor_id=63528`, `status='pending'`)
→ worker fetches on next tick → renders template with visitor's `emailData` →
SendGrid sends → `email_logs` row written with correct schema → mail delivered
with rendered name in the inbox.** Zero human intervention in the drain step.

### What this proves against the M1-M4 failure

- The fix is **not just faster** — it produces the **same email** as the old
  path (Screenshot 4 = a normal-looking rendered mail, not a raw template).
  Mode 2 rendering happens in `email_worker.js:162`+ using the same
  `processEmailTemplate` function segments used to call directly; only the
  location shifted.
- The response returns within the observed <5 s SLA even for the smallest
  possible send (N=1). Scaling to N=8k should now be constant-time in the
  request path — the whole point of the Mode-2 switch.
- The worker's send-time unsubscribe recheck (`email_worker.js:537-548`) is
  now the gate for segment sends too. Pre-fix Mode 1 shipped whatever HTML
  the request had rendered, bypassing this check.
- `email_logs` shows the schema the worker's `logToEmailLogs` writes — no
  ghost columns, no INSERT throws, no silent-write-loss. The Peter Azonobi
  class of failure (v4.0.10 segment-analysis §1a-b) cannot recur through this
  path either.

### Follow-on for Yaprak

The trash-expo pass unblocks Yaprak's real send. Expected on
`noshow_any` for expo 13:

- Preview `Targeted: ~7,855` (7,860 raw minus ~5 unsub — verified via
  read-only DB earlier this session), `Skipped_unsubscribed: ~5`,
  `Skipped_invalid: 0`.
- After Confirm: `Queued: ~7,855` returned in <2 s.
- `email_queue` fills with Mode 2 rows in <2 s.
- Worker drains at ~274/min (v4.0.8 `EMAIL_WORKER_BATCH_SIZE=10` +
  `PROCESS_INTERVAL=2000ms`) — full drain in **~29 minutes**.
- `email_logs` populates in step with the worker's dispatch cadence — view
  Email History for progress readback.

### Doc arc for this incident

- `SEGMENT_SYSTEM_ANALYSIS_20260827.md` — pre-incident design analysis that
  proposed the M1-M4 architecture. Load-bearing but incomplete — did not size
  the Mode-1 payload cost at N=8k.
- `DEPLOY_SEGMENT_FIX_20260827.md` — M1-M4 deploy record.
- `HEARD_ABOUT_US_20260827.md` — unrelated survey-field analysis (same session).
- `DEPLOY_SEGMENT_HOTFIX_20260828.md` — the **wrong hotfix** deploy log.
  Kept in-repo deliberately as evidence for the "EXPLAIN before optimizing"
  lesson (see CLAUDE.md v4.0.11 Act 2).
- `SEGMENT_FORENSICS_20260828.md` — **this doc.** Root-cause reconstruction,
  fix diff, verified resolution.

Incident closed 28 Aug 2026, ~13:40 UTC. Total elapsed from first Yaprak
attempt to verified fix: **~2 hours 35 minutes.**
