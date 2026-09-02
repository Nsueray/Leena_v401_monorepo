# Leena EMS — TODO & Roadmap

> Son güncelleme: **31 Ağustos 2026, fuar-sonrası gün 4** (önceki: 28 Ağustos)
> Aktif modül: Leena EMS Core + Email Campaigns + Visitor Management + Segments
> Admin panel: masaüstü/laptop kullanılıyor (mobil öncelik düşük)

---

## 🔴 TODAY — 28 Aug (post-fair, top of stack)

| owner | item |
|---|---|
| **OPS** | **Conference cert catch-up — ~340 attended conference-topic-holders on expo 13 still uncertified.** Mailmerge query in `docs/sessions/FAIR_FINAL_20260827.md` §5. Bulk-issue via `POST /api/conference-certificates/…` per row or via `email_queue` Mode 1 with pre-generated cert URLs. |
| **SUER** | **PIXAD brief update** — Friday's budget-math call. Feeds off `FAIR_FINAL_20260827.md` §3 SIEMA table (Pixad = 4,857 registered / 570 attended / **11.74%** show rate; contrast public_form 78%, Email Marketing 29%). |

## 📋 POST-FAIR — priorities refreshed 28 Aug

| # | item | pri | note |
|---|---|---|---|
| ~~0~~ | ~~**RUN `tests/test_activate_phone_smoke.js` TODAY**~~ | ~~P1 BLOCKER~~ | **DONE 2 Sep** — job 36. Row 4 stored `+905321234567` with `custom_fields=NULL`; row 3 stored `''` with `custom_fields={phone_raw:"12ab", phone_reject_reason:"invalid phone number for country NG: \"12ab\"", phone_rejected_at:"2026-09-02T11:04:20.088Z"}`. Cleanup ran (email_queue + tokens + visitors, 0\|0\|0). A-1 fail-open + JSONB trace verified live. Recorded in `docs/sessions/DEPLOY_PHONE_NORMALISATION_20260902.md` §B-6. |
| ~~1~~ | ~~**Campaign wizard (Phase 2)**~~ | ~~P1~~ | **DONE 2 Sep** — 6 commits `e07ac0f` → `8740dd7`. G1–G4 + bare-{{name}} severity split + mailable-formula fix. Third tab in `reactivation-campaign.html` with 5 panels (Source → Preview → Templates → Confirm → Build), four `/api/campaigns/reactivation/*` endpoints, silent-mode + draft-only invariants, wave-aware template validation. Verified: 18/18 validator unit tests, wire smoke passes (STEP 6 = regression guard for the mailable bug), Suer live click-through on expo 17 (job #40, preview run 1 shows `tokens to mint=5`, run 2 shows `tokens to mint=0` — the 2 Sep mailable bug confirmed fixed in browser). Full narrative + known gaps + operator notes for Yaprak in `docs/sessions/DEPLOY_CAMPAIGN_WIZARD_20260902.md`. |
| 2 | **App-log surface for Claude Code diagnostics** | **P1** | **New — surfaced by v4.0.11 segment-forensics.** Either ship Render logs to a Claude-readable sink, wire `LOG_LEVEL=debug` to `console.log` at each POST handler entry/exit, or add a lightweight `logs/access.log` on the Render disk. G26. **Diagnosis without app logs costs ~2 h that a 5-minute grep would replace** — the M1-M4 failure reconstruction is the reference case. |
| 3 | **Wire segment smoke test into CI** | **P1** | **New — file exists at `backend/leena-v401-backend/tests/test_email_segments_smoke.js`.** Runs 10 k-recipient `/send`, asserts response <5 s + Mode 2 shape. Add to `npm test`; run on every PR touching `routes/emailSegments.js`, `email_worker.js`, or `utils/email.js`. Needs `TEST_JWT`/`TEST_BASE_URL`/`DATABASE_URL` on staging service. Would have caught the Mode-1 regression on its own PR. |
| ~~4~~ | ~~**Import phone coercion**~~ | ~~P1~~ | **DONE 2 Sep** — libphonenumber-js Sep 2026 rewrite. Verified end-to-end on trash expo 17 with a previously-failed real agency file (`Meta Pixad 3.xlsx`, 261 rows). See CLOSED block below and `docs/sessions/DEPLOY_PHONE_NORMALISATION_20260902.md`. Public form + Zoho webhook Phase 2 is item #14. |
| 5 | **"Copy URL" per terminal purpose + param unification** | P1 | Button always emits `qrscanner.html?terminalKey=`. Make it purpose-aware **and** unify on `terminal_key` everywhere (`conference-scanner` uses `terminal_key`, `bulk-badge-print` uses `key`). See G22 |
| 6 | **`delivered_count` snapshot timing** | P1 | All campaign types, not just single-step. See G23 |
| 7 | **Certificate Templates admin page** | P1 | May's Option 3. Ends the hardcoded `expoId`-switch (v4.0.10) |
| ~~8~~ | ~~**Unsubscribe UI in visitor detail panel**~~ | ~~P1~~ | **DONE 31 Aug** — see CLOSED block below and `docs/sessions/DEPLOY_UNSUB_UI_20260831.md` |
| 9 | **Reply-to-unsubscribe automation** | P1 | (a) SendGrid Inbound Parse webhook → auto-insert `email_unsubscribes` with reason `reply_request`, OR (b) documented ops procedure. Bundle with G9 SendGrid bounce webhook. **NOTE:** the UI now covers the ops-procedure half — Yaprak can insert with `reply_request` reason via the visitor detail panel — but auto-insert on inbound reply is still open |
| 10 | **p95 response-time alarm on `/api/email-segments/send`** | **P2** | **New — surfaced by v4.0.11.** 30 s threshold would have alerted on Yaprak's first noshow_any attempt today. Extends naturally to `/api/email-send/bulk` and `/api/reactivation/create-from-excel`. |
| 11 | **Restore Claude Code's DB inbound-IP as standing item** | **P2** | **New — recurring G4.** WARP/VPN egress-IP drift blocked read-only DB access mid-segment-diagnosis; had to work analytically for 20 min. Standing checklist item at start of any prod-diagnosis session: `psql $RENDER_DATABASE_READONLY_URL -c 'SELECT 1'` — if it fails, refresh whitelist BEFORE touching anything else. |
| 12 | **Manual-reg form parity with form config** | P2 | Read required fields from `forms.fields`, kill silent `N/A`/`Nigeria` defaults |
| 13 | **Phone cleanup: 5,148 malformed `+CC0…` rows** | P2 | Trunk zero not stripped before country code; not dialable. **Corrected 2 Sep from earlier stale "840" figure — actual count measured across all expos: NG `+2340…` 3,142 + MA `+2120…` 900 + GH `+2330…` 813 + KE `+2540…` 2 + minor others. See IMPORT_PHONE_NORMALISATION_20260901.md §2. Dry-run SQL in §7 of the same doc; not run.** |
| 14 | **Phone normalise Phase 2 — public form + Zoho webhook** | P2 | Extend Sep-2026 normaliser to `routes/visitors.js:215` (public form submit) and `routes/webhook.js:57` (Zoho). Same fail-open behaviour as `/activate` (store `''`, don't reject the flow). **Do only after the import deploy has run clean for 1 week** — if the normaliser is wrong for a whole country, the import path can be rolled back; the public form is real-time visitor traffic where mistakes are more visible. |
| 15 | **Smart phone field on public forms — country selector + number, E.164 output** | P2 | `form-public.html:302-309` renders `tel` fields as plain text today; `form-builder.html:499` has the type wired but no interactive behaviour. Add a country-code selector alongside the number input so visitors don't have to hand-type `+234`. Backend `visitors.js:215` (public form submit) normalises with the selected country and fails open — no cross-reactivation with the import path. **Deploy AFTER 24 Sep** — `form-public.html` serves live SIEMA traffic and this touches the primary registration UI. |
| 16 | **Conference stats: exclude/flag test certificates** | P3 | Page reads 2 issued when both are smoke tests |
| 17 | **Import loop check order — phone before email** | P3 | `routes/visitors.js:712-732` runs the phone normaliser (and can reject the row) BEFORE the email-validity check at `:729`. Meta Pixad 3.xlsx smoke on 2 Sep exhibited it: row 204 has both a blank email AND `phone='telefon_numarası'` (a Turkish header inside the data); the row was reported as `Phone rejected: …` when email is the primary key and should have been flagged first. Cosmetic — the row still ends up in `results.errors` either way — but the message ops sees is misleading. Swap the two check blocks in a later pass. Noted 2 Sep; not urgent, no data loss. |
| 18 | **Persist `warnings` into `import_logs.errors` (or a new column) for History tab visibility** | P3 | `routes/visitors.js:1020-1031` "Save import log" INSERT writes only `results.errors`, so the phone-drop warnings introduced by Decision B (2 Sep) do NOT show up in the History tab for past imports. Options: (a) concatenate `errors + warnings` into the `errors` column and let the UI colour by prefix (`Phone rejected:` red, `phone dropped:` amber); (b) add a `warnings` JSONB column to `import_logs` (schema change). Live import UI shows warnings in real-time already — this is only about historical replay. Small write. |

### Carried, unchanged
- SendGrid bounce webhook → automated `email_unsubscribes` (G9: **zero** bounce visibility)
- Index `email_queue.campaign_recipient_id` (G18) · condition-based single-step campaigns (G19)
- Per-check-in print signal + a check-in undo path (no `DELETE /api/checkins/:id` exists at all)
- `expos.js:628` country stat reads the JSONB key, not the column (437 vs 7,249)
- `reports.js` bare `CURRENT_DATE` on a UTC session → "today" rolls at 01:00 Lagos
- Fix `Dear {{chain}}` double greeting in templates #61/#62 (G20)
- **P3 — `DELETE /api/email-templates/:id` returns 500 when the template is referenced by `campaign_steps`** (observed 2 Sep, probe template 70 during wizard smoke). Should be a 409 with a clear message naming the blocking campaigns, not a 500. Fix in `routes/emailTemplates.js` — catch pg `23503` (foreign_key_violation), SELECT campaign IDs + names via `campaign_steps` → `email_campaigns`, return `{success:false, error:'Template in use', blocking_campaigns:[{id,name,status}]}`.
- **P3 — remove the wizard's `c.tokens_to_mint` fallback in `reactivation-campaign.html`** (2 places: `wRenderPreview` around :1535, `wGoToConfirm` around :1693). The backend and HTML always ship together, so `c.tokens_to_mint` is guaranteed present — the `!= null` guards are dead code. Simplify on the next touch of that file.

## ✅ CLOSED — 2 Sep

- [x] **Campaign wizard (Phase 2)** (was P1 #1, SIEMA-blocking) — 6 commits `e07ac0f` → `8740dd7` shipped over the day: G1 `e07ac0f` segment preview + orchestrator skeleton + per-chunk error persist; G2 `a404558` full six-phase orchestrator + wave-aware `/validate-template` + Piece 5 truncation; `5962e1b` bare-`{{name}}` severity split (WARNING `BARE_NAME_FALLBACK`, not error — measured against `email_worker.js:570-572`, SIEMA templates 47/69/28 would otherwise have been blocked); G3 `081bb79` third tab in `reactivation-campaign.html` (5 panels, all vanilla JS, includes Fix (a) land-on-step-3 on `blocking_templates` and Fix (b) `loadExpos()→wInitTab()`); G4 `803fd4f` two test files (validator unit + wire smoke); `8740dd7` the mailable-formula fix. **The mailable bug is worth remembering**: `campaignBuilder.js:472` filtered `!_unsub && !_hasToken` — that's the mint-count formula, not the mailable formula. Preview reported `g2_activate_mailable=0` while `/build` planned 3, silently disabling the activate wave on any second run. Caught by Suer in the live browser click-through, not by the wire smoke (which ran on a clean slate). Fix: filter only `!_unsub` and add explicit `tokens_to_mint` counter to `/segment`'s `counts` (same name+formula as `/build`'s `:921` response). Regression guard: new STEP 6 in `test_wizard_silent.js` runs `/segment` twice on the same fixture and asserts `g2_activate_mailable=3, existing_pending_tokens_hit=3, tokens_to_mint=0` on the second run — the exact shape that broke. **Verified end-to-end 2 Sep**: 18/18 validator unit tests pass; wire smoke passes all 6 steps; Suer live browser click-through on expo 17 completed job #40 (5 recipients, 1 draft campaign — empty register wave correctly skipped by Phase 5 short-circuit; preview run 2 shows `tokens to mint=0` confirming the fix). Silent-mode invariant (0 `email_queue` rows on token mint, guarded at `reactivation.js:141`) verified in both automated and live paths. Draft-only invariant (`INSERT INTO email_campaigns` accepts DEFAULT `status='draft'`; no code path anywhere sets `'active'`) verified in DB post-job. Full narrative + known gaps (from-expo path unexercised, blocking-validation UI branch un-click-tested, wizard state in-memory, preview cache dies on deploy) + operator notes for Yaprak in `docs/sessions/DEPLOY_CAMPAIGN_WIZARD_20260902.md`.

- [x] **Import phone normalisation** (was P1 #4) — commit `2664ead` + smoke fix `14d7ff8` + reactivation smoke `2a1e48f`. libphonenumber-js@1.13.12 wired into 5 write sites (`visitors.js:712/788/884` + `reactivation.js:197/669`). New signature `normalizePhone(raw, defaultCountry) → {ok, e164, reason}`; legacy 1-arg preserved verbatim for `visitors.js:1076` export via arity dispatch. Wrapper rules: empty → `''` preserved (before the library, which returns undefined on `''`); trunk-zero retry (`/^\+\d{1,3}0\d{6,}$/` only, never blind); `00→+` E.123 fold; junk `/^x+$/i` → empty. Unfixable → row REJECTED in import + reactivation-excel with row# + raw + reason; `/activate` handler fails **OPEN** (stores `''`, still creates the visitor, writes reject trace into `custom_fields` JSONB atomically with the INSERT — A-1). Backfill of existing rows OUT OF SCOPE. Country resolution: `expos.country_code` populated for 14 / 17 expos (test expos 11 / 15 / 16 stay NULL). **Verified end-to-end 2 Sep**: two automated smoke tests (`test_phone_normalize.js` 42/42 pass; `test_import_phone_smoke.js` idempotent — Row 1 numeric cell → `+2348012345678`, Row 2 `xxxxxxxxxx` → empty preserved, Row 3 `12ab` → rejected with `Phone rejected: …`; `test_reactivation_phone_smoke.js` — 2 tokens created, 0 email_queue rows for silent mode, DB-asserted) + a real previously-failed agency file (`Meta Pixad 3.xlsx`, 261 rows, phone cell types int=259 / None=1 / str=1) re-run through `import.html` on expo 17: **`259 successful, 2 failed`** vs the 26 Aug baseline of `0 new, 145 errors` on the same file at expo 13. All 259 stored as `+234…` E.164, zero exceptions. Reactivation-UI 4th results-line ("Invalid Phone (Skipped) N (rows X, Y, Z)") verified by code review only — `reactivation-campaign.html:278` marks the template `required` so the UI cannot POST silent-mode today; the wizard closes that gap. Full narrative: `docs/sessions/DEPLOY_PHONE_NORMALISATION_20260902.md`.

## ✅ CLOSED — 31 Aug

- [x] **Unsubscribe UI in visitor detail panel** (was P1 #9) — `feat(unsub)` commit `34061f8`. New route file `routes/unsubscribes.js` (GET status / POST idempotent add + campaign_recipients deactivate / DELETE idempotent remove), all JWT-auth + organizer-scoped. Frontend button in visitorlog panel next to Send Email, toggles Unsubscribe (grey) ↔ Re-subscribe (green) with status line. Confirmation modal with reason dropdown (`manual_ops_added` / `reply_request` / other+free text). Ops no longer needs psql for individual opt-outs. Verified end-to-end via trash-expo click-through — see `docs/sessions/DEPLOY_UNSUB_UI_20260831.md`. First real use: Yaprak on `ggem603@gmail.com`.
- [x] **G4 recurrence noted** — second time in three days, DB access lost mid-verification. P2 #11 (standing DB IP allowlist check at session start) remains the fix.

## ✅ CLOSED — 28 Aug (segment incident, one arc)

- [x] **M1-M4 segment rewrite** shipped 27 Aug 22:16 UTC (`d1cebcf`) — `email_queue`-routed, preview modal, day-scoped targeting, ghost-columns fix. Bug: enqueued Mode 1 (pre-rendered HTML in queue row) which OOM'd `/send` at N=~8k
- [x] **First hotfix** (`5794e2a`, 28 Aug 12:24 UTC) — `NOT EXISTS`→`NOT IN`. Diagnosis was **wrong** (both forms measured ~9 ms via `EXPLAIN ANALYZE`). Falsified by post-hotfix retry at 12:45 UTC failing identically. Rewrite is functionally correct but not the actual fix
- [x] **Real fix** (`90e2999`, 28 Aug 13:26 UTC) — switched `/send` to Mode 2 enqueue. Payload per row 10 KB → 40 bytes, **165× reduction**. Request path now constant-size in recipient count. Beneficial side effect: worker's send-time unsubscribe recheck now applies to segment sends (Mode 1 bypassed it)
- [x] **End-to-end verification** via trash-expo click-through — preview modal → queue Mode 2 row → worker drain → correctly-rendered mail delivered → clean `email_logs`
- [x] **Regression test** committed at `backend/leena-v401-backend/tests/test_email_segments_smoke.js` (10 k recipients, response <5 s, Mode 2 shape assertions). **Not CI-wired yet** — item #3 above
- [x] **New Gotchas added:** G24 (never pre-render bulk email in request path), G25 (Network-error toast = fetch/parse throw, not HTTP status), G26 (diagnosis without app logs)
- [x] Full arc: `SEGMENT_FORENSICS_20260828.md` (reconstruction) + `DEPLOY_SEGMENT_HOTFIX_20260828.md` (the wrong-fix log, kept as evidence for the "EXPLAIN before optimizing" lesson)

---

## ✅ CLOSED — shipped Sunday night 24 Aug

- [x] **Fail-closed check-in** — badge popup gated on a confirmed check-in, red panel + Retry (`e900b70`)
- [x] **Auto Check-in switch removed** — was a silent kill switch; `terminals.auto_checkin` confirmed dead config
- [x] **Duplicate scans made visible** — yellow "Already checked in — reprinting badge"
- [x] **Terminal-key manual registration** — `dualAuth` factory, expo/organizer clamped from the terminal row, `visitor_type` allowlisted (`580dff1`)
- [x] **Popup `setTimeout` removed** — closed the popup-blocker hypothesis
- [x] **MP26 certificate installed** — `expoId`-switch, `MPN-2026-<token[0:10]>`, no pipe splitting, issue **and** resend switched (`3e14bf8`, `d06069e`, `668fd5c`)
- [x] **Bulk-print terminal 41** created and verified live (148-exhibitor pool)
- [x] **10 stuck `processing` emails** recovered — all sent 24 Aug 12:10

---

## ✅ Tamamlanan İşler

### 23 Şubat 2026
- [x] Exhibitor form → visitor_type fix (backend: visitors.js POST /public)
- [x] Mevcut exhibitor kayıtları DB'de düzeltildi (36 kayıt expo 5+6)
- [x] Participant ID Badge Registration kayıtları düzeltildi (3 kayıt)
- [x] Email templates expo bazlı gruplama + clone
- [x] Email templates UI: kompakt liste + İngilizce
- [x] Forms expo bazlı gruplama + cross-expo clone
- [x] email_templates tablosuna expo_id eklendi, mevcut template'ler expo'lara atandı
- [x] Form 23 (Nigeria webhook) expo_id NULL → expo 3 düzeltildi
- [x] Terminals expo gruplama + cross-expo clone
- [x] Forms istatistik kartları sadece mevcut expo'dan hesaplanıyor
- [x] Send Email QR bug fix (emailSend.js: existing visitor QR lookup + fallback)
- [x] Check-in export'a visitor_type + job_title eklendi (10 → 12 kolon)
- [x] Sidebar standardizasyonu (15 admin sayfa, 13 link, 5 section)
- [x] CLAUDE.md English-only language rule eklendi
- [x] Reports page enhanced (visitor_type, job_title, daily trend, hall, terminal charts)

### 24 Şubat 2026 — Security Hotfix (Sprint 1)
- [x] POST /api/visitors/manual: authMiddleware eklendi
- [x] Import route organizer_id: `req.user?.id` → `req.organizer_id` düzeltildi
- [x] Zoho webhook token: hardcoded → `process.env.ZOHO_WEBHOOK_TOKEN`
- [x] QR Scanner localStorage: `organizer_id` → `organizerId` düzeltildi
- [x] Badge endpoint PII: SELECT * → explicit columns (email/phone kaldırıldı)

### 24 Şubat 2026 — UX Consistency (Sprint 2)
- [x] Login redirect unified: tüm 14 admin sayfa → login.html
- [x] Active expo indicator: sidebar'da selectedExpoName gösterimi (14 sayfa)
- [x] Favicon eklendi (29 HTML dosyası)
- [x] Login.html Gen 4 modern UI ile değiştirildi
- [x] organizerId localStorage'a eklendi (Zoho webhook URL için)
- [x] Post-login redirect: main-panel-v2 → dashboard_new (expo selection)
- [x] "No expo selected" redirect düzeltildi (9 admin sayfa)
- [x] Public form upsert: duplicate registration + QR invalidation fix
- [x] Template placeholder fix: {{expo_name}} + {{date}} tüm 13 email akışına eklendi
- [x] emailSegments.js BASE_BADGE_URL localhost → leena.app
- [x] visitor_type standardized: "conference" type tüm 4 frontend sayfaya eklendi
- [x] email_worker transaction fix: FOR UPDATE SKIP LOCKED

### 25 Şubat 2026 — Navigation & Webhook Fixes
- [x] Custom field email placeholder fix: ...customFields spread in visitors.js POST /public
- [x] "All Expos" button fix: goToDashboard() self-loop → dashboard_new.html
- [x] Sidebar expo indicator: div → clickable `<a>` link (14 sayfa)
- [x] Webhook custom_fields: Zoho non-standard fields → custom_fields JSONB
- [x] Webhook visitor_type: forms table lookup when Zoho doesn't send it

### 26 Şubat 2026 — Import Enhancement (Sprint 5)
- [x] Import custom_fields extraction (knownColumns Set → custom_fields JSONB)
- [x] Import existing visitor email options (none/resent/first_time + template)
- [x] Import existing visitor QR options (keep/regenerate)
- [x] Import email template placeholders (...customFields spread)
- [x] import_logs table + GET /api/visitors/import-logs endpoint
- [x] Frontend import history (paginated table, color-coded stats)

### 26-27 Şubat 2026 — Visitors & Conference (Sprint 6)
- [x] Visitors page: conference_topic dropdown filter + Job Title/Topic columns
- [x] Export fix: window.location.href → fetch+blob (auth header support)
- [x] GET /api/visitors/export endpoint (Excel export ALL filtered visitors)
- [x] GET /api/visitors/conference-topics endpoint (topic counts + check-in data)
- [x] /paginated: conference_topic filter + computed column (not full JSONB)
- [x] conference-sessions.html: topic tracking, stats, targeted email/export
- [x] "Conferences" sidebar link added (14 admin pages, total 14 sidebar links)
- [x] email-send.html: conference_topic URL param auto-populates recipients
- [x] email-history.html: paginated email send history (stats, filters, table)
- [x] GET /api/email-send/history endpoint (paginated, filtered email_logs)

---

## ✅ Floor Plan Builder — Sprint 1 (30 Mart 2026) — COMPLETED

- [x] Migration SQL: `migrations/001_floorplan_tables.sql` (5 tables, indexes, trigger, constraints)
- [x] Backend route: `routes/floorplan.js` (8 endpoints: halls CRUD, versions list+create, stands list+create+delete)
- [x] index.js mount: `/api/floorplan` (2 lines added)
- [x] Frontend page: `floorplan-builder.html` (Konva.js canvas, standard Leena sidebar)
- [x] Frontend modules: `public/floorplan/` (state.js, grid.js, stands.js, toolbar.js, api.js)
- [x] Cell lookup optimization: O(1) via `_cellMap` in state.js
- [x] Rectangular marquee selection (draw mode)
- [x] Stand boundary rendering (no internal lines, outer boundary as Konva.Line)
- [x] Label layout: stand_code bottom-left, m² bottom-right, company centered
- [x] Optional stand_code (auto-generates S-{id})
- [x] CLAUDE.md + todo.md + spec updated

### Post-Deploy Tasks
- [ ] **Run migration on production:** Render Shell → `psql $DATABASE_INTERNAL_URL -f migrations/001_floorplan_tables.sql`
- [x] **Add "Floor Plan" sidebar link to all 19 admin pages** ✅ 20 Apr
- [ ] **Run migration 003:** Render Shell → `psql $DATABASE_INTERNAL_URL -f migrations/003_exhibitors_table.sql`
- [ ] **Test end-to-end:** Create hall → create version → draw stands → delete stand

---

## ✅ Floor Plan Builder — Sprint 2 (30 Mart 2026) — COMPLETED

- [x] Stand update (PUT /stands/:id — general fields, structural=draft only, commercial=active OK)
- [x] Commercial status change (PUT /stands/:id/status — instant dropdown save)
- [x] Inline editing in detail panel (company, label, notes + Save Changes button)
- [x] Stand renk seçimi (10-color pastel palette via metadata.color)
- [x] Special area type selector (vip, conference, registration, entrance, exit, technical)
- [x] Version activate/archive (POST /versions/:id/activate — draft→active, old active→archived)
- [x] Version label/notes update (PUT /versions/:id)
- [x] Background image overlay (PNG/JPG upload, localStorage, opacity slider, bgLayer)
- [x] Stats bar live update (standUpdated event wired to updateStats + drawStands)
- [x] Background image fix (grid rect opacity toggle when bg present)

---

## ✅ Floor Plan Builder — Sprint 3 (31 Mart 2026) — COMPLETED

- [x] Stand split (POST /stands/:id/split — dialog-based horizontal/vertical split)
- [x] Stand merge (POST /stands/merge — Shift+click multi-select, combine)
- [x] Version clone (POST /versions/:id/clone — deep copy stands + cells)
- [x] PNG export (client-side, stage.toDataURL pixelRatio:2, auto-download)
- [x] Stand duplicate (copy template → draw new cells → pre-filled dialog)
- [x] Stand drag-to-move (PUT /stands/:id/move — ghost preview, grid snap, draft-only)
- [x] Multi-stand drag (Shift+click or marquee → drag all selected stands together)
- [x] Select mode marquee selection (left-drag on empty area → rectangle stand selection)
- [x] Pan controls changed (stage.draggable=false, middle mouse or Space+drag = pan)
- [x] Split UX overhaul (cell-selection → horizontal/vertical dialog)
- [x] Clone button icon fix (bi-copy → bi-files)

---

## ✅ Floor Plan Builder — Sprint 3.5 Polish (31 Mart 2026)

- [x] Trackpad pan/zoom (wheel=pan, Ctrl+wheel/pinch=zoom — MacBook native)
- [x] Bulk duplicate (multi-select → "Duplicate All" → offset right or below)
- [x] Erase mode: click stand cell → confirm + delete entire stand
- [x] Grid rulers (meter markers every 5 cells, top + left edges)
- [x] Selection glow (blue shadow rect on selected/multi-selected stands)
- [x] Fit to view auto (verified: already called on hall/version change)

---

## ✅ April 2026 — Form Design + UX Improvements

- [x] Form Design Customization — config.style JSONB, banner upload, Design tab in form builder, dynamic styling in form-public.html and reactivate.html
- [x] Conference Topic Email Fix — formatConferenceTopic() `<ul>` bullet list for multi-topic
- [x] Import Skip Existing — skip_existing parameter, UI radio buttons, skipped_count in results
- [x] Visitor Detail Panel — slide-in panel with visitor info + email history timeline
- [x] GET /api/visitors/:id/emails — email history endpoint (queue + logs)
- [x] UI Help Info Boxes — all 20 admin pages, bilingual EN+TR, dismissible, localStorage
- [x] body-parser limit 2mb — for base64 banner data
- [x] Reactivation form_id migration — links campaigns to form design
- [x] Banner upload endpoint — POST /api/forms/upload-banner (base64, 500KB limit)
- [x] JSONB double-stringify fix — removed JSON.stringify for forms.config
- [x] Info box toggle fix — CSS display:none override solved with display:block
- [x] Zoom fix — mouse wheel=zoom restored, trackpad pan preserved, +/− buttons
- [x] Duplicate stand fix — no stand_code → auto S-{id}, no confirm dialog

---

## ✅ Yaprak Feedback — Sprint A (5 Mayıs 2026)

- [x] Madde 1: Visitor count display bug (bigint→int cast + parseInt defense)
- [x] Madde 4: Campaign delete extended (draft+completed+paused, email_queue pre-cleanup)
- [x] Campaign completion logic fix (computeNextDue → recipient 'completed')
- [x] Delete button on campaign list view (quickDelete function)

## 🔧 Operasyonel Müdahale (5 Mayıs 2026)

Render Shell'den manuel SQL migration çalıştırıldı (campaign completion bug'ının yan etkisini temizlemek için):

- 37,574 recipient (active kampanyalarda) status='completed' yapıldı
- 11 campaign 'active' → 'completed' geçti
- 37,545 recipient (draft kampanyalarda) KORUNDU — Conference Invitation Verify ve test66 hâlâ activate edilebilir durumda
- Transaction kullanıldı, COMMIT öncesi doğrulama yapıldı
- Bu migration tek seferlik, kod fix'i (commit a449ccb) ile birlikte bir daha gerekmeyecek

## ✅ Yaprak Feedback — Sprint B (5-6 Mayıs 2026)

- [x] Madde 2: PUT /api/visitors/:id endpoint (COALESCE pattern, qr_code protected)
- [x] Madde 2: Inline edit UI in visitor detail panel
- [x] Toast Bootstrap conflict fix (.toast → .app-toast)
- [x] badge_id added to paginated SELECT

---

## ✅ Yaprak Feedback — Sprint C1 (7 Mayıs 2026)

- [x] Madde 9: Source filter — searchable text input + datalist (replaced 5 fixed pills)
- [x] GET /api/visitors/sources endpoint (DISTINCT source values per expo)
- [x] ILIKE partial match in /paginated and /export

## ✅ Yaprak Feedback — Sprint C2 (7 Mayıs 2026)

- [x] Madde 6: Conference topic edit (jsonb_set in PUT endpoint, only for conference type)
- [x] Madde 8: Send Email button in visitor detail panel (template dropdown, POST /api/email-send/single)
- [x] "Send Badge Email" → "Send Email" rename

## ✅ Yaprak Feedback — Sprint C3 (7 Mayıs 2026)

- [x] Madde 11: Prev/next visitor navigation (panel buttons + ArrowLeft/Right keyboard)
- [x] Edit mode confirm dialog on navigation

## ✅ Read-only DB Access Setup (7 Mayıs 2026)

- [x] Created claude_readonly Postgres user (SELECT only)
- [x] Render IP whitelist configured for Suer's Mac
- [x] RENDER_DATABASE_READONLY_URL added to .env
- [x] Database Access section added to CLAUDE.md
- [x] leena-db-schema SKILL.md env vars table updated
- [x] Memory file: reference_db_readonly.md (Claude Code session persistence)

## ✅ Email Queue Bug Fix (7 Mayıs 2026)

- [x] Fix 1: Mode 1 email_queue INSERTs now include visitor_id/expo_id/organizer_id/template_id
- [x] Fix 2: Removed duplicate 'queued' email_logs INSERTs from routes (worker handles logging)
- [x] Cleanup: 6,396 ghost 'queued' email_logs → 'sent' via SQL transaction

## ✅ Madde 10 — Email Status Filter + Bulk Send (7 Mayıs 2026)

- [x] Sprint 1: email_status filter (never_sent/sent) in /paginated and /export
- [x] Sprint 1 fix: email fallback for historical NULL visitor_id logs (17 false positives → 0)
- [x] Sprint 2: buildVisitorFilter helper extracted (DRY refactor)
- [x] Sprint 2: POST /api/visitors/bulk-email endpoint (transaction, 10K limit, Mode 2)
- [x] Sprint 2: Bulk send modal UI (template selector, confirm dialog, toast)

## ✅ UI Quick Fixes Sprint (7 Mayıs 2026)

### Sprint 1
- [x] leena-toast.js shared component
- [x] 21 sayfada alert() → showToast() migration (~73 instances)
- [x] email-campaigns Bootstrap toast conflict fix
- [x] visitorlog bulk send filter guard (Madde 15)
- [x] form-public.html alert → inline error div
- [x] ARIA labels (visitor detail panel: prev/next/edit/close)
- [x] conference-scanner viewport zoom restored

### Sprint 2
- [x] reports.js + checkins.js COUNT::int cast (74 instances)
- [x] leena-fetch.js shared component (auth wrapper)
- [x] 3 sayfa migration: visitorlog, email-campaigns, dashboard_new
- [x] email-campaigns loading indicator
- [x] JWT 30-day lifetime documented
- [x] middleware/auth.js dead code identified

## ✅ Conference Topic Cleanup Sprint (10-12 Mayıs 2026)

### Hazırlık
- [x] conference-sessions.html line 242 orphan sidebar link fix (14969f6)

### Backend
- [x] /api/conference-cleanup/expos — organizer-scoped expo list
- [x] /api/conference-cleanup/canonical-topics — dynamic dropdown from form
- [x] /api/conference-cleanup/topic-variants — variants with visitor/cert counts
- [x] /api/conference-cleanup/visitors — multi-topic-aware lookup
- [x] /api/conference-cleanup/bulk-update — dry_run + execute, segment-aware, conflict detection, transaction-wrapped (61db471)

### Frontend
- [x] /conference-cleanup.html — master-detail page, dry-run modal (aa7012f)
- [x] Topic Cleanup button on conference-sessions.html (aa7012f)

### Tested
- [x] All 5 endpoints tested via curl (expos, canonical-topics, topic-variants, visitors, bulk-update dry_run)
- [x] UI flow tested manually in browser

---

## ✅ Pre-launch Mega Clima Nigeria 70k Reactivation Sprint (13 Mayıs 2026)

### Code (deployed)
- [x] BLOCKER-1 fix: POST /activate template selection (form_id primary, visitor-type fallback) (3e4b969)
- [x] Async job pattern: `import_jobs` table + setImmediate + 202 response + GET /job/:id polling (094ef99)
- [x] File size limit 10MB → 50MB (multer + frontend) (7d10144)
- [x] email_unsubscribes pre-check in `prefetchEmails()` + skipped_unsubscribed counter (e7d9cf4)
- [x] Public form job_title fallback: `custom_fields?.job_title || custom_fields?.title` (aff83bc)

### DB Operations (Render Shell)
- [x] Template 24 unsubscribe footer SQL REPLACE before `</body>`
- [x] 52 Mega Clima Nigeria exhibitor job_title backfill from `custom_fields->>'title'` (backup table: `exhibitor_job_title_backup_20260513`)
- [x] 76 visitor conference_topic split "Day 1 & Day 2 ..." → Topic 1 + Topic 5 (backup table: `conference_topic_backup_20260513`, segment-aware dedup, multi-segment preserved)

### Crisis Response — Test Domain SendGrid Suppression
- [x] 42,077 pending `@leena-test.local` emails cancelled via `UPDATE email_queue SET status='cancelled'`
- [x] 85,000 unique test addresses added to SendGrid Global Suppression (85 batches × 1000, 85/85 success)
- [x] Random 10-sample verification confirmed suppression effective

### Infrastructure
- [x] SendGrid Pro 100K → Pro 300K upgrade ($89.95 → $249/mo)

### Smoke Test
- [x] 5-recipient real-domain test on Mega Clima Nigeria expo → 464ms response, full chain validated (invite Template 34, badge Template 24)

### Yaprak Campaign
- [x] 12:00 — Yaprak uploaded Excel (41,222 rows, 34,041 unique emails); background drain in progress (~2-2.5h at 5/sec)

---

## ✅ Reactivation Monitoring UI Sprint (13 Mayıs 2026, afternoon)

### Tier 1 — UI quality of life (frontend only)
- [x] T1.1 — Auto-refresh dropdown Off/10s/30s/60s + "Last updated: X ago" indicator (1b9c87e)
- [x] T1.3 — Progress bar + ETA per card, stalled-history heuristic (0978a8c)
- [x] T1.4 — Activation Rate color coding (red/orange/green) + tooltip (5d4de9e)

### Tier 2 — SendGrid delivery breakdown
- [x] T2.1 — Backend GET /api/reactivation/campaign/:expoId/stats (per-status counts + last_sent timestamps, 45ms in prod) (573d182)
- [x] T2.2 — Per-card Mail Delivery Status row (Sent/Queued/Failed + "Last email sent: X ago", 120s+ idle → "Worker may be stalled") (695c28c)

### Resend safety
- [x] S2 — GET /api/reactivation/campaign/:expoId/is-active endpoint (f31a6b1)
- [x] S1 — Resend button disabled-while-active + 3-layer confirm (confirm → prompt expo name → final confirm) (777bb6c)

### Categorization + sort + test protection
- [x] 4 status badges (🟢 Active / 🟡 Stalled / ⚪ Completed / 🔴 Test) with statusOrder sort + last_queued_at DESC same-status (cdc295a)
- [x] Test campaigns: permanent resend disable + deemphasized stats + "Test campaign" caption
- [x] Empty-active hint when no current campaigns
- [x] Refactor: collapsed N+1 is-active fetch into single batch

### Awaiting Activation badge
- [x] 🔵 Awaiting badge (drain done, tokens pending — healthy waiting state) (0820b00)
- [x] Stalled redefined as "real problem" (queue pending AND worker idle 10+ min)

### Past Campaigns visual hierarchy
- [x] Top section (full cards: Active/Awaiting/Stalled) + separator + bottom section (compact rows: Completed/Closed/Test) (384b3fe)
- [x] Compact card: opacity 0.72, single-line info, hover→1
- [x] Mail status + resend button updates scoped to currentCampaigns only (no wasted fetches)

### Close Campaign feature
- [x] Migration 006_reactivation_closed_at.sql (expos.reactivation_closed_at + reactivation_closed_by) (4e61c35)
- [x] Migration applied on production via Render Shell
- [x] Backend POST /api/reactivation/campaign/:expoId/close + /reopen (idempotent, 409/503 graceful)
- [x] GET /campaigns augmented with JOIN organizers for closed_by_name, try/catch fallback to pre-migration query
- [x] Frontend 🔒 Closed badge + 2-layer confirm + "Closed on X by Y" compact card + Reopen link

---

## ✅ Test Email Cleanup (14 Mayıs 2026)

- [x] Migration `migrations/007_test_email_cleanup.sql` written (commits aae78f4 + aa7dbcc)
- [x] FK dependency map completed (8 intermediate tables + visitors)
- [x] Dry-run caught missed FK: `email_queue.campaign_recipient_id → campaign_recipients`
- [x] Fix: new STEP 1 cleans email_queue by campaign_recipient_id before STEP 2
- [x] Real run executed by Suer on Render Shell: 46 visitor rows + ~389 related rows removed
- [x] Backup table created: `visitors_test_backup_20260514` (46 rows snapshot)
- [x] Validation: all 4 remaining_* counters = 0; backup_rows = 46
- [x] Two-phase migration pattern (dry-run ROLLBACK → real run COMMIT) proven and adopted as template

---

## ✅ Conference Scanner UX Hardening (14 Mayıs 2026)
- [x] Visitor preview card before `/checkin-and-certify` (Change A)
- [x] Custom confirm modal for force certify (Change B)
- [x] Backend unchanged; `forceCertify` body preserved
- [x] Field name compatibility verified (customFields camelCase)
- [x] Deployed to production (commit 27ddae7)
- [ ] **PENDING:** Suer functional smoke test (real QR scan + force scenario)
- [ ] **DEFERRED post-fair:** Audit log table for force=true events — see `CONFERENCE_FORCE_AUDIT_20260514.md` Karar Soru 2

---

## ✅ Mega Clima Nigeria 2026 Pre-Fair Sprint (15 Mayıs 2026)

### Conference Scanner Hardening
- [x] Pre-display visitor sessions card (commit 27ddae7)
- [x] Custom confirm modal for force button (commit 27ddae7)
- [x] Smoke test verified by Yaprak (badge "SPEAKER" display)

### Quick Fixes
- [x] qrscanner country default Morocco → Nigeria (commit d1464b7)
- [x] Hostess quick reference card /hostess-guide.html (commit 7e852ba)
- [ ] **PENDING:** Senaryo 5 bookmark URL placeholder fill (Suer manual)

### Yaprak Requests #2, #4, #5, #6 + Capitalize
- [x] #2 Terminal default visitor_type (commit 86c3738)
- [x] #4 form-public QR display (commit 9a94447) — smoke tested ✅
- [x] #5 Manual registration reason required (commit 439eb0e)
- [x] #6 Badge preview type fix (commit 5606ef6) — smoke tested ✅
- [x] Smart capitalize badge type display (commit d9908d9)

### Zoho Day1/Day2 Recurrence Fix
- [x] Root cause research (DAY1_DAY2_ISSUE_RESEARCH_20260515.md)
- [x] Webhook auto-split deployed (commit 6dd34ca)
- [x] DB cleanup of 2 historical merged rows (Render Shell, no commit)
- [x] Backup: conference_topic_backup_20260518 (2 rows)
- [ ] **POST-FAIR:** Drop conference_topic_backup_20260518

### Pending Smoke Tests (Yaprak + Suer)
- [ ] #2 terminal default visitor_type on actual terminal URLs
- [ ] #5 manual reason dropdown + required validation
- [ ] Conference scanner pre-display + force modal end-to-end

### Post-Fair Backlog
- [ ] **Request #1**: Token-protected bulk badge print page (HIGH risk)
- [ ] **Request #3**: Manual Registration on/off toggle per terminal (migration 008)
- [ ] Form 39 "Cool Plus Limit" → "Limited" typo cleanup
- [ ] Audit log table for force=true events (deferred from 14 May)

---

## ✅ Mega Clima Nigeria 2026 Pre-Fair Sprint Day 2 (18 Mayıs 2026)

### Per-Terminal Manual Registration Toggle (commit 1324296, Yaprak #3)
- [x] Migration 008 (terminals.allow_manual_registration) production'da
- [x] POST/PUT /api/terminals + for-terminal response (allowManualRegistration) + terminals.html + qrscanner.html
- [x] Suer tested ✅
- [ ] **POST-FAIR:** clone/:id allow_manual_registration kopyalama bug

### Token-Protected Bulk Badge Print (commit 5a66070, Yaprak #1)
- [x] Migration 009 (terminals.kind) production'da
- [x] dualAuth middleware + /paginated + /import swap + bulk-badge-print.html + for-terminal kind
- [x] Suer tested ✅ (Mega Clima + Mega Water token)

### Nigeria Certificate Branch (commit 9a20641, Method A2)
- [x] verify/:token expo_id + CERT_EMAIL_TEMPLATE_NG + certificate-ng.html + certificate.html redirect
- [ ] **PENDING:** fuar günü test (Yaprak/Suer)

### Cool Plus Topic Block (commit 02e0692, Yaprak)
- [x] Helpers (getCoolPlusBlockedTopics/isTopicBlocked/coolPlusBlockResponse) + 3-dokunuş guard + frontend blocked-overlay
- [ ] **PENDING:** fuar günü test (Topics 1/5/11 expo 7, check-in korunuyor + non-Cool-Plus normal)

### Preemptive Cool Plus Warning + Microcopy (commit d858391)
- [x] /blocked-topics endpoint + frontend preemptive UI + mikrokopi
- [x] Suer tested ✅ (mobile)

### Tokens (Render Shell, no commit)
- [x] Bulk print token Mega Clima Nigeria (expo 7): 50a9d2a4-76b4-437a-818e-271193777fff
- [x] Bulk print token Nigeria Mega Water (expo 8): 77565c52-fee4-40d9-a378-22c5112529a2
- [x] Conference scanner terminal Mega Clima Nigeria (expo 7): 7a7537d3-62e5-4ec6-aaca-1d9846e8d16e

### Pending Smoke Tests (fuar günü — Yaprak/Suer)
- [ ] Nigeria certificate email (yeşil, Lagos) + certificate-ng.html render + cert-id
- [ ] Cool Plus block (Topics 1/5/11) → turuncu overlay, check-in VAR, cert+email YOK
- [ ] Non-Cool-Plus topic → normal yeşil success + Nigeria email
- [ ] Conference scanner preemptive warning (mobile, expo 7 terminal)

---

## ⏳ Yaprak Feedback — Sprint C Remaining (Fuar sonrası)

- [ ] Madde 3: Visitor silme (hard delete, sadece checkin'siz ve email gönderilmemiş visitor'lar)
- [ ] Cascade kontrolü: email_queue, email_logs, campaign_recipients temizliği
- [ ] Confirmation UI: "This visitor has X checkins, cannot be deleted" vs "No associated data, safe to delete"

---

## 🔴 Floor Plan Builder — Sprint 4 (Next)

- [ ] Background image UX (resize, reposition, alignment)
- [ ] Batch stand workflow (draw large area → split into grid)
- [ ] PDF export (branded, server-side — Phase 2)
- [ ] Connected shape validation (cell adjacency check)
- [ ] Sidebar link to existing 15 admin pages
- [ ] Stand resize (edge drag to expand/shrink)

---

## 📋 Post-Fair Backlog (Fuar sonrası — Haziran 2026+)

### Email System
- [ ] Schedule for later: add `scheduled_at` column to email_queue, worker WHERE filter `(scheduled_at IS NULL OR scheduled_at <= NOW())`
- [ ] Backend bulk send rate limit / duplicate protection (prevent double-submit queueing same visitors twice)
- [ ] Historical email_logs visitor_id backfill: UPDATE ~114K NULL visitor_id rows via email match, then revert email fallback SQL in email_status filter (19ms vs 227ms)
- [ ] Email UI Simplification (Senaryo C): merge Send Emails + Email Segments into unified send page, keep Templates and Campaigns separate
- [ ] **Generic token-based unsubscribe endpoint** (replace "reply with UNSUBSCRIBE" manual flow for non-campaign emails). Reactivation emails currently lack one-click unsubscribe.
- [ ] **SendGrid bounce/complaint webhook integration** → automated `email_unsubscribes` population. Currently bounces invisible to Leena.
- [ ] **email_unsubscribes scope refinement**: per-expo or per-organizer-form (currently organizer-level — unsub blocks all that organizer's expos).
- [ ] **R5: Stale 'processing' email recovery** — deploy/restart strands rows in `email_queue.status='processing'`. No recovery cron.
- [ ] **R8: setImmediate orphan recovery** — server restart kills background reactivation job, `import_jobs.status='processing'` stuck. Boot-time orphan detector or cron needed.
- [ ] **R9: reactivation_tokens UNIQUE(email, target_expo_id) constraint** — currently only an index. Concurrent duplicate request risk.
- [ ] **R14: Backend template `{{activation_url}}` placeholder validation** — wrong template selection sends 70k+ emails with no link.
- [ ] **Test email safety practice** — pre-add fake test domains to SendGrid suppression OR enforce plus-addressing on real mailboxes (see L1 lesson in CLAUDE.md).
- [ ] **Stalled detection upgrade** — current 3-fetch unchanged-pending heuristic is short and shallow. Replace with a worker-cadence aware detector (compare observed `sent_at` rate to expected throughput).
- [ ] **Reactivation drop-off analytics** — daily activation curve graph for each campaign (currently the dashboard only shows a single % number).
- [ ] **Auto-close after expo end + N days** — replace manual `🔒 Close` click for routine campaigns where the expo has ended.
- [ ] **ETA formula dynamic throughput** — currently hardcoded at 300 emails/min (5/sec). Compute from observed `sent_at` cadence over the last 5 minutes instead.
- [ ] **Custom modal for 3-layer resend confirm** — native `prompt()` can be muted by users in some browsers ("prevent this site from showing dialogs"), skipping layer 2.
- [ ] **Bulk-card SendGrid stats endpoint** — current per-card fetch is fine at 1-3 visible expos; revisit once campaign list grows.

### Frontend Components
- [ ] leena-fetch.js migration: remaining 16+ admin pages
- [ ] Refresh token mechanism (auto-renew at day 25)
- [ ] Frontend proactive expire check (decode JWT exp claim)
- [ ] middleware/auth.js dead code deletion

### Backend
- [ ] Remaining 11 route files COUNT::int cast cleanup

### Security & Maintenance
- [ ] Password rotation: claude_readonly DB user, JWT_SECRET, SENDGRID_API_KEY
- [ ] Git history cleanup: .env.backup files in 3 locations
- [ ] .gitignore creation (.env*, *.env, *.backup)
- [ ] **Drop `visitors_test_backup_20260514` after 21 May 2026 fair end** — snapshot of 46 test-email visitor rows from migration 007; kept as safety net through fair, no longer needed once Mega Clima Nigeria 2026 closes.

### Visitor Management
- [ ] Madde 3: Visitor delete (hard delete, checkin-less visitors only)
- [ ] Visitor detail panel: add check-in history (all check-in timestamps)

### Conference Module (post-fair)
- [ ] Sprint Cleanup: remove /api/conference-cleanup routes + conference-cleanup.html + Topic Cleanup button from conference-sessions
- [ ] Conference Entity Migration: new tables (expo_conferences, visitor_conferences), migrate JSONB strings to FKs, refactor 8-10 affected modules. See ADR-021.
- [ ] Webhook input validation: normalize conference_topic against canonical form options
- [ ] Audit DB: remove any remaining test data ("Choice One" etc.)
- [ ] Ghana expo (id=5) cleanup decision: archive or migrate
- [ ] **conferenceCleanup 1→N split capability** — current tool is 1→1 rename only. Day 1 & Day 2 → Topic 1 + Topic 5 done via manual SQL this sprint; encode pattern in tool.
- [ ] **Form 39 canonical topic typo cleanup**: "Cool Plus Limit" → "Limited", duplicate spaces in 13 conference topics for Mega Clima Nigeria.

### Mega Clima Nigeria 2026 Sprint (18 May) — post-fair
- [ ] **Bulk print tokenları revoke** — `UPDATE terminals SET is_active=false WHERE terminal_key IN ('50a9d2a4-76b4-437a-818e-271193777fff','77565c52-fee4-40d9-a378-22c5112529a2')` (fuar bitince)
- [ ] **Drop backup tabloları** — `conference_topic_backup_20260518`, `conference_topic_backup_20260513` (fuar sonrası, artık gerekmez)
- [ ] **JWT organizer_id filter zayıflığı** — `/paginated` + `/import` `buildVisitorFilter` sadece expo_id filtreliyor, organizer scope yok; multi-tenant öncesi düzeltilmeli
- [ ] **clone/:id allow_manual_registration bug** — `POST /api/terminals/clone/:id` yeni kolonu kopyalamıyor (DB DEFAULT TRUE alır, kaynağı yansıtmaz)
- [ ] **Certificate system Option 2/3** — DB-backed per-expo certificate templates + admin UI (mevcut hardcoded + Method A2 expo-gated branch yerine). Bkz CERTIFICATE_SYSTEM_ANALYSIS_20260518.md
- [ ] **Cool Plus rescan dedup** — aynı Cool Plus visitor 2 kez taranırsa 2 check-in; cert-row-yok nedeniyle dedup yok (polish)
- [ ] **conference scanner `terminal_key` vs bulk-print `key=` param adı tutarsızlığı** — standardize
- (Not: "Form 39 Cool Plus Limit→Limited typo" yukarıda + "Audit log force=true" 15-May backlog'da zaten takip ediliyor — duplike eklenmedi)

### Fair Day 1 Observations (19 Mayıs 2026)

**Data Quality**
- [ ] `visitors.source` normalization — "Pixad Meta Form" 2 invisible-char variants (combined ~3,568, true #1 channel). Detected in FAIR_DAY1_ANALYTICS_20260519.md.
- [ ] `visitors.country` casing canonicalization — Nigeria/Nigerian/NIGERIA fragmentation. Same audit doc.
- [ ] `visitors.company` free-text noise — "Self-employed" 5+ variants (~362 combined), placeholder junk (Nil/Student/Nigeria as company). Same audit doc.

**Schema Issues**
- [ ] `checkins.terminal` is TEXT (not FK to terminals.id) — JOINs expensive, no referential integrity. Detected during FAIR_DAY1_HEALTH_REPORT_20260519.md.
- [ ] `conference_certificates.created_at` timestamp vs timestamptz tz quirk — displayed times appear "in the future" (cosmetic, non-functional). Detected in FAIR_DAY1_AFTERNOON_20260519.md.

**Documentation Gaps**
- [ ] Mega Clima Nigeria 2025 data: not in current DB (system started Sept 2025) and not in local backups. Export from Zoho/Pixad/old Leena4 hosting required for year-over-year comparison.
- (Not: "conference scanner `terminal_key` vs bulk-print `key=` param" doc-gap zaten yukarıdaki 18-May alt-bölümünde takip ediliyor — duplike eklenmedi)

**Audit Files (root, untracked — preserve for post-fair review)**
- FAIR_DAY1_HEALTH_REPORT_20260519.md
- FAIR_DAY1_ANALYTICS_20260519.md
- FAIR_DAY1_AFTERNOON_20260519.md
- CERTIFICATE_SYSTEM_ANALYSIS_20260518.md
- COOL_PLUS_BLOCK_ANALYSIS_20260518.md
- BULK_PRINT_DUAL_AUTH_DESIGN_20260518.md

### Visitor Export / WhatsApp Sprint (19 May) — post-fair
- [ ] Add `idx_checkins_visitor_id` index for correlated EXISTS performance on /export with checkin_status filters (low priority, admin path). Identified during v4.0.6 visitor export checkin filter sprint (2026-05-19).
- [ ] **visitors.phone data quality** (identified during WhatsApp campaign prep, expo_id=7 verified 2026-05-19): ~95 rows with short numbers (len < 14 after normalize, missing digits); ~10 rows with junk/over-length numbers (len > 14 after normalize). Separate from normalize logic — require manual cleanup or form-layer input validation.
- [ ] **phoneNormalize Nigeria-hardcoded**: uses `COUNTRY_CODE = '+234'`. Future: expo-aware country code (read from expos.country or similar). Currently sufficient for Mega Clima Nigeria 2026 (expo_id=7).

### Zoho Webhook Phone Mapping (19 May) — post-fair
- [x] **Forward-only fix** ✅ APPLIED 21 May 2026 (commit `3f68411`) — verified 18 Aug 2026: `webhook.js:57` has the mobile/Mobile fallbacks and `knownFields` includes them; 99.9% phone fill on 1,910 post-fix zohoform rows. Original note: `routes/webhook.js:57` değiştir: `const phone = req.body.phone ?? req.body.mobile ?? req.body.Mobile ?? '';` + `knownFields` Set'e `'mobile'`, `'Mobile'` ekle. `routes/visitors.js:208` paralel fix: `phone: custom_fields?.phone || custom_fields?.mobile || custom_fields?.Mobile || '',`. 2 satır additive değişiklik. Identified 2026-05-19, root cause: Zoho `mobile` lowercase gönderiyor, handler sadece `phone` okuyor. Backfill (6,214 rows) applied; new Zoho payloads still drop phone until this fix lands.
- [ ] **webhook_payload_log table**: observability layer for incoming webhook POSTs (endpoint, params, body_jsonb, received_at). Would have caught Zoho `mobile` vs `phone` mismatch in minutes instead of hours. Migration + handler hook.

---

### Nigeria Mega Project Expo 2026 Pre-Fair Sprint (18 Aug 2026) — expo_id=13, 25-27 Aug

Shipped (3 commits, staged locally, deployed together in one restart):
- [x] `reactivate.html` — `required` + `*` on Job Title and Phone (commit `8799ccd`)
- [x] `webhook.js:55` — `|| req.body.title` so Zoho's lowercase `title` reaches `job_title` (commit `32501ed`)
- [x] `checkinReports.js:47,73` — `direct_job_title` in CTE + COALESCE/NULLIF fallback (commit `52cc27e`)

Manual step for Suer (NOT run by Claude):
- [x] **job_title backfill** ✅ DONE 18 Aug — **1,785 rows** across 4 expos from
      `custom_fields->>'title'`. Three-phase SQL in `EXEC_BRIEF_02_FINDINGS.md` §2.4.
      **Run ONLY after `32501ed` is deployed and confirmed filling new rows live.**
      Backup table `job_title_backup_20260818`. Re-runnable (guard: column empty AND cf.title non-empty).

## 🎯 ACTIVE — owners & deadlines (updated 21 Aug 2026, 23:15 — fair opens Tue 25)

| # | Item | Owner | Deadline | Notes |
|---|---|---|---|---|
| 1 | **T1 Visitor badge template swap** off `test visitor 80x40` (17) | **OPS** | **before Tue 25** | Unchanged since 19 Aug. Gate serves ~5,600 registrants. |
| 2 | **Turn on `show_job_title`** for the visitor badge | **OPS** | **before Tue 25** | 5,097+ visitors (98%+) have a job title; none of it prints. |
| 3 | **Conference terminal + confirm session topics** | **OPS** | **Sunday 23 Aug** | 85+ conference registrants, no check-in or certificate path. Form 55 has 4 sessions configured (the earlier "1 topic" finding was a measurement error — withdrawn). |
| 4 | **C19 "Final Register Push" go/no-go** | **SUER** | **Sat 22 Aug, noon** | 25,844 draft, template #62, ready to activate. Held: coldest segment (0.67% vs 3.41%), and Monday step-3 already reaches them. |
| 5 | **SendGrid bounce webhook → LEENA** | **DEV** | before SIEMA | Zero bounce visibility (G9); ~96k delivered with no feedback loop. |
| 6 | Phase 2 campaign wizard | **DEV** | awaiting GO | Design: `docs/sessions/CAMPAIGN_UI_DESIGN_20260819.md`. |
| 7 | Gate-scanner fork of `conference-scanner.html` | **DEV** | backlog, revisit for SIEMA | `qrscanner.html` has no camera. |

---

### Friday 21 Aug — greeting chain + final push (SHIPPED)

- [x] Diagnosed the `"Dear ,"` incident — bare `{{first_name}}` has no per-token default; the chain is the canonical greeting (see CLAUDE.md v4.0.9 RULE)
- [x] Greeting chain applied to #56 / #58 / #59 (14:12), re-audited and render-proofed
- [x] Dead `{{unsubscribe_url}}` anchors unwrapped in #61 / #62 (second time this has been needed)
- [x] Forensic scan: **96,227 sent bodies, 0 fallback, 0 broken, 0 literal tokens** — verified twice by two methods
- [x] Campaign 18 "MP26 Final Activate Push" — 14,229, template #61, **ACTIVATED 23:07:31**, drained in ~3 min enqueue / ~250/min
- [x] Campaign 19 "MP26 Final Register Push" — 25,844, template #62, built as **draft, held**
- [x] Confirmed Monday step-3 will skip C18 converts via the email-based checks in `dedbcd0`

Post-fair adds from tonight:
- [ ] **Index `email_queue.campaign_recipient_id`** (G18) — bulk recipient DELETE currently times out against a 361k-row scan
- [ ] **Condition-based single-step campaigns** (G19) — step 1 is forced to `condition='all'`, so one-shot waves cannot filter at send time and go stale
- [ ] **Template-edit audit hook** (G17) — templates are referenced live, so editing one silently changes what an active campaign sends next; add a warning or a re-audit prompt when editing a template attached to an active campaign
- [ ] **Fix `Dear {{chain}}` double-greeting** in #61/#62 (G20) before those templates are reused

## 🎯 ACTIVE — owners & deadlines (19 Aug 2026 EOD — superseded above)

Fair opens **Tue 25 Aug**. Ordered by deadline.

| # | Item | Owner | Deadline | Notes |
|---|---|---|---|---|
| 1 | **T1 Visitor badge template swap** off `test visitor 80x40` (id 17) | **OPS** | **before Mon 24 Aug** | Serves 3,678 registrants. Confirm physical badge stock size first; template 12 `Standard Badge Template` is the default. |
| 2 | **Turn on `show_job_title`** for the visitor badge | **OPS** | **before Mon 24 Aug** | 97.7% of expo-13 visitors now have a job title (1,785 recovered by the backfill) and none of it prints. Template 17 has it OFF. |
| 3 | **Create the conference terminal** + complete conference form topics | **OPS** | **before Mon 24 Aug** | 66 conference registrants, 81 with a topic, form 55 exposes only **1** option. No terminal ⇒ no conference check-in and no certificates. |
| 4 | **SendGrid bounce webhook → LEENA** | **DEV** | **before SIEMA** | LEENA records zero bounce data (G9). 41k delivered to a partly-aged list with no feedback loop. Highest-value observability gap. |
| 5 | **Phase 2 campaign wizard** | **DEV** | this week, **awaiting GO** | Design complete: `docs/sessions/CAMPAIGN_UI_DESIGN_20260819.md`. ~1,020 lines / 4 files, no migration. Phase 1 (funnel) shipped. |
| 6 | Gate-scanner fork of `conference-scanner.html` | **DEV** | backlog — **suspended by decision**, revisit for SIEMA | `qrscanner.html` has no camera (keyboard-wedge only). ~40-60 lines to fork. See `docs/sessions/SCANNER_INSPECTION_20260819.md`. |
| 7 | Per-step delivered tracking | **DEV** | backlog | Needs an `email_queue.campaign_step_id` join; per-step numbers currently show enqueued and are labelled "Queued". |

---

### Campaign Results Funnel (19 Aug 2026) — SHIPPED

- [x] `6d798ab` — Delivered/Opened/Clicked/Registered/Checked-in funnel on the campaign Stats tab
- [x] Delivered reads `email_queue.status='sent'`, not the enqueue-time `sent` event (was a 4× overstatement mid-drain)
- [x] Checked-in joins on **email**, not `visitor_id` — the Excel path never populates it (0 of 41,203 rows)
- [x] Attribution-honest labelling: "campaign recipients who checked in", upper bound not ROI; "target expo not yet open" before the fair
- [x] `42703` fallback on both read paths so deploy-before-migration degrades instead of 500-ing
- [x] **Migration 029 applied to production** — `email_campaigns.delivered_count`, snapshotted atomically with the purge in `checkCampaignCompletion`
- [x] `EMAIL_WORKER_BATCH_SIZE` 1→10 — measured **28.5 → 274.4/min**, restart mid-drain safe (0 retries, 0 duplicates)
- [x] **`not_registered` now checks visitor row + activated token, not just the campaign event** — 66 recipients across C16/C17 (all organic `zohoform`) would have received Monday's last-chance email after already registering; growing ~50/day

### MP26 Reactivation Campaign Launch (18-19 Aug 2026) — expo 13

Shipped (2 further commits + data ops; see CLAUDE.md v4.0.7):
- [x] `fd0c503` — the bridge: `trackingPixel.js:154` matcher + `reactivate.html` `_lc` capture + `recordCampaignRegistration()` in `/activate`
- [x] `5866a0a` — fair-anchored token expiry (GREATEST/COALESCE, 30-day floor, 90-day NULL fallback)
- [x] job_title backfill: **1,785 rows**, backup `job_title_backup_20260818`, Render Shell
- [x] Templates #58/#59 CTA → form 53 (2 occurrences each); `{{unsubscribe_url}}` anchor unwrapped in #54-59; subject comma. **Via API — DB only, not in git.**
- [x] Campaigns 16 (14,941 G2) + 17 (26,262 G3), steps `0h all / 37h not_registered / 96h not_registered`, 30-min staggered launch
- [x] `EMAIL_WORKER_BATCH_SIZE` 1→10 on Render worker — measured **28.5 → 274.4/min**
- [x] Bridge verified end-to-end on throwaway expo 17 (step 2 skipped the activated recipient) **and** in production (100% attribution, 0 gaps)

Post-fair from THIS sprint:
- [ ] **`knownFields` cleanup** — add `'title'` to `webhook.js:63-68`. Deliberately left so `custom_fields.title` stays a recovery net. Only after the fix + backfill are settled.
- [ ] **`checkins.js:353` has the same NULLIF flaw** fixed in `52cc27e` — plain `COALESCE` returns `''` for the 346 production rows where `custom_fields->>'job_title'` is an empty string. Same for the `country` line at `checkinReports.js:72`.
- [ ] **Config-driven required fields on `reactivate.html`** — the page renders a hardcoded 7-field block and only consumes `forms.config` (style), never `forms.fields`. `GET /verify/:token` would need to return `f.fields` too (Option B in `docs/sessions/SIEMA_OPTION_A_GAPS_20260818.md`). Also: `last_name` is `required:true` in config but rendered unmarked.
- [ ] **Token expiry floor for past-dated expos** — `GREATEST(..., NOW()+30d)` still mints a live token for an expo that already ended. Should refuse, or clamp to the fair.
- [ ] **`{{unsubscribe_url}}` placeholder support in campaign mode** (Gotcha G7) — currently unfillable; needs the unsub token generated *before* the render at `email_worker.js:531-532`, which is an ordering change.
- [ ] **Campaign-UI merge flow** — a "Reactivate via Campaign" button so the token-generation → export → recipient-upload round trip isn't manual. Today it is: `create-from-excel` (no `template_id`) → SQL export → build sheet with `activation_url` → campaign upload.
- [ ] **Duplicate IP allowlist entries cleanup** — Render PostgreSQL Inbound IP Rules has accumulated stale/duplicate entries from repeated re-adds (Gotcha G4).
- [ ] **SendGrid bounce/complaint webhook integration** — LEENA records no bounce data at all (Gotcha G9). Highest-value observability gap; blocks any data-driven list hygiene.
- [ ] `prefetchEmails` `LOWER` without `TRIM` (Gotcha G11) — latent dedup hole.
- [ ] `#54` secondary form link bypasses the token (~1% of C16 conversions create a fresh record and leave the token `pending`) — decide keep or remove.
- [ ] Duplicate public-form submission created two visitor rows (`chavadagroup@yahoo.com`, 1 min apart) — `/public` upsert should have caught it.

Pre-fair operational blockers (see `DISCOVERY_20260818.md` §6):
- [ ] **expo 13 has ZERO terminals** — no check-in path exists. Largest gap, blocks the fair.
- [ ] **Rotate/deactivate May bulk-print terminal keys** (terminals 33, 34 — both still
      `is_active=true`, full UUIDs in plaintext in CLAUDE.md in the GitHub repo; `dualAuth.js`
      grants them visitor read + import on expos 7/8)
- [ ] Deactivate the other 22 terminals belonging to finished fairs
- [ ] Remove 4 test rows from expo 13 (`test@test.com`, `yaprakguzelcik@gmail.com`,
      `elan02@elan-expo.com`, + one `name='test'`) — migration 007 two-phase pattern
- [ ] Drop 5 stale backup tables (`visitors_test_backup_20260514` ~3 months past its documented
      drop date; `visitors_backup` is undocumented — confirm provenance before dropping)
- [ ] Badge template `show_job_title` is `false` by default (`badgeTemplates.js:35`) — decide
      whether job titles should print on badges once terminals exist

Post-fair from this sprint:
- [ ] Config-driven `reactivate.html`: verify endpoint returns `forms.fields`, page maps
      `required` onto its 7 inputs (Option B in `EXEC_BRIEF_02_FINDINGS.md` §1.6).
      Currently the page is a hardcoded snapshot while `form-public.html` is config-driven.
- [ ] **`form-public.html` header/footer style duplication** — `applyFormStyle` now sets the
      header/footer band both as inline element styles (`:497-536`) and as rules in the
      injected `<style>` tag (`:551-563`). The inline copy was deliberately left in place so
      the initial render stayed provably unchanged during the pre-fair window; the stylesheet
      copy is what survives the `innerHTML` replacement in `showSuccess()`/`showError()`.
      Collapse to the stylesheet copy alone and delete the inline block. Two sources of truth
      until then — edit both or neither.
- [ ] `reactivate.html` `last_name` is `required:true` in config but rendered unmarked
- [ ] Add `'title'` to `webhook.js` `knownFields` — ONLY after fix + backfill confirmed.
      Kept duplicating deliberately as the recovery safety net.
- [ ] `checkins.js:353` plain COALESCE has the same empty-string flaw as the line fixed in
      `52cc27e` — 346 production rows hold `custom_fields->>'job_title' = ''`
- [ ] `checkinReports.js:72` country line — same plain-COALESCE flaw
- [ ] Check whether `visitors.js` POST `/public` enforces `required` server-side or trusts the client
- [ ] **`Africa/Lagos` hardcoded in 29 sites** — correct for expo 13 (Nigeria), latent defect for
      Morocco Siema Expo 2026 (expo_id=9, 22-24 Sep). Also `phoneNormalize` `+234`.
- [ ] **Docs were 3 months stale** — CLAUDE.md described 21 routes, 34 are mounted; the Expo
      Operations module (migration 010, applied in prod) and the ELL finance module were
      entirely undocumented. `expo_clusters` exists but is EMPTY; `expo-list/form/clusters/
      partners.html` are built but linked from nowhere; `dashboard_new.html:667` pencil is dead.

---

## 📌 Previous TODOs

### Conference topic backfill
- [ ] Conference topic backfill: Zoho'dan Excel export → import page ile conference_topic güncelle

---

## 🟡 Email Stabilizasyon (Kısmen Tamamlandı)

- [ ] webhook.js → email_queue üzerinden gönder (direkt sgMail.send kaldır)
- [x] visitors.js import → email_queue Mode 1 kullanıyor ✅
- [x] visitors.js public form → email_queue Mode 1 kullanıyor ✅
- [ ] emailSend.js bulk/single → email_queue üzerinden gönder
- [ ] emailSegments.js → email_queue üzerinden gönder
- [x] `email_worker.js` — FOR UPDATE transaction fix ✅ 24 Şubat
- [x] `emailSend.js` — BASE_BADGE_URL fallback ✅ 23 Şubat
- [ ] email_worker → email_logs sync: worker gönderim sonrası email_logs güncellemiyor (status tutarsızlığı)

## 🟢 Sprint 4 — Race Condition & Error Handling (Fuar sonrası, 3-5 gün)

- [ ] `leads.js:99-128` — Duplicate check'i ON CONFLICT ile değiştir
- [ ] Hata yanıt formatını standardize et: tüm route'lar `{success: bool, message: string}` dönsün
- [ ] Auth check standardizasyonu: tüm admin sayfalara DOMContentLoaded'da token + expoId kontrolü

## 🔵 Sprint 5 — UI Unification (SaaS hazırlığı, 2-3 hafta)

Bu büyük refactor. Fuar yokken yapılacak.

- [ ] Sidebar component oluştur (tek JS include — tüm sayfalar aynı sidebar'ı çeker)
- [ ] CSS variable standardizasyonu (Gen 4 baz alınarak)
- [ ] Inline CSS → tek CSS dosyasına taşı
- [ ] Mobil sidebar: hamburger menü + overlay (tüm sayfalar)
- [ ] Bootstrap Icons versiyonunu tekleştir (v1.11.0)
- [x] Sidebar CSS standardization: add ::before accent bar to all pages ✅

## 🗑️ Sprint 6 — Temizlik

- [ ] Legacy sayfaları sil: dashboard.html, admin-dashboard.html, main-panel.html
- [ ] *.backup.html dosyalarını sil
- [ ] Console.log temizliği (production)
- [ ] initial.sql'i production DB ile senkronize et

---

## 📋 Yeni Backlog (Nisan 2026+)

- [ ] Form Design: test all form types (conference, exhibitor formlarında tasarım testi)
- [ ] Central file storage (S3/Cloudinary) — banner images currently base64, migrate when scaling
- [x] Visitor detail panel: add edit capability ✅ 6 May 2026
- [ ] Visitor detail panel: add check-in history (all check-in timestamps)
- [ ] initial.sql sync with production DB (add missing tables/columns)

## 🔧 Tech Debt

- [ ] Mode 3 in email_worker.js is dead code (no producer). Remove in a future refactor after confirming no plans to use it.
- [ ] visitor_event_status table exists in production but not in initial.sql
- [ ] email_logs production schema has columns not in initial.sql (recipient, recipient_email, recipient_name, subject, created_at)
- [ ] Shared sidebar component (stop duplicating across HTML files)
- [ ] email_queue.campaign_id FK needs ON DELETE SET NULL (currently no cascade behavior defined)
- [ ] email_campaigns.total_sent currently counts enqueued, not delivered. Consider adding total_delivered updated by email_worker on SendGrid success.

---

## 📋 Stratejik Notlar

1. **Email stabilizasyon** — import ve public form artık email_queue kullanıyor, webhook ve emailSend/Segments hâlâ direkt SendGrid
2. **UI Unification** — sidebar component yapılınca info box + sidebar + expo indicator güncellemeleri tek yerden olur
3. **Form Design** — banner storage base64 in JSONB, küçük formlar OK ama büyük organizasyonlar için S3'e geçiş planla
4. **Floor Plan Builder** — Sprint 1-3.5 tamamlandı, production'da migration çalıştırılmalı
