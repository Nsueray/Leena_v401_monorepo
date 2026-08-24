# Registration-source analysis — 24 August 2026
**Taken:** 24 Aug 2026, **20:34 Lagos** · Read-only · all day boundaries `AT TIME ZONE 'Africa/Lagos'`.
**Doors open tomorrow, Tue 25 Aug 10:00.**

> ⚠️ **Date correction, load-bearing for §3.** The request called today Sunday and asked me to
> re-check the step-3 fire time on that basis. **Today is Monday 24 August 2026** (`isodow = 1`),
> and expo 13 opens **Tuesday 25 Aug**. Step 3 fired **this morning, exactly as scheduled** — it is
> the single largest driver of today's numbers, so treating today as Sunday would misread the whole
> day. Details in §3.

---

## 1. Headline — source × today / yesterday / cumulative

**Today 1,198 · yesterday 392 · cumulative 7,871.** Today is **3.06× yesterday** — the biggest
single day on this expo.

| source | today | yesterday | cumulative | % of expo |
|---|---:|---:|---:|---:|
| Ads — Pixad/Meta (Zoho form) | 233 | 245 | 2,778 | **35.3%** |
| **Campaign reactivation link** | **330** | 44 | 1,488 | 18.9% |
| **Import — Meta/Pixad batch** | **256** | 0 | 1,094 | 13.9% |
| Ads — landing page | 58 | 34 | 780 | 9.9% |
| Zoho — generic/untagged | 125 | 39 | 646 | 8.2% |
| Public form direct | 95 | 17 | 479 | 6.1% |
| Import — other lists | **49** | 0 | 296 | 3.8% |
| Ads — email marketing | 47 | 13 | 275 | 3.5% |
| Zoho — "Leena"-labelled | 1 | 0 | 29 | 0.4% |
| Ads — LinkedIn | 2 | 0 | 4 | 0.1% |
| Onsite manual (terminal) | 2 | 0 | 2 | 0.0% |
| **TOTAL** | **1,198** | **392** | **7,871** | 100% |

**How the data actually distinguishes sources:** `origin` (5 values) × `source` (14 values) ×
`form_id`. **There is no UTM anywhere** — 0 rows on this expo carry a `utm` key in
`custom_fields`. Ad channels are separable only because Zoho writes a descriptive `source` string
per campaign ("… - Pixad", "… - Landing Page", "… - Email Marketing", "… - Linkedin").

🟡 Two label defects worth knowing before anyone charts this: a typo variant
**"Landign Page"** (1 row, folded into landing page above), and one row whose source is literally
**"This is a test submission"**.

## 2. Today vs yesterday — what drove the 3× delta

| bucket | today | yesterday | delta |
|---|---:|---:|---:|
| Campaign reactivation | 330 | 44 | **+286** |
| Meta/Pixad import batch | 256 | 0 | **+256** |
| Zoho generic | 125 | 39 | +86 |
| Public form direct | 95 | 17 | +78 |
| Other imports (Ceramica list) | 49 | 0 | +49 |
| Ads — email marketing | 47 | 13 | +34 |
| Ads — landing page | 58 | 34 | +24 |
| **Ads — Pixad/Meta (Zoho)** | 233 | 245 | **−12** |

**The delta is two things: campaign step 3 (+286) and an ops import (+305 across two batches).**
Together they are **591 of the +806 swing (73%)**.

Paid acquisition was **flat to slightly down** — Pixad ran 233 today vs 245 yesterday. Today's
spike is **not** an advertising effect.

### Hourly shape (Lagos)

```
00 ▏3    01 ▏6    02 ▏7    03 ▏4    04 ▎11   05 ▏6
06 ▍17   07 ▋27   08 ███████████████ 141   ← campaign step 3 lands
09 ████████████ 116        10 ████████ 83
11 █████████████ 125       12 ██████ 65     13 █████ 49
14 ████████████████████████████████ 300     ← 255 of these are the import
15 ████ 45  16 █████ 52   17 █████ 48
18 ███ 31   19 ████ 46    20 ▉15 (partial)
```

Two artificial peaks — **08:00** (step 3) and **14:00** (bulk import, 255 of 300 rows) — over a
steady organic floor of roughly **45-60/hour** through the working day.

## 3. Campaign step 3 — it fired **today, Monday**, as scheduled

**Measured from `email_events`, not from the schedule:**

| campaign | first enqueue | last | day |
|---|---|---|---|
| 16 → template #56 | **Mon 24 Aug 07:52:55** | 07:58:31 | **Monday** ✅ |
| 17 → template #59 | **Mon 24 Aug 08:15:25** | 08:25:17 | **Monday** ✅ |

These match the predicted 07:52-07:57 / 08:15-08:24 windows exactly. Nothing is pending and no
restatement of a future fire time is needed — **there is no step 4.**

### Response, today alone

| campaign | `registered` events today |
|---|---:|
| 16 (Activate) | **308** |
| 17 (Register) | **65** |
| 18 (Final Activate Push) | 22 |
| **total events today** | **395** |

The 4.7:1 split between C16 and C17 is consistent with every prior step: C16's audience holds a
personal activation token, C17's must fill in a form.

### Cumulative campaign attribution

| campaign | cumulative unique `registered` |
|---|---:|
| 16 | 891 |
| 17 | 287 |
| 18 | 227 |
| **deduped by email** | **1,403** |

**1,403 of 7,871 = 17.8% of the entire expo is campaign-attributed.**

⚠️ 395 attributed events today vs 330 rows with `origin='reactivation_campaign'` — the gap is the
C17/C18 route, where people arrive via `form-public.html` carrying `_lc` and land as
`origin='public'`. Both numbers are right; they count different things.

## 4. Non-campaign momentum — the SIEMA baseline

Last 48 hours, **1,667 registrations**:

| bucket | n | share |
|---|---:|---:|
| **Ads** (Pixad 529 · landing 95 · email mktg 62 · LinkedIn 2) | **688** | 41.3% |
| **Campaign** (reactivation link 385 · other route 56) | **441** | 26.5% |
| **Import** (ops-loaded lists) | 303 | 18.2% |
| **Organic** (generic Zoho 170 · public form 63) | 233 | 14.0% |
| Onsite manual | 2 | 0.1% |

**Excluding the import** — it is a list ops uploaded, not demand — leaves **1,364 acquired
registrations**:

| | share of acquired |
|---|---:|
| Ads | **50.4%** |
| **Campaign** | **32.3%** |
| Organic | 17.1% |

**The "would have come anyway" baseline is ~67.5%** (ads + organic). Campaign adds roughly
**one registration for every two the ads and organic channels produce**.

⚠️ **Attribution is not causation, and this is the number most likely to be over-read.** A
campaign `registered` event fires when someone arrives carrying our tracking token — it does not
establish that they would not have registered anyway, and many of these people are on the ad
lists too. Treat 32.3% as the **upper bound** on campaign contribution, not a measured lift.
A true incremental figure needs a holdout group, which this campaign did not have.

## 5. Data quality of today's intake

Fill rates by source, today only:

| source | n | phone | job title | country | company |
|---|---:|---:|---:|---:|---:|
| Campaign reactivation | 330 | 100% | 100% | 100% | 100% |
| Import — Meta/Pixad | 256 | 100% | 100% | 100% | 100% |
| Ads — Pixad (Zoho) | 232 | 100% | 100% | 100% | 100% |
| Zoho generic | 122 | 100% | 100% | 100% | 100% |
| Public form direct | 95 | 100% | 100% | 100% | 100% |
| Ads — landing page | 58 | 100% | 100% | 100% | 100% |
| Import — Ceramica list | 49 | 100% | **91.8%** | 100% | 100% |
| Ads — email marketing | 47 | 100% | 100% | 100% | 100% |
| **Onsite manual (terminal)** | **2** | **0%** | **50%** | **50%** | 100% |

**Every acquisition source is at or near 100%.** Only two exceptions, and neither is new:

- **Ceramica import at 91.8% job title** — 4 rows short.
- 🟠 **Onsite manual at 0% phone** — this is the exact gap documented in
  `FAIR_DAY_TOOLS_20260824.md` §C, now visible in live data. Both rows are my own test
  registrations, so the sample is mine, not ops' — but it confirms the prediction: the terminal
  form has **no phone field at all**, and country/job title are optional.

### The Meta/Pixad import — phone format verified

**305 import rows landed today** (256 Meta/Pixad + 49 Ceramica). **All 305 carry a phone.**

| format | n | verdict |
|---|---:|---|
| `+234` + 10 digits | **272** | ✅ valid, dialable |
| `+2340…` — trunk zero **not stripped** | **15** | ❌ not dialable as written |
| `+234` wrong length | 3 | ❌ e.g. `+23491307733709`, `+234909 596 6254` (spaces), `+23465543387` |
| Non-`+234` — other countries | 15 | ✅ legitimate (+1, +212, +237, +31, +60, +86, +880, +91, +971) |

**89.2% clean; 18 rows (5.9%) malformed.**

The dominant defect is the classic double-prefix: `+234` prepended to a local number that kept its
leading `0`, producing `+2340803…`. Nigerian mobile numbers are `+234` followed by **10** digits
with no zero.

**But this is a pre-existing, expo-wide problem, not something the fixed file introduced:**

| | `+2340…` rate |
|---|---:|
| Today's import | **4.9%** (15/305) |
| **Everything else on expo 13** | **10.9%** (n=7,553) |
| Expo-wide absolute | **840 rows** |

**The re-run file is more than twice as clean as the expo baseline** — so the fix worked; it just
did not catch every row. 840 malformed numbers across the expo is a post-fair cleanup item, not a
fair-day one.

## 6. Two things ops changed today that were not in the brief

- 🟡 **Form 58 "Speaker Registration"** was created today at **10:55** and already has **3
  submissions**, all `visitor_type='speaker'`. Expo 13 previously had **zero** speakers, which was
  the basis of the T3-Speaker-terminal warning in `MONDAY_PREFAIR_20260824.md` §6. **T3 now has an
  audience of 3.** T4 VIP still has **zero** — that warning stands unchanged.
- 🟡 **A second import batch, "Nigeria Mega Ceramica 2026"** (49 rows), landed alongside the
  Meta/Pixad one. It was not mentioned in the brief; flagging it in case it was not intended for
  expo 13.

Today's visitor-type mix: visitor 1,165 · exhibitor 24 · conference 4 · speaker 3 · staff 1.

---

## Summary

- **1,198 today, 3.06× yesterday** — the largest day on this expo, cumulative now **7,871**.
- **The spike is campaign + import, not ads.** Step 3 (+286) and two import batches (+305) are 73%
  of the swing; **Pixad was flat, actually −12**.
- **Step 3 fired Monday 07:52 / 08:15 as scheduled** — today is Monday, not Sunday, and there is
  no further step.
- **Campaign-attributed cumulative: 1,403 = 17.8% of the expo.**
- **SIEMA baseline: ~67.5% of acquired registrations came from ads + organic.** Campaign's 32.3%
  is an attribution ceiling, not measured lift — no holdout existed.
- **Intake quality is excellent** (≈100% across every acquisition source). The import's phones are
  **89% clean and twice as good as the expo baseline**; the only structurally poor source is the
  terminal's onsite manual form, exactly as predicted.
