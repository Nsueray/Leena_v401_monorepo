# Manual registration on a terminal key — deploy record
**Deployed:** 2026-08-24, night (Lagos) · commit **`580dff1`** · **Doors 25 Aug 10:00 Lagos.**
Follows `FAIR_EVE_FINAL_20260824.md` Part D.

---

## 1. What was wrong

Scanning needed only `?terminal_key=` — `checkRequiredData()` returns early when a key is present
(`qrscanner.html:509-512`), so no login is required. **Manual registration did not follow the same
rule.** It posted to `/api/visitors/manual` with `Authorization: Bearer` and gated on
`localStorage.token` + `selectedExpoId`, so a tablet opened with only the terminal URL scanned
perfectly and then failed on the first walk-in with *"Missing required data. Please login again."*

A design violation, not a missing feature: the button silently bound a desk operation to admin
auth. Zero rows in production have ever come through it (0 on expo 7 in May, 0 on expo 13), so
nothing depended on the old shape.

## 2. What changed

### `middleware/dualAuth.js` — kind-parameterised factory

The default export keeps its exact contract (`kind='bulk_print'`); `dualAuth.forKinds(['scanner'])`
builds the variant this route needs.

A factory rather than a second near-duplicate auth file: one auth path is easier to reason about,
and the bulk-print default is **verifiable live against a real key** — which it was, both
directions, after deploy (§4).

### `routes/visitors.js` — `POST /manual` accepts either credential

```js
const isTerminal   = req.authMode === 'terminal';
const expo_id      = isTerminal ? req.terminal.expoId      : req.body.expo_id;
const organizer_id = isTerminal ? req.terminal.organizerId : req.body.organizer_id;
```

- **Terminal mode: scope comes from the terminal row, the body is ignored.** This includes the
  existing-visitor lookup, which is scoped by that forced `expo_id` — so the upsert can only ever
  touch a row on the terminal's own expo.
- **`visitor_type` is clamped** to the seven values the form offers, falling back to `visitor`.
- **Bulk-print keys are rejected here**, and scanner keys are still rejected on the bulk-print
  endpoints. The two kinds cannot borrow each other's powers.
- **JWT path byte-identical** — same fields, same trust in body `expo_id`/`organizer_id` as before.

### `public/qrscanner.html`

- login gate now mirrors the scan path: `if (!terminalKey && (!expoId || !token))`
- request uses the shared `buildHeaders(true)`; `expo_id`/`organizer_id` are **not sent** in
  terminal mode rather than sent and ignored
- **the 500 ms `setTimeout` around the badge popup is gone.** A deferred `window.open` breaks the
  user-gesture chain, which is what popup blockers catch. This closes the untested hypothesis from
  Part D §D2 instead of leaving it to be discovered in a queue.
- **registration failure now gets the blocking red panel + Retry**, not a dismissible alert,
  consistent with the fail-closed check-in work in `e900b70`. Retry re-submits the form, which is
  upsert-by-email server-side, so a partially-succeeded attempt cannot create a duplicate visitor.

## 3. Blast radius

| file | risk |
|---|---|
| `middleware/dualAuth.js` | **highest** — shared with the two bulk-print endpoints. Default export contract unchanged; both directions retested live. |
| `routes/visitors.js` | `/manual` only. JWT callers unchanged. |
| `public/qrscanner.html` | manual path + popup timing. Scan path untouched. |

Backend change ⇒ Node restart. Measured **~50 s**, ~20 s of 502 (G3). Email worker is a separate
service, untouched. **Laptops still need a hard refresh** to pick up the frontend half.

## 4. Smoke test — production, no login, terminal key only

Exactly the "fresh browser profile, no session" case: requests carrying **only** `x-terminal-key`,
no `Authorization` header.

| # | test | result |
|---|---|---|
| 1 | Register with T1 key only, **hostile body** `expo_id:5, organizer_id:999, visitor_type:"admin"` | ✅ created — **`visitor_id 67234`** |
| 2 | Where did it land? | ✅ **`expo_id=13`, `organizer_id=1`** — body values ignored |
| 3 | Type escalation | ✅ clamped `admin` → **`visitor`** |
| 4 | QR / badge assigned | ✅ `6f23a4e3-…` / `6F23A4E3` |
| 5 | Audit fields | ✅ `origin=onsite`, `source=manual`, `manual_reason='Smoke test'` |
| 6 | Cross-expo leak | ✅ **0** rows with that email outside expo 13 |
| 7 | Check-in with the same key | ✅ `success:true, duplicate:false` — **checkin 20313** |
| 8 | Immediate re-check-in | ✅ `duplicate:true` — *"ignored: duplicate within 120 seconds"* |
| 9 | Re-submit same email (Retry simulation) | ✅ same `visitor_id 67234`, **same QR** — no duplicate row |
| 10 | No credentials at all | ✅ **401** |
| 11 | **Bulk-print** key on `/manual` | ✅ **403 `WRONG_TERMINAL_KIND`** |
| 12 | **Regression** — bulk-print key on `/paginated` | ✅ **200** (default `dualAuth` intact) |
| 13 | **Regression** — scanner key on `/paginated` | ✅ **403 `WRONG_TERMINAL_KIND`** |
| 14 | **Regression** — JWT path on `/manual` | ✅ `visitor_id 67237`, `expo=13`, `visitor_type=staff` **honoured** (no clamping in JWT mode, as designed) |

Frontend confirmed served: terminal-mode gate present ×2, `buildHeaders(true)` in use, no
`setTimeout` around the popup, and the only `Bearer ${token}` left in the file is inside
`buildHeaders()` itself.

**Not verifiable from here:** the popup-blocker fix and the red panel need a real browser — they
are steps 4-7 of the Part D §D2 laptop plan. Run them tonight.

## 5. Test rows to clean up

Tonight's testing left five artefacts. All are safely removable; none is referenced elsewhere.

```sql
BEGIN;
DELETE FROM checkins               WHERE id IN (20312, 20313);
DELETE FROM conference_certificates WHERE id = 612;
DELETE FROM visitors               WHERE id IN (67234, 67237);
COMMIT;
```

| what | why it exists |
|---|---|
| visitor **67234** `suer+mrtest@elan-expo.com` | terminal-path registration test |
| visitor **67237** `suer+mrjwt@elan-expo.com` | JWT-path regression test |
| checkin **20313** | check-in test on 67234 |
| checkin **20312** + certificate **612** | MP26 certificate test (visitor 59725 — the visitor row is **real**, do not delete it) |

⚠️ Delete the check-ins **before** 10:00 or they land in opening-day counts. Expo 13 currently
holds **15** check-ins, all test data.

## 6. §D3 — recover the 10 stuck emails

Ten campaign-17 step-3 emails were claimed into `processing` at 08:23:03 and orphaned
(`try_count=0`, `sent_at` null) while the queue flowed past them. Known risk **R5**: nothing ever
re-claims a `processing` row. Not caused by any deploy — the worker is a separate service.

Safe because `sent_at IS NULL` guarantees no double-send. **One command:**

```bash
psql "$DATABASE_INTERNAL_URL" -c "UPDATE email_queue SET status='pending' WHERE status='processing' AND sent_at IS NULL AND id BETWEEN 410455 AND 410464;"
```

Expect `UPDATE 10`. The worker picks them up within one poll cycle (2 s).

To confirm afterwards:

```bash
psql "$DATABASE_INTERNAL_URL" -c "SELECT status, count(*) FROM email_queue WHERE id BETWEEN 410455 AND 410464 GROUP BY 1;"
```

Post-fair: a sweep returning `processing` rows older than N minutes to `pending`.

## 7. Effect on the laptop setup list

**Step 1 of Part D §D4 is no longer mandatory.** A laptop can now run a lane with the terminal URL
alone — scanning *and* walk-in registration both work with no login and no expo selection.

Logging in is still worth doing where convenient (it gives the hostess the admin sidebar if she
needs the visitor list), but it is no longer the difference between a working desk and a dead one
mid-queue.

Everything else in §D4 stands, and one item gains weight:

> **Hard-refresh every laptop** (Ctrl/Cmd+Shift+R). Both tonight's deploys are frontend-visible,
> and a tab opened earlier keeps running the old code — including the old login gate this commit
> removes.
