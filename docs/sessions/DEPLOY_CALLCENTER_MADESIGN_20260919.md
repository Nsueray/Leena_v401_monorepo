# Call-Center — Madesign (expo 18) alongside LIVE SIEMA (expo 9)

**Date:** 19 Sep 2026 (Saturday daytime push, authorised by Suer — not a
campaign send day, not a fair day, G42 satisfied; SIEMA cohort notified).
**Commits:** `5496c3a` (per-expo settings + `?expo=` scoping + report phase 1)
and `708a531` (form-public prefill + Register-now params), on top of `669a2aa`.
**Discovery pass:** 16 Sep, same session — this doc records what shipped.

⚠️ Point-in-time record. True as of the timestamp; never updated afterwards.

---

## 1. Scope

| File | Change |
|---|---|
| `routes/callcenter.js` | `EXPO_SETTINGS` map; `?expo=` resolution + scoping; `GET /expo-meta`; per-expo resend; segment-C resend |
| `utils/callCenterReport.js` | Phase 1 — all 4 queries pinned to expo 9 |
| `public/callcenter/agent.html` | `?expo=`, meta-driven texts/label, C-resend button, register link from server |
| `public/callcenter/supervisor.html`, `admin.html` | `?expo=` pass-through + relabel |
| `public/form-public.html` | URL prefill by field name (commit 2) |

`email_worker.js` is **not** touched in this push. It `require`s
`utils/callCenterReport.js`, so the worker service picks up the expo-9 report
filter on its own deploy of this commit.

### EXPO_SETTINGS (routes/callcenter.js)

| | expo 9 — SIEMA | expo 18 — MADESIGN |
|---|---|---|
| activate template (segment A resend) | 74 | 90 |
| C resend template | `null` → 400 `RESEND_WRONG_SEGMENT` | 93 (Mode 1) |
| register form | 59 | 64 |
| attendance ("came in 2025") | `checkins` on expo 1 | `visitors` on expo 19, `source='madesign2025_checkin'` |
| campaigns (mail-status strip) | A→78, C→79 | A→80, C→81 |
| agent-card texts | `null` → agent.html's own I18N | EN/FR/TR in the settings map |

Expo 19 has **zero `checkins` rows** — Madesign 2025 attendance exists only as
the `visitors.source` tag (1,427 rows, measured 16 Sep). Hence the second
attendance kind rather than a reused query. Measured 4.8 ms
(`idx_visitors_expo_id`, 4,158 rows on expo 19).

### `?expo=` (allowlist {9, 18}, absent → 9, otherwise 400 `INVALID_EXPO`)

Scopes `/next` (claim pool, remaining count, stuck-claim reaper), `/stats/me`,
`/stats/live` (cache key gains the expo), `/stats/agent/:name`, `/admin/dump`.
`/outcome`, `/skip` and `/resend` stay id-addressed and read the lead's own
`expo_id`. `/next` responses gain `register_form_id`, `expo_label`,
`c_resend_enabled` — additive; no client hardcodes a form id any more.

### `GET /expo-meta?expo=` (unauthenticated)

Serves label + `register_form_id` + `c_resend_enabled` + agent-card texts.
Unauthenticated because the agent/supervisor **splash renders before any key
is entered** and must not say SIEMA on a Madesign link. Payload is display-only
(fair name, public form id, call scripts) — no counts, no lead data. Pages
fail closed: if meta can't be loaded for a `?expo=` link, the page renders
"Unknown or unreachable expo" instead of falling back to SIEMA texts.

### New resend guards

`RESEND_EXPO_NOT_CONFIGURED` (lead on an expo with no settings) and
`RESEND_TOKEN_EXPO_MISMATCH` (token targets a different expo than the lead).
Both measured 0 rows on 16 Sep. Segment-C resend additionally refuses
unsubscribed recipients (`email_unsubscribes`, same predicate as
`email_worker.js:635`) — Mode 1 rows bypass the worker's send-time check, and
segment C is the coldest list.

---

## 2. SIEMA-equivalence evidence (measured 16 Sep, read-only production)

The SQL text changed for expo 9 (every query gained `expo_id = 9`); the
**results** did not, because all 33,635 leads were expo 9 at build time.

| Evidence | Result |
|---|---|
| 29 old-vs-new read comparisons: `/stats/live` ×5 queries × 3 windows, `/stats/me` pool, `/next` remaining ×4 segments, per-agent outcomes ×8 agents, whole-table md5 vs expo-9 md5 | identical |
| `buildDailyReport()` old vs new against production | subject + HTML byte-identical |
| `agent.html` HEAD vs new in a stubbed-DOM harness, no `?expo=` | `t()` identical across 252 key×lang pairs; segment-A cards byte-identical; B/C identical outside the Register-now href |
| `form-public.html` HEAD vs new, 10 field types × 4 URL shapes (no params, `?id=` only, `_lc`, `utm_source`) | byte-identical |
| `npm test` | exit 0, 0 failures |

Behaviour that **does** change for SIEMA: Register-now for segments B/C now
carries prefill params (commit 2, deliberate — flagged in that commit message),
and `/admin/dump` without `?expo=` returns expo 9 only (it returned the whole
table, which was the same rows until Madesign is imported).

---

## 3. Smoke constraints

Full plan is in the `5496c3a` commit message. Two hard constraints:

1. **The expo-9 smoke lead is inserted as `status='claimed'`.** The expo-9
   reaper returns any claim older than 30 min to the LIVE SIEMA pool, so the
   checks and the cleanup must finish inside 30 minutes.
2. **Run the smoke before the Madesign xlsx import**, or the expo-18 pool
   assertions (`pool.total = 2`) do not hold.

Cleanup per G44: `DELETE FROM callcenter_leads WHERE source = '<TAG>'
RETURNING id, expo_id, segment, status;` with a per-session tag
`cc_smoke_YYYYMMDD_HHMM`. The segment-C smoke `email_queue` row stays as the
audit trail.

Smoke inserts are writes → Render Shell, Suer only (CLAUDE.md DB rule).

---

## 4. Decisions recorded (Suer, 19 Sep)

- **No segment B for Madesign.** The import covers sheets `A_activate` and
  `C_register` only. Any other sheet name is ignored by `/admin/import`
  (`SHEET_TO_SEGMENT`), so a B sheet cannot arrive by accident. Madesign B
  texts exist in the settings map as a safety net only.
- **Hold-outs are excluded from the call pool** — they are not part of the
  import file, so no call-center row is ever created for them. Nothing in the
  code filters them; the exclusion lives in the xlsx.
- **`CALLCENTER_AGENTS` is not updated yet** — it waits for Meriem's agent list
  covering both fairs. Both fairs share `CALLCENTER_KEY` and the same
  allowlist; if the allowlist is set and a Madesign agent is missing from it,
  that agent gets 400 `AGENT_NOT_ALLOWED`. Editing the env var restarts the
  web service (G3/G43 cost).
- **Madesign FR call scripts** are Suer's text verbatim. EN/TR mirrors, the
  pill labels, the WhatsApp one-liners and the segment-B drafts were written
  in-session and are **pending Meriem's review**.

---

## 5. Open items

- **Report phase 2** — a Madesign daily report with its own subject prefix and
  a per-expo worker probe. Until then, expo-18 call activity appears in **no**
  daily report. The SIEMA report keeps the exact subject
  `SIEMA Call-Center — %`, so the worker's 20 h probe is unaffected.
- **Madesign export** requires `admin.html?expo=18`; the no-param export is
  expo 9. The client-side download filename does not carry the expo tag (the
  server-side name does).
- **`/admin/import` expo field** is seeded from `localStorage.selectedExpoId`.
  Read the expo id on the dry-run panel before confirming the Madesign file.
- **G4 recurrence on push day:** the read-only Postgres URL was unreachable
  from the Mac on 19 Sep (`SSL connection has been closed unexpectedly`) while
  `leena.app/health` answered 200 in 0.57 s — Render inbound IP rule, not an
  outage. It blocked the pre-push queue check and all DB-side smoke evidence.
