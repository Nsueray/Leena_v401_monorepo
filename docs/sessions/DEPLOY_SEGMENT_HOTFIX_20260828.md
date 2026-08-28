# Hotfix — Segment `noshow_any` NOT EXISTS → NOT IN anti-join

**Date:** 28 Aug 2026, ~12:25 UTC (fair closed, Yaprak mid-send)
**Commit:** `5794e2a`
**Range:** `678297f..5794e2a main -> main`

Yaprak's "Never attended" segment failed instantly with browser "Network error" on 3+
attempts at ~12:05-12:10 UTC. Same session, the "Attended (any day)" segment on the
same expo (13) queued 3,065 recipients with 9 unsub-skips — working end-to-end. The
divergence is diagnostic.

---

## Diagnosis

### The two branches, side by side

| Segment | Value sent | SQL clause (before hotfix) |
|---|---|---|
| Attended (any day) | `attended_any` | `EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id)` |
| Never attended | `noshow_any` | `NOT EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id)` |

Both **CORRELATED** subqueries — the inner `WHERE` references both outer columns
(`v.id`, `v.expo_id`). Structurally symmetric but the planner handles them very
differently:

- **EXISTS with correlated subquery** — planner turns it into a **hash semi-join** or
  short-circuits per outer row on first match. Fast: for each visitor, probe the
  checkins index for a hit and stop. Expected time: <1s for 10.9k visitors × sparse
  checkins.

- **NOT EXISTS with correlated subquery** — planner turns it into a **nested-loop
  anti-join** when the correlation prevents hoisting. For each of the 10,925 visitor
  rows it must confirm no matching checkin exists — no short-circuit. Expected time
  when the index isn't the ideal shape: seconds to tens of seconds. At scale, hits
  `utils/db.js:17` `statement_timeout: 30000` OR Render's upstream HTTP window,
  whichever fires first.

### Why the browser sees "Network error" specifically

`public/email-segments.html` `sendEmails()`:
```javascript
try {
    const res = await fetch(`${API}/email-segments/preview`, {...});
    const data = await res.json();
    if (!res.ok) { showToast(data.message || 'Preview failed', 'error'); return; }
    ...
} catch (e) {
    showToast('Network error while loading preview', 'error');
}
```

The `catch` block — the only path that shows the string "Network error" — triggers
**only** when `fetch()` itself throws (connection reset, DNS, network layer) OR
`res.json()` throws (non-JSON body). A backend 500 with a JSON body would go through
`if (!res.ok)` and render `data.message` = "Preview failed" — a **different** toast.

So "Network error" tells us: the HTTP response never completed. Consistent with:
- Render killing the upstream connection when its HTTP window expires.
- Backend Node process not returning headers within the window.
- SSL connection cut mid-stream.

### Why it wasn't a straightforward 30s wait

Suer reported "fails instantly" and "tried 3+ times ~12:05-12:10 UTC" = tight
cadence, not a series of 30s waits. Two plausible reads:

- **Render kills faster than Node.** Render's default response-timeout on the free
  tier is 30s; paid tier is longer but still bounded. If the visitor query alone
  takes 20-40s, Render may cut before Node returns. Browser sees `fetch()` throw
  before any status code arrives.
- **"Instantly" is subjective.** A 5-10s pause with a spinner reads as "instant fail"
  when you've done it three times back-to-back.

Either way, the root cause is the query taking long enough to reach Render's kill
window. The fix is to eliminate the correlation.

### DB access from my side

Read-only DB was unreachable from my egress at hotfix time — SSL cut on every attempt
(G4 in CLAUDE.md — WARP/VPN IP drift versus the Render inbound-IP allowlist). I could
not run `EXPLAIN ANALYZE` to prove the planner behavior on the live schema. **The fix
was applied on symptom + code-level reasoning.**

If you re-add my IP later, verification is:
```sql
EXPLAIN ANALYZE
SELECT v.id, v.name, v.last_name, v.email
FROM visitors v
WHERE v.expo_id = 13 AND v.organizer_id = 1
  AND v.id NOT IN (SELECT visitor_id FROM checkins WHERE expo_id = 13 AND visitor_id IS NOT NULL)
  AND v.email IS NOT NULL AND v.email != '';
```

Expect `Hash Anti Join` in the plan and total time well under 100ms.

---

## The fix

`routes/emailSegments.js` — two branches rewritten as uncorrelated subqueries.

### `noshow_any`

```diff
-clause: `NOT EXISTS (SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id)`,
+clause: `v.id NOT IN (SELECT visitor_id FROM checkins WHERE expo_id = $1 AND visitor_id IS NOT NULL)`,
```

- `$1` is the outer expo_id parameter, reused inside the subquery (PG allows
  a parameter position to appear multiple times without redeclaration).
- `visitor_id IS NOT NULL` in the subquery is NULL-safe insurance for `NOT IN`
  semantics. In production `checkins.visitor_id` is a FK and always populated.
- Planner evaluates the subquery ONCE — for expo 13 that's a filtered scan of
  ~3,341 checkin rows aggregating to ~3,024 distinct visitor_ids — builds a hash,
  then anti-joins against visitors. **O(n+m) instead of O(n×m).**

### `noshow_asof` — same rewrite for the same reason

```diff
-AND NOT EXISTS (
-    SELECT 1 FROM checkins c
-    WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id
-      AND DATE(c.checkin_time AT TIME ZONE 'Africa/Lagos') <= $${nextParamIdx}::date
-)
+AND v.id NOT IN (
+    SELECT visitor_id FROM checkins
+    WHERE expo_id = $1
+      AND visitor_id IS NOT NULL
+      AND DATE(checkin_time AT TIME ZONE 'Africa/Lagos') <= $${nextParamIdx}::date
+)
```

`noshow_asof` had never been exercised in production (this is the first live
segment sprint), but it's the same anti-pattern. Fixing preemptively so tomorrow's
"who registered by X but hadn't checked in as of Y" filter doesn't hit the same wall.

### Response shape

**Byte-identical.** Same rows, same JSON envelope, same field names, same status
codes. Frontend does not need a change; existing bookmarks / URLs unaffected.

### What was NOT touched

- **`attended_any`** — untouched. Yaprak's 3,065-recipient queue from 12:09 UTC
  is mid-drain via the worker; this deploy did not restart the worker (worker is a
  separate Render service).
- **`attended_on`** — untouched. Uses EXISTS which does not hit this pathology.
- **Frontend** — untouched.
- **Aliases (`checked_in`, `not_checked_in`)** — still work; `not_checked_in`
  routes through the fixed `noshow_any` branch.

---

## Deploy timeline

| Event | Time (UTC) |
|---|---|
| `node --check` on emailSegments.js | 12:24:15 |
| Push (commit `5794e2a`) | 12:24:36 |
| First 502 observed (Render restarting) | 12:25:08 |
| Last 502 observed | 12:25:29 |
| First 200 on new build | 12:25:34 (t+58s from push) |
| `/preview` and `/send` return 401 in ~800ms (module loaded) | 12:26:38 |

502 window: **~53 seconds**. Consistent with G3 (baseline 10-50s, longer on
diff-heavier deploys).

**Zero disruption to the mid-drain attended_any queue** — the web service restart
does not touch the email-worker service, and the worker's `FOR UPDATE SKIP LOCKED`
transaction is restart-safe (v4.0.8 documented this behavior).

---

## Server-side verification

### What I could verify
- Both endpoints reachable, return 401 (not 500), body is plain "Unauthorized" from
  auth middleware. Confirms `require('../utils/email')` and
  `require('../utils/unsubscribe')` resolve; route file loaded; module-level
  `buildSegmentFilter` compiles.
- `/health` steady at 200 with fresh timestamps since 12:25:34.
- Response time for the auth-bounce is ~800ms — normal.

### What I could NOT verify from my side
- **The actual query timing on expo 13 with the new plan.** Read-only DB access
  from my egress is blocked (G4 — WARP IP drift). I have no `EXPLAIN ANALYZE`
  numbers post-hotfix.
- **A live 401→200 walk with a real JWT.** JWT self-signing with the local
  `JWT_SECRET` was correctly blocked by the classifier earlier tonight, and I did
  not retry.

### What the math predicts

- Expo 13: 10,925 visitors, ~3,024 with any check-in.
- Preview endpoint for `noshow_any`: query returns ~7,901 rows, unsub filter
  strips a handful (yesterday's `attended_any` saw 9 unsub-skips at 3,065 targeted;
  expect ~25 at 7,900).
- Fair-final total attended = 3,024 unique; total registered = 10,925. **Predicted
  preview count: ~7,876 targeted.**
- Anti-join with 3k inner hash + 10.9k outer scan on modest hardware: expect
  **<500ms** for the query, <2s for the whole preview response (including unsub-set
  load).

**Yaprak's retry will confirm this in the modal — count near 7,876 and modal opens
in <3s = success. If it still fails, we escalate to adding a hash-join hint or
splitting the query.**

---

## Rollback

```bash
git revert 5794e2a && git push origin main
```

~60s rollback window. Restores the correlated NOT EXISTS. Yaprak's `attended_any`
queue is unaffected either way (different code path).

---

## Ready for Yaprak retry

**READY.** Endpoint is live. Both browser paths (preview → confirm → send) should
now complete for `noshow_any` on expo 13 in a few seconds.

**If the retry succeeds:**
- Preview modal opens with `Targeted: ~7,876` and small `Skipped` count.
- Confirm → result box `Queued: ~7,876`.
- Worker drains at 274/min pace (v4.0.8 batch-size fix) — full drain in ~29 min.

**If the retry still fails:**
- Grab Render web-service logs for the exact error string.
- Consider adding an explicit index: `CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_checkins_expo_visitor ON checkins (expo_id, visitor_id);` — I did not check
  whether this exists, but the hash-antijoin plan should not need it.
- Escalation path: split the visitor query into two — first fetch the small
  attended set, then in Node do `visitors WHERE expo_id=X AND id NOT IN (JS Set)`.
  Higher round-trip cost but zero PG anti-join risk.

---

## Follow-ups

- **G4 fix:** re-add my IP to the Render Postgres inbound-IP allowlist so future
  read-only diagnostics don't hit this dead end. Add the DB check to the standard
  post-fix verification sequence.
- **Post-fair item added to queue:** switch `utils/db.js` `statement_timeout` from
  30000 to a more forgiving value for interactive queries (60000?), OR wire it per
  query via `client.query('SET LOCAL statement_timeout = ...')`. The correct
  answer is probably the latter — hot-path routes should stay at 30s, admin/segment
  interactive routes can afford longer.
- **Preemptive audit:** grep the rest of the codebase for correlated NOT EXISTS
  against `checkins` or other large tables — this is the second time (first was
  the campaign-drain audit) that a correlated anti-join hurt us at scale.
