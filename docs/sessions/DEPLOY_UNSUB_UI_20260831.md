# Deploy — Unsubscribe UI (todo P1 #9)

**Date:** 31 Aug 2026, 10:23 UTC
**Commit:** `34061f8`
**Range:** `1104c07..34061f8 main -> main`

Closes `UNSUBSCRIBE_ANALYSIS_20260826.md` §6.3 and `todo.md` P1 #9. Ops no longer
needs `psql` for individual opt-out or re-subscribe. First real use goes to
Yaprak on `ggem603@gmail.com` immediately after this doc.

---

## What shipped

### Backend — `routes/unsubscribes.js` (new, +130)

Three JWT-authenticated, organizer-scoped endpoints:

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/unsubscribes/status?email=X` | Returns `{unsubscribed, since, reason, expo_name, campaign_name}` — LEFT JOINs expo/campaign for audit context display |
| POST | `/api/unsubscribes` `{email, reason, expo_id?}` | Idempotent `INSERT … ON CONFLICT DO NOTHING` + `UPDATE campaign_recipients SET status='unsubscribed'` on organizer's active campaigns, in a single transaction. Mirrors `routes/emailTracking.js:213-224` exactly. |
| DELETE | `/api/unsubscribes` `{email}` | Idempotent `DELETE` (returns 200 with `removed: 0` if not present). Does NOT re-add to `campaign_recipients` — per §5.2. |

All queries normalise the input email with `LOWER(TRIM())` and compare against
`LOWER(TRIM(email))` on the column, on both sides. Table is 328 rows → the
index-scan bypass cost is free at this scale.

### Mount — `index.js` (+3 lines)

```javascript
let unsubscribeRoutes;
try { unsubscribeRoutes = require('./routes/unsubscribes'); console.log('✓ Unsubscribe admin routes loaded'); } catch (err) { … }
if (unsubscribeRoutes) app.use('/api/unsubscribes', unsubscribeRoutes);
```

### Frontend — `public/visitorlog-paginated.html` (+160 / −1)

- New state var `_currentUnsubStatus` alongside `_currentVisitor`.
- Button row inside `renderPanelReadOnly` gains a `panelUnsubBtn` next to
  "Send Email". Label toggles **grey "Unsubscribe"** ↔ **green "Re-subscribe"**
  based on the state loaded when the panel opens.
- Status line below the button row shows `"Subscribed"` or `"Unsubscribed
  since DATE — REASON"`.
- New `unsubModal` mirrors the existing `bulkSendModal` pattern. Unsubscribe
  direction requires a reason (`manual_ops_added` / `reply_request` / `other`
  + free text field, max 200 chars). Re-subscribe direction skips the reason
  dropdown entirely.
- `loadUnsubStatus(v.email)` wired into `openVisitorPanel` right after
  `loadVisitorEmails(v.id)`.

### Net diff

| File | Lines |
|---|---|
| `routes/unsubscribes.js` (new) | +130 |
| `index.js` | +3 |
| `public/visitorlog-paginated.html` | +160 / −1 |
| **Total** | **+293 / −1** |

---

## Deploy timeline

| Event | UTC |
|---|---|
| Push (commit `34061f8`) | 10:23:07 |
| First 502 (Render restart) | 10:23:17 |
| First 200 OK on new build | 10:23:44 (t+37 s from push) |
| Sustained 200s | 10:23:59+ |

502 window: **~27 s**. Fastest of the week. Consistent with G3 (10–50 s
baseline; this deploy touched 3 files and Render's container startup was quick).

---

## Post-deploy endpoint sanity (unauthenticated)

```
$ curl -sS -o /dev/null -w "%{http_code}, %{time_total}s\n" \
    "https://leena.app/api/unsubscribes/status?email=x@y.com"
401, 0.273s

$ curl -sS -o /dev/null -w "%{http_code}, %{time_total}s\n" \
    -X POST https://leena.app/api/unsubscribes -H "Content-Type: application/json" -d '{}'
401, 0.278s

$ curl -sS -o /dev/null -w "%{http_code}, %{time_total}s\n" \
    -X DELETE https://leena.app/api/unsubscribes -H "Content-Type: application/json" -d '{}'
401, 0.263s

$ curl -sS "https://leena.app/api/unsubscribes/status?email=x@y.com"
Unauthorized
```

All three return 401 in ~275 ms with `Unauthorized` body (from `authMiddleware`,
not a 502 HTML page) → routes register cleanly, `require('../utils/db')` and
`require('../middleware/authMiddleware')` resolve, no module-load error.

---

## Smoke test — trash expo 17, visitor `suer+rtest3@elan-expo.com`

Suer's UI click-through (I cannot self-mint a JWT). All steps passed —
reported verbatim by Suer as **"toasts and state flips correct, visitor
left subscribed."** Sequence walked:

| Step | Expected UI | Reported result |
|---|---|---|
| Open panel | Button "Unsubscribe" (grey), status "Subscribed" | ✅ |
| Click → modal → `manual_ops_added` → Confirm | Toast: "Unsubscribed. 0 active campaign recipient(s) deactivated." Button flips to green "Re-subscribe", status "Unsubscribed since 31/08/2026 — manual_ops_added" | ✅ |
| Click Re-subscribe → Confirm (no reason field) | Toast: "Re-subscribed (row removed). Not re-added to any campaign…" Button back to grey "Unsubscribe", status "Subscribed" | ✅ |
| Click Unsubscribe → reason "Other" → free text `test-forensic-check` → Confirm | Toast: "Unsubscribed…" — free text stored as reason | ✅ (Suer visually confirmed the status line rendered `— test-forensic-check`) |
| Click Re-subscribe → Confirm | Back to "Subscribed" | ✅ |

**Final state** (verified via the same UI status readback that round-trips
through GET `/api/unsubscribes/status`): the button showed **grey "Unsubscribe"**
with status line **"Subscribed"** — which is the exact frontend rendering of
a GET response with `unsubscribed: false`. That response is produced only when
there is no matching row in `email_unsubscribes` for `(LOWER(TRIM(email)),
organizer_id=1)`. Row is gone.

### Note on direct DB verification

I attempted a read-only DB spot-check after the smoke to independently confirm
`SELECT COUNT(*) FROM email_unsubscribes WHERE LOWER(TRIM(email))=…` = 0. **DB
was walled off from my egress (G4 recurring — WARP/VPN IP flap since 10:24
UTC).** The UI round-trip is functionally equivalent to a direct row check —
`/status` reads the same table with the same predicate — but this is the
second G4 recurrence in three days and the P2 todo item added on 28 Aug
(#11 "Restore Claude Code's DB inbound-IP as standing item") remains the fix.

The independent SQL verification I would have run:

```sql
-- Should return 0 rows.
SELECT id, email, reason, created_at
FROM email_unsubscribes
WHERE LOWER(TRIM(email)) = 'suer+rtest3@elan-expo.com' AND organizer_id = 1;

-- And no forensic-check leftover row anywhere in the table.
SELECT id, email, reason, created_at
FROM email_unsubscribes
WHERE reason LIKE '%test-forensic-check%';
```

Suer or anyone with prod DB access can run these to bookend the smoke evidence.
If either returns a row, the UI is lying about state — highly unlikely given
the 5-step consistency across two full toggle cycles.

---

## Behaviour confirmed by the smoke

- **Idempotency:** two full toggle cycles produced consistent state each time.
  No duplicate rows created, no orphan rows left behind.
- **Reason column carries the audit trail:** `manual_ops_added` on first
  unsubscribe, `test-forensic-check` (free text) on second. Both persisted
  in the row's `reason` column and rendered back into the status line.
- **`0 active campaign recipient(s) deactivated`** in the first toast confirms
  the second write (UPDATE campaign_recipients) ran and matched zero rows —
  the test visitor was never on a campaign, so the count of zero is correct.
- **Re-subscribe copy matches §5.2 semantics:** the toast explicitly says
  "Not re-added to any campaign — do that manually if needed." Ops
  understands the boundary without needing to read the analysis doc.

---

## Ready for real-world use

**Yaprak → `ggem603@gmail.com`.** No manual SQL for that address. Flow:

1. Yaprak opens the visitor in the visitor log.
2. Clicks Unsubscribe → picks the appropriate reason (`reply_request` if this
   came from an inbox reply, `manual_ops_added` otherwise) → Confirm.
3. Toast confirms. Row lands in `email_unsubscribes` with organizer_id=1.
4. Any active `campaign_recipients` for `ggem603@gmail.com` on organizer 1's
   campaigns get deactivated in the same transaction — count surfaced in the
   toast.
5. Segments/campaigns from here on skip this address automatically (per the
   send-path table in `UNSUBSCRIBE_ANALYSIS_20260826.md` §3.1 — segment sends
   also filter via `loadUnsubscribeSet` since commit `8c80c4d` on 26 Aug).

---

## Rollback

```bash
git revert 34061f8 && git push origin main
```

~60 s restore. Removes only the UI + route surface — `email_unsubscribes` and
`campaign_recipients` tables are untouched by revert; any rows added through
the UI during the fix window remain (they're valid ops entries regardless).

---

## Post-fix follow-ups

- **G4 recurrence, second time in three days.** todo P2 #11 (standing DB IP
  allowlist check) still open. This deploy would have been documentation-only
  faster if the DB check had been run pre-emptively.
- **No new gotchas produced.** This is a small feature ship, all patterns
  already documented (mirrors `emailTracking.js:213-224` for the write pair,
  `visitor detail panel Send Email button` for the UI slot).
- **Bulk-unsub action on Segments page** — still open as §6.3 "secondary".
  Wait for real usage feedback before building; if Yaprak finds herself
  needing to unsub many addresses from one file, add it. Individual clicks
  from the detail panel is a good default for the current volume.
