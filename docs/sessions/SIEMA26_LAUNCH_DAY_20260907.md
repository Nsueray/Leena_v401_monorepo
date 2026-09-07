# SIEMA26 — Launch day (Mon 7 Sep 2026)

> First day of live SIEMA email sends. Two campaigns activated, ~1,000 registrations added
> on top of ~15k already-registered, three visitor replies, three daytime deploys, one
> new operational rule (G42).

---

## 1. Activation

| Campaign | Wave | Recipients | Started (UTC) | = IST | = Casablanca |
|---|---|---:|---|---|---|
| **78** — `Morocco Siema Expo 2026 Leena Registered – Re-activation` | activate / G2 | 16,472 active + 867 holdout | 2026-09-07 **08:00:21** | 11:00 | **09:00** |
| **79** — `Morocco Siema Expo 2026 Past Visitors – Registration` | register / G3 | 16,350 active + 861 holdout | 2026-09-07 **10:00:22** | 13:00 | **11:00** |

Both `status='active'`. Two-hour stagger held per the runbook. Step 1 for both campaigns fires
`condition='not_registered'` — the fix from 4 Sep that made the 78-hour build-vs-activate gap
safe.

## 2. Send rate

Both campaigns drained at **~240 emails/minute** (a bit under the theoretical 300 = `BATCH_SIZE=10 ÷ PROCESS_INTERVAL=2s`). No worker restart needed. `email_queue` moved from ~15k pending
at activation to zero-pending well before end of business.

The 240/min figure is meaningful in one direction: it means the full step-1 payload for a
16k-recipient wave drains in ~65 minutes end-to-end. Step 2 delays are keyed off each
recipient's own enqueue timestamp (G10), so if the drain overlaps the next step's due time the
scheduler starts firing step 2 before step 1 has finished — normal, no compensation needed.

## 3. Step-1 `not_registered` — measured skip count

**236 recipients across campaigns 78 + 79 were skipped by the step-1 `not_registered`
condition** — i.e. they registered on expo 9 between the wizard Build (Fri 4 Sep 15:26 UTC)
and today's activations. Without the 4 Sep guard-move (`87c6c4c` in `email_worker.js:485`
plus `3120810` in `routes/campaigns.js`), all 236 would have received *"activate your badge"*
mail for a badge they already had. Instead they were silently advanced past step 1.

The `condition='not_registered'` decision was the load-bearing change of the whole SIEMA
launch build.

## 4. 15:00 IST funnel (Suer's snapshot)

| Stage | Count | % of prior |
|---|---:|---:|
| Delivered (`email_queue.status='sent'`) | **16,236** | — |
| Opened (unique) | **2,941** | 18.1% |
| Clicked (unique) | **1,134** | 38.6% of opens |
| Activated (`reactivation_tokens.status='activated'`, today) | **618** | 54.5% of clicks |

Read against G14: this snapshot is delivery-based, not enqueue-based, so the numbers reconcile
against `email_queue.status='sent'` and not `total_sent`/`email_events.sent`. By end-of-day
sanity check the activation count had grown to 704 (up ~86 in the next couple of hours),
which tracked with the *"clicked but hesitating"* tail turning into signups.

⚠️ **Follow-up:** the campaign detail page's "Registered" funnel count from `campaign_events`
may over- or under-count compared to the raw activation count — see todo below.

## 5. The three visitor replies (auto-inbound during send)

Three visitors replied to the campaign mails during the send. All three landed via the
existing SendGrid Inbound Parse hook at `POST /api/email/inbound` (no change needed).
Content varied — the shape of the reply-to is preserved at `noreply@leena.app` with reply
routing to `reply@replies.leena.app` (unchanged from campaign send path).

- **Reply 1** — French visitor asked whether the badge for last year still works. Answered by
  hand: activation link resends the pass on click; no separate badge needed.
- **Reply 2** — asked to unsubscribe. Ops added the address to `email_unsubscribes` manually
  from the visitor detail panel (via the 31 Aug UI — see `DEPLOY_UNSUB_UI_20260831.md`). No
  automated inbound-parse-to-unsubscribe yet (open todo P1 #9, still).
- **Reply 3** — a query about parking / venue access. Answered by hand; not a Leena-side
  workflow item.

**Auto-inbound → unsubscribe automation is still a P1 gap.** Ops procedure covers it for now.

## 6. Three daytime deploys and the "site inaccessible" complaint

Three code deploys landed while campaigns were mid-drain:

| Time (IST) | Commit | What |
|---|---|---|
| **12:22** | `8f47e3d` | Call-center dialer module — table, auth, routes, three pages |
| **12:47** | `c161a32` | Call-center TR strings + FR default + resend uses token email |
| **13:58** | `a403d2f` | Call-center 4c fixes (ccFetch 400 no longer drops to splash) + admin xlsx import |

Each carried a Render cutover — the standard 22-45 s 502 window (G3), sometimes worse. During
one of these windows a visitor reported *"the site is inaccessible"* — they were mid-click on
their activation link and the request hit an in-progress deploy.

**Verdict:** during a live-send campaign day, even a 20-45 s outage is unacceptable — every
visitor in the 502 window who clicked the CTA thinks "the invite is broken" and does not
retry. The click rate is a one-shot: recover it back is expensive.

**New operational rule (G42 in CLAUDE.md):** on campaign-send days, **no deploys except
between 22:00 and 07:00 Casablanca**. Suer can override explicitly for hotfixes. The 17:12 IST
push tonight (`1f8692a` + `a9a44fd`) was such an authorised override — Yaprak's `last_name`
data-quality issue was live-affecting new activations, so shipping it before the tomorrow
morning send restart was worth the risk. Cutover: 20 s (G43 — with `/health` now wired as
the Render health check path, the switchover happens only when the new container is truly
ready).

## 7. Pool state end-of-day

| Metric | Value |
|---|---:|
| Reactivation tokens on expo 9 total | 15,788 |
| Activated today (started 09:00 Casablanca) | 704 |
| Still pending EOD | ~15,084 |
| Empty `visitors.last_name` on today's activations (motivator for the fix) | 63 / 702 (9%) |
| `email_queue` still pending mid-day | 0 |

## 8. Related

- `docs/sessions/SIEMA26_LAUNCH_RUNBOOK.md` — the operational plan (state = LAUNCHED today)
- `docs/sessions/SIEMA26_BUILD_20260904.md` — the build report
- `docs/sessions/DEPLOY_STEP1_NOT_REGISTERED_20260904.md` — why step 1 = `not_registered`
- `docs/sessions/DEPLOY_LAST_NAME_REQUIRED_20260907.md` — tonight's fix (this deploy doc)
- `docs/sessions/DEPLOY_CALLCENTER_20260907.md` — the call-center module built today
- CLAUDE.md G42 — deploy-freeze rule
