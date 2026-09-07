# DEPLOY — Call-Center module (7 Sep 2026)

> Single-day build of an isolated call-center dialer for the SIEMA 33,635-lead follow-up.
> 5 commits, 3 pages, 10 API endpoints, 2 middlewares, 2 migrations. One existing file
> touched (`index.js` +2 mount lines).

---

## 1. What the module is

Part-time agents (Morocco + Nigeria) call SIEMA leads from their phones. One card at a time,
tel: link, outcome buttons, WhatsApp/Copy/Resend/Register actions. Suer and a supervisor
watch live without a Leena login.

Three surfaces:

| Page | Auth | Purpose |
|---|---|---|
| `/callcenter/agent.html` | `x-callcenter-key` + `?agent=` (splash-cached in sessionStorage) | Mobile-first single-card interface. EN / FR / TR toggle, default FR. |
| `/callcenter/supervisor.html` | `x-callcenter-supervisor-key` (splash-cached) | Read-only live dashboard, auto-refresh 30 s. |
| `/callcenter/admin.html` | JWT (Leena admin session) + supervisor key for `/stats/live` | Same as supervisor + Export xlsx + Send report now + xlsx bulk import. |

## 2. DB — one new table + two indexes

**Migration 030 — `callcenter_leads`.** 18 columns, 5 indexes (pkey + `pool`, `callback`,
`email_expo`, `agent`). No FKs — matches the wizard's excel-lead pattern where `visitor_id`
is deliberately NULL on cold contacts. Segment CHECK (`A|B|C`), status CHECK
(`new|claimed|done|callback|skipped`), outcome CHECK union of 8 codes across all segments
(segment-B UI shows a reduced 5-outcome subset but reuses codes so the catalog stays flat).

**Migration 031 — two partial indexes on `email_queue`:**
- `idx_queue_campaign_email` (campaign_id, lower(recipient_email)) WHERE campaign_id IS NOT NULL — A/C mail-status lookup
- `idx_queue_expo_email_txn` (expo_id, lower(recipient_email)) WHERE campaign_id IS NULL — B badge-mail lookup

Both `CREATE INDEX CONCURRENTLY IF NOT EXISTS` — non-blocking, apply with `psql -a -f`
outside a transaction.

## 3. Endpoints — 10 total (`routes/callcenter.js`, ~1,160 lines)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/callcenter/health` | none | Unauth probe — reports stage `3b` + endpoint list |
| POST | `/api/callcenter/next` | agent | Atomic claim `FOR UPDATE SKIP LOCKED`, random ordering, segment filter, stuck-claim reaper (30-min TTL), `registered_meanwhile` auto-close up to 10 attempts. Segment A gets `attended_2025` from checkins on expo 1. Stage 3b adds `mail_sent_at` / `mail_status` / `opened_at` / `clicked_at` / `badge_mail_sent_at`. |
| POST | `/api/callcenter/skip/:id` | agent | Release claim (409 if not owned) |
| POST | `/api/callcenter/outcome/:id` | agent | Record outcome + optional 5-field patch (dynamic UPDATE with param whitelist; 409 if not owned) |
| POST | `/api/callcenter/resend/:id` | agent | Segment A only. Mode 1 `email_queue` INSERT reusing template 74. Sends to `reactivation_tokens.email` (never a patched lead email — Stage 4b fix). 2-min per-recipient cooldown keyed on the token's email. |
| GET | `/api/callcenter/stats/me` | agent | Today's calls + per-outcome + pool remaining |
| GET | `/api/callcenter/stats/live` | supervisor | Per-agent table + outcome bars + hourly + last 20 + registered-after-call + checked-in. **15-second module-scope cache**, busted on every write. |
| GET | `/api/callcenter/stats/agent/:name` | supervisor | Drill-down: last 100 calls + today's outcomes |
| GET | `/api/callcenter/admin/dump` | JWT | Full-table xlsx export (excludes `reactivation_token`) |
| POST | `/api/callcenter/admin/import` | JWT + multipart | Two-step (dry_run then confirm). Sheets accepted: `A_activate` / `B_registered` / `C_register`. Dedupe on `(expo_id, phone-digit-key)`. Segment A rows fetch `reactivation_token` via bulk email + `target_expo_id` lookup. Source column = original filename. |
| POST | `/api/callcenter/report/send-now` | JWT | Daily HTML report. `CALLCENTER_REPORT_TO` env var supports comma-separated list — one `email_queue` Mode 1 row per address, response body's `to` is an array. |

## 4. Env vars — all on the `Leena_v401` web service (NOT worker per G34)

| Var | Purpose | Format |
|---|---|---|
| `CALLCENTER_KEY` | Agent access key | long random string |
| `CALLCENTER_SUPERVISOR_KEY` | Supervisor access key (read-only endpoints) | long random string |
| `CALLCENTER_REPORT_TO` | Daily report recipients | comma-separated emails (Stage 3: single-address; Stage 4b: multi) |
| `CALLCENTER_AGENTS` | **Optional** allowlist of agent names (Stage 4d) | comma-separated. When set, unknown names return 400 `AGENT_NOT_ALLOWED`. When unset/blank, any valid name passes. |

## 5. Migrations — Suer's run order

```bash
# Migration 030 — new table (idempotent, inside psql tx)
psql "$DATABASE_INTERNAL_URL" -f backend/leena-v401-backend/migrations/030_callcenter_leads.sql

# Migration 031 — CONCURRENTLY indexes on email_queue (must be outside tx; -a echoes each stmt)
psql "$DATABASE_INTERNAL_URL" -a -f backend/leena-v401-backend/migrations/031_callcenter_email_queue_indexes.sql

# Verify
psql "$DATABASE_INTERNAL_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='email_queue' ORDER BY 1;"
# Expect 4 rows: email_queue_pkey, idx_queue_campaign, idx_queue_campaign_email, idx_queue_expo_email_txn
```

## 6. Smoke — expo 17, 5 fake leads

Suer's 5-lead smoke on expo 17 (`source='cc_smoke_20260907'`) covered: splash auth, concurrent
claim under `FOR UPDATE SKIP LOCKED`, skip-back-to-pool, outcome + inline data-fix,
callback snooze, auto-close on `registered_meanwhile`, per-token Resend + `email_queue` Mode 1
verification, supervisor auto-refresh, admin report send, full cleanup. All 11 steps passed
before touching production expo 9.

## 7. The "smoke rows gone" investigation

Around midday Suer noticed the 5 smoke rows (ids 1-5) were missing. Read-only investigation:

- `pg_stat_user_tables.n_tup_del = 5` — exactly the smoke row count, single targeted delete
- `n_tup_ins = 33,640` = 5 smoke + 33,635 imported (real)
- Current lowest id = 6 — sequence not reset, table not recreated
- All 5 named indexes intact
- **Zero `DELETE FROM callcenter_leads` in the repo** (routes/migrations/scripts/tests grep)
- No startup path re-runs migrations (index.js has no migration runner; `initial.sql` has zero references to callcenter_leads)
- No `render.yaml`, no Procfile, no `postinstall`
- My credentials (`claude_readonly`) have SELECT-only privilege on this table — verified via `information_schema.role_table_grants`

**Verdict: the cleanup SQL from the design doc (`DELETE FROM callcenter_leads WHERE source='cc_smoke_20260907'`) ran once and removed all 5 rows.** Suer's *"returned 0"* was a second run of the same SQL. No app-side deletion, no deploy-wipe risk. Real import safe.

**Preventive lesson → CLAUDE.md G44:** smoke cleanup SQL should use `DELETE ... RETURNING id` (surface removed ids) + per-session source tag (`cc_smoke_YYYYMMDD_HHMM`) so repeat-runs can't accidentally match anything unrelated.

## 8. Real import — the 33,635 SIEMA leads

Import ran ~11:38:57 UTC from `SIEMA26_callcenter_20260907.xlsx` (the dump from 4 Sep):

| Segment | Rows | Notes |
|---|---:|---|
| **A** (Leena Registered — Re-activation) | **15,016** | Each row gets `reactivation_token` via bulk lookup on `reactivation_tokens (email, target_expo_id=9)` |
| **B** (Registered for 2026) | **2,727** | Already-registered warm calls; no token needed |
| **C** (Cold register) | **15,892** | Register wave — no token, agent uses "Register now" (form 59) |
| **Total** | **33,635** | matches import xlsx exactly |

`callcenter_leads.source = 'SIEMA26_callcenter_20260907.xlsx'` on every row.

## 9. Yaprak's smoke + the 4c / 4d fixes

Yaprak agent-tested with the 5 smoke rows before the real import. Two issues surfaced:

**Bug 1 — Resend on a token-less lead dropped to splash.**
Cause: `ccFetch` in `agent.html` treated any `400` as an auth failure and cleared
sessionStorage → splash. Resend on a lead without `reactivation_token` (the smoke rows had
NULL) legitimately returns `400 RESEND_NO_TOKEN`, which then logged Yaprak out. **Fix (Stage
4c-a):** narrowed the sessionStorage-clearing branch to `401` (bad key) + `503` (env unset).
Everything else (400/404/409/429/500) returns the Response so the caller's existing
`else { toast(j.error) }` branch shows the server's message and keeps the card. Every
caller already had that fallback. **New G45:** *"a page that treats 400 as auth error logs
users out — only 401/503 may clear credentials."*

**Bug 2 — Segment pill copy was cryptic.** Yaprak read *"A · Activate"* and had to look up
what that meant. **Fix (Stage 4c-b):** plain-language `pill_A/B/C` keys, EN/FR/TR:
- A: *"Had a badge in 2025 — activate"* / *"Avait un badge en 2025 — à activer"* / *"2025'te rozeti vardı — aktive edilecek"*
- B: *"Registered for 2026"* / *"Inscrit pour 2026"* / *"2026'ya kayıtlı"*
- C: *"Not registered yet"* / *"Pas encore inscrit"* / *"Henüz kayıtsız"*

**Stage 4c-c** — one-line hint under every action button (5 hints × 3 langs). Fix-data
hint shown inline with the summary so it's visible before the section is expanded.

**Stage 4d** (later, single push with the last_name fix in the evening): normalise the agent
name (`trim → collapse whitespace → uppercase`, locale-independent) at every entry point, plus
an optional `CALLCENTER_AGENTS` env var (comma-separated allowlist). When set + name not
listed → `400 AGENT_NOT_ALLOWED` with a new EN/FR/TR splash toast *"Your name is not on the
list — ask your supervisor"*. Splash input uppercases on type. 8-case middleware unit test
passing.

## 10. What's still open

- **Daily report cron** (design R9 minimum): manual admin button lands the report in
  `email_queue`; scheduled 19:00 Casablanca requires an external cron (Render Cron / GitHub
  Action / Suer's cron) hitting `POST /report/send-now`. Not wired yet.
- **Form-public prefill (Stage 6)**: Register-now still opens a blank form 59. Adding
  URL-param prefill to `form-public.html`'s `renderField()` is ~8 lines but touches
  live-traffic code — deferred to post-fair.
- **`registered_meanwhile` stats audit**: the `/next` auto-close appends `note` but doesn't
  emit a separate metric for supervisor visibility. Need to confirm the supervisor's
  "Reg. after" column counts these correctly vs. proper agent-driven `registered_meanwhile`
  outcomes.
- **Stats "Registered" audit**: the campaign detail page's "Registered" funnel count (from
  `campaign_events`) may not match the raw `reactivation_tokens.status='activated'` count.
  Compare after tomorrow's send window to confirm parity or characterise the drift.

## 11. Commit log (this module, chronological)

| Time (IST) | Commit | Stage |
|---|---|---|
| 12:22 | `8f47e3d` | 2+3+4 — table + auth + routes + 3 pages |
| 12:47 | `c161a32` | 4b — TR strings + FR default + resend uses token email |
| 13:58 | `a403d2f` | 4c (agent fixes) + 5 (admin import) |
| 17:11 | `1f8692a` | 4d — agent name normalisation + optional allowlist |

Not covered here: `a9a44fd` (17:11, same push) is the `last_name required` fix — separate deploy
doc `DEPLOY_LAST_NAME_REQUIRED_20260907.md`.
