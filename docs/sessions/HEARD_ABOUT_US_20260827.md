# "How did you hear about us?" — Self-Reported Source Analysis

**Date:** 27 Aug 2026, 22:47 UTC (post-fair, same session as FAIR_FINAL + DEPLOY_SEGMENT_FIX)
**Mode:** Read-only. All figures from live DB.

---

## TL;DR

**The field already exists. Yaprak can add it to any SIEMA form today with zero code.**

- **Field name in production DB:** `hear_about_event` (18 canonical options).
- **Already deployed on:** form 51 (Morocco Siema Expo 2026 pre-registration — **331 answers already in the DB**), form 56 (Nigeria MP onsite — 929 answers), form 46 (Mega Clima Nigeria 2026 onsite — 884), plus every May-era onsite form and a few Ghana-era stragglers.
- **NOT deployed on:** pre-registration forms 53 (Nigeria MP visitor pre-reg), 55/57/58 (Nigeria MP conference/VIP/speaker), and any Zoho-driven landing pages. **This is the SIEMA gap.**
- **Answers land in `visitors.custom_fields->>'hear_about_event'` automatically.** All three submit paths — public form (`routes/visitors.js`), Zoho webhook (`routes/webhook.js`), Excel import — pipe any non-standard key through to `custom_fields`. No code change needed to capture.

---

## 1. What exists today

### Forms that already carry `hear_about_event`

| form_id | name | expo_id | expo name | field required? | options |
|---|---|---|---|---|---|
| 24 | Onsite Visitor Registration Form | 3 | Mega HoReCa Nigeria | yes | 18 |
| 33 | Onsite Visitor Registration Form | 5 | Mega Clima Ghana 2026 | yes | 18 |
| 46 | Onsite Visitor Registration Form | 7 | Mega Clima Nigeria 2026 | yes | 18 |
| 50 | Visitor Registration Form | 14 | Mega Clima Nigeria 2027 | yes | 18 |
| **51** | **Visitor Registration Form** | **9** | **Morocco Siema Expo 2026** | **yes** | **18** |
| 56 | Onsite Visitor Registration Form | 13 | Nigeria Mega Project Expo 2026 | yes | 18 |

**Form 51 is the SIEMA pre-registration form and already carries the field.** Anyone Yaprak points at the SIEMA landing already answers it. The DB has **331 answers on expo 9** as of tonight — that's already a starting cohort to slice by show-rate once SIEMA opens.

### Forms that do NOT carry it (relevant to the pre-fair marketing question)

| form_id | name | expo_id | expo name | why it matters |
|---|---|---|---|---|
| 34 | Mega Clima Nigeria 2026 Webhook | 7 | Mega Clima Nigeria 2026 | This is the Zoho-driven pre-registration landing. The **May pre-fair funnel had no self-reported source** — that's why we can't back-solve Instagram share of pre-registrants for May. Post-fair only. |
| 41 | Activate Your Pass | 7 | Mega Clima Nigeria 2026 | Reactivation form — probably never appropriate for this field. Different audience. |
| 43 | Mega Clima Nigeria 2026 VIP Registration | 7 | Mega Clima Nigeria 2026 | Small volume, not worth chasing. |
| 44 | Mega Clima Nigeria 2026 Speaker Registration | 7 | Mega Clima Nigeria 2026 | Small volume, not worth chasing. |
| 53 | Visitor Registration Form | 13 | Nigeria Mega Project Expo 2026 | The Nigeria MP pre-reg. Missing here is why we couldn't run this cross-tab for the FAIR_FINAL SIEMA slide. |
| 55 | Conference Registration | 13 | Nigeria Mega Project Expo 2026 | Small volume. |
| 57 | VIP Registration | 13 | Nigeria Mega Project Expo 2026 | Small volume. |
| 58 | Speaker Registration | 13 | Nigeria Mega Project Expo 2026 | Small volume. |

### The 18 canonical options (from form 56, verbatim)

```
Instagram
Facebook
LinkedIn
TikTok
Youtube
X (Twitter)
Google Search
Elan Expo Website
Email Newsletter / Email Marketing
WhatsApp Message or Campaign
Invitation from Elan Expo Organizer
Invitation from an Exhibitor
Colleague / Friend Recommendation
Industry Association / Chamber Announcement
Newspaper / Magazine Advertisement
Radio / TV Advertisement
Outdoor Advertising (Billboards, Posters, Banners)
Other
```

Suer's proposed 8-item list maps into these cleanly:

| Suer's proposal | Existing canonical option |
|---|---|
| Instagram/Facebook ad | Instagram + Facebook (two rows, so we can rank each) |
| Google | Google Search |
| Email invitation | Email Newsletter / Email Marketing |
| WhatsApp | WhatsApp Message or Campaign |
| Colleague/friend | Colleague / Friend Recommendation |
| Association/chamber | Industry Association / Chamber Announcement |
| Visited before | *(not in the canonical list — closest is "Elan Expo Website" but not the same signal)* |
| Other | Other |

**Recommendation: use the canonical 18-option list, not the 8-item proposal.** The extra granularity (LinkedIn separated from Facebook, X separated from Instagram, exhibitor invitations tagged separately, print/radio/outdoor split for offline-media budget audits) gives the show-rate table more resolution than 8 buckets. If a "Visited before" signal really matters, we can add it as option 19 without disturbing the historical data — the field is free-text under the hood.

---

## 2. What form-builder supports today (zero code needed)

Read `public/form-builder.html:496-861`. The Add Field dialog handles:

- **Field type `Dropdown`** (line 502) — renders as `<select>` on the public form (line 970).
- **Custom options** — textarea, one option per line, split on `\n` and trimmed (line 861).
- **Required flag** — checkbox (line 813, propagates to `required` HTML attribute on the rendered `<select>`).
- **Custom field name** — arbitrary key (line 842), lands in `visitors.custom_fields` JSONB on submit.

The three submit paths all auto-capture non-standard fields:

- **`routes/visitors.js` POST /public** (`:206-219`) — pulls the standard columns out of `custom_fields` and stores the whole blob as-is, so `hear_about_event` survives.
- **`routes/webhook.js` POST /zoho/…** (`:62-74`) — has a `knownFields` set; anything NOT in that set lands in `customFields`. `hear_about_event` is **not** in `knownFields`, so it lands automatically.
- **`routes/visitors.js` POST /import`** (`:721-724`) — Excel columns not in `knownColumns` land in `customFields`. Same pattern.

**Verified against production:** visitor id 61918 (expo 13, form 53) has `hear_about_event = "X (Twitter)"` in `custom_fields` alongside 16 other form-56 fields. This is a walk-up who first pre-registered on form 53 and later filled form 56 onsite; the upsert path merged both forms' `custom_fields` correctly.

---

## 3. Ops steps for Yaprak — add it to SIEMA forms today

Two paths depending on whether SIEMA needs a new form or an edit of an existing one.

### Path A — new SIEMA form (recommended: clone form 51)

**Fastest and safest.** Form 51 already carries the 18-option field, is Suer-authored, and its wording ("How did you hear about Morocco Siema FoodExpo?") is the canonical template.

1. Log in to leena.app as `suer@elan-expo.com`.
2. Dashboard → pick the target expo → **Forms**.
3. On form 51's row click **Clone** (cross-expo clone is supported — v4.0.2 Sprint feature).
4. The clone lands on the target expo with `is_active = false` (safety default).
5. Open the clone → **form-builder.html** → edit each field's label to swap "Morocco Siema FoodExpo" → "[TARGET EXPO NAME]" (there are three: field 11, field 14 label prefix "6) How did you hear about…", field 14 remains functionally correct).
6. Save → toggle **Active** → publish.

Clone inherits the `hear_about_event` field byte-identical, so no risk of typos in the option list.

### Path B — edit an existing form (e.g. form 53 Nigeria MP retro, or a fresh visitor form)

Only if a clone from 51 is not suitable (different question set, different expo language, etc.).

1. Log in → Dashboard → target expo → **Forms** → open the form in **form-builder.html**.
2. **Add Field**.
3. Fill in:
   - **Field Type:** Dropdown
   - **Field Label:** `How did you hear about [Expo Name]?`
   - **Field Name:** `hear_about_event`   *(use this exact key — matches historical data, matches every existing show-rate query, matches the field name on form 51/56/46/33/24)*
   - **Placeholder:** (blank)
   - **Required:** ☑ checked
   - **Options (one per line, verbatim):** paste the 18 canonical options from §1.
4. Save the form (the field appears at the bottom by default; drag it into position if the ordering matters).
5. Toggle Active if not already.
6. Sanity check: open `form-public.html?id=<form_id>` in an incognito window and confirm the dropdown renders with all 18 options and the "*" required marker.

### Path C — Zoho landing page (SIEMA marketing funnel)

If SIEMA's Meta ads point at a Zoho landing page instead of `form-public.html`, this is a two-step add:

1. **In Zoho**, add a Single Select field:
   - Field name (Zoho internal): `hear_about_event`  *(must match exactly — the Leena webhook is key-based)*
   - Label: `How did you hear about [Expo Name]?`
   - Required: yes
   - Options: paste the 18 canonical options.
2. **In Leena**, no change needed. The webhook (`routes/webhook.js:62-74`) doesn't have `hear_about_event` in its `knownFields` set, so it auto-drops into `custom_fields`.

Verified with production visitor 65387 (source=`reactivation`, form_id=NULL, `hear_about_event = "Facebook"`) — an off-Leena-form path successfully landed the value.

---

## 4. How self-reported source feeds the show-rate table

The FAIR_FINAL §3 SIEMA table is grouped by `v.source` (the technical funnel tag). Adding `hear_about_event` gives us a second axis: what the visitor said they came from. Two useful views.

### 4a. Standalone — self-reported channel show rate (drop-in for the FAIR_FINAL §3 table)

```sql
SELECT
  COALESCE(NULLIF(TRIM(v.custom_fields->>'hear_about_event'), ''), '(no answer)') AS heard_via,
  COUNT(*) AS registered,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id
  )) AS attended,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id
    ))::numeric / NULLIF(COUNT(*), 0),
    2
  ) AS show_rate_pct
FROM visitors v
WHERE v.expo_id = $1
GROUP BY heard_via
ORDER BY registered DESC;
```

Same structure as the FAIR_FINAL Pixad/public_form/reactivation table. Pre-fair vs during-fair split by adding `AND v.created_at < $2::date` / `AND v.created_at >= $2::date` on two runs.

### 4b. Cross-tab — technical source × self-reported source

The interesting one. Tells us "of the 4,857 Pixad-tagged registrations, how many self-reported Instagram vs Facebook vs Other — and how did each cohort's show rate compare."

```sql
SELECT
  v.source AS technical_source,
  COALESCE(NULLIF(TRIM(v.custom_fields->>'hear_about_event'), ''), '(no answer)') AS heard_via,
  COUNT(*) AS registered,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM checkins c WHERE c.visitor_id = v.id AND c.expo_id = v.expo_id
  )) AS attended
FROM visitors v
WHERE v.expo_id = $1
GROUP BY v.source, heard_via
ORDER BY v.source, registered DESC;
```

Two axes → four scenarios per source:
- **Matches** (Pixad + Instagram, Pixad + Facebook) → the ad platform's attribution is honest.
- **Doesn't match** (Pixad + "Colleague / Friend Recommendation") → the ad was the click-through mechanism but a friend was the actual influencer. Pixad gets credit it didn't earn; the friend gets none.
- **`(no answer)`** — the row is on a form without the field, or the visitor skipped it. Currently ~90% of expo 13 rows, because form 53 lacked the field pre-fair.
- **`source` NULL / unknown + a real self-report** → the visitor came in through a channel Leena wasn't tracking (WhatsApp forward from another visitor, PR piece, etc.) but they told us where they came from.

The **friend-recommendation gap** is the big one for Suer's budget question. Meta will always report a Pixad-conversion because it saw the click. If 30% of Pixad-tagged visitors self-report "Colleague / Friend Recommendation", the true CAC on Pixad is materially worse than Meta says — the friend converted, Meta just took the last-touch credit.

### 4c. Attribution honesty note (to state on the SIEMA slide)

- Answers are **self-reported at registration time**, so they carry all the usual biases: recency (visitor remembers the most recent touch, not the first), acquiescence (whichever option is at the top of the list gets a lift), and desirability (few people admit "Radio / TV Advertisement" if the option is present).
- The `hear_about_event` field is **required on form 51** but the visitor can pick "Other" without free-text. ~4% of expo 13 answers are "Other" — treat as unclassified.
- **This is the human-funnel signal to sit next to `source`, not to replace it.** `source` remains the technical truth about which URL the click came from; `hear_about_event` is the visitor's story about why they clicked. Both together price the channel; either alone lies.

---

## 5. Code follow-ups (queued, priority note only)

**No code required tonight** to add the field on SIEMA. Everything below is *nice-to-have* polish that would surface `hear_about_event` in the UI/reporting layer.

| # | Item | Priority | Why | Effort |
|---|---|---|---|---|
| 1 | Add `heard_via` column to the visitor log table (`visitorlog-paginated.html`) | LOW | Ops can already filter/see it via visitor detail panel (`custom_fields` JSON) | ~1h |
| 2 | Add `hear_about_event` to the `/api/visitors/export` Excel | LOW-MED | Yaprak asked for source visibility in exports; this closes it out | ~1h |
| 3 | Add self-reported-source stats section to `reports.html` (per-channel show rate) | MED | Replaces the ad-hoc SQL query above with a UI. Only useful once a couple more fairs have SIEMA-style pre-fair data. | ~half day |
| 4 | Filter option on visitor log (`visitorlog-paginated.html`) — "Heard via: [dropdown]" | LOW | Nice, but rare use case | ~2h |
| 5 | Backfill: add the field to Nigeria MP form 53 retro so any late walk-ups going through it also capture | ZERO CODE | Yaprak can do this in form-builder today | 5min |

**Recommendation: none of these block anything.** Add the field to the SIEMA forms this week; use the SQL in §4 to report; do the UI polish (items 1-4) opportunistically post-SIEMA.

---

## 6. Priority verdict for the post-fair queue

- **Not a code sprint.** The FAIR_FINAL post-fair queue does NOT need to grow by an item for this.
- **Yaprak-owned action, this week:** clone form 51 into the SIEMA-target expos, or add the field manually to any bespoke SIEMA form. Uses form-builder UI, no dev involvement.
- **The queue polish items above (§5) are LOW priority** — add them to the tail of the FAIR_FINAL post-fair queue (below `L2` reactivation snapshot fix, above dashboard cosmetics).

If SIEMA-Instagram-attribution proves critical for the Friday brief and Yaprak needs a slide with the cross-tab from §4b, run those two queries against expo 9 (Morocco Siema — 331 rows) or expo 7 (Mega Clima Nigeria May — 884 rows) tonight. Both already have enough data for a directional read; SIEMA-Morocco can now become a proof-of-concept for the pattern before it lands on the next Nigeria fair.
