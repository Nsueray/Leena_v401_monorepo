# MP26 Friday Night — full state
**Taken:** 2026-08-21 23:15 Istanbul / 21:15 Lagos · **Fair opens Tue 25 Aug (3 days).**
Read-only except the template edits and campaign build recorded below.

Prior: `FRIDAY_STATUS_20260821.md` (11:54 today) → **this**.

---

## 1. The `"Dear ,"` incident — diagnosis

Ops replaced #56/#58/#59 with short designs saved with a **bare `{{first_name}}`**. A
template-page test rendered subject `"Ay, Doors open tomorrow…"` but body `"Dear ,"`.

**Mechanism.** `processEmailTemplate` (`utils/email.js:12-23`) serves **both** renderers. Its
lookup is `if (data[part]) return data[part]` — truthy. A bare token against an empty value
yields **empty string**; there is no per-token default. The subject already used the fallback
chain and slid to the next non-empty field (a surname, "Ay"); the body had nothing to fall back
to. **Same data, two token forms, two outcomes.**

**Fix applied 14:12:50** — chain substituted into #56/#58/#59 via `PUT /api/email-templates/:id`,
+28 bytes each, nothing else touched.

⚠️ Side effect: the chain supplies its own salutation, so those templates now open
`Ololade,` rather than `Dear Ololade,`.

---

## 2. Forensic verification — every live send

**MEASURED 23:11 — 96,227 sent bodies still resident in `email_queue`:**

| campaign | step | tpl | sent | body fallback | body broken | `{{}}` in body | subject defects |
|---|---|---|---:|---:|---:|---:|---:|
| 16 | 1 | 54 | 14,941 | 0 | 0 | 0 | 0 |
| 16 | 2 | 55 | 14,649 | 0 | 0 | 0 | 0 |
| 17 | 1 | 57 | 26,262 | 0 | 0 | 0 | 0 |
| 17 | 2 | 58 | 26,148 | 0 | 0 | 0 | 0 |
| 18 | 1 | 61 | 14,227 | 0 | 0 | 0 | 0 |
| **total** | | | **96,227** | **0** | **0** | **0** | **0** |

**100% real name. Nothing broken has ever reached a recipient.** Verified twice, by two
independent methods (regex capture; then literal substring match on `Dear ,`, `Dear  ,`, `{{`,
`}}`, subjects starting with `,`), on two separate days.

### ⚠️ Correction — the "77% / 23%" figure is not supported

A split of *77% real name / 23% "Dear Visitor" fallback* was reported during this sprint.
**Both forensic scans return zero fallbacks.** The fallback path has never fired in a live send,
because every recipient in every campaign has a populated `first_name`.

Probable origin: a UI statistic with a different definition, or the template-page test send —
which is **not** stored in `email_queue` and therefore not part of this corpus. **Do not
propagate 77/23.**

---

## 3. Template timeline, 21 Aug

| time (IST) | event |
|---|---|
| 13:34 | #60 "Test 1" / #61 "Test 2" saved — bare `{{first_name}}` |
| **14:12:50** | **chain applied to #56/#58/#59** |
| 17:54 | #61 → "Activate Badge Last Call", #62 → "Register Now Last Call" — chain ✅, **dead `{{unsubscribe_url}}` anchors reintroduced** |
| ~22:50 | **anchors unwrapped again** in #61/#62 |
| 23:07:31 | **C18 activated** |

**The unsubscribe anchor has been removed twice** — #54-#59 on 18 Aug, #61/#62 tonight. It
returns whenever a template is authored fresh in the UI: `{{unsubscribe_url}}` looks like a
valid placeholder but **cannot be filled in campaign mode** (G7). Expect it to reappear.

### Current template state

| # | greeting | CTA | `{{unsubscribe_url}}` | role |
|---|---|---|---|---|
| 54 / 55 | plain (harmless — already sent) | `{{activation_url}}` | none | C16 steps 1-2, sent |
| **56** | **chain ✅** | `{{activation_url}}` | none | **C16 step 3 — Monday** |
| 57 | plain (already sent) | form-53 | none | C17 step 1, sent |
| 58 | chain ✅ | form-53 | none | C17 step 2, sent |
| **59** | **chain ✅** | form-53 | none | **C17 step 3 — Monday** |
| **61** | chain ✅ *(as `Dear {{chain}}` — see G20)* | `{{activation_url}}` | **removed ✅** | C18, sent |
| **62** | chain ✅ *(same caveat)* | form-53 | **removed ✅** | C19, held |

---

## 4. Campaigns

| id | name | status | recipients | tpl | next fire |
|---|---|---|---:|---|---|
| 16 | MP26 Activate Wave | active | 14,941 | 54,55,**56** | **Mon 24 07:52 Lagos** |
| 17 | MP26 Register Wave | active | 26,262 | 57,58,**59** | **Mon 24 08:15 Lagos** |
| **18** | **MP26 Final Activate Push** | **completed** | **14,229** | **61** | — |
| 19 | MP26 Final Register Push | **draft — HELD** | 25,844 | 62 | — |

### C18 — activated 23:07:31

- 14,227 enqueued in **3 m 17 s** (23:07:33 → 23:10:50), drained at ~252/min
- All 14,229 `activation_url`s resolved to **live `pending` tokens**
- **79 recipients removed** before activation — they had converted since the afternoon build
- 5 rendered samples verified: `Dear Ololade,` `Dear Idris,` `Dear Aminu,` `Dear Ikeoluwa,`
  `Dear Olawale,` — each with its own token CTA, no `href=""`, no leftover `{{ }}`

### C19 — held deliberately

26k people who have ignored two emails, converting at **0.67%** against C16's **3.41%**.
Sending Friday night would add ~26k sends when sender reputation matters most, for the weakest
expected return, to people **Monday's step 3 already reaches**. Decision: **Saturday noon.**

---

## 5. Monday

Step 3 fires **07:52 Lagos (C16) / 08:15 (C17)** with #56/#59 — both chain-greeted and
render-proofed on real recipients.

**`dedbcd0` is what prevents a double-mail from C18 conversions.** A C18 activation writes its
`registered` event against **campaign 18's** `recipient_id`, so check (a) — the campaign event —
cannot see it from campaign 16. It is caught by check (b) `lower(v.email)` on the visitor row
and check (c) `rt.email` on the activated token, both email-matched and campaign-agnostic.

## 6. Numbers at 23:15

| metric | value |
|---|---:|
| Expo 13 visitors | **5,637** |
| Reactivation tokens activated | 912 |
| C16 registered (campaign-attributed) | 530 |
| C17 registered | 193 |
| Registrations last 24 h | 743 (zoho 600 · public 81 · reactivation 62) |
| Worker rate | ~252/min |
| Queue failed / stuck | 0 / 0 |

## 7. Open before Tuesday

**All three remaining risks are gate readiness, none are campaign:**

1. 🔴 T1 Visitor still on badge template `test visitor 80x40`
2. 🔴 `show_job_title` off — 5,097+ job titles will not print
3. 🔴 No conference terminal — 85+ conference registrants have no check-in or certificate path

Plus one decision: **C19 go/no-go, Saturday noon.**
