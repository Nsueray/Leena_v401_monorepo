# Expo 13 — Terminal Readiness Check
**Taken:** 2026-08-19 · **Mode:** read-only. No terminals, check-ins or templates created or modified.
**Target:** `expo_id=13` Nigeria Mega Project Expo 2026, **25-27 Aug — opens in 6 days**.
**Baseline for diff:** `expo_id=7` Mega Clima Nigeria 2026 (May), the last fair that ran end-to-end.

---

## VERDICT TABLE — ops punch list

| # | Item | Verdict | Action needed |
|---|---|---|---|
| 1 | Terminals exist for expo 13 | 🟢 **READY** | 4 created 18 Aug 08:33, all active |
| 2 | Created fresh, not cloned | 🟢 **READY** | Clone bug does **not** apply — proven below |
| 3 | Terminal keys unique, no May reuse | 🟢 **READY** | 28/28 distinct, 0 shared, 0 malformed |
| 4 | `for-terminal` endpoint resolves | 🟢 **READY** | All 4 verified live over HTTP |
| 5 | Badge template assigned to every terminal | 🟢 **READY** | 4/4 assigned, all resolve |
| 6 | **T1 Visitor uses a TEST badge template** | 🔴 **MISSING** | **Reassign template 17 → a real visitor template** |
| 7 | **`show_job_title` on the visitor badge** | 🔴 **MISSING** | Template 17 has it **OFF** — 1,785 backfilled titles won't print |
| 8 | **Conference terminal** | 🔴 **MISSING** | 66 conference registrants, no conference terminal |
| 9 | **Bulk-print terminal** | 🔴 **MISSING** | Expo 7 had one; expo 13 has none |
| 10 | `allow_manual_registration` intent | 🟡 **NEEDS-VERIFY** | All 4 = TRUE; expo 7 ran a deliberate mix |
| 11 | Speaker / VIP terminals vs demand | 🟡 **NEEDS-VERIFY** | 0 speakers, 0 VIPs registered — 2 of 4 terminals serve empty segments |
| 12 | Conference form topic list | 🟡 **NEEDS-VERIFY** | Form 55 exposes only **1** topic option |
| 13 | May-fair scanner keys still active | 🟡 **NEEDS-VERIFY** | 6 of 8 expo-7/8 terminals still `is_active=true` |

**Blocking for opening day: items 6, 7, 8.** Items 9-13 are judgement calls.

---

## 1. Inventory — expo 13

| id | terminal_no | hall | kind | active | manual_reg | badge_tpl | auto_checkin | created (IST) |
|---:|---|---|---|---|---|---:|---|---|
| 37 | T1 Visitor | Hall 1 | scanner | ✅ | true | **17** | true | 18 Aug 08:33 |
| 38 | T2 Exhibitor | Hall 1 | scanner | ✅ | true | 13 | true | 18 Aug 08:33 |
| 39 | T3 Speaker | Hall 1 | scanner | ✅ | true | 16 | true | 18 Aug 08:33 |
| 40 | T4 VIP | Hall 1 | scanner | ✅ | true | 15 | true | 18 Aug 08:33 |

All four created in the same minute — a batch setup.

### Created fresh or cloned? → **FRESH. The clone bug does not apply.**

`POST /api/terminals/clone/:id` (`routes/terminals.js:52-90`) omits **both**
`allow_manual_registration` **and** `kind` from its INSERT, so both fall to the DB default
(`true` / `'scanner'`). It also copies `hall` and `terminal_no` **verbatim** and forces
`is_active=false`.

**Decisive test — do any expo-13 `(terminal_no, hall)` pairs exist on another expo?**

| terminal_no | hall | same pair elsewhere |
|---|---|---:|
| T1 Visitor | Hall 1 | **0** |
| T2 Exhibitor | Hall 1 | **0** |
| T3 Speaker | Hall 1 | **0** |
| T4 VIP | Hall 1 | **0** |

A clone would necessarily match its source pair. None match → **all four were created via
`POST /api/terminals`, not cloned.** Their `is_active=true` corroborates this (clone forces false).

⚠️ **Worth recording beyond this check:** the clone endpoint silently drops `kind` as well as
`allow_manual_registration`. **Cloning a `bulk_print` terminal produces a `scanner`** — the
`dualAuth` gate (`kind='bulk_print'`) would then reject it with 403 WRONG_TERMINAL_KIND. Not a
problem here, but a live trap for anyone who clones a print terminal.

### 🟡 Item 10 — `allow_manual_registration` intent unverified

All four are `TRUE`. This is **not** the clone bug — but `POST /api/terminals` uses
`allow_manual_registration ?? true` (`routes/terminals.js`), so "explicitly set true" and "field
not sent at all" are indistinguishable in the data.

Expo 7 ran a **deliberate mix**: E1 `false`, V1 `true`, V1 `false`, Speaker `true`,
Conference `false`. That pattern says manual registration was restricted on purpose at some
gates in May. Expo 13's uniform TRUE may be intentional or may be the default nobody touched.

**Ask ops: should any expo-13 gate have manual registration OFF?**

---

## 2. Badge templates

`badge_templates` has **no `expo_id`** — templates are organizer-wide, selected per terminal.
Every expo-13 terminal has an assignment and all four resolve.

| terminal | tpl | name | visitor_type | **show_job_title** | show_company | show_qr | show_country |
|---|---:|---|---|---|---|---|---|
| T1 Visitor | **17** | **`test visitor 80x40`** | all | **FALSE** 🔴 | true | true | false |
| T2 Exhibitor | 13 | Exhibitor Badge Template | exhibitor | true ✅ | true | true | true |
| T3 Speaker | 16 | Speaker Badge Template | speaker | true ✅ | true | true | false |
| T4 VIP | 15 | VIP Badge Template | vip | false | true | true | false |

### 🔴 Item 6 — the primary visitor terminal is on a TEST template

Template **17 is named `test visitor 80x40`** and is assigned to T1 Visitor — the gate that will
serve **3,678 registered visitors**, the overwhelming majority of expo-13 traffic. Its name, its
`80x40` sizing and its `show_job_title=false` all read as a sizing experiment rather than a
production badge.

Available alternatives (organizer-wide):

| id | name | visitor_type | is_default | show_job_title |
|---:|---|---|---|---|
| 12 | Standard Badge Template | all | **true** | **true** |
| 14 | Horeca 2026 Visitor | all | false | true |
| 17 | test visitor 80x40 | all | false | false |

**Template 12 (`Standard Badge Template`, the organizer default, `show_job_title=true`) is the
obvious candidate** — but the physical badge stock size must be confirmed before switching, since
17's `80x40` may have been chosen to match the printer.

### 🔴 Item 7 — job titles will not print on visitor badges

`badge.html:368` renders the field only when `content.show_job_title === true`. Template 17 has it
**off**, so the **1,785 job titles recovered by the 18 Aug backfill will not appear on any visitor
badge.** Expo 13 now has **3,721 of 3,809 visitors (97.7%) with a populated `job_title`** — the
data is there and unused at the gate.

Exhibitor (13) and Speaker (16) badges do show it. VIP (15) does not, which is plausibly
deliberate.

**This is the direct pay-off of the backfill and it is currently switched off.**

---

## 3. Terminal keys

| check | result |
|---|---|
| Total terminals / distinct keys | 28 / **28** ✅ |
| Keys shared across terminals | **0** ✅ |
| Malformed or NULL keys | **0** ✅ |
| Expo-13 keys reusing a May (expo 7/8) key | **0** ✅ |
| Key format | 36-char UUID v4, all four |

Expo-13 key prefixes: `b3b32aae…` (37) · `29279c38…` (38) · `4399d46d…` (39) · `492e20c3…` (40).

### 🟡 Item 13 — May-fair keys: bulk-print revoked, scanners still live

| id | expo | terminal_no | kind | active |
|---:|---:|---|---|---|
| 29 | 7 | E1 | scanner | **true** |
| 30 | 7 | V1 | scanner | **true** |
| 31 | 7 | V1 | scanner | **true** |
| 32 | 7 | Speaker | scanner | **true** |
| 33 | 7 | BULKPRINT-1 | bulk_print | false ✅ |
| 35 | 7 | 1 (Conference) | scanner | **true** |
| 34 | 8 | BULKPRINT-WATER-1 | bulk_print | false ✅ |
| 36 | 8 | WE1 | scanner | **true** |

**Good news:** both `bulk_print` terminals — the two whose full UUIDs are in plaintext in
`CLAUDE.md` in the GitHub repo — are now **deactivated**. That closes the highest-severity item
from the 18 Aug discovery report.

**Still open:** six scanner keys from finished fairs remain active. Lower severity (a scanner key
grants check-in against a closed expo, not visitor-list read like `bulk_print` did), but they
serve no purpose.

---

## 4. Kind coverage — diff vs expo 7 baseline

Schema: `terminals.kind VARCHAR(20) DEFAULT 'scanner'`. Values in use across all 28 terminals:
**`scanner` (26)** and **`bulk_print` (2)**. No other kind exists in production.

| role | expo 7 (May, worked) | expo 13 (now) | verdict |
|---|---|---|---|
| Hall check-in scanners | 4 (E1, V1, V1, Speaker) | **4** (T1-T4) | 🟢 covered |
| **Conference scanner** | **1** — `kind=scanner`, hall `Conference`, tpl 16, manual_reg **false** | **none** | 🔴 **MISSING** |
| **Bulk print** | **1** — `kind=bulk_print`, hall `Bulk Print`, tpl 13 | **none** | 🔴 **MISSING** |
| **Total** | **6** | **4** | |

### 🔴 Item 8 — no conference terminal, and expo 13 has a conference programme

| signal | expo 13 |
|---|---:|
| `visitor_type='conference'` | **66** |
| visitors carrying a `conference_topic` | **81** |
| active conference form | **1** (form 55) |

The conference certificate flow (`conference-scanner.html` + `POST /api/conference-certificates/checkin-and-certify`)
authenticates with `x-terminal-key` and **requires a terminal on the expo**. With none present,
**conference check-in and certificate issuance cannot run.**

Expo 7's equivalent was a plain `kind=scanner` terminal in hall `Conference` with the Speaker
badge template and manual registration disabled — that is the shape to copy.

*(For scale: expo 7 had 1,428 conference registrants and issued only 2 certificates, so the
conference path was lightly used in May. 66 is smaller again — but "no terminal at all" means the
option does not exist, rather than being used lightly.)*

### 🔴 Item 9 — no bulk-print terminal

Expo 7 used one for `bulk-badge-print.html` (pre-printing badges in batches). Expo 13 has none.
If ops intends to pre-print, a `kind='bulk_print'` terminal must be created — and per the clone
note above, **it must be created fresh, not cloned**, or `kind` reverts to `scanner` and
`dualAuth` rejects it.

### 🟡 Item 11 — two terminals serve segments with zero registrants

| visitor_type | registered on expo 13 | dedicated terminal |
|---|---:|---|
| visitor | **3,678** | T1 |
| exhibitor | **134** | T2 |
| **speaker** | **0** | T3 |
| **vip** | **0** | T4 |
| conference | 66 | — 🔴 |

Half the gate capacity is pointed at segments with no registrants, while the one segment with 66
registrants has no terminal. Speakers and VIPs are often added late and on paper, so this may be
deliberate provisioning — worth confirming rather than assuming.

### 🟡 Item 12 — conference form exposes 1 topic

Form 55's `conference_topic` field carries a **single** option. Expo 7's form 39 had 13. If the
programme has more sessions, the form needs them before the conference terminal is useful —
certificates are issued per topic.

---

## 5. Check-in wiring — verified live

`GET /api/badge-templates/for-terminal/:terminalKey` called once per terminal (read-only; **no
check-ins created**):

| terminal | HTTP | expo resolved | kind | manualReg | template resolved |
|---|---|---:|---|---|---|
| 37 T1 Visitor | ✅ | 13 | scanner | true | `test visitor 80x40` |
| 38 T2 Exhibitor | ✅ | 13 | scanner | true | Exhibitor Badge Template |
| 39 T3 Speaker | ✅ | 13 | scanner | true | Speaker Badge Template |
| 40 T4 VIP | ✅ | 13 | scanner | true | VIP Badge Template |

**All four resolve correctly** — key → terminal → expo 13 → badge template. The wiring is sound;
the problem is *which* template T1 points at, not whether the lookup works.

Expo 13 currently has **4 check-ins** (test traffic).

---

## PUNCH LIST FOR OPS

**Before opening day — blocking:**

1. **Reassign T1 Visitor's badge template** off `test visitor 80x40` (17). Confirm physical badge
   stock size first; template 12 `Standard Badge Template` is the default and has
   `show_job_title=true`.
2. **Turn on `show_job_title`** for whichever visitor template is used — 97.7% of expo-13 visitors
   now have a job title and it will not print otherwise.
3. **Create a conference terminal** — `kind=scanner`, hall `Conference`, speaker/conference badge
   template, manual registration off (expo 7's shape). Without it there is no conference check-in
   or certificate path.

**Decisions needed:**

4. Bulk-print terminal — needed for expo 13? If yes, **create fresh, never clone** (clone drops `kind`).
5. Should any gate have `allow_manual_registration` OFF? All four are currently ON; May used a mix.
6. Are T3 Speaker and T4 VIP intentional given 0 registrants in both segments?
7. Conference form 55 has only 1 topic option — is the programme complete?
8. Deactivate the 6 remaining active scanner keys from the finished May fairs (expos 7/8).

**Verified good, no action:** terminals exist and are active · created fresh, clone bug not
applicable · keys unique with no May reuse · `for-terminal` resolves for all four · both
`bulk_print` keys from May already revoked.
