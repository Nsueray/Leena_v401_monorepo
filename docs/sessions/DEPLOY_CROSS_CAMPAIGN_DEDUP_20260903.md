# Deploy — Wizard cross-campaign duplicate detection

**Date:** 3 Sep 2026, ~07:30 local
**Commit:** `72a29d4` — `feat(wizard): cross-campaign overlap detection + opt-in exclusion`
**Scope:** three files. Preview-side only, zero changes to the send path.
  - `backend/leena-v401-backend/routes/campaignBuilder.js` (Part 1 detection + Part 2 exclusion)
  - `backend/leena-v401-backend/public/reactivation-campaign.html` (warning UI + Remove button)
  - `backend/leena-v401-backend/tests/test_wizard_silent.js` (STEP 8 regression guard)

Closes a bug that would have shipped step-1 emails **twice** on the same day whenever an
operator built two wizard campaigns targeting the same expo. Warning-first, opt-in exclusion —
never automatic. Detection includes drafts so the Sunday-build / Monday-launch pattern surfaces
before both campaigns are activated together.

---

## 1. The measured gap

Two facts, both verified read-only before any code was written:

### 1.1 `ON CONFLICT (campaign_id, email) DO NOTHING` — key is per campaign, not per expo

`routes/campaignBuilder.js:912`:
```javascript
`INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
 VALUES ${valueClauses.join(',')}
 ON CONFLICT (campaign_id, email) DO NOTHING`
```

The uniqueness key is `(campaign_id, email)`. Same email in two different campaign_ids = two rows.

### 1.2 `/segment` never consulted `campaign_recipients` or `email_campaigns`

The four prefetch queries in the original `/segment` handler (`campaignBuilder.js:422` prior to
this commit) hit only `visitors`, `email_unsubscribes`, and `reactivation_tokens`.
`grep -nE 'FROM|JOIN'` inside the endpoint block returned zero matches for the campaign tables.

**Combined consequence:** the same email enrolled by two separate wizard runs against the same
target expo receives step 1 of BOTH campaigns. Later steps do skip once the recipient registers
(dedbcd0's `evaluateCondition` for `not_registered` checks visitor row / activated token / campaign
event — see MP26 audit `docs/sessions/SIEMA_PRELAUNCH_AUDIT_20260902.md` §B.4), so the duplication
is **bounded to step 1 plus any step firing before registration**. But two campaigns activated
the same morning = two emails that day, no way to catch it after the fact.

STEP 6 of the wire smoke (shipped 2 Sep in commit `803fd4f`) already demonstrated the mechanism:
a second run on the same 5 smoke emails created 5 more recipients across 2 new campaigns.

---

## 2. Decision: warn, never auto-exclude

Two reasons, both about ops trust:

**(a) Silent removal is a class of bug we've already been bitten by.** The mailable-formula bug
(commit `8740dd7`, 2 Sep) silently subtracted `_hasToken` recipients from the "mailable" count
and disabled the entire activate wave on any second run. Suer caught it in the browser, not
tests. The fix went out of its way to keep counts internally consistent AND to surface
`tokens_to_mint` as a separate honest number. Cross-campaign overlap is the same shape of risk —
if it silently filtered, an operator who legitimately wanted to re-mail a subset would find their
list mysteriously smaller.

**(b) The overlap may be intentional.** A "last chance" campaign might deliberately re-hit
people who are also in a slow-drip campaign, e.g. because the slow-drip's step 2 fires days
later. The wizard cannot know intent — it can only surface the fact.

**Solution:** detection is unconditional; exclusion is a body-flag opt-in
(`exclude_already_in_campaign`) rendered in the UI as an amber warning row with an explicit
button ("Remove them from this campaign"). Nothing changes without a click.

---

## 3. Why drafts are included in the overlap set

The overlap SQL filters on `cr.status = 'active'` — no predicate on `ec.status`:

```sql
FROM campaign_recipients cr
JOIN email_campaigns ec ON ec.id = cr.campaign_id
WHERE cr.status = 'active'
  AND ec.expo_id = $1
  AND ec.organizer_id = $2
  AND LOWER(TRIM(cr.email)) = ANY($3)
```

**Suer's operational pattern (verbatim):** he routinely builds several campaigns as drafts on a
Sunday and activates them together on Monday morning. If drafts were skipped from the overlap
check, the amber warning would stay silent in exactly the situation it exists for — two drafts
sitting side by side, about to be activated within minutes of each other, each with the same 5k
overlapping recipients. Silent = both step-1 emails ship on Monday morning.

Only the campaign **currently being built** is out of scope — and it does not exist yet at
segment time, so there is nothing to exclude.

**Verified production status enum values** (2 Sep, `DISTINCT ... GROUP BY status`):
- `email_campaigns.status`: `completed` (14), `draft` (3). Historical values likely also
  include `active`. **The query filters on `cr.status`, not `ec.status`**, so the lifecycle
  stage of the containing campaign is not the gate.
- `campaign_recipients.status`: `active` (63,173), `completed` (92,904), `unsubscribed` (603).
  Only `active` is included. `completed` recipients have finished their drip and won't receive
  again (no step-1 conflict). `unsubscribed` obviously excluded.

---

## 4. Bounded ANY() query — EXPLAIN evidence

The query returns only rows whose email actually intersects the current source list, so response
size scales with source size rather than the expo's active-recipient count.

**Expo 9 target (SIEMA — no active recipients yet), source array of 1:**
```
Nested Loop  (cost=0.44..5972.13 rows=1 width=65) (actual time=0.096 ms)
  →  Index Scan using idx_campaigns_expo on email_campaigns ec
        Index Cond: (expo_id = 9)
        Filter: (organizer_id = 1)
  →  Index Scan using idx_recipients_campaign on campaign_recipients cr
        Index Cond: (campaign_id = ec.id)
        Filter: (status = 'active' AND lower(trim(email)) = ANY (...))
```
**0.096 ms.** Both indexes used. Perfect plan.

**Expo 7 worst-case (37,384 active recipients today), source array of 3 non-matching emails:**
```
Nested Loop  (cost=0.44..5972.13 rows=606 width=65) (actual time=44.427 ms)
  →  Index Scan using idx_recipients_status on campaign_recipients cr
        Index Cond: (status = 'active')
        Filter: (lower(trim(email)) = ANY (...))
        Rows Removed by Filter: 63173
  →  Memoize on cr.campaign_id → Index Scan on email_campaigns ec
```
**44 ms.** The planner picks status-first when the ANY() array is tiny relative to the active
pool. Still acceptable for a one-shot preview call.

For a real SIEMA source (21k emails), the planner will likely revert to the JOIN-first plan
because the ANY() array is much larger than the per-expo active recipient count. Not measured
against a 21k array; if wall-clock over 250 ms turns up in production, cache-and-check.

**Bandwidth win**, even in the worst-case query plan: previously an unbounded query on expo 7
would have returned ~37k rows × ~200 B ≈ 7.4 MB per preview call. Bounded returns only the
actual overlap rows, typically <1 MB.

---

## 5. Preview-token replacement path (the load-bearing plumbing)

The "Remove them from this campaign" button re-runs `/segment` with
`exclude_already_in_campaign=true` and **adopts the NEW preview_token**. Client-side filtering
would leave the server-side cache unchanged and `/build` would enrol everyone.

Full trace, `public/reactivation-campaign.html`:

1. Button `onclick="wRemoveCrossCampaignOverlap()"` — HTML at the amber warning row
2. `wRemoveCrossCampaignOverlap()` → `wGoToPreview(true)` — trivial wrapper, in the JS block
3. `wGoToPreview(true)` sends `exclude_already_in_campaign: true` in the /segment body
   (multipart or JSON — both branches wired at `:~1633`+)
4. Response returns a **NEW** `preview_token` (the server-side cache is written fresh, keyed by
   the new token, holding the already-filtered `g2_activate` and `g3_register` lists)
5. **`wizard.previewToken = data.preview_token`** at `:1618` — the state update
6. `/build` reads `wizard.previewToken` at **`:1885`** inside `packSteps` on the build POST
   body — the orchestrator's Phase 2 minting is driven by whatever's cached under this token

Preview cache holds `g2_activate` and `g3_register` **after** the source-list filter — the
orchestrator has no way to see the excluded emails. **Filter propagates all the way to token
minting and recipient insertion.**

---

## 6. STEP 8 wire smoke — passed live

Suer ran `node tests/test_wizard_silent.js` post-deploy. STEP 8 passed:

**8a (detection-only, no flag)** — asserted:
- `already_in_another_campaign === 5` — all 5 smoke emails overlap the earlier `[SMOKE-WIZARD]`
  drafts (STEP 3 + STEP 6 + STEP 7 collectively created 6 draft campaigns holding all 5 smoke
  emails between them)
- `excluded_already_in_campaign === 0`
- `other_campaigns` present as top-level array (not inside `counts`), each entry with
  `{id, name, status, overlap_count}`
- Every overlap campaign's name starts with `[SMOKE-WIZARD]` (sanity — no stray production data
  bled in)
- **Byte-identical baseline hold:** `g1=0 / g2_mailable=3 / g3_mailable=2 / tokens_to_mint=0`,
  unchanged from the STEP 6 second-run baseline. The zero-overlap-source ⇒ zero-drift invariant.

**8b (with `exclude_already_in_campaign=true`)** — asserted:
- `excluded_already_in_campaign === 5`
- `already_in_another_campaign === 0` (filtered rows no longer counted)
- `g1 === 0 && g2_activate_mailable === 0 && g3_register_mailable === 0` — all 5 smoke emails
  filtered out before bucketing, so both wave counts collapse
- **`g2_activate_raw === 0 && g3_register_raw === 0`** — the row-level assertion that the
  filter runs BEFORE the bucketing loop, not as a post-hoc subtraction (rows never entered
  buckets to be counted as `_raw`)
- `tokens_to_mint === 0` (no G2 mailable → nothing to mint)

Full smoke output matches expectations. Cleanup emitted; every `[SMOKE-WIZARD]%` campaign
removed via the existing prefix DELETE.

---

## 7. Browser verification — verbatim from Suer (expo 11 → expo 17)

**Before clicking "Remove":**
> "Will receive emails: 4" plus the amber row —
> *"3 of these people are also in another campaign for this expo that has not been sent yet
>  ([SMOKE-WIZARD] Activate …-07-51-20, …-run2, …-run3). If you activate both, they will
>  receive both."*
> — draft wording chosen correctly, three campaign names inline, button on the right.

Confirms:
- Copy branches on `every(oc => oc.status === 'draft')` → **all-drafts variant fired** (correct
  — the smoke fixtures are all draft campaigns)
- Top-3 names shown inline, comma-separated
- The amber row's flex layout put the button on the right (per the new
  `.wizard-preview-crosscampaign-note` CSS)

**After clicking "Remove them from this campaign":**
> "Will receive emails: 1", amber row replaced by the confirmation
> *"3 people excluded — they are already in another campaign for this expo"*, button gone.
> The count moved 4 → 1, so the server-side list changed, not just the display.

Confirms:
- The `will_receive` headline dropped from 4 to 1 — **server-side list actually changed** (the
  key architectural claim from §5)
- Amber warning hidden, muted confirmation shown, button removed — the mutually-exclusive UI
  state from `wRenderPreview`'s cross-campaign branch
- The 3 filtered emails are exactly the G2 seeded rows on expo 11 (smoke-wizard-1..3), which
  overlap with the earlier smoke campaigns

Cleanup ran.

---

## 8. Post-deploy sanity (7 Sep 2026 07:32 UTC)

Render 502 window: 07:31:46 → 07:32:15 = **~29 s**, inside G3's 10-50 s envelope.

```
/health                                              → 200 {"status":"OK",...}
POST /api/campaigns/reactivation/segment    (no auth) → 401
POST /api/campaigns/validate-template       (no auth) → 401
POST /api/campaigns/reactivation/build      (no auth) → 401
GET  /api/campaigns/reactivation/job/999999 (no auth) → 401
GET  /reactivation-campaign.html                     → 200 (133,356 bytes, +6.3 KB vs prior)
```

- 11/11 new markers present (CSS + all handler references + both copy variants).
- **27/27 wizard IDs** present exactly once on the deployed page — no dangling `getElementById`
  targets, no duplicate IDs.
- Existing Create Campaign tab wiring: **7/7 intact** (`#targetExpo`, `#sourceExpo`,
  `#emailTemplate`, `loadExpos`/`loadTemplates` defs + call sites — Yaprak's daily flow
  untouched).

---

## 9. Known limits

Two facts worth writing down before Yaprak uses this against real production data.

### 9.1 Overlap is scoped to the same target expo only

The 5th prefetch filters by `ec.expo_id = $1`. If the same person is in a campaign on **another**
expo (say Yaprak built a Ghana-fair campaign that includes some SIEMA registrants), the wizard
will not surface it. **That is deliberate:** two campaigns on two different expos are two
different events; a person receiving both is receiving mail for two different reasons, not a
duplicate.

The exception is a person on a fair-wide multi-expo drip — that pattern doesn't exist in our
codebase today, so the design defers cleanly. If it ever emerges (e.g. an Elan-Expo-wide
newsletter campaign), the detection would need to widen to "any campaign of this organizer,
regardless of expo," and the copy would need a corresponding rework.

### 9.2 Preview-time race — no lock

The check runs at `/segment` time. If Suer runs Preview at 10:00, then Yaprak builds and
activates a new campaign for the same target at 10:03, then Suer clicks Build at 10:05 without
re-previewing, the overlap check will not see Yaprak's campaign. Suer's build proceeds, both
campaigns fire step 1.

The window is small and only ops-versus-ops (not the more common single-operator case). No
lock is planned — the trade-off between build-time correctness and a race window Yaprak would
have to explicitly time-lose is not worth a `SELECT ... FOR UPDATE` on the campaign tables.

**Mitigation for the paranoid:** re-run Preview immediately before clicking Build. The preview
token round-trip is <100 ms on a normal source; the check is fresh.

---

## 10. Todo update

`todo.md` under `CLOSED — 3 Sep`: item added referencing commit `72a29d4` and this doc.

Also new **P2** item (already-noted class of gap, but worth breaking out separately given today's
work):
> **P2 — Cross-campaign overlap scope should widen to "any campaign of this organizer"
> when the multi-expo drip pattern emerges.** Today the check is target-expo-only per §9.1.
> Trigger: the first time Yaprak builds a fair-agnostic newsletter that spans multiple expos.
> When that happens, remove the `ec.expo_id = $1` predicate from the 5th prefetch query and
> update the amber warning copy from *"another campaign for this expo"* to *"another campaign
> from you"* (or similar). No change to the ON CONFLICT semantics — recipients can still be in
> multiple campaigns, just not silently.

---

## 11. Summary — what changed and what did not

**Changed:**
- `/segment` gains a 5th prefetch query (cross-campaign overlap), 2 new `counts` keys, and a
  top-level `other_campaigns` array.
- `/segment` accepts optional `exclude_already_in_campaign` body flag. Filter runs BEFORE
  bucketing, on the source list. Rebinds `cleanList` in place.
- Wizard preview UI gains an amber warning row + a Remove button + a confirmation row + 2 rows
  in the Details ledger. All 6 new IDs present exactly once.

**Not changed:**
- The 4 original prefetch queries are byte-identical.
- `wRenderPreview`'s existing setters are byte-identical; new setters appended.
- Any `/segment` response with zero cross-campaign overlap is byte-identical to the prior shape
  in every existing key. STEP 8a locks this in.
- `/build`, `/validate-template`, `/job/:id` response shapes — all unchanged.
- The send path (`enqueueStepEmail` at `email_worker.js:531`, `email_queue`, campaign scheduler)
  — untouched. This is a preview-side change only.
- Create Campaign / View Campaigns tabs on `reactivation-campaign.html` — untouched.
- Backend business logic — zero writes added to `/segment` (still read-only).

**Verified by measurement, not assumption:**
- ON CONFLICT semantics (§1.1, file read)
- No prior campaign-table reads in `/segment` (§1.2, awk+grep on the endpoint block)
- Production status enum values (§3, DISTINCT queries against prod read-only)
- Query plan on expo 9 target (§4, EXPLAIN ANALYZE — 0.096 ms)
- Query plan on expo 7 worst-case (§4, EXPLAIN ANALYZE — 44 ms)
- Preview-token replacement path (§5, code-read line references)
- STEP 8 assertion pass (§6, live smoke via TEST_JWT)
- Browser end-to-end on expo 11 → expo 17 (§7, verbatim from Suer)
- 502 window ~29 s (§8, timed poll)
- All 27 IDs present exactly once on deployed page (§8, grep against `/tmp/deployed.html`)
