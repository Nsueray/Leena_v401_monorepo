# DEPLOY — wizard step 1 `not_registered` + evaluateCondition guard-move (4 Sep 2026)

## Why

SIEMA (expo 9) is receiving hundreds of registrations per day (86 → 585 in
the 24 h window before this change). The wizard freezes the recipient list
at Build. A campaign built Friday and activated Monday would send
*"activate your badge"* (step 1 template 74) to ~1,000 people who
registered in between, because step 1 was forced to `condition = 'all'`.

Fix: let step 1 carry `not_registered` and have the worker actually honour
it. Delay stays forced to 0 (step 1 must always fire on activation).

## What ships together

Two file changes in one deploy — wizard-side alone is a footgun, worker
change alone doesn't surface in the UI.

### 1. `email_worker.js:479-517` — `evaluateCondition` guard-move

The single-line early return `if (!prevStep) return true;` at `:485`
short-circuited **every** condition on step 1 (`recipient.current_step = 0`
→ `prevStep = stepsMap[0] = undefined`). This was correct for `not_opened`
/ `opened` / `not_clicked` / `clicked` which need the previous step's ID
for the `email_events.step_id = $2` predicate. It was WRONG for
`not_registered` / `registered`, whose SQL at `:537-547` is self-contained
on `recipient.id`, `recipient.email`, `campaign.expo_id`,
`campaign.organizer_id` and does not reference `prevStep`.

**Change:** moved the `if (!prevStep) return true;` guard **into** the two
branches that reference `prevStep.id`. The registration branch is now
reachable on step 1.

**Safety:**
- `not_registered` is documented one-way at `email_worker.js:536` — *"This
  is one-way: it can only ever SUPPRESS a send, never cause an extra one."*
  Making it fire on step 1 can only skip people, never send extras.
- `registered` on step 1 was previously silently `true` (via the early
  return) and now evaluates correctly — legitimate for a *"thanks for
  registering"* wave.
- open/click conditions still see the guard on their own branch;
  behaviour on steps 2+ unchanged.

### 2. `routes/campaignBuilder.js:858-905` — `normaliseStep1` wizard divergence

Delay stays forced to 0 with a log line when the caller sent something
else. Condition is now **preserved** as sent (any `VALID_CONDITIONS` value
is allowed; the earlier `:849` validation gate still runs). Default when
absent is `'all'`.

Comment explicitly cites the legacy endpoint's own rule
(`routes/campaigns.js:383-384`) and notes the wizard's deliberate divergence.

### 3. `public/reactivation-campaign.html`

- Row-1 condition select is no longer `disabled`. Delay input stays disabled.
- Split tooltips per row: step-1 select carries *"Step 1 fires when you
  activate. 'not_registered' skips anyone who registered between build and
  activation."*; later steps carry the shorter *"Who gets this step."*
- Fresh step-1 default is `'not_registered'` (was `'all'`).
- Info-box drip table row 1 changed from `all` → `not_registered`.
- Both drip-hint lines (activate + register waves) updated: every step is
  `not_registered` in the recommended pattern.

### 4. Tests

- `tests/test_wizard_silent.js` STEP 7 asserts:
  - `delay_hours === 0` for both waves' step-1 rows (unchanged) — proves
    delay normaliser fired.
  - `condition === 'not_registered'` on activate wave step-1 (was `'all'`).
  - `condition === 'not_opened'` on register wave step-1 (was `'all'`).

  The register wave uses `not_opened` (a different valid non-`'all'`
  value) to prove the divergence is not hardcoded to one string.

  Wave identified by `email_campaigns.name` prefix so each row is
  asserted against the correct expected condition per wave.
- Validator unit tests (`tests/test_template_validator.js`) unchanged
  (this change doesn't touch validator logic).

### 5. Docs

- `docs/WIZARD_USER_GUIDE.md` — typical drip table row 1 now
  `not_registered`. New paragraph explaining the *build → activate* gap
  and why `not_registered` on step 1 closes it.
- `docs/sessions/SIEMA26_LAUNCH_RUNBOOK.md` §3 activate + register wave
  tables updated. `normaliseStep1` note updated to describe the delay-only
  force + condition preservation.

## Test coverage — what the smoke can and cannot prove

Static tests (`test_wizard_silent.js` STEP 7) prove the wizard writes
`campaign_steps` correctly: `delay_hours = 0`, `condition` preserved per
wave. That reaches the DB row but stops before the worker's scheduler
picks it up.

**No unit test can reach `evaluateCondition` without a live DB and a
running worker.** The registration check reads `email_events`, `visitors`,
`reactivation_tokens` — all live tables — and depends on the timing of a
recipient's `current_step`, `next_step_due_at`, and the worker's
scheduler cycle. Verified in production via the smoke protocol below.

## Smoke protocol — production expo 9, Suer to run

Reproduces *"built Friday, registered over the weekend, activated Monday"*
end-to-end with a 2-recipient dataset. Uses two internal addresses, neither
currently registered on expo 9. All step numbers assume the wizard's
default step ordering.

### Preconditions (verified read-only 4 Sep before this deploy)

Expo 9 has 0 `visitors` for `suer+step1a@elan-expo.com` and
`suer+step1b@elan-expo.com` — pick two internal addresses of this shape
(or any pair not yet on expo 9). Run this first to confirm:

```sql
SELECT id, email, created_at FROM visitors
WHERE expo_id = 9 AND email IN ('<addrA>', '<addrB>');
-- Expected: 0 rows
```

If either exists, pick different addresses or DELETE them first (they're
internal test rows).

### Step-a — Wizard Build (do NOT activate)

Prepare a 2-row Excel with columns `email, name, last_name, company,
country, phone` for `<addrA>` and `<addrB>`. Both country `Morocco`.

In the wizard on production:
- **Source:** Import from Excel (the 2-row file)
- **Target expo:** 9 (Morocco Siema Expo 2026)
- **Preview:** should show `g2_activate = 0` (they're not on any other
  Leena expo) and `g3_register = 2` (both cold contacts). Skip the
  register wave in Templates panel; use activate wave only if you have a
  fresh G2 fixture instead. **For a clean single-step test the simplest
  option is a bespoke register wave with 1 step template 74** — swap
  wave labels in your head, the mechanism is identical (register-wave
  recipients also route through `processRecipient` → `evaluateCondition`).
  Alternatively use two addresses that DO exist on another Leena expo to
  force them into G2.
- **Templates:** activate wave (or register wave, whichever you seeded)
  with **exactly one step**: template 74, `delay_hours = 0`,
  `condition = 'not_registered'`.
- **Confirm:** Français, form 59, holdout 0.
- Click **Build**. Wait for the job to complete (green progress bar).
- **Do NOT activate the campaign.** Leave it in `status='draft'`.

Note the campaign id. Query it:
```sql
SELECT id, name, status, created_at
FROM email_campaigns
WHERE expo_id = 9 AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY id DESC LIMIT 5;
```

Save the two recipient ids:
```sql
SELECT id, email, current_step, status, next_step_due_at
FROM campaign_recipients
WHERE campaign_id = <YOUR_CAMPAIGN_ID>
ORDER BY email;
```

Both should show `current_step = 0`, `status = 'active'`,
`next_step_due_at = NULL` (campaign not yet activated).

### Step-b — Register ONE of the two through the public page

Open `https://leena.app/form-public.html?id=59` in a browser (form 59 is
the SIEMA visitor form) and submit a real registration for **just
`<addrA>`** — fill name / last_name / company / phone / country. Submit
and confirm the "thank you" page renders.

Verify the visitor row exists:
```sql
SELECT id, email, created_at, source, origin
FROM visitors WHERE expo_id = 9 AND email = '<addrA>';
-- Expected: 1 row, source='form', origin='manual_entry' (or similar)
```

`<addrB>` remains unregistered.

### Step-c — Activate the campaign

Two options:
- On the *Email Campaigns* page in the browser, find the draft campaign
  from step-a and click **Activate**.
- Or `POST /api/campaigns/:id/activate` from the API console.

Activation sets `campaign.status='active'` and every recipient's
`next_step_due_at = NOW()`. Within one scheduler cycle
(≤ `CAMPAIGN_SCHEDULER_INTERVAL_SECONDS = 10` s on the worker) the
scheduler picks them up, calls `processRecipient` → `evaluateCondition`.

Wait ~15 seconds for the scheduler + worker to drain step 1.

### Step-d — Expected result

**One** `email_queue` row exists (for `<addrB>`, the unregistered one).
**Zero** `email_queue` rows for `<addrA>` (skipped because
`not_registered` returned false: visitor row exists at `visitors WHERE
expo_id=9 AND lower(email)=lower(<addrA>)`).

The `campaign_recipients` row for `<addrA>` shows `current_step = 1`
(advanced past step 1) with **no queue row for it** — the worker's
`advanceRecipient` path at `email_worker.js:465` fires when
`conditionPassed === false`.

The `campaign_recipients` row for `<addrB>` shows `current_step = 1`ith
a queue row created by `enqueueStepEmail` at `email_worker.js:470`.

### SQL to see both rows side-by-side

```sql
-- Both recipients + queue presence
SELECT
    cr.email,
    cr.current_step,
    cr.status,
    cr.next_step_due_at,
    cr.last_step_sent_at,
    (SELECT COUNT(*) FROM email_queue eq
      WHERE eq.campaign_recipient_id = cr.id) AS queue_rows,
    (SELECT status FROM email_queue eq
      WHERE eq.campaign_recipient_id = cr.id
      ORDER BY id DESC LIMIT 1) AS latest_queue_status,
    EXISTS (SELECT 1 FROM visitors v
             WHERE v.expo_id = <YOUR_EXPO_ID> AND lower(v.email) = lower(cr.email)) AS is_registered
FROM campaign_recipients cr
WHERE cr.campaign_id = <YOUR_CAMPAIGN_ID>
ORDER BY cr.email;
```

**Expected shape** (with expo_id = 9, campaign_id = your draft):

| email | current_step | status | queue_rows | latest_queue_status | is_registered |
|---|---|---|---|---|---|
| `<addrA>` (registered) | `1` | `active` (or `completed` if only 1 step) | `0` | `NULL` | `t` |
| `<addrB>` (unregistered) | `1` | `active` (or `completed`) | `1` | `pending` / `sent` | `f` |

The `queue_rows = 0` for `<addrA>` is the proof that the guard-move worked
and step-1 `not_registered` correctly suppressed a send at run time.

### Scheduler log line to expect

`email_worker.js:464` logs on the skip path:
```
[CAMPAIGN SCHEDULER] Skipped step 1 for <addrA> (condition 'not_registered' failed)
```

If you have Render worker log access, `grep 'Skipped step 1' | grep <addrA>`
confirms directly.

### Rollback

If the smoke fails and you need to revert while keeping visitors:
```sql
-- Cancel the pending queue row for <addrB> so it doesn't ship
UPDATE email_queue SET status = 'cancelled'
WHERE campaign_recipient_id IN (
    SELECT id FROM campaign_recipients WHERE campaign_id = <YOUR_CAMPAIGN_ID>
);
-- Force the campaign to completed (per G35 you cannot DELETE it while
-- email_queue rows exist even in status='cancelled')
UPDATE email_campaigns SET status='completed' WHERE id = <YOUR_CAMPAIGN_ID>;
```

---

## Live proof — production expo 9, 4 Sep 2026

Suer's run against production, addresses `elif@elan-expo.com` (registered
on expo 9 between build and activate) and `suer@elan-expo.com` (never
registered on expo 9).

**Landmark commits.** The wizard + worker changes shipped as `87c6c4c`
(4 Sep 07:25 UTC). The legacy activation-gate fix in `routes/campaigns.js`
shipped as `3120810` (4 Sep 08:14 UTC) after the first Activate attempt
returned `Step 1 must have delay=0 and condition=all` — the legacy gate
had not yet accepted `not_registered`.

### Timeline

| UTC | Event |
|---|---|
| **07:47:21** | Wizard Build — `email_campaigns id=77` created, `status='draft'` |
| **07:50:53** | `elif@elan-expo.com` registered on expo 9 via `form-public.html?id=59` → `visitors id=72855, source='public_form', origin='public'` |
| **08:14:17** | `routes/campaigns.js` gate fix live (commit `3120810`) |
| **08:26:37** | Activate — `status='active'`, both recipients' `next_step_due_at = NOW()` |
| **08:26:39** | Worker picks up both recipients; campaign completes (only one step) |
| **08:26:41** | SendGrid accepts the one queued mail for suer |

### `campaign_steps` for campaign 77 — the fix landed

```
 step_number | template_id | delay_hours |   condition
-------------+-------------+-------------+----------------
           1 |          74 |           0 | not_registered
```

`condition='not_registered'` on `step_number=1` was preserved through:
- wizard `normaliseStep1` (delay-only force, condition preserved — `campaignBuilder.js:858-905`)
- legacy activation gate (delay-only check, condition validated by `VALID_CONDITIONS` — `campaigns.js:902-908`)
- worker `evaluateCondition` (guard-move at `email_worker.js:485-486` allows the registration branch to reach its SQL on step 1)

### The two recipient rows, verbatim

```
       email        | current_step |  status   | next_step_due_at |  last_step_sent_at  | queue_rows | latest_queue_status | is_registered
--------------------+--------------+-----------+------------------+---------------------+------------+---------------------+---------------
 elif@elan-expo.com |            1 | completed |                  |                     |          0 |                     | t
 suer@elan-expo.com |            1 | completed |                  | 2026-09-04 08:26:39 |          1 | sent                | f
```

**Reading the row shape:**
- `current_step = 1` for both — the scheduler advanced past step 1 either way. `elif`'s advance came from the skip path (`email_worker.js:465` `advanceRecipient` after `conditionPassed === false`); `suer`'s came from the enqueue path (`:470` `enqueueStepEmail` then `:474` `computeNextDue`).
- `status = 'completed'` for both — this is a single-step campaign, so completion followed step 1 in both branches.
- `queue_rows = 0` for `elif` — the load-bearing evidence. `not_registered` returned `false` (because `is_registered = t`), so `enqueueStepEmail` never ran, and no `email_queue` row was ever created.
- `queue_rows = 1, latest_queue_status = 'sent'` for `suer` — `not_registered` returned `true` (because `is_registered = f`), `enqueueStepEmail` fired at `08:26:39`, SendGrid accepted at `08:26:41`.
- `last_step_sent_at` is `NULL` for elif (nothing sent) and `08:26:39` for suer (matches the queue row's `created_at`, which is what the worker writes at enqueue time).
- `next_step_due_at = NULL` for both because there is no step 2 (`computeNextDue` at `email_worker.js` marks recipient completed when no more steps exist).

### The one queue row that DID land (for `suer`)

```
   id   | campaign_recipient_id |  recipient_email   | status |       created       |       sent_at
--------+-----------------------+--------------------+--------+---------------------+---------------------
 434990 |                156916 | suer@elan-expo.com | sent   | 2026-09-04 08:26:39 | 2026-09-04 08:26:41
```

Two-second gap between enqueue and send matches `PROCESS_INTERVAL = 2000 ms` (`email_worker.js:21`) — one worker cycle. No `elif`-addressed row present at all.

### End-to-end proof

- Wizard wrote `condition='not_registered'` on step 1 ✓ (visible in `campaign_steps`)
- Legacy activation gate accepted it ✓ (Activate returned success at 08:26:37, no `400 Step 1 must have delay=0 and condition=all`)
- Worker honoured it at send time ✓ (elif skipped; suer sent)
- The "built at 07:47, registered at 07:50, activated at 08:26" sequence is exactly the "built Friday / registered over weekend / activated Monday" pattern the change was written to close, in miniature and end-to-end.
