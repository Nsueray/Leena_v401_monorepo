# MP26 Saturday-night 24h checkpoint
**Taken:** 2026-08-22 23:25 Istanbul / 21:25 Lagos · **Fair opens Tue 25 Aug (3 days).**
Read-only. No writes, no code, no interventions.

Prior: `FRIDAY_NIGHT_20260821.md` (21 Aug 23:15) → **this**.

---

## 1. C18 results — the short template wins on clicks, not opens

**Delivered 14,227** of 14,229 recipients (2 unsubscribed before their send).
Drain 23:07:35 → **00:02:13**, span **54.6 min**, **260.4/min**. Enqueue itself took 3 m 17 s.

First 24 h after activation:

| | unique | of delivered |
|---|---:|---:|
| Opened | 1,644 | 11.55% |
| Clicked | 208 | 1.46% |
| Registered | 170 | 1.19% |
| Unsubscribed | 5 | 0.035% |

### Like-for-like against C16 step 1 — the SAME 14,229 people

All 14,229 C18 recipients are also C16 recipients, so C16's step-1 behaviour can be measured on
exactly that subset. This is the only honest comparison: C18's pool is **C16's non-converting
residue**, not a hotter list — the ~3.4% who had already converted were stripped out.

| | C16 step 1 (#54, long, Tue 20:52) | C18 (#61, short, Fri 23:07) |
|---|---:|---:|
| Opened | 1,827 (12.84%) | 1,644 (11.55%) |
| Clicked | **76 (0.53%)** | **208 (1.46%)** |
| Click-to-open | **4.2%** | **12.7%** |

**Opens down ~10% relative; clicks up 2.7×; click-to-open up 3.0×** — on an audience already
proven less responsive. The short design is not getting more people to open; it is converting a
far larger share of those who do open into clicks.

Registrations cannot be compared like-for-like: the C18 pool was built by excluding everyone who
had converted from C16, so C16's registrations inside that pool are 0 by construction.

### Hourly open curve (unique openers, elapsed hours from activation)

```
        h+00 h+01 h+02 h+03 h+04 h+05 h+06 h+07 h+08 h+09 h+10 h+11
C18      435  253  143   98   52   49   31   32   42   64   62   79
C16       31   62   71   88  103  124   89   95  104   75   78  117

        h+12 h+13 h+14 h+15 h+16 h+17 h+18 h+19 h+20 h+21 h+22 h+23
C18       70   49   55   46   44   35   31   31   37   36   30   43
C16      156  146  154  113   98   85   63   74   65   52   44   37
```

C18 is heavily front-loaded — **688 opens (42% of the 24 h total) in the first two hours**, from a
21:07 Lagos send. C16 is flat and peaks at h+12–14, its 20:52 Tuesday send landing its peak in
Wednesday office hours.

### ⚠️ MEASURED DEFECT — C18's delivered figure in the UI reads 950, not 14,227

`delivered_count = 950`, while 14,227 sent rows are resident in `email_queue`. The reader is
`COALESCE(c.delivered_count, live_count)` (`routes/campaigns.js:119-120, :257`), so the non-null
snapshot wins and the campaign list shows **950 Delivered / 14227 queued**. The funnel divides by
950: opens render 1,651/950 = 174%, clamped by the guard to 100%.

**Cause.** `checkCampaignCompletion` (`email_worker.js:670-722`) snapshots when no
`campaign_recipients` row is still `active` — that is *recipient* completion, not *drain*
completion. C18 hit it at **23:11**, three minutes after activation, with the queue still
draining for another **51 minutes**. The snapshot captured the 950 sent by that instant.

The migration-029 design assumed completion implies the drain has finished. That holds for
multi-step campaigns, whose steps are days apart; it fails for **single-step** campaigns, where
completion arrives within minutes of activation. C15's 125% open rate was the opposite failure
(purge with no snapshot); this is the same metric broken from the other end.

Two consequences, both measured:
- The purge deleted **0** rows (`sent_at < NOW() - 1 hour`; everything was minutes old) and the
  completion UPDATE is guarded by `AND status='active'`, so it fires exactly once — those 14,227
  rows will now never be purged. Bloat, but also why truth is still recoverable here.
- Nothing else consumes `delivered_count`; delivery, sending and Monday's scheduling are all
  unaffected. This is a **display** defect only.

Post-fair fix, logged; not touched tonight.

---

## 2. Registration picture

| | |
|---|---:|
| Expo 13 total visitors | **6,218** (was 5,637 Friday night → **+581**) |
| Created last 24 h | **564** |
| Reactivation tokens activated | 1,123 (pending 22,915) |
| `job_title` populated | 6,133 / 6,218 = **98.6%** |

### Last 24 h by source / origin

| source / origin | n |
|---|---:|
| Visitor Registration – **Pixad** / zohoform | **281** |
| **reactivation** / reactivation_campaign | **201** |
| Visitor Registration – Landing Page / zohoform | 33 |
| public_form / public | 21 |
| Nigeria Mega Project Expo 2026 / zohoform | 17 |
| Visitor Registration – Email Marketing / zohoform | 8 |
| Visitor Registration – Leena / zohoform | 2 |
| zoho / zohoform | 1 |

Paid acquisition (Pixad, 281) and campaign reactivation (201) are running neck and neck; together
they are 86% of the day.

### Campaign attribution

| | cumulative unique | last 24 h |
|---|---:|---:|
| C16 registered | 564 | 34 |
| C17 registered | 210 | 17 |
| C18 registered | 170 | **157** |
| **Total, deduped by email** | **945** | **208** |

Deduped (945) is within 1 of the per-campaign sum (944) because C18's pool excluded C16's
converts, so the lists barely intersect on converters. The 1-row difference comes from an event
whose `campaign_id` and recipient's campaign differ; immaterial, not chased.

Cross-check: 208 campaign-attributed events vs 201 rows with `origin='reactivation_campaign'` —
the gap is the public-form route (C17/C18 converts arriving via form 53 with `_lc`).

**C18 produced 157 of the day's 208 attributed registrations** — 75% of campaign-driven
registration in the window came from one overnight send.

---

## 3. List health

| | |
|---|---:|
| Unsubscribes last 24 h | **8** — C18 **5**, C17 **3** |
| Reason (all) | `user_unsubscribed` |
| `email_unsubscribes` all-time | 261 |
| `email_queue` pending / processing / failed | **0 / 0 / 0** |
| Stuck > 15 min | 0 |
| `try_count > 1` (retries) | 0 |
| `error_message` not null | 0 |
| `email_logs` in the C18 burst hours | 13,710 + 646 = 14,356 — **0 failed** |

Unsubscribe rates: **C18 0.035%** · C16 step 1 0.047% · C17 cumulative 0.134% (both steps). All an
order of magnitude inside tolerance.

**There is still no bounce signal anywhere in our data.** `email_events` holds exactly five types
— `clicked, opened, registered, sent, unsubscribed`. No bounce, dropped or spamreport row exists
because no SendGrid event webhook is wired (G9). Nothing here is evidence of good deliverability;
it is evidence that **we cannot see deliverability at all**. The SendGrid dashboard remains the
only source, and I cannot read it. The 14,356 rows above mean SendGrid *accepted* the API call.

---

## 4. C19 decision inputs

| | |
|---|---:|
| C19 active pool | **25,841** |
| C17 Monday step-3 send audience (after the registration checks) | **25,795** |
| **Overlap** | **25,795** |
| In C19 but not in Monday's audience | **46** |
| **In Monday's audience but not in C19** | **0** |

**Monday's step-3 audience is a strict subset of C19.** Every single person C19 would email is
already scheduled to receive template #59 on Monday morning; the only difference is 46 people who
have registered since Friday. Because a single-step campaign is forced to `condition='all'`
(G19), C19 cannot filter them out — those 46 would get a "register now" email despite already
being registered.

**Expected yield:** 25,841 × 0.67% ≈ **173 registrations**, against **9–35 unsubscribes** (9 at
C18's observed 0.035%, 35 at C17's 0.134%), delivered to a list that Monday's step 3 reaches
anyway ~33 hours later.

*The one line requested:* C19 buys ~173 registrations roughly a day and a half earlier than
Monday's step 3 would deliver to the identical audience, at the cost of ~9–35 unsubscribes, 46
mis-targeted emails, and a second send to people who have now ignored three.

---

## 5. Monday readiness

Fire windows confirmed from `next_step_due_at`:

| campaign | fires (Lagos) | active | **projected SKIP** | **projected SEND** |
|---|---|---:|---:|---:|
| 16 → step 3 (#56) | **Mon 24 Aug 07:52–07:57** | 14,921 | **950** | 13,971 |
| 17 → step 3 (#59) | **Mon 24 Aug 08:15–08:24** | 26,192 | **397** | 25,795 |

Skip attribution as of tonight (a recipient can match more than one check):

| | C16 | C17 |
|---|---:|---:|
| (a) campaign `registered` event | 564 | 210 |
| (b) visitor row on expo 13 | 948 | 337 |
| (c) activated reactivation token | 745 | 5 |
| **(b) but NOT (a) — invisible to the campaign event alone** | **386** | **187** |

**573 people are caught only by the email-matched checks that `dedbcd0` added.** Without that
commit all 573 would receive a "last chance to register" email on Monday having already
registered. On 19 Aug that figure was **66**; it has grown 8.7× in three days, exactly as the
~50/day trend predicted.

Method note: this replicates `evaluateCondition` set-based, but without check (a)'s
`created_at >= last_step_sent_at` clause, making (a) marginally over-inclusive. It cannot move the
union materially — the union (950) exceeds check (b) alone (948) by 2.

Templates #56 and #59 are chain-greeted and render-verified. Both campaigns remain `active` with
`delivered_count` NULL, which is correct — nothing to snapshot until they complete.

---

## 6. Ops open items — no movement on any of the three

All four terminals still carry `created_at = 18 Aug 08:33`. Nothing has been reconfigured since
`TERMINAL_CHECK_20260819.md`.

| terminal | kind | badge template | `show_job_title` |
|---|---|---|---|
| **T1 Visitor** | scanner | **17 "test visitor 80x40"** | **false** 🔴 |
| T2 Exhibitor | scanner | 13 Exhibitor Badge Template | true ✅ |
| T3 Speaker | scanner | 16 Speaker Badge Template | true ✅ |
| T4 VIP | scanner | 15 VIP Badge Template | false (shows `role` instead — plausibly deliberate) |

1. 🔴 **T1 still on the test template.** The highest-volume gate, unchanged.
2. 🔴 **`show_job_title` false on T1.** 6,133 populated job titles will not print at the visitor
   gate. Template 12 "Standard Badge Template" (`is_default`, `show_job_title=true`) already
   exists and would fix both items in one reassignment.
3. 🔴 **No conference terminal.** Four terminals, all `kind='scanner'`, all Hall 1. 86 visitors of
   type `conference`, 107 holding a topic, **0 certificates issued**.

Check-ins on expo 13: **13**, unchanged — still the test rows.

### New since Friday

**Form 56 "Onsite Visitor Registration Form"** — created Fri 21 Aug **21:29**, updated 21:32.
16 fields, `email_template_id=49`, `visitor_type='visitor'`, active, **0 submissions**. Ops is
preparing an onsite path. Not previously in any check.

### ⚠️ New finding — conference topic drift on form 55

Form 55 currently lists **4** canonical options (numbered 1–4). Visitors hold segments that are
not among them:

| held value | visitors |
|---|---:|
| `6. Panel Session \| The leading manufacturer of pipes in Nigeria` | 3 |
| `7. Panel Session \| Costarchem; Building A Strong Future` | 4 |
| `Choice One` | 1 |

**8 visitors, 8 segments, unmatched**; 100 visitors / 101 segments match cleanly. Numbers 5–7
imply the option list was edited or renumbered after those registrations. The hostess dropdown is
built from the canonical options, so `isVisitorRegisteredForTopic` will fail for these 8 and the
hostess would have to use force. `Choice One` is a leftover template default.

Also worth noting before anyone edits these strings: the topic names themselves contain a **single
pipe** (`Panel Session | Smart Cities…`) while the multi-topic separator is a **double pipe**
(` || `). Two visitors already hold combined values. Any split logic that loosens to a single `|`
will shred every topic name in this expo.

---

## 7. Standing

**Campaign side is healthy and needs nothing before Monday.** Zero failures, zero stuck rows,
zero retries, unsubscribes an order of magnitude inside tolerance, the registration checks
suppressing 573 wrong sends, and both Monday templates verified.

**Every remaining risk is gate readiness**, unchanged for four days: T1's badge template,
`show_job_title`, and the missing conference terminal. Plus the C19 call.

Two new items for the post-fair list: the single-step `delivered_count` snapshot timing, and the
8 non-canonical conference topics.
