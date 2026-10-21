# CLAUDE.md Arşivi — Leena EMS

> 2026-10-21'de `CLAUDE.md`'den AYNEN taşındı. Dosya 217,581 karakterdi; Claude Code'un
> dosya başı uyarı eşiği 150,000 karakter (1M bağlam). Metinler değiştirilmedi, yalnız yer
> değiştirdi. Kaynak: `CLAUDE.md` @ `fab377d` (eliza-next).
> **Bu dosya otomatik yüklenmez.** İçerik tarih kaydıdır; güncel durum sanılmaz (YON-01).
> `↪` ile başlayan satırlar taşıma notudur: o blok CLAUDE.md'de kaldı.

---

## Bilinen Buglar ve Güvenlik Sorunları — ✅ FIXED kayıtları

> ↪ CLAUDE.md'deki eski yeri: `## Bilinen Buglar ve Güvenlik Sorunları` başlığının hemen altı,
> `### KRİTİK`'ten önce. Açık maddeler (KRİTİK / YÜKSEK / ORTA) CLAUDE.md'de kaldı.

### ✅ FIXED (23 Feb 2026)

- **Public form visitor_type and form_id missing** — `visitors.js` POST /public
  - visitor_type and form_id were missing from INSERT query, all public form records had NULL
  - Fix: visitor_type fetched from forms table via form_id (authoritative source), both columns added to INSERT

- **Send Email QR not showing** — `emailSend.js` single + bulk send
  - emailSend.js never looked up existing visitor's qr_code from DB when save_to_database=false or generate_qr=false
  - Fix: added DB lookup for existing visitor QR when qrCode is null (both single and bulk routes)

- **BASE_BADGE_URL fallback** — `emailSend.js:40,153`
  - Fallback was `http://localhost:3000`, now `https://leena.app`. Uses `baseUrl` const consistently.

- **Check-in report CSV missing columns** — `checkins.js` GET /api/checkins + `checkin-reports.html`
  - visitor_type was missing from backend SELECT (Type pie chart defaulted all to 'visitor')
  - CSV export had 10 columns, now 12 (added Visitor Type + Job Title)
  - Fix: added `COALESCE(v.visitor_type, 'visitor') as visitor_type` to backend query

- **Sidebar inconsistency** — All 15 admin pages
  - 9 pages had wrong Forms link (form-builder.html → form-list.html), 13 missing Send Emails, 8 missing Re-activation, 5 missing Check-in Reports
  - Fix: all 15 admin pages standardized with unified 13-link sidebar

### ✅ FIXED (24 Feb 2026 — Sprint 1 Security Hotfix)

- ~~**Import organizer_id bug**~~ — `visitors.js:333` → Changed `req.user?.id || req.user?.organizer_id || 1` to `req.organizer_id || 1` (authMiddleware sets req.organizer_id)
- ~~**Manual registration auth missing**~~ — `visitors.js:244` → Added `authMiddleware` to `router.post('/manual')`. Frontend already sends Bearer token.
- ~~**localStorage key mismatch**~~ — `qrscanner.html:437` → Changed `localStorage.getItem('organizer_id')` to `localStorage.getItem('organizerId')` to match login.html
- ~~**Hardcoded webhook secret**~~ — `webhook.js:8` → Changed to `process.env.ZOHO_WEBHOOK_TOKEN || 'fallback'`. Env var must be set on Render.
- ~~**Badge endpoint PII leak**~~ — `visitors.js:99` → Replaced `SELECT *` with explicit columns (id, name, last_name, company, country, job_title, visitor_type, badge_id, qr_code, booth_number, badge_url, expo_id). Email and phone no longer exposed.

### ✅ FIXED (24 Feb 2026 — Sprint 3)

- ~~**Public form duplicate registration**~~ — `visitors.js` POST /public had no duplicate check. Same email+expo could create multiple records with different QR codes, invalidating the original. Fix: added upsert pattern (SELECT by lower(email)+expo_id → existing: COALESCE UPDATE + QR preserved + email resent with "(Resent)" suffix; new: INSERT as before).

### ✅ FIXED (1 Mar 2026 — Conference Certificate Fixes)

- ~~**Double client.release() in conferenceCertificates.js**~~ — Early `client.release()` calls before return statements + `finally { client.release() }` caused ERR_HTTP_HEADERS_SENT and "Release called on client already released" on production. Fix: removed all early `client.release()` calls, only `finally` block handles release.
- ~~**Conference topic registration check always failing**~~ — `splitTopics()` was splitting by comma, but topic names contain commas (e.g. "Engineering for a Healthy Buildings, Designing for Life"). Created phantom topics like "Designing for Life". Fix: `splitTopics()` now ONLY splits by `" || "` (double pipe). Comma is never a separator.
- ~~**Conference topic overwritten on re-registration**~~ — Webhook and public form upsert replaced entire `conference_topic` value. Visitor registering for Session B lost Session A. Fix: append logic with `" || "` separator + duplicate prevention in webhook.js, visitors.js /public, and conferenceCertificates.js addTopicToVisitor().

---

## Versiyon Geçmişi

### v4.0.2+ (Şubat 2026 — Mega Horeca Nigeria fuarı)

**Fuar Öncesi (9-10 Şubat):**
- Exhibitor model: visitors.visitor_type kullanımı (ayrı tablo kaldırıldı)
- visitors.booth_number kolonu eklendi
- Badge templates: visitor_type dropdown, booth/phone/sector alanları, bold/italic toggle, bulk print
- QR Scanner: exhibitor modal kaldırıldı, tüm tipler aynı akış
- Visitor log: visitor_type filtre pills + Type kolonu + backend filtre desteği
- Bulk print: Excel → /api/visitors/import API → DB'ye kayıt + QR üretimi
- Import/manual registration upsert: duplicate email → update (QR koru)
- Badge print popup (scanner sayfası açık kalır)
- Badge text wrap (ellipsis kaldırıldı, word-break, auto-size threshold 15/25)
- Test checkin temizliği (37 checkin + 20 visitor_event_status silindi)

**Fuar Sırası (11 Şubat):**
- Reactivation resend-pending endpoint + frontend (farklı template ile pending'lere tekrar gönder)
- Check-in reports sayfası (checkin-reports.html): saatlik/günlük grafik, source/ülke/type dağılımı, dönüşüm analizi, no-show tablosu, CSV export, print, mobil uyumlu
- Exhibitor lead scanner (lead-scan.html + leads.js): kamera QR okuma, firma bazlı lead toplama, vCard export, CSV export
- Terminal visitor-by-email endpoint (email ile visitor arama)
- QR scanner email fallback (input'a email yazılırsa önce email ile arar)
- QR URL parse (kamera URL formatında QR okursa qr parametresini çıkarır)
- Manual registration loading fix (isProcessing/showLoading reset)
- Badge popup boyutu: 450x300 → 600x400

**Post-Fair (23 Feb):**
- Send Email QR fix (emailSend.js: existing visitor QR lookup + BASE_BADGE_URL fallback)
- Check-in report CSV: visitor_type + job_title columns added (10 → 12)
- Check-in backend: visitor_type added to GET /api/checkins SELECT (fixes Type pie chart)
- Email templates expo-based grouping + cross-expo clone
- Forms expo-based grouping + cross-expo clone
- Terminals expo-based grouping + cross-expo clone
- Sidebar standardization: all 15 admin pages unified link list (13 links, 5 sections)
- CLAUDE.md English-only language rule added
- Reports page enhanced for Ghana fair: backend added visitor_type_breakdown, job_title_breakdown, daily_checkin_trend, checkin_by_hall, checkin_by_terminal queries to /summary; frontend added 6 stat cards, overlay line chart (reg+checkin), visitor type doughnut, country horizontal bar, job title horizontal bar, hall bar chart

**Security Hotfix (24 Feb — Sprint 1):**
- POST /api/visitors/manual: authMiddleware added (was open to unauthenticated requests)
- Import route organizer_id: fixed `req.user?.id` → `req.organizer_id` (authMiddleware pattern)
- Zoho webhook token: moved from hardcoded to `process.env.ZOHO_WEBHOOK_TOKEN` with fallback
- QR Scanner localStorage: fixed key mismatch (`organizer_id` → `organizerId` to match login.html)
- Badge endpoint PII: replaced `SELECT *` with explicit column list (email/phone no longer exposed publicly)

**Sprint 2 — UX Consistency (24 Feb):**
- Login redirect unified: all 14 admin pages now redirect to `login.html` (removed 16 `login_new.html` refs across 13 files)
- Active expo indicator: sidebar shows selected expo name (via `selectedExpoName` localStorage) on all 14 admin pages with sidebars. Hidden gracefully when no expo selected. Inserted between sidebar-header and sidebar-nav with inline style + IIFE script.
- Favicon added: `<link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon-96x96.png">` added to all 29 HTML files (admin + public pages). File: `public/assets/favicon-96x96.png`

**Sprint 3 — Login Flow Hotfix (24 Feb):**
- login.html replaced with login_new.html's Gen 4 modern UI (split-panel, Inter font, login+register tabs)
- Added missing `organizerId` to localStorage on login (required by Zoho webhook URL generation)
- Fixed post-login redirect: `main-panel-v2.html` → `dashboard_new.html` (expo selection step was skipped, causing infinite redirect loop)
- Fixed "no expo selected" redirect on 9 admin pages: `main-panel-v2.html` → `dashboard_new.html` (self-redirect loop → proper expo picker)
- login_new.html converted to simple redirect to login.html (old bookmark compatibility)
- dashboard_new.html confirmed as active expo selection page (NOT legacy — Sprint 2 incorrectly labeled it)
- Public form upsert: POST /api/visitors/public now checks email+expo_id before INSERT. Existing visitor → COALESCE UPDATE (QR preserved) + email resend with "(Resent)" subject. New visitor → INSERT as before. Fixes duplicate registration + QR invalidation bug.
- Template placeholder fix: `{{expo_name}}` added to 4 flows missing it (public form, import, reactivation activate badge email); `{{date}}` added to 10 flows missing it (webhook, import, email_worker mode2/3, reactivation create-from-excel/create-from-expo/activate/resend-pending, public form). All 13 email flows now have both placeholders.
- emailSegments.js BASE_BADGE_URL: fixed `http://localhost:3000` fallback → `https://leena.app`
- visitor_type standardized across all frontend: added "conference" type to all 4 pages (form-builder, visitorlog-paginated, badge-templates, import). Standard order: visitor, exhibitor, conference, vip, press, staff, speaker. form-builder.html radio buttons replaced with 7-option select dropdown. visitorlog-paginated.html: new filter pill + CSS badge color (.badge-type-conference orange) + JS color map.
- email_worker transaction fix: `fetchNextTask()` now uses `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`. Atomic `UPDATE status='processing' WHERE id=(SELECT ... FOR UPDATE SKIP LOCKED)` prevents duplicate email when multiple workers run concurrently.

**Custom Field Email Placeholder Fix (25 Feb):**
- Public form email template: custom_fields (e.g. `conference_topic`) were not available as template placeholders. `{{conference_topic}}` was never replaced because custom_fields was stored as a JSON string in emailData, not spread as top-level keys. Fix: `...(custom_fields || {})` added to emailData spread in `visitors.js` POST /public. Now any form-defined custom field works as `{{field_name}}` in email templates.

**Sprint 4 — Navigation Fix (25 Feb):**
- "All Expos" button fix: `goToDashboard()` in main-panel-v2.html was pointing to `main-panel-v2.html` (self-loop), fixed to `dashboard_new.html`
- Sidebar expo indicator: changed from `<div>` to `<a href="dashboard_new.html">` across all 14 admin pages — expo name is now clickable to switch expo, with `⇄` icon hint
- Webhook custom_fields fix: Zoho webhook now captures all non-standard fields (e.g. `conference_topic`) into `custom_fields` JSONB column. Custom fields are spread into emailData so `{{conference_topic}}` etc. work in email templates. Both INSERT and UPDATE queries updated.
- Webhook visitor_type fix: Zoho webhook now fetches `visitor_type` from forms table when Zoho payload doesn't include it. Priority: Zoho payload → form DB → 'visitor' fallback. Fixes conference form (form_id=31) registrations being saved as 'visitor' instead of 'conference'.

**Sprint 5 — Import Enhancement (26 Feb):**
- Import custom_fields extraction: Excel columns not in `knownColumns` Set are stored as `custom_fields` JSONB (e.g. `conference_topic`). Both UPDATE (merge) and INSERT paths updated.
- Import existing visitor email options: new `existing_email_option` param — `none` (default), `resent` (subject + "(Resent)"), `first_time` (original subject). Each requires explicit template selection via `existing_template_id`.
- Import existing visitor QR options: new `existing_qr_option` param — `keep` (default, preserves QR), `regenerate` (new UUID + badge_id). Warning shown in UI.
- Import email template placeholders: `...customFields` spread into templateData for both UPDATE and INSERT paths. `{{conference_topic}}` and any custom Excel column now works in email templates.
- Import INSERT path fix: `JSON.stringify(row)` → `JSON.stringify(customFields)` — previously stored entire row object including known fields.
- Frontend import.html: new "Existing Visitor Options" card with email/QR dropdowns + conditional template selector. Template required when email option is active.
- Backward compatible: no params sent = old behavior (no email for existing, QR kept).
- Import history log: new `import_logs` table stores per-import stats (new/updated/failed/emails/qr_regen/custom_fields_updated counts, errors array, options used). `GET /api/visitors/import-logs` endpoint with pagination. Frontend "Import History" section with paginated table (20 per page), color-coded stats, expandable error details. Auto-refreshes after each import.
- New counter: `custom_fields_updated_count` tracks how many rows had custom fields (non-standard Excel columns) stored.

**Sprint 6 — Visitors Page Enhancement + Conference Sessions (26 Feb):**
- Visitors page (visitorlog-paginated.html) enhanced with Conference Topic dropdown filter, Job Title and Conference Topic columns in table, active filter count badge on Apply button, and URL param support (?conference_topic=X, ?visitor_type=X pre-apply filters on page load).
- Export fix: `exportData()` changed from `window.location.href` to `fetch()` + blob download pattern — supports auth header for authenticated downloads.
- New backend endpoint: `GET /api/visitors/export` — exports ALL filtered visitors as .xlsx (same filters as /paginated but no pagination limit). Uses XLSX library. Columns: Name, Last Name, Email, Company, Country, Phone, Job Title, Visitor Type, Source, Booth Number, Conference Topic, Registered Date, QR Code.
- New backend endpoint: `GET /api/visitors/conference-topics` — returns conference topics with registered_count and checked_in_count. Groups by `custom_fields->>'conference_topic'`, LEFT JOINs with checkins for check-in data.
- `/paginated` endpoint enhanced: new optional `conference_topic` query param filters by `custom_fields->>'conference_topic'`. New computed column `custom_fields->>'conference_topic' as conference_topic` added to SELECT (single string, NOT whole JSONB blob). Existing consumers unaffected.
- New page: `conference-sessions.html` — Gen 3 design, conference topic tracking dashboard. Stats cards (Total Topics, Total Registrations, Total Checked In), table with Topic/Registered/Checked In/Conversion%/Actions, summary bar. Actions: View Attendees (→ visitorlog with filter), Send Email (→ email-send), Export Topic (→ xlsx download).
- Sidebar updated: "Conferences" link (bi-mortarboard icon) added to all 14 admin page sidebars after "Terminals". Total sidebar links now 14 (was 13).
- email-send.html conference_topic URL param: when navigating from conference-sessions.html "Email" button with `?conference_topic=X`, auto-fetches all matching visitors, switches to bulk mode, pre-fills recipient list, shows conference banner. Save-to-database auto-disabled (already in DB).
- New page: `email-history.html` — Gen 3 design, paginated email send history. Stats cards (Total Emails, Successful, Failed, Delivery Rate %). Filters: Template dropdown, Status (Sent/Failed), Email search. Table: Date & Time, Recipient (email + visitor name), Template, Status (color-coded badge), Details. Pagination with page numbers.
- New endpoint: `GET /api/email-send/history` — paginated email_logs with LEFT JOIN to email_templates and visitors for names. Filters: expo_id (required), template_id, status, search (ILIKE). Includes stats (total_sent, total_failed). Response: `{success, logs[], total, page, totalPages, stats}`.
- email-send.html: "History" button added to header (navigates to email-history.html).

**Conference Certificate System (1 Mar 2026 — Mega Clima Ghana):**
- New table: `conference_certificates` (visitor_id, expo_id, conference_topic, certificate_token UNIQUE, email_sent). UNIQUE constraint on (visitor_id, expo_id, conference_topic) prevents duplicates.
- New route file: `routes/conferenceCertificates.js` — 5 endpoints: POST /checkin-and-certify (terminalAuth), POST /resend (terminalAuth), GET /verify/:token (public), GET /topics (terminalAuth), GET /stats (JWT).
- New page: `conference-scanner.html` — mobile-first hostess QR scanner with topic selector, camera QR (html5-qrcode), result cards, scan log. Terminal auth via URL param.
- New page: `certificate.html` — public certificate view with elegant design (Playfair Display font, gold border, A4 landscape print CSS). "Save as PDF" via window.print().
- Certificate email: inline HTML template with "View Certificate" button linking to certificate.html?token=X. Queued via email_queue Mode 1.
- Conference check-ins stored in standard `checkins` table (source='conference-cert', notes='Conference: TOPIC') — appear in existing reports.
- index.js: route mount added (line 86 load, line 108 mount).

**Conference Certificate Refinements (1-3 Mar 2026):**
- Registration check fix: `isVisitorRegisteredForTopic()` — case-insensitive, splits by `" || "` only (commas are in topic names, not separators)
- Topic append logic: webhook.js + visitors.js /public merge conference_topic with `" || "` separator on re-registration (prevents overwrite, duplicate-safe)
- `splitTopics()` helper: ONLY splits by `" || "` — topic names contain commas (e.g. "Engineering for a Healthy Buildings, Designing for Life")
- Double `client.release()` fix: removed early release calls, only `finally` block releases (fixed ERR_HTTP_HEADERS_SENT on production)
- New endpoint: `POST /api/conference-certificates/resend` — resends existing certificate email using stored token, no new cert created
- Duplicate scan UX: overlay persists with "Resend Certificate" + "Dismiss" buttons (no auto-dismiss)
- Conference topic filters: `/paginated` and `/export` changed from `=` to `ILIKE` for multi-topic support
- `/conference-topics` and `/topics` endpoints unnest `" || "`-separated values into individual topic counts

**Floor Plan Builder — Sprint 1 COMPLETED (30 Mar 2026):**
- New module: Floor Plan Builder (ELL Extension) — spatial CRM layer for expo stand management
- 5 new DB tables: `expo_halls`, `expo_floorplan_versions`, `expo_stands`, `expo_stand_cells`, `expo_stand_assignments` (Phase 2 stub)
- DB features new to codebase: `GENERATED ALWAYS AS` column (total_area_sqm), PostgreSQL trigger (`fn_update_stand_size_m2`), partial unique index (one active version per hall)
- Migration: `migrations/001_floorplan_tables.sql` — run on Render Shell: `psql $DATABASE_INTERNAL_URL -f migrations/001_floorplan_tables.sql`
- New route: `routes/floorplan.js` — 8 endpoints (halls CRUD, versions list+create, stands list+create+delete)
- Stand creation uses transaction (`pool.connect()` + `BEGIN/COMMIT/ROLLBACK`) with batch cell INSERT
- Draft-only enforcement: stand create/delete blocked on active/archived versions
- Optional stand_code: if omitted, auto-generates `S-{id}` after INSERT
- Frontend: `floorplan-builder.html` + 5 ES module files in `public/floorplan/` (state.js, grid.js, stands.js, toolbar.js, api.js)
- Canvas: Konva.js (CDN, v9.3.15) — grid rendering, zoom/pan, rectangular marquee selection, stand boundary rendering
- State: `FloorPlanState` class with event emitter pattern (state.js). `_cellMap` provides O(1) lookup for `getStandAtCell()` and `getOccupiedCells()`
- Stand rendering: no internal cell lines, outer boundary as separate Konva.Line segments. Labels: stand_code bottom-left, m² bottom-right, company name centered (bounding box based)
- Organizer isolation: `expo_halls.organizer_id` direct, sub-tables via JOIN chain (version→hall→organizer)
- Sidebar: standard Leena sidebar + "Floor Plan" link (bi-grid-3x3 icon, under Management section)
- index.js: 2 lines added (require + mount at `/api/floorplan`)
- Spec file: `ELL_FloorPlan_Builder_Spec_v2.md` in repo root
- **Summary:** 5 DB tables, 8 API endpoints, 6 frontend modules (1 HTML + 5 ES modules), Vanilla JS + Konva.js (CDN), no React, no build tools

**Floor Plan Builder — Sprint 2 COMPLETED (30 Mar 2026):**
- Stand update: `PUT /api/floorplan/stands/:id` — general fields (structural changes require draft, commercial fields allowed on active per Invariant #2)
- Commercial status change: `PUT /api/floorplan/stands/:id/status` — quick status dropdown in detail panel, instant save, works on active versions
- Inline editing: detail panel with company name, display label, notes inputs + Save Changes button
- Stand color selection: 10-color pastel palette stored in `metadata.color` JSONB field. Custom color overrides status color in grid rendering (`getStandColor()` checks metadata first). `darkenColor()` generates matching stroke.
- Special area type selector: create dialog shows `special_area_type` dropdown (vip, conference, registration, entrance, exit, technical, other) when `area_kind='special'` selected
- Version activate/archive: `POST /api/floorplan/versions/:id/activate` — draft→active transition, archives current active (transaction). `PUT /api/floorplan/versions/:id` for label/notes update. Activate button (green checkmark) visible only for draft versions.
- Background image overlay: PNG/JPG upload as reference behind grid. Stored in localStorage (base64, per expo+hall). Opacity slider 5%-100%. Grid background rect becomes semi-transparent when image present. New `bgLayer` below `gridLayer`.
- Stats bar live update: `standUpdated` event triggers `updateStats()` + `drawStands()` on every status/field change
- 4 new endpoints: PUT stands/:id, PUT stands/:id/status, POST versions/:id/activate, PUT versions/:id
- **Summary:** Total 12 API endpoints (8 Sprint 1 + 4 Sprint 2)

**Floor Plan Builder — Sprint 3 COMPLETED (31 Mar 2026):**
- Stand split: `POST /api/floorplan/stands/:id/split` — dialog-based horizontal/vertical split at bounding box midpoint. Auto-suggests codes (B3a/B3b). Transaction validates complete cell coverage.
- Stand merge: `POST /api/floorplan/stands/merge` — Shift+click multi-select → merge button → new code prompt. Inherits properties from first stand.
- Version clone: `POST /api/floorplan/versions/:id/clone` — deep copy all stands + cells. Optional `clear_assignments` resets company/status.
- PNG export: client-side `stage.toDataURL({ pixelRatio: 2 })`, auto-download `floorplan-{hall}-v{num}.png`. Includes background image.
- Stand duplicate: copy template (zone, area_kind, metadata) → draw mode → pre-filled create dialog with `{code}-copy` suggestion.
- Stand drag-to-move: `PUT /api/floorplan/stands/:id/move` — ghost overlay (green=valid, red=invalid), grid snap, draft-only. DB uniqueness constraint prevents overlap.
- Multi-stand drag: Shift+click or marquee-select multiple stands → drag all together. Parallel `moveStand()` API calls on commit.
- Select-mode marquee selection: left-drag on empty area → rectangle → selects all stands with cells inside.
- Pan controls: `stage.draggable = false`. Middle mouse button + drag OR Space + left drag = manual pan. Scroll wheel = zoom (unchanged).
- 4 new endpoints: POST stands/:id/split, POST stands/merge, POST versions/:id/clone, PUT stands/:id/move
- **Summary:** Total 16 API endpoints (8 Sprint 1 + 4 Sprint 2 + 4 Sprint 3)

**Floor Plan Builder — Sprint 3.5 Polish (31 Mar 2026):**
- Trackpad pan/zoom: wheel without Ctrl = pan (deltaX/deltaY), Ctrl+wheel or pinch = zoom. Works on MacBook trackpad natively.
- Bulk duplicate: multi-select → "Duplicate All" button. Copies all selected stands offset to the right (or below if no room). Codes get `-c` suffix, commercial_status reset to available.
- Erase mode improved: clicking a stand cell in erase mode → confirm + delete entire stand (not just pending cells)
- Grid rulers: meter markers every 5 cells on top and left edges (9px grey text, cached with grid)
- Selection glow: selected/multi-selected stands get blue shadow rect (4px, opacity 0.3) behind boundary
- Fit to view: already auto-called on hall/version change (verified)

### v4.0.3 (Nisan 2026)

**Form Design Customization (17-20 April):**
- `forms.config` JSONB column activated for style configuration (was unused since initial.sql)
- Style system: headerBanner (image/color/gradient/height), footerBanner (same + text), primaryColor, backgroundColor, fontFamily, buttonText, borderRadius
- Banner images stored as base64 in JSONB (max 500KB, Render ephemeral disk workaround)
- form-builder.html: "Design" tab with color pickers, banner upload, font selection, live preview
- form-public.html: `applyFormStyle(config)` dynamically applies styles. Null config → hardcoded defaults preserved
- reactivate.html: Same style system. form_config from verify endpoint. Null → yellow theme preserved
- `POST /api/forms/upload-banner`: multer memoryStorage, returns base64 data URI
- `migrations/002_reactivation_form_id.sql`: adds `form_id` to `reactivation_tokens`
- body-parser limit: 100KB → 2MB in index.js (`express.json({ limit: '2mb' })`)
- Fix: removed JSON.stringify for JSONB config (was double-encoding), added typeof string parse fallback

**Conference Topic Email Fix (7 April):**
- `formatConferenceTopic()` in utils/email.js — multi-topic → HTML `<ul>` bullet list
- Applied in visitors.js (public form) and email_worker.js (Mode 2 template)
- Single topic: plain text unchanged. Null/empty: empty string

**Import Skip Existing (20 April):**
- `skip_existing` parameter in POST /api/visitors/import
- When true: existing visitors completely skipped (no update, counted in `skipped_count`)
- import.html: radio "Update info (keep QR)" vs "Skip entirely", hides email/QR options when skip selected
- Results display: shows new/updated/skipped/failed/emails counts

**Visitor Detail Panel + Email History (20 April):**
- `GET /api/visitors/:id/emails` — returns email_queue + email_logs history for visitor
- visitorlog-paginated.html: click row → slide-in panel (480px, right side)
- Panel: visitor info grid + email timeline (status icons, subject, date, errors)
- Queries by both visitor_id AND email address (comprehensive history)

**UI Help Info Boxes (20 April):**
- All 20 admin pages have contextual bilingual help boxes (EN main + TR translation)
- Dismissible (X → localStorage per page), re-openable ("ℹ️ Help" toggle)
- Page-specific content: what it does, key info, tips, differences from similar pages

**Floor Plan Builder Fixes (31 Mar - 7 Apr):**
- Zoom: mouse wheel=zoom, trackpad two-finger=pan, Ctrl+wheel/pinch=zoom
- Duplicate: no stand_code → backend auto-assigns S-{id}
- Zoom buttons (+/−) in top bar

**Floor Plan Builder — Sprint 4 Backlog:**
- Background image UX (resize, reposition, alignment)
- Batch stand workflow (draw large area → split into grid)
- PDF export (branded, server-side — Phase 2)
- Connected shape validation (cell adjacency)
- Sidebar link to existing 15 admin pages
- Stand resize (edge drag)

**Yaprak Feedback Sprint A+B (5-6 May 2026):**
- Visitor count display bug fix: `COUNT(*)::int` cast in expos.js (3 endpoints), `parseInt()` defense in dashboard_new.html. Root cause: pg driver serializes bigint as string → JS string concatenation instead of addition.
- Campaign delete extended: new `requireDeletable` helper (draft/completed/paused), `email_queue` pre-cleanup to prevent FK violation, Delete button on list view (non-active only)
- Campaign completion logic fix: `computeNextDue` marks recipient `status='completed'` when no more steps. Previously stayed 'active' forever, blocking `checkCampaignCompletion`. See ADR-016.
- One-time data migration (5 May 2026 Render Shell): 37,574 stuck recipients + 11 campaigns → completed
- `PUT /api/visitors/:id`: authMiddleware, COALESCE(NULLIF()) pattern, email duplicate check (409), qr_code/badge_id route-level protection (never in UPDATE list)
- Inline edit UI in visitor detail panel: Edit button, input form, Save/Cancel, visitor_type dropdown, table auto-refresh
- Toast Bootstrap conflict fix: `.toast` → `.app-toast` (Bootstrap 5 .toast class override caused 0×0 rendering)
- `badge_id` added to `/paginated` SELECT (was missing from detail panel display)

**Yaprak Feedback Sprint C + Email Bug Fix + Madde 10 (7 May 2026):**
- Source filter: replaced 5 fixed pills with searchable text input + datalist, `GET /api/visitors/sources` endpoint, ILIKE partial match
- Conference topic edit: `jsonb_set` for `custom_fields.conference_topic` in PUT endpoint, only shown for `visitor_type='conference'`
- Send Email button in visitor detail panel: template dropdown, `POST /api/email-send/single` integration, double-click protection
- Prev/next visitor navigation: `< >` buttons in panel header, keyboard shortcuts (ArrowLeft/ArrowRight), edit mode confirm dialog
- Email queue bug fix (Fix 1): Mode 1 email_queue INSERTs now include `visitor_id, expo_id, organizer_id, template_id` (3 locations in visitors.js)
- Email queue bug fix (Fix 2): Removed duplicate 'queued' email_logs INSERTs from routes (4 locations). Worker `logToEmailLogs` is now sole log writer.
- Email queue cleanup: 6,396 ghost 'queued' email_logs updated to 'sent' via SQL transaction
- Email status filter: `email_status` query param on `/paginated` and `/export` (never_sent/sent). Uses EXISTS on email_logs with email fallback for historical NULL visitor_id logs (~227ms, acceptable).
- `buildVisitorFilter` helper: extracted shared filter logic from /paginated and /export, also used by /bulk-email
- Bulk email send: `POST /api/visitors/bulk-email` — transaction-wrapped batch INSERT (1K chunks, 10K limit), template+expo ownership check, Mode 2 queue. Frontend modal with template selector and confirm dialog.

**UI Quick Fixes Sprint 1 + Sprint 2 (7 May 2026):**
- Shared toast component (`leena-toast.js`): replaces inline alert()/toast across 21 admin pages. ~73 alert() instances migrated to showToast(). Resolves Bootstrap .toast class conflict in email-campaigns.html. Net -16 lines via DRY.
- Shared fetch wrapper (`leena-fetch.js`): auto-attaches Authorization header, handles 401/403 with auto-logout + redirect, 15s timeout via AbortController, concurrent 401 protection. Migrated in 3 high-traffic pages: visitorlog, email-campaigns, dashboard_new.
- Bulk send filter guard: visitorlog button now requires active filter (prevents accidental send to entire expo).
- Public form error: form-public.html alert() → inline error div for better visitor UX.
- Accessibility: ARIA labels on visitor detail panel buttons (prev/next/edit/close); conference-scanner viewport zoom restored (WCAG 2.1).
- Loading indicator: email-campaigns.html now shows spinner during loadCampaigns().
- Backend COUNT::int cast: reports.js (63 instances) + checkins.js (11 instances). Closes Sprint A gap. Other 11 route files deferred (frontend parseInt() defensive).

### v4.0.4 — Mega Clima Nigeria 2026 Pre-Fair Sprint (15 May 2026)

**Context:** Fuara 4 gün kala (19-21 May, Lagos) toplu UX hardening + 
data quality fixes. 10 production commit, hepsi backward compatible. 
Migration yok (1 webhook auto-split + 1 one-off DB cleanup).

#### Conference Scanner Hardening (commit 27ddae7)
- `public/conference-scanner.html` — pre-display visitor preview + force confirm modal
- Hostess QR scan ettiğinde visitor'ın registered topic'leri ekrana basılır
- "Save & Send Certificate" force butonu artık custom confirm modal'la korunmuş
- Backend untouched
- Audit: CONFERENCE_FORCE_AUDIT_20260514.md

#### qrscanner Country Default (commit d1464b7)
- `public/qrscanner.html:582` — country default `'Morocco' → 'Nigeria'`
- Dropdown options preserved (Morocco still selectable)

#### Hostess Quick Reference Card (commit 7e852ba)
- New page: `public/hostess-guide.html` (10KB, self-contained, no external deps)
- 8 crisis-moment scenarios: force button, not-registered, QR fails, badge redirect, wrong page, cert resend, escalation, offline fallback
- Mobile-first, sticky jump bar, severity color coding
- Production URL: https://leena.app/hostess-guide.html
- Suer needs to fill bookmark URL in Senaryo 5 (placeholder)

#### Terminal Default Visitor Type (commit 86c3738)
- `public/qrscanner.html` — manual registration's visitor_type dropdown defaults to the terminal's badge template visitor_type
- Uses existing `/api/badge-templates/for-terminal/:terminalKey` endpoint (no new endpoint)
- Dropdown remains editable
- Backend/DB unchanged

#### form-public QR Display on Success (commit 9a94447)
- `public/form-public.html` — submit response's `qr_code` rendered as `<img src="/api/qr-image/${qr}">` in success card
- "Show this QR at the entrance" message
- Use case: visitors who don't receive confirmation email can still enter via on-screen QR
- Backend already returned qr_code (no backend change)

#### Manual Registration Reason Field (commit 439eb0e)
- `public/qrscanner.html` — required "Why manual?" dropdown added to manual registration form
- Options: No internet / Did not receive email / Speaker / VIP / Press / Long queue / Other (with conditional text input)
- `routes/visitors.js` `/api/visitors/manual` — accepts manual_reason, merges into custom_fields JSONB
- Backward compatible: missing manual_reason → null, doesn't break existing flow
- Stored as `custom_fields.manual_reason` (string)

#### Badge Preview Type Fix (commit 5606ef6)
- `public/badge.html:295` — preview mode now reflects selected template's visitor_type instead of hardcoded 'VIP'
- Real-print path (else branch) untouched
- Audit: BUG_6_DEEPDIVE_20260515.md (Senaryo 1 — preview-only kozmetik)

#### Smart Capitalize Badge Type (commit d9908d9)
- `public/badge.html` — `formatRole()` helper added: Title Case for normal words, UPPERCASE for known acronyms (vip, ceo, cto, cfo, vp, md)
- Applied at single render site (line 377), affects both preview and real-print paths
- DB unchanged (display-only transformation)
- `esc()` XSS protection preserved (wraps formatRole output)

#### Zoho Day1/Day2 Auto-Split Webhook (commit 6dd34ca)
- `routes/webhook.js` — new `normalizeConferenceTopic()` helper + try-catch guard
- Detects exact MERGED_DAY12 string (Zoho form 39's merged "Day 1 & Day 2" option) and splits into Topic 1 + Topic 5 (canonical form 39 strings)
- Strict exact-match detection (no substring/regex) — zero false-positive risk
- Insertion point: after customFields loop (line ~74), before new/existing visitor branch — covers both INSERT and append-merge paths
- Fail-safe: try-catch pass-through on any error (preserves current behavior)
- Backward compatible: non-matching values byte-identical to current behavior
- Audit: DAY1_DAY2_ISSUE_RESEARCH_20260515.md + WEBHOOK_DAY1_DAY2_FIX_PLAN_20260515.md

#### Day1/Day2 Historical Cleanup (one-off DB, no commit)
- 2 pre-deploy visitors (id 55052, 55909) had merged "Day 1 & Day 2" conference_topic — manually split via Render Shell heredoc, NOT a migration
- Backup table: `conference_topic_backup_20260518` (2 rows, preserved for post-fair drop)
- Pattern: BEGIN; UPDATE ... RETURNING ...; (verify) COMMIT;
- Validated POST-COMMIT: merged_rows_remaining = 0, split_rows_total = 87

#### Post-Fair Backlog (yarın için karar)
- **Request #1**: Token-protected bulk badge print page (HIGH risk, ~yarım-1 gün, security infrastructure)
- **Request #3**: Manual Registration on/off toggle per terminal (LOW-MED risk, migration 008, ~2-3 saat)
- Decisions pending: see REQUESTS_1_AND_3_ANALYSIS_20260515.md

#### Smoke Test Status
- Yaprak confirmed: form-public QR display works ✅
- Yaprak confirmed: badge preview shows SPEAKER (capitalize) ✅
- Other 8 commits: smoke test pending (Yaprak + Suer post-doc-update)

### v4.0.5 — Mega Clima Nigeria 2026 Pre-Fair Sprint Day 2 (18 May 2026)

**Context:** Fuara 1 gün kala (19-21 May, Landmark Centre, Lagos) ikinci pre-fair sprint.
**5 production commit** + 2 migration + 1 DB cleanup/token oluşturma + 1 yeni endpoint.
Hepsi backward compatible. Tüm yeni davranışlar expo-scoped veya additive — mevcut
fuarlar (Ghana expo 5 vb.) etkilenmez.

#### Per-Terminal Manual Registration Toggle (commit 1324296)
- Migration 008: `terminals.allow_manual_registration BOOLEAN DEFAULT TRUE NOT NULL` (production'da uygulandı; 20 terminal default TRUE)
- `POST/PUT /api/terminals` body'de `allow_manual_registration` kabul (snake_case; backward compat: yoksa TRUE / değişmez)
- `GET /api/badge-templates/for-terminal/:key` response'a `allowManualRegistration` (camelCase, terminal objesi konvansiyonu)
- `public/terminals.html`: "Manual Reg" checkbox (Add form + her satır inline toggle, snake_case body)
- `public/qrscanner.html`: `applyTerminalManualRegToggle()` — flag false ise Manual Registration checkbox disabled + not (ayrı fonksiyon; `applyTerminalDefaultType` dokunulmadı)
- Yaprak request #3. Frontend enforcement (`/api/visitors/manual` gate'lenmedi — kapsam dışı)
- Clone bug deferred: `POST /api/terminals/clone/:id` yeni kolonu kopyalamıyor → DB DEFAULT TRUE (post-fair)
- Suer tested ✅

#### Token-Protected Public Bulk Badge Print (commit 5a66070)
- Migration 009: `terminals.kind VARCHAR(20) DEFAULT 'scanner' NOT NULL` + `idx_terminals_kind` (production'da uygulandı; 20 terminal kind=scanner)
- Yeni `middleware/dualAuth.js`: `Authorization: Bearer` → JWT path (authMiddleware ile byte-identical); `x-terminal-key` → kendi terminal SELECT'i + `kind='bulk_print'` gate (403 WRONG_TERMINAL_KIND). `terminalAuth.js` dokunulmadı (scanner/cert/lead route'ları etkilenmez)
- `routes/visitors.js`: `/paginated` + `/import` `authMiddleware` → `dualAuth` swap; token mode'da `expo_id = req.scopedExpoId` (token'dan zorlanır, cross-expo leak yok). JWT path byte-identical
- `public/bulk-badge-print.html` (390 satır, self-contained): `?key=` token, for-terminal `kind` ile gate, Excel upload + DB-from-paginated modu, badge-templates.html modal mantığı port (loadBulkData/executeBulkPrint/generateBulkPrintHTML verbatim), tüm fetch `x-terminal-key`
- `GET /api/badge-templates/for-terminal/:key` response'a `kind` (camelCase, additive — qrscanner #2 etkilenmez)
- Yaprak request #1. Single-organizer sadeleştirme: organizer_id zorlama YOK (sadece Elan Expo; multi-tenant guard post-fair). JWT organizer_id filter zayıflığı (`buildVisitorFilter` sadece expo_id filtreliyor) bilinen, post-fair backlog
- Suer tested ✅ (Mega Clima + Mega Water token'ları)

#### Nigeria Certificate Expo-Gated Branch (commit 9a20641)
- `routes/conferenceCertificates.js`: `/verify/:token` response'a `expo_id` (1 satır additive); yeni `CERT_EMAIL_TEMPLATE_NG` const (yeşil #54AF3A tema, "19–21 May 2026 • Landmark Centre, Lagos", westafricahvacexpo.com asset, Ghana template **yapısıyla birebir** — sadece branding swap). `issueCertificate` + `/resend`: `Number(expoId)===7 ? NG : Ghana`. Ghana `CERT_EMAIL_TEMPLATE` byte-identical (dokunulmadı)
- `public/certificate-ng.html` (yeni): Yaprak `certificate 2.html` markup+CSS **byte-identical** (cp, satır 1-588) + yeni `<script>` (`/verify/:token` → `.field`/`.topic`/`.cert-id` data binding, fetch öncesi gizle, hata overlay)
- `public/certificate.html`: +6 satır JS — `Number(cert.expo_id)===7` → `location.replace('certificate-ng.html'+search)`. Ghana HTML/CSS + DOM-injection **byte-identical**
- Method A2 (ayrı dosya + redirect); Method B (DOM override) reddedildi (Ghana ↔ Yaprak Nigeria template yapısal divergence). cert-id format: `MCN-2026-<token[0:10]>`. "9th International Mega Clima Expo Nigeria 2026" hardcoded (Suer onayı, expo-7'ye özel dosya)
- Forward-only (deploy anında expo 7'de 0 cert). **Test pending** (fuar günü)

#### Cool Plus Topic Block (commit 02e0692)
- Yaprak request: Topics 1, 5, 11 (Cool Plus Limited oturumları) Leena sertifikası ALMAMALI — Cool Plus kendi sertifikasını verir
- `routes/conferenceCertificates.js` helper'ları: `getCoolPlusBlockedTopics(expoId)` (form 39 options [0,4,10] canlı çek; module-level `coolPlusCache` lazy; **fail-OPEN**: DB hatası → boş Set + console.error → sertifika akışı durmaz), `isTopicBlocked` (" || " split + segment normalize + Set.has), `coolPlusBlockResponse` (`code:'COOL_PLUS_BLOCKED'`). `normalizeTopic`: `NFKC + trim + lowercase`
- 3-dokunuş tasarım: `issueCertificate` guard **EN BAŞTA** (blocked → check-in INSERT + visitor_event_status upsert normal akışla **byte-identical SQL**, A1 attendance korunur; cert+email atlanır; `return {blocked,blocked_topic}`) + `checkin-and-certify` caller `if(result.blocked){COMMIT; return coolPlusBlockResponse}` (duplicate branch'ten önce, değişmedi) + `/resend` guard
- `public/conference-scanner.html`: yeni turuncu `blocked-overlay` (success/error/duplicate'ten ayrı; duplicate'in Resend butonu çelişkisi nedeniyle reuse edilmedi), 2sn auto-dismiss (workflow kırılmaz), `confirmAndIssue` + `forceCertify` ikisinde `code==='COOL_PLUS_BLOCKED'` guard (`!success`'ten önce), scan log "Cool Plus". Saf additive
- Rescan dedup (a) kabul: aynı Cool Plus visitor 2 kez taranırsa 2 check-in (cert row yok; sistemde çoklu check-in olağan; post-fair polish)
- Scope: SADECE `expo_id=7`. Forward-only. Diğer expo'lar sıfır davranış değişikliği. **Test pending** (fuar günü)

#### Preemptive Cool Plus Warning + Force Microcopy (commit d858391)
- Yeni `GET /api/conference-certificates/blocked-topics` (terminalAuth, expo-scoped, `getCoolPlusBlockedTopics` reuse, fail-open; **normalize/lowercase string** döner)
- `public/conference-scanner.html`: `loadBlockedTopics()` (sayfa açılışta cache; fail-open boş Set) + `isClientSideBlocked` (backend ile birebir NFKC normalize + " || " split) + dropdown change → selector altı turuncu uyarı + `showVisitorPreview` turuncu banner + Confirm disable + `showUnregCard` Force disable. Saf additive, yeni CSS rule yok (inline + `.pv-match-banner` reuse)
- Defense-in-depth: backend block (02e0692) otoriter — frontend disable bypass edilse bile reject. Fail-safe: endpoint fail → frontend uyarı yok ama backend reddeder
- Mikrokopi: mismatch banner "force will be needed" → "click Confirm to proceed with force certification" (class/yapı dokunulmadı)
- Suer tested ✅ (mobile)

#### Migrations (production'da uygulandı, Render Shell heredoc)
- `008_add_allow_manual_registration_to_terminals.sql` — idempotent IF NOT EXISTS; 20 terminal allow_true
- `009_add_kind_to_terminals.sql` — idempotent; kind=scanner ×20; idx_terminals_kind

#### Tokens / DB ops (no commit, Render Shell)
- Bulk print token — Mega Clima Nigeria (expo 7): `50a9d2a4-76b4-437a-818e-271193777fff`
- Bulk print token — Nigeria Mega Water (expo 8): `77565c52-fee4-40d9-a378-22c5112529a2`
- Conference scanner terminal — Mega Clima Nigeria (expo 7): `7a7537d3-62e5-4ec6-aaca-1d9846e8d16e` (hall='Conference', terminal_no='1', badge_template_id=16, allow_manual_registration=FALSE)

#### Key Decisions / Learnings
- Single-organizer sadeleştirme: bulk-print'te organizer_id enforcement atlandı (sadece Elan Expo; multi-tenant guard deferred)
- JWT organizer_id filter zayıflığı: `/paginated` + `/import` `buildVisitorFilter` sadece expo_id filtreliyor — post-fair backlog
- Certificate redesign Method A2 (ayrı dosya + redirect) > Method B (DOM override): Ghana ve Yaprak Nigeria template yapısal divergence
- Cool Plus block: form 39 canonical string NFKC normalize; defense-in-depth (backend guard + frontend preemptive UI); DB hatasında fail-open
- Conference scanner URL param adı: `terminal_key` (bulk-badge-print.html `key=` kullanır — farklı)

#### Test Status
- Suer tested ✅: 1324296 (manual reg toggle), 5a66070 (bulk print, 2 token), d858391 (preemptive warning, mobile)
- Pending (fuar günü Yaprak/Suer): 9a20641 (Nigeria certificate), 02e0692 (Cool Plus block)

### v4.0.6 — Nigeria Mega Project Expo 2026 Pre-Fair Sprint (18 August 2026)

**Context:** Nigeria Mega Project Expo 2026 (`expo_id=13`, 25-27 Aug, Lagos) opens in 7 days.
Discovery pass on 18 Aug found the repo was NOT dormant since May — the ELL finance module
(migrations 012-028) and an undocumented Expo Operations module (migration 010, 18 June) both
landed in this repo. See `DISCOVERY_20260818.md` and `EXEC_BRIEF_02_FINDINGS.md` (untracked).

**3 code commits.** No migration, no schema change. All additive and backward compatible.
Deployed together in a single restart to minimise the Zoho webhook exposure window.

#### Reactivate form required fields (commit 8799ccd)
- `public/reactivate.html:380-381,386-387` — `required` attribute + ` *` label marker added to
  Job Title and Phone
- Root cause: the page renders a **hardcoded** 7-field block (`:353-391`); the `*` is a literal
  character typed into the label string, and `required` was hardcoded on `#name` and `#company`
  only. There is no required-marker mechanism on this page.
- The config was already correct: `forms.fields` for form 53 has
  `{"name":"title","label":"Job Title / Position","required":true}`. The page never reads it —
  `GET /api/reactivation/verify/:token` (`reactivation.js:471`) returns `f.config` (**style**),
  not `f.fields`.
- Client-side only. The submit listener is bound to the **form's submit event**
  (`reactivate.html:504`), so browser constraint validation runs before the handler — no JS
  validation logic needed.
- `POST /api/reactivation/activate` untouched: still validates only `token`
  (`reactivation.js:533`), and its `job_title || tokenData.job_title` fallback
  (`reactivation.js:599`) is preserved.
- `last_name` is `required:true` in config but deliberately left unmarked (out of scope).
- Context: 9,651 reactivation tokens on expo 13 (9,326 pending), all `form_id=53`.

#### Zoho `title` → `job_title` column (commit 32501ed)
- `routes/webhook.js:55` — `??` chain replaced with
  `req.body.jobTitle || req.body.job_title || req.body.title || ''`
- Root cause: Zoho posts the job title as **`title`** (lowercase — form 53's field is literally
  named `title`). The handler read only `jobTitle`/`job_title`, so the value landed in
  `custom_fields` instead of the column.
- Measured before fix (expo 13): `origin=zohoform` 1,770 rows → **54 (3%)** had `job_title`;
  `origin=public` 113 rows → **110 (97%)**. Same key, both paths; `visitors.js:207` already
  read `title`, the webhook did not.
- Operator `??` → `||` to match `visitors.js:207`. Production data shows `??` would also have
  worked (the phone fix at `webhook.js:57` uses `??` and fills **99.9%** of 1,910 post-fix
  rows, proving Zoho **omits** absent keys rather than sending empty strings), but `||` also
  falls through on `''` and stays correct if Zoho ever starts emitting empty values.
- **`knownFields` (`webhook.js:63-68`) deliberately NOT changed** — `title` keeps duplicating
  into `custom_fields`, which is the safety net that keeps 1,776 rows recoverable. Post-fair cleanup.
- Forward-only. Backfill of 1,776 rows across 4 expos (1,756 on expo 13) is a separate manual
  Render Shell step, run AFTER this fix is confirmed live.

#### Check-in report job title fallback (commit 52cc27e)
- `routes/checkinReports.js:47` — `v.job_title as direct_job_title` added to the
  `ranked_checkins` CTE (mirrors the existing `v.country as direct_country` pattern)
- `routes/checkinReports.js:73` — `custom_fields->>'job_title' as job_title` →
  `COALESCE(NULLIF(custom_fields->>'job_title',''), NULLIF(direct_job_title,''), '')`
- Without this, the "by job title" breakdown stays empty even after the webhook fix and the
  backfill, because both write the **column** while this report read only the JSONB key.
- Measured against production (read-only) on `valid_checkins`:
  expo 7 `1034 → 2142 / 2214`; expo 3 `793 → 2052 / 2166`; expo 5 `408 → 560 / 587`;
  expo 8 `69 → 88 / 91`.
- **Uses `NULLIF`, unlike `checkins.js:353` which uses a plain `COALESCE`.** 346 production rows
  hold `custom_fields->>'job_title' = ''` (empty string, not NULL); a plain COALESCE returns
  that empty string and never reaches the column. **`checkins.js:353` therefore carries the
  same latent flaw**, as does the `country` line at `checkinReports.js:72`. Neither touched — post-fair.

#### Public form success/error card follows the form's design (18 Aug 2026)
- `public/form-public.html` — `showSuccess()` (`:413`) and `showError()` (`:447`) replace
  `#formContent` via `innerHTML`, destroying the **inline** header/footer styles that
  `applyFormStyle` had applied (`:497-536`). The new elements fell back to the stylesheet
  default `--primary-gradient` (`:14`) = `#667eea → #764ba2` — the reported "standard purple".
- Why the button looked right but the header did not: `.btn-submit` was styled through the
  injected `<style>` tag (persists across re-render), the header/footer only inline (does not).
- Fix: the header/footer band rules are now also emitted into that same `<style>` tag, so any
  re-render inherits them. New `formStyle` module variable + `footerLabel()` helper restore the
  configured `footerText` on the two re-rendered cards (was hardcoded "Powered by Leena v401").
- **Strictly additive.** The inline block at `:497-536` is untouched; inline styles beat
  stylesheet rules, so the initial render is byte-identical to before. The new rules only bind
  to elements with no inline style — exactly the success/error cards.
- `showError` can fire before any config loads (`:189,:191,:203`); `formStyle` stays null and
  `footerLabel()` falls back to the old hardcoded string, so that path is unchanged.
- `renderForm()`'s footer (`:227-228`) deliberately left hardcoded — `applyFormStyle` runs
  after it and overwrites the text at `:529`.
- Success checkmark `#28a745` (`:119`) and error icon `#dc3545` (`:109`) deliberately NOT
  changed — semantic status colours, not branding (Suer's call).
- `public/reactivate.html` explicitly OUT OF SCOPE: separate implementation, shows/hides a
  pre-existing `#successState` div rather than replacing innerHTML, and its green
  `var(--success)` header is deliberate. It does not have this bug.
- Expo 13 effect: forms 52/53/55 all set `primaryColor #009846` / `headerGradientEnd #29539f`,
  so the success card becomes green→blue and the footer reads "Powered by Leena EMS · © Elan Expo".
- Known duplication (inline + stylesheet) logged in todo.md as post-fair cleanup.

#### Known limitation — job titles will NOT appear on badges
Three independent gates; only the first is addressed by this sprint:
1. ✅ `visitors.job_title` populated (webhook fix + backfill)
2. ❌ badge template needs `show_job_title: true` — `badgeTemplates.js:35` defaults it **false**,
   and `badge.html:368` renders only when true
3. ❌ **expo 13 has ZERO terminals** — there is no badge-printing path configured at all

Job titles WILL appear in exports (`visitors.js:1047`), reports (`reports.js:255`), and the
visitor detail panel — all of which read the column directly.

#### Pre-fair risks logged (see DISCOVERY_20260818.md §6)
- **expo 13 has 0 terminals and 0 check-ins** — largest operational gap
- **Both May bulk-print terminal keys are still `is_active=true`**, and their full UUIDs are in
  plaintext in this file (v4.0.5 section) in the GitHub repo. `dualAuth.js` grants those keys
  visitor-list read + visitor import on expos 7/8. Rotate/deactivate.
- 5 backup tables still in production, one ~3 months past its documented drop date; one
  (`visitors_backup`) undocumented
- 4 test rows in expo 13 (`test@test.com`, `yaprakguzelcik@gmail.com`, `elan02@elan-expo.com`)
- `Africa/Lagos` hardcoded in 29 query sites — **correct for expo 13**, latent defect for
  Morocco Siema Expo 2026 (`expo_id=9`, 22-24 Sep)
- Email worker healthy: 0 pending / 0 failed / 0 stuck at time of audit

#### Post-fair backlog from this sprint
- Config-driven `reactivate.html` (verify endpoint returns `forms.fields`; page maps
  `required` onto the 7 inputs) — Option B in `EXEC_BRIEF_02_FINDINGS.md`
- Add `'title'` to `webhook.js` `knownFields` — only after the fix and backfill are confirmed
- `checkins.js:353` + `checkinReports.js:72` (country) NULLIF hardening
- Verify whether `form-public.html`'s server side (`visitors.js` POST `/public`) enforces
  `required` at all, or trusts the client

### v4.0.7 — MP26 Reactivation Campaign Launch (18-19 August 2026)

**Context:** first production run of **reactivation links delivered through the campaign
(multi-step) module** — the two modules were previously unable to talk to each other. Target
`expo_id=13` Nigeria Mega Project Expo 2026 (25-27 Aug). Source list: 42,212 verified emails
(MillionVerifier OK-only), segmented into 3 groups. Analysis chain: `DISCOVERY_20260818.md`,
`EXEC_BRIEF_02_FINDINGS.md`, `SIEMA_MERGE_OPTIONS_20260818.md`,
`SIEMA_OPTION_A_GAPS_20260818.md`, `REACTIVATION_SEGMENTATION_SQL_20260818.md` — all now
committed under `docs/sessions/`.

#### The 5 production fixes of this sprint

| # | commit | change | documented |
|---|---|---|---|
| 1 | `8799ccd` | reactivate.html required Job Title + Phone | v4.0.6 above |
| 2 | `32501ed` | webhook `??`→`\|\|` + `req.body.title` | v4.0.6 above |
| 3 | `52cc27e` | checkinReports COALESCE/NULLIF job_title | v4.0.6 above |
| 4 | `6279a36` | form-public success/error card follows design | v4.0.6 above |
| 5 | `fd0c503` + `5866a0a` | **the bridge** + fair-anchored token expiry | below |

#### THE BRIDGE — campaign attribution reaches token activation (commit `fd0c503`)

**The problem.** `evaluateCondition` (`email_worker.js:469-477`) resolves `not_registered` by
reading `email_events` for `event_type='registered'`. The only writer was
`routes/visitors.js:452-468`, gated on a `_lc` token that `appendCampaignTokenToFormLinks`
attached to **Leena form links only**. `reactivate.html` was never matched, and
`POST /api/reactivation/activate` emitted **no events at all**. Reactivation activations were
therefore invisible to the campaign scheduler — steps 2/3 would have fired at everyone,
including people who had already activated.

Three changes close the loop:

1. `utils/trackingPixel.js:154` — matcher now also matches `reactivate.html`. The existing
   separator logic on the next line handles the page's own `?token=X`, producing
   `?token=X&_lc=Y`. `wrapClickLinks` runs after (`email_worker.js:551,554`) and base64-encodes
   the whole URL; `routes/emailTracking.js:104-114` decodes and 302s to it, so **both params
   survive the click redirect**.
2. `public/reactivate.html` — reads `_lc` from the URL alongside `token`, forwards it in the
   `/activate` body. Mirrors `form-public.html:375-377`. Sends `undefined` when absent.
3. `routes/reactivation.js` — new `recordCampaignRegistration()` helper, called from **both**
   activate success branches (already-registered and new-visitor). HMAC verification via
   `verifyUnsubscribeToken`; the event keys on `recipient_id`, matching what `evaluateCondition`
   reads. Non-fatal by design (mirrors `visitors.js:467-468`).

⚠️ **`_lc` cannot be pre-computed into an Excel column.** `generateUnsubscribeToken` needs
`recipient_id`, which is assigned by the `campaign_recipients` INSERT. The matcher extension is
the only viable route, not one option among several.

**Verified end-to-end before the real run** (throwaway expo 17, campaign 15, 5 recipients):
step 1 queued 5, one recipient activated, **step 2 queued 4** — the activated one correctly
skipped. Then verified again in production: see results below.

#### Fair-anchored token expiry (commit `5866a0a`)

`expires_at` was hardcoded `NOW() + INTERVAL '30 days'` at both batch INSERT sites. Since
campaigns can start months before a fair, tokens could expire **before** the event. Measured:
tokens generated 2026-08-18 for SIEMA (22-24 Sep) expired **2026-09-17**, five days early and
dead for the whole fair. `/verify:485` and `/activate:548` both return 410.

New expression, computed once per job (`routes/reactivation.js`, `processReactivationChunks`)
and shared by every row tuple via one placeholder:

```sql
GREATEST(
  COALESCE(end_date + INTERVAL '1 day', NOW() + INTERVAL '90 days'),
  NOW() + INTERVAL '30 days'
)
```
- `end_date + 1 day` — `end_date` is a DATE, so +1 day is 00:00 the following morning: valid
  through all of the final fair day.
- `COALESCE(…, +90d)` — `expos.end_date` is nullable (1 such row in production).
- `GREATEST(…, +30d)` — floor. Never SHORTER than the old behaviour; stops a **past-dated** expo
  (10 in production) minting an already-dead token.

Verified read-only against all 16 expos: `new_expiry >= old_expiry` for every one.
Param-index change verified by simulation at chunk sizes 1/3/1000 for both the from-expo
(13 params/row) and from-excel (11 params/row) branches.

**Backward compatible — existing tokens keep their stored `expires_at`.** Insert-time only.

⚠️ **Known gap:** for a fair nearer than 30 days the floor wins, which is correct; but for a
**past-dated** expo the floor still mints a live token. See post-fair backlog.

---

### DATA OPERATIONS — production changes NOT in git

> These live only in the database. Nothing below is reproducible from the repo.

#### job_title backfill (Render Shell, 18 Aug)

Recovered Zoho job titles stranded in `custom_fields->>'title'` by the pre-`32501ed` handler.

| | |
|---|---|
| Rows updated | **1,785** |
| Backup table | **`job_title_backup_20260818`** (1,785 rows — `id, expo_id, old_job_title, cf_title, backed_up_at`) |
| Guard | `WHERE COALESCE(job_title,'')='' AND COALESCE(custom_fields->>'title','')<>''` |
| Re-runnable | Yes — guard means a second run matches 0 rows; never overwrites an existing value |
| Method | Three-phase: backup → dry-run counts → `BEGIN` + UPDATE + in-transaction verification + `COMMIT` |
| Sequencing | Handler fix `32501ed` deployed and confirmed on live traffic **first**, backfill second |

Rollback recipe retained:
`UPDATE visitors v SET job_title=b.old_job_title FROM job_title_backup_20260818 b WHERE b.id=v.id;`

#### Email templates #54-#59 (via API `PUT /api/email-templates/:id`, 19 Aug)

**Templates are DATA, not code — they are not in git and not reproducible from this repo.**
Yaprak authored them; two systemic defects were found by audit and fixed in the DB.

| id | name | expo |
|---|---|---|
| 54/55/56 | MP26 Reactivate Step1/2/3 | 13 |
| 57/58/59 | MP26 Register Step1/2/3 | 13 |

1. **#58/#59 CTA pointed at `{{activation_url}}`** — but Group 3 recipients hold no token, so it
   rendered `href=""`. **Two occurrences each**: the CTA href *and* a plain-text "if the button
   doesn't work, copy and paste this link" `<span>`. Both replaced with
   `https://leena.app/form-public.html?id=53` (form 53 = Visitor Registration Form, expo 13;
   `form-public.html:173` reads `urlParams.get('id')`).
2. **`{{unsubscribe_url}}` unwrapped in all six** — the placeholder is **unfillable in campaign
   mode** (see Gotchas). The anchor was removed, sentence text kept; `injectUnsubscribeLink`
   (`trackingPixel.js:41-51`) appends its own working footer.
3. Cosmetic: comma added after the `{{first_name|last_name|company|"Dear Visitor"}}` fallback in
   all six subjects.

Post-fix audit: **all 6 PASS** — correct CTA, no dead unsubscribe, no `{{activation_url}}` in the
Register set, no Zoho/zfrmz links, no `[##...##]` placeholders.

⚠️ #54 retains a **secondary** `form-public.html?id=53` link alongside its activation CTA
(deliberate, Suer's call). It bypasses the token: the visitor creates a fresh record and their
reactivation token stays `pending`. Observed in production at ~1% of C16 conversions.

#### Campaign objects (expo 13)

| | **16 — MP26 Activate Wave** | **17 — MP26 Register Wave** |
|---|---|---|
| Group | G2 — prior LEENA visitor on another expo | G3 — no LEENA record |
| Recipients | **14,941** | **26,262** |
| Templates | 54 / 55 / 56 | 57 / 58 / 59 |
| Steps | `0h all` · `37h not_registered` · `96h not_registered` | identical |
| `activation_url` in `extra_fields` | 14,941 (100%) | 0 (correct — no tokens) |
| Activated (IST) | 18 Aug **20:52** | 18 Aug **21:15** |

**Segmentation of the 42,212-row verified list** (all distinct emails, 0 parse errors):

| group | definition | count |
|---|---|---:|
| G1 | already a visitor on expo 13 → **excluded** | 887 |
| G2 | visitor on another expo → activate | 14,967 → **14,941** mailable |
| G3 | no LEENA record → register | 26,358 → **26,262** mailable |

G2 tokens: 14,077 newly minted (`expires 2026-09-17`) + 864 reused from the 9-17 Aug wave
(`expires 2026-09-09`). 26 excluded: 25 unsubscribed + 1 who registered mid-run (promoted to G1).

**The 30-minute stagger was deliberate** — a sender-reputation ramp. Launching 41k at once from a
domain whose recent volume was ~19 emails/hour is a spike; splitting into 14.9k then 26.3k half an
hour later lets the first wave's engagement register before the second lands. Because the exact
offsets (37.25 h and 36.75 h) both round to **37**, the stagger cost nothing in scheduling
accuracy — both waves still land Thursday morning.

⚠️ **Step delays are measured from each recipient's own step-1 enqueue, not from activation.**
Activation ran 53-60 min earlier than the times the offsets were computed against, so step 2
lands **Thu 07:52 Lagos (C16) / 08:15 (C17)** — about an hour earlier than the 09:00 intent.
Recorded, not corrected.

#### Worker environment (Render — `leena-email-worker`)

**Canonical values as of 19 Aug 2026.** These are env vars on the Render worker service; they
are NOT in the repo and NOT reproducible from it.

| var | value | effect |
|---|---|---|
| **`EMAIL_WORKER_BATCH_SIZE`** | **10** (was unset ⇒ default 1) | campaign emails per cycle |
| `CAMPAIGN_SCHEDULER_BATCH_LIMIT` | **2000** (code default 500) | recipients enqueued per campaign per scheduler run |
| `CAMPAIGN_SCHEDULER_INTERVAL_SECONDS` | **10** (code default 60) | scheduler cadence |
| `PROCESS_INTERVAL` | **2000 ms — HARDCODED**, `email_worker.js:21`, no env override | worker poll interval |

**The batch-size change, measured.** With `EMAIL_WORKER_BATCH_SIZE` unset the worker sent
**1 email per 2-second cycle ≈ 30/min ceiling**; measured **28.4/min**, flat to ±0.3% across 13
consecutive hours. Raised to 10 and restarted at 09:56 on 19 Aug:

```
09:54→28  09:55→28  09:56→30   ← BATCH_SIZE=1
09:57→108                       ← restart (partial minute, NO downtime)
09:58→289 09:59→271 10:00→270   ← BATCH_SIZE=10
```

**28.5 → 274.4/min (9.6×).** Ceiling is 300 (10 ÷ 2 s); the ~9% shortfall is per-cycle send
latency. Post-restart integrity: **0 failed, 0 stuck, 0 retries (`try_count>1`), 0 duplicate
recipient+step rows** — the `FOR UPDATE SKIP LOCKED` transaction held across the restart.

Impact: a full 41,203-email step drains in **~2.5 h instead of ~24 h**. Before the change,
step 3 (fires Mon 24 Aug) would have been delivering into **Tue 25 Aug — fair opening day**.

⚠️ `TRANSACTIONAL_BATCH_SIZE = 10` is hardcoded (`email_worker.js:24`), so badge/confirmation
emails were always 10× faster than campaign mail. Campaign email is **priority 2** (`:30`).

#### Results — first 13 hours (19 Aug 09:48 IST)

| | C16 Activate | C17 Register |
|---|---:|---:|
| Delivered | 14,941 (100%) | 6,738 (25.7%) |
| Opened (unique / % of delivered) | 1,217 / **8.15%** | 321 / **4.75%** |
| Clicked | 161 | 129 |
| **Registered** | **98** | **7** |
| Unsubscribed | 4 | 1 |

C16 attribution: 95 `reactivation_activate_new` · 2 `reactivation_activate_existing` ·
1 `public_form_submission` (via #54's secondary link).
C17: all 7 via `public_form_submission` — **confirming the Group 3 chain** (campaign email →
`form-public.html?id=53` with `_lc` → `visitors.js:452-468` writes the event).

**Bridge integrity: 100%.** Zero activated tokens without an attributed event. Counts reconcile:
105 activations = 97 belonging to C16 recipients + 8 from the earlier 9-17 Aug wave;
C16's 98 events = those 97 + 1 public-form. Every activator will be correctly skipped at step 2.

Unsubscribe rate **0.05% of delivered** — well within tolerance.

### v4.0.8 — Campaign Results Funnel + Delivery Truth (19 August 2026)

**Context:** the day after the MP26 launch. Every campaign figure labelled "Sent" was counting
**enqueues**, not deliveries — a 4× overstatement while a campaign drains. Fixing it exposed a
second, worse defect: the only live source of delivery truth is destroyed when a campaign
completes. Both are closed here. Analysis: `docs/sessions/CAMPAIGN_UI_DESIGN_20260819.md`;
EOD numbers: `docs/sessions/CAMPAIGN_STATUS_20260819_EOD.md`.

#### Campaign results funnel (commit `6d798ab`)

`routes/campaigns.js` · `public/email-campaigns.html` · `email_worker.js` · migration 029.

**The metric bug.** `email_events` `'sent'` rows are written in `enqueueStepEmail`
(`email_worker.js:537-539`) at **enqueue** time, and `email_campaigns.total_sent` is
incremented in the same place. Mid-drain, campaign 17 reported **26,262 sent against 6,765
actually handed to SendGrid**. Delivered now reads `email_queue.status='sent'`; the list column
is relabelled **Delivered**; per-step numbers stay enqueue-based and are relabelled **Queued**
with a note saying so (per-step delivery would need a `campaign_step_id` join — deferred).

**The funnel:** Delivered → Opened → Clicked → Registered → Checked-in, on the campaign detail
Stats tab. Percentages are always **of delivered, never of recipients**, and capped at 100%.

> ↪ **⭐ CANONICAL JOIN RULE** paragrafı CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

**Query shape.** Aggregate each source once; do **not** use a per-recipient `EXISTS`. Measured
on production: per-row form **1,219-1,575 ms** on the 26k campaign vs **248-275 ms** for the
aggregate form, identical results, and flat with recipient count.

> ↪ **Attribution honesty — deliberate, do not "simplify" away:** bölümü CLAUDE.md'ye taşındı (2026-10-21) → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

> ↪ **`42703` fallback — deploy-before-migration ordering.** paragrafı CLAUDE.md'ye taşındı (2026-10-21) → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

#### Migration 029 — `email_campaigns.delivered_count` (applied to production 19 Aug)

Additive, nullable, **no backfill**. Written because `email_queue` is **not durable**: see G13.

`checkCampaignCompletion` (`email_worker.js`) now snapshots the live queue count and purges
**in one transaction** — the purge destroys the only source, so if the snapshot does not persist
neither may the delete. Rollback leaves the queue rows intact, so delivery stays readable and
the next completion pass retries.

Readers use `COALESCE(delivered_count, live_count)`. Campaigns completed **before** 029 have
neither a snapshot nor queue rows; they return `delivered_unknown` and the UI renders
**"n/a — campaign completed before delivery tracking"** with percentages suppressed, rather than
printing a false number. Campaign 15 was the proof case: 4 surviving queue rows against 5 unique
opens produced a **125%** open rate before this fix.

#### `EMAIL_WORKER_BATCH_SIZE` 1 → 10 — measured effect

Raised on the Render worker and restarted 09:56. **28.5 → 274.4 emails/min (9.6×).** Ceiling is
300 (10 per 2 s cycle, `PROCESS_INTERVAL` hardcoded at `email_worker.js:21`); the ~9% shortfall
is per-cycle send latency. Minute-by-minute, with **no downtime**:

```
09:54→28  09:55→28  09:56→30   ← BATCH_SIZE=1
09:57→108                       ← restart, partial minute
09:58→289 09:59→271 10:00→270   ← BATCH_SIZE=10
```

**Restart mid-drain proven safe:** 0 failed, 0 stuck, **0 retries (`try_count>1`), 0 duplicate
recipient+step rows** — the `FOR UPDATE SKIP LOCKED` transaction held across the restart.

Impact: a full 41,203-email step drains in **~2.5 h instead of ~24 h**. Before the change,
step 3 (fires Mon 24 Aug) would have been delivering into **Tue 25 Aug — fair opening day**.

#### `not_registered` now means registered by ANY route (19 Aug, same day)

**The defect.** `evaluateCondition`'s `not_registered` only consulted the campaign
`registered` event, which fires exclusively when a visitor arrives carrying an `_lc` token.
Anyone who registered through **organic Zoho traffic** never carries one, so the campaign
could not see them.

**Measured before the fix**, campaigns 16/17: **66 active recipients** were already visitors
on expo 13 yet still evaluated as `not_registered` — **all origin `zohoform`** (Pixad,
landing page, email marketing), growing **~50/day** (16 on 18 Aug → 50 on 19 Aug). They would
have received Monday's *"last chance to register"* email days after registering; unfixed, step 3
would have hit an estimated 300-400.

**The fix.** `not_registered` now treats a recipient as registered if **any** of:
1. the campaign `registered` event exists (as before), **or**
2. a `visitors` row exists for that email on the campaign's expo, **or**
3. their `reactivation_tokens` row for that expo is `activated`

Email-matched, read-only, evaluated at send time. `evaluateCondition` gained a `campaign`
parameter — already in scope at the only call site (`processRecipient`) — and degrades to
campaign-event-only if it is absent.

⚠️ **This changes the semantics, not just the coverage.** `not_registered` previously meant
"has not registered *through this campaign*"; it now means "is not registered *at all*". Right
for a last-chance email; wrong if a campaign ever deliberately re-targets people who registered
elsewhere. No such campaign exists today.

**One-way by construction:** the extra checks can only ever *suppress* a send, never cause an
extra or duplicate one.

**Index alignment is load-bearing** — see G16. Combined cost **2.99 ms/recipient** measured
server-side, ≈6 s per 2,000-recipient batch inside a 10 s scheduler cycle.

⚠️ Check (3) was **redundant on measurement** — 0 activated tokens lacked a campaign event, so
the bridge is at 100%. Kept deliberately as insurance: `recordCampaignRegistration` is non-fatal
by design, so a swallowed tracking error would otherwise leave that recipient permanently
`not_registered`. At 0.09 ms it is free.

#### Campaign results, EOD 19 Aug

| | C16 Activate | C17 Register |
|---|---:|---:|
| Delivered | 14,941 (100%) | 26,262 (100%) |
| Opened | 2,031 (13.6%) | 1,340 (5.1%) |
| Clicked | 271 (1.8%) | 436 (1.7%) |
| **Registered** | **190** (1.27%) | **23** (0.09%) |
| Unsubscribed | 6 | 11 |

Expo 13: **4,055 visitors** (546 via `reactivation_campaign`), 556 tokens activated, 13
check-ins (test), 4 terminals. **Step 2 fires Thu 20 Aug 07:52 Lagos (C16) / 08:15 (C17)** —
at 274/min the ~41k wave now drains inside ~2.5 h.

⚠️ `delivered_count` is NULL on both campaigns and **that is correct** — the snapshot is taken
at completion, and both are still `active` with step 3 pending Monday.

### v4.0.10 — Final Pre-Fair Deploys + Fair Day 1 (24-25 August 2026)

**Context:** the last night before Nigeria Mega Project Expo 2026 (`expo_id=13`, 25-27 Aug,
Landmark Centre Lagos) and the fair's opening day. Four code commits, all deployed and verified
live before doors.

#### Fail-closed scanner (commit `e900b70`)
`public/qrscanner.html` only. Backend untouched — `/terminal/checkin` and its duplicate
semantics are unchanged; the page simply stopped discarding the response.
- **The check-in write now gates the badge popup.** `performCheckin` returns
  `{ok, duplicate, error}` and never throws, where it previously caught every failure and wrote
  only to `console`. All three call sites (both scan modes + manual registration) branch on `.ok`
  and open the badge **only after a confirmed check-in**.
- **Failure = blocking red panel + low beep + Retry/Cancel.** Text tells the hostess not to let the
  visitor through. The manual path's message says explicitly that the visitor row already exists
  and not to re-register — otherwise a hostess reading "CHECK-IN FAILED" re-types the person.
- **This inverts the failure mode on purpose.** Before, a dropped request meant silent
  under-counting while the queue kept moving; now a broken API stops the queue. Correct trade for a
  system whose whole purpose is the attendance record.
- **Duplicates became visible** — the backend already returned `duplicate:true` and the UI
  discarded it, so a re-scan and a first scan looked identical. Now a yellow non-blocking
  *"Already checked in — reprinting badge"* note, and the badge still prints.
- **The Auto Check-in switch was removed.** It was a live client-side toggle that silently turned
  the desk into a badge printer recording nothing. `terminals.auto_checkin` is dead config —
  stored, editable, selected by `terminalAuth.js:33`, **read by no route**. Server authority stays
  `expos.settings.auto_checkin_on_badge_print`.

#### Terminal-key manual registration — the philosophy fix (commit `580dff1`)
Scanning needed only `?terminal_key=`; manual registration posted with `Authorization: Bearer` and
gated on `localStorage.token` + `selectedExpoId`. A tablet opened with just the terminal URL
scanned perfectly and then **died on the first walk-in**. A design violation, not a missing feature.
- `middleware/dualAuth.js` became a **kind-parameterised factory**. Default export unchanged
  (`kind='bulk_print'`); `dualAuth.forKinds(['scanner'])` builds the variant `/manual` needs.
- **In terminal mode `expo_id` and `organizer_id` come from the TERMINAL ROW and the body is
  ignored** — including the existing-visitor lookup, so the upsert can only touch a row on the
  terminal's own expo. `visitor_type` is clamped to the seven values the form offers.
- Verified with a hostile body (`expo_id:5, organizer_id:999, visitor_type:"admin"`) → landed on
  expo 13, organizer 1, type `visitor`, **0 rows outside expo 13**. Bulk-print keys rejected here;
  scanner keys still rejected on bulk-print endpoints. JWT path byte-identical.
- Also removed the 500 ms `setTimeout` around the badge popup — a deferred `window.open` breaks the
  user-gesture chain and is what popup blockers catch.

#### MP26 certificate — installed the May way (commits `3e14bf8`, `d06069e`, `668fd5c`)
Expo 13 fell through to the **Ghana** default and would have issued certificates naming
*Mega Clima Ghana 2026, 3-5 March, The Palms Convention Centre Accra*, signed by the Ashrae Ghana
Chapter. Terminal 42 was live at the time, so this was an armed path, not a hypothetical.
- Method A2 / `expoId`-switch exactly as `9a20641` did for expo 7. Ghana and NG both byte-identical.
- **`certificate_id = MPN-2026-<token[0:10]>` uppercased**, not `badge_id`: certificates are UNIQUE
  per `(visitor, expo, topic)` so a two-session attendee holds two and `badge_id` would print the
  same number on both; the token is the lookup key so the printed number is a verifiable prefix of
  the `?token=` in the URL; and `badge_id` is not in the `/verify` payload at all.
- **No pipe splitting.** Measured across all 482 certificate rows in production: **482 contain a
  single `|` as part of the topic NAME, 0 contain the ` || ` separator** — the cert row holds one
  topic, the merge lives only in `visitors.custom_fields`. Splitting on a bare `|` would shred
  every topic ever issued. The renderer splits only on the exact ` || `.
- Placeholders substituted in **text nodes only** via `nodeValue`, which never parses HTML — a
  visitor named `<script>` is inert by construction. Walker skips `SCRIPT`/`STYLE`.
- **Both selectors changed, at issue (`:387`) and resend (`:676`)** — changing only the first is
  how a resent certificate silently reverts to Ghana branding.

#### Fair day 1 — opening state (25 Aug)
- **Gates opened 08:26:39**, 1h33m before the advertised 10:00 — exhibitor move-in, by design.
- **Fail-closed ran in production with zero incident.** Across the day: **0 failed emails, 0 orphan
  check-ins, 0 unknown/revoked terminal labels, 0 cross-expo leakage, 0 duplicate-guard
  violations**, and a phantom rate of **1 in 981 (0.10%)** against May's 0.15%.
- The terminal manual path, which had **never carried a production registration**, began carrying
  real walk-ins from 10:00.
- Both new terminals (41 bulk print, 42 conference) authenticated correctly on first live use.

#### DAY 1 — session record
The day is documented in `docs/sessions/`, in order:
`FAIR_EVE_MECHANICS_20260824.md` (print→check-in chain traced against May's 2,223 check-ins) →
`FAIR_EVE_FINAL_20260824.md` (conference/certificate audit + the deploy record) →
`DEPLOY_MANUAL_REG_20260824.md` (the philosophy fix, 14-point smoke test) →
`FAIR_DAY_TOOLS_20260824.md` (missed-day-1 mailing, dashboards, field parity, phantom check-ins) →
`SUNDAY_SOURCES_20260824.md` (the pre-fair source breakdown) →
**`FAIR_DAY1_OPENING_20260825.md`** (09:51 baseline) →
**`DAY1_VS_MEGACLIMA_20260825.md`** (like-for-like vs May — both Tuesday openings, same venue) →
**`DAY1_MIDDAY_20260825.md`** (12:16 pulse).

⚠️ Session docs are **point-in-time records**, true as of their timestamp and never updated.

### v4.0.11 — Segment `/send` Incident: Failure → Forensics → Mode-2 Fix (28 August 2026)

**Context:** first fair-close-day of use for the M1-M4 segment rewrite shipped 27 Aug
22:16 UTC (v4.0.10 last night). Yaprak sent the closing "thank you" via
`attended_any` at 12:09 UTC — 3,065 recipients, 33 MB payload, worked end-to-end.
She then tried the same page with segment `noshow_any` (7,860 recipients) five
times across two windows (12:05-12:10 and 12:45-12:47). Every attempt returned
the browser's "Network error" toast; zero rows written to `email_queue`.
Full arc across three acts. Reference doc: `SEGMENT_FORENSICS_20260828.md`.

#### Act 1 — the latent Mode-1 design flaw (M1-M4, commit `d1cebcf`)

The 27 Aug rewrite moved segments off direct `sgMail` and onto `email_queue`,
which was the right architectural move. But it enqueued **Mode 1** rows — every
row containing the fully rendered `html_content` for that visitor. The `/send`
handler therefore did all its work **synchronously in the request path**:

1. Fetched all visitor rows (~7,860 for noshow_any on expo 13).
2. `targeted.map(v => processEmailTemplate(...))` — rendered per-visitor HTML
   into a `rows` array held in Node heap. **Measured: 82 MB of `html_content`
   held simultaneously across 7,855 objects, Node heap 178 MB used / 299 MB
   allocated, RSS 364 MB.**
3. Batch-INSERTed in 500-row chunks — each chunk pushing ~8.8 MB across the
   PG wire. **Total INSERT payload: 82 MB across 16 chunks in one request.**

3,065-recipient send at 33 MB survived. 7,860-recipient at 82 MB died with
zero rows written and browser "Network error" (either Node OOM or Render HTTP
window kill — both produce the same symptom; see G25).

#### Act 2 — the wrong hotfix (commit `5794e2a`, ~4 h later)

My first diagnosis: the `noshow_any` `NOT EXISTS` was correlated on both
`c.visitor_id = v.id` AND `c.expo_id = v.expo_id`, which I assumed forced a
nested-loop anti-join. I rewrote it as uncorrelated `NOT IN` and deployed.

**The diagnosis was wrong.** `EXPLAIN ANALYZE` on production showed both forms
execute in **~9 ms** — the PG planner is smart enough to turn the correlated
`NOT EXISTS` into a `Hash Anti Join` too. Yaprak's post-hotfix retry at
12:45-12:47 failed the same way. **That failure was the direct falsification of
the hotfix.** The rewrite is functionally correct but addressed a bottleneck
that did not exist.

> ↪ **Lesson worth recording: `EXPLAIN` before optimizing.** paragrafı CLAUDE.md'ye taşındı (2026-10-21) → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

#### Act 3 — the real fix (commit `90e2999`)

`/send` now enqueues **Mode 2**: `visitor_id + template_id + expo_id +
organizer_id + status='pending'`, no `html_content`. Worker
(`email_worker.js:162`) fetches template + visitor and renders per-message at
drain time. **Payload per row drops from ~10 KB to ~40 bytes — 165× smaller.**
The `/send` request path is now **constant-size in recipient count.**

**Verified end-to-end via trash-expo smoke on expo 17** (Suer's click-through,
28 Aug ~13:35 UTC):

1. Preview modal → `Targeted: 1`, sample `suer+rtest3@elan-expo.com`.
2. Confirm & Queue → result box `1 emails queued`.
3. `email_queue` row: **Mode 2 shape** (`html_content NULL`, `template_id=68`,
   `visitor_id=63528`, `status='pending'`).
4. Worker drained within ~30 s, `status='sent'`, `sent_at` set.
5. `email_logs` row written by worker's `logToEmailLogs` — correct schema, no
   ghost columns.
6. Mail delivered to the real inbox with the visitor's rendered name.

**Beneficial side effect:** the worker's send-time unsubscribe recheck
(`email_worker.js:537-548`) now applies to segment sends. Mode 1 bypassed it —
if a visitor unsubscribed between `/send` and worker dispatch, the pre-rendered
HTML shipped anyway. Post-fix behaviour is stricter and matches how campaigns
already work.

#### Deliverables in-repo

- Fix: commit `90e2999` (17 lines added, 40 removed in `routes/emailSegments.js`).
- Forensics reconstruction: `docs/sessions/SEGMENT_FORENSICS_20260828.md`
  (evidence-first, access-boundaries stated upfront, hypotheses labelled).
- Regression test: `backend/leena-v401-backend/tests/test_email_segments_smoke.js`
  (10 k recipients, asserts response <5 s + all rows Mode 2 shape). **Not
  CI-wired yet — captured so the failure mode has a concrete assertion.**

#### New Gotchas produced

- **G24** — don't pre-render bulk email HTML in a request path (rule + rationale).
- **G25** — "Network error" toast ≠ HTTP failure (diagnostic shortcut).
- **G26** — diagnosis without app logs costs hours (P1 infra follow-up).

### v4.0.9 — Greeting Chain Rule + Final Push Waves (21 August 2026)

**Context:** Friday, 4 days before Mega Project Nigeria opens. Ops replaced three step-3
templates with new short designs; a test send rendered `"Dear ,"`. Diagnosis, fix, forensic
verification, and two final-push waves. Full state:
`docs/sessions/FRIDAY_NIGHT_20260821.md`.

> ↪ `#### ⭐ RULE — templates MUST use the greeting fallback chain…` bölümü CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

#### Forensic verification of every live send

**MEASURED 21 Aug 23:11 — 96,227 sent bodies still resident in `email_queue` (unpurged):**

| campaign | step | template | sent | body fallback | body broken | body literal `{{}}` | subject defects |
|---|---|---|---:|---:|---:|---:|---:|
| 16 | 1 | 54 | 14,941 | 0 | 0 | 0 | 0 |
| 16 | 2 | 55 | 14,649 | 0 | 0 | 0 | 0 |
| 17 | 1 | 57 | 26,262 | 0 | 0 | 0 | 0 |
| 17 | 2 | 58 | 26,148 | 0 | 0 | 0 | 0 |
| 18 | 1 | 61 | 14,227 | 0 | 0 | 0 | 0 |
| **total** | | | **96,227** | **0** | **0** | **0** | **0** |

**100% rendered a real name. Nothing broken has ever gone out.** Verified twice by two
independent methods (regex capture, then literal substring match on `Dear ,` / `Dear  ,` /
`{{` / `}}` / subjects starting with `,`), on two separate days.

⚠️ **A figure of "77% real name / 23% Dear Visitor fallback" was reported during this sprint.
It is NOT supported by the data — the fallback path has never fired in a live send.** Both
scans return zero. Likely origin: a UI statistic with a different definition, or the
template-page test send (which is not stored in `email_queue`). **Do not propagate 77/23.**

#### Template timeline, 21 Aug

| time (IST) | event |
|---|---|
| 13:34 | Ops saves #60 "Test 1" / #61 "Test 2" — short designs, bare `{{first_name}}` |
| **14:12:50** | **Greeting chain applied to #56, #58, #59** via `PUT /api/email-templates/:id` |
| 17:54 | Ops replaces #61 → "Activate Badge Last Call", #62 → "Register Now Last Call" — chain greeting ✅ but **dead `{{unsubscribe_url}}` anchors reintroduced** |
| ~22:50 | **Unsubscribe anchors unwrapped again** in #61/#62 (`href=""` → gone, sentence kept) |

**The unsubscribe anchor has now been removed twice** — once from #54-#59 on 18 Aug, again from
#61/#62 tonight. It returns whenever a template is authored fresh in the UI, because
`{{unsubscribe_url}}` looks like a valid placeholder but **cannot be filled in campaign mode**
(G7). Treat its reappearance as expected, not exceptional.

⚠️ Note the greeting fix **removed the word "Dear"** from #56/#58/#59 — they now open
`Ololade,` rather than `Dear Ololade,`. Intended, but a copy change.

#### Final push waves

| | **18 — MP26 Final Activate Push** | **19 — MP26 Final Register Push** |
|---|---|---|
| Pool | C16 not activated/registered | C17 not registered |
| Recipients | **14,229** | **25,844** |
| Template | **#61** `{{activation_url}}` | **#62** form-53 |
| Step | 1 only, `0h`, `all` | 1 only, `0h`, `all` |
| Status | **ACTIVATED Fri 23:07:31** → `completed` | **DRAFT — HELD** |

**C18 delivery:** 14,227 enqueued in 3 m 17 s (23:07:33 → 23:10:50), drained at ~252/min.
All 14,229 `activation_url`s resolved to live `pending` tokens; 79 recipients that had converted
since the afternoon build were removed before activation.

**C19 held deliberately.** It is the coldest segment — 26k people who have ignored two emails
and convert at **0.67%** against C16's **3.41%**. Sending it Friday night would add ~26k sends
at the moment sender reputation matters most, for the weakest return, to people **Monday's
step 3 already reaches**. Decision point: Saturday noon.

#### Monday state

Step 3 fires **Mon 24 Aug 07:52 Lagos (C16) / 08:15 (C17)** with templates #56/#59, both
chain-greeted and verified.

**The `not_registered` fix (`dedbcd0`) is what prevents a double-mail from C18 conversions.**
A C18 activation writes its `registered` event against **campaign 18's** `recipient_id`, so
check (a) — the campaign event — would not see it from campaign 16. It is caught instead by
check (b) `lower(v.email)` on the visitor row and check (c) `rt.email` on the activated token,
both email-matched and campaign-agnostic. Without that fix every C18 convert would receive
Monday's "last chance" email anyway.

> ↪ `### Shared Frontend Components (public/leena-*.js)` bölümü CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

> ↪ `### Authentication` bölümü (ilk 6 madde; aşağıdaki tarihli kayıtlar burada) CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

**Conference Topic Cleanup Tool (10-12 May 2026):**
- Temporary admin tool to fix conference_topic data quality issues in Mega Clima Nigeria 2026 expo. DB had 55 distinct variants for 13 canonical topics (apostrophe variants, prefix variants, numbered variants, JSON array strings).
- Backend: `routes/conferenceCleanup.js` — 5 endpoints (GET /expos, /canonical-topics, /topic-variants, /visitors, POST /bulk-update). Transaction-wrapped execute, CHUNK_SIZE=100, organizer-scoped, conflict detection (cert UNIQUE constraint).
- Frontend: `public/conference-cleanup.html` — master-detail layout (variants left, visitors right), dry-run preview modal, segment-aware execute. Entry via "Topic Cleanup" button on conference-sessions.html header.
- Canonical source: `forms.fields` JSONB → field with `name='conference_topic'` → `options` array. Dynamic per expo, no hardcoded list.
- conference-sessions.html line 242 orphan sidebar link fix (14969f6).
- Temporary tool — to be removed post Mega Clima Nigeria 2026 fair. See ADR-021.

**Pre-launch Mega Clima Nigeria 70k Reactivation Sprint (13 May 2026):**

Code commits (all deployed to production):
- **BLOCKER-1 fix (3e4b969):** `routes/reactivation.js:589-607` POST /activate template selection corrected. Previously picked first form for expo (often wrong template — e.g. conference template used for visitor activation). New logic: `tokenData.form_id` primary, NULL fallback → `expo_id + visitor_type='visitor' + ORDER BY f.id ASC LIMIT 1`. Added log line: `[reactivation] Activate template selection: form_id=X, template_id=Y`.
- **Async job pattern (094ef99):** New `import_jobs` table (`migrations/005_import_jobs.sql`) with status, total_count, processed_count, skipped_count, failed_count, error_message, target_expo_id, source_expo_id, template_id, form_id. POST /create-from-excel + /create-from-expo refactored: pre-fetch existing emails into Sets (O(1) dedup) → INSERT import_jobs → setImmediate background → 202 response. Helper `processReactivationChunks` with CHUNK_SIZE=1000 and BEGIN/COMMIT/ROLLBACK per chunk. New endpoint: GET /api/reactivation/job/:id polling. Frontend: progress bar + 2s polling loop.
- **File size limit (7d10144):** multer + frontend validation 10MB → 50MB (`routes/reactivation.js:20`, `public/reactivation-campaign.html:431`). 70k Excel ~24MB, headroom retained.
- **email_unsubscribes pre-check (e7d9cf4):** `prefetchEmails()` now returns 3 Sets — existingVisitors, existingTokens, unsubscribed. Filter loop adds `skipped_unsubscribed++` counter, surfaced in UI breakdown.
- **Exhibitor job_title fallback (aff83bc):** `routes/visitors.js:195` — `custom_fields?.job_title || custom_fields?.title || ''`. Exhibitor form (id=35, expo 7) uses field name `title`. Aligns with Excel import path which already uses this OR fallback (visitors.js:612).

DB operations (Render Shell, production):
- **Template 24 unsubscribe footer:** SQL REPLACE inserted standard footer before `</body>` — "You received this email because you registered for or were invited to an Elan Expo event. Elan Expo, Istanbul, Turkey. To unsubscribe from future emails, reply with UNSUBSCRIBE in the subject line." Manual unsubscribe path until automated endpoint is built post-fair.
- **52 exhibitor job_title backfill (expo 7):** `UPDATE visitors SET job_title = custom_fields->>'title' WHERE expo_id=7 AND visitor_type='exhibitor' AND (job_title IS NULL OR job_title='') AND custom_fields->>'title' <> ''`. Backup: `exhibitor_job_title_backup_20260513`. UPDATE 52, visually validated by Yaprak in Visitor Log.
- **76 visitor conference_topic split (expo 7):** "Day 1 & Day 2 | Workforce Development Programme..." segment → Topic 1 + Topic 5 (canonical from form 39). Backup: `conference_topic_backup_20260513`. Method: WITH refs (DB-derived strings) + LATERAL `regexp_split_to_table(...,' \|\| ')` + UNNEST + DISTINCT trim + string_agg. Multi-segment visitors preserved with dedup (e.g. visitor 49864 expanded from 3 to 4 segments). Validation: still_has_day_1_2=0, has_topic_1=76, has_topic_5=76.

Crisis response — test domain SendGrid suppression:
- During async-pattern stress test, 85,000 reactivation tokens were inserted with `test-NNNNN@leena-test.local` (no DNS) recipients. Working assumption "SendGrid skips invalid-domain addresses" was wrong — SendGrid attempts MX lookup, returns deferred, retries 72h, then hard-bounces. 42,924 already submitted to SendGrid; 42,077 pending in queue.
- Action 1: `UPDATE email_queue SET status='cancelled' WHERE status IN ('pending','processing') AND recipient_email LIKE '%@leena-test.local'` → 42,077 cancelled.
- Action 2: 85,000 unique test addresses POSTed to SendGrid Global Suppression List via `/v3/asm/suppressions/global` (85 batches × 1000) → 85/85 success → deferred retries blocked, hard-bounce escalation prevented, sender reputation preserved (~98%).
- Verified: random 10 sent emails confirmed in suppression list.

Infrastructure:
- SendGrid plan upgrade: Pro 100K → Pro 300K ($89.95 → $249/mo). Month-to-date usage already ~84k; 70k reactivation would have exceeded Pro 100K cap.

Smoke test (production validation):
- 5 real recipients (`suer+smoke1@elan-expo.com` … `suer+smoke5`) on Mega Clima Nigeria expo validated full chain. Response 464ms → progress bar → "Completed! 5 tokens created". Reactivation invite used Template 34 ("MC Nigeria Reactive Badge Mailing") with correct {{name}} and {{activation_url}}. Activate flow → reactivate.html → Success. Badge confirmation emitted Template 24 ("QR Code Badge"), proving BLOCKER-1 fix (previously selected Template 29 "Conference QR Badge").

Yaprak's 70k campaign:
- ~12:00 — Yaprak uploaded Excel (41,222 rows, 34,041 unique emails after dedup; header bug `jot_title` corrected by Yaprak before upload). Background drain currently running at ~5 emails/sec (~2-2.5h ETA).

> ↪ "Lessons learned (operational rules)" L1–L3 maddeleri CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

Open backlog from this sprint (post-fair):
- Generic token-based unsubscribe endpoint (replace manual "reply with UNSUBSCRIBE" instruction).
- SendGrid bounce/complaint webhook integration → automated `email_unsubscribes` population.
- `conferenceCleanup` 1→N split capability (current tool is 1→1 rename only; Day 1 & Day 2 → Topic 1 + Topic 5 done via manual SQL this sprint).
- `email_unsubscribes` per-expo or per-organizer-form scope (currently organizer-level — unsubscribing affects all expos for that organizer).
- Form 39 canonical topic typo cleanup ("Cool Plus Limit" → "Limited", duplicate spaces).
- Existing risks re-flagged for tracking: R5 stale 'processing' email recovery, R8 setImmediate orphan recovery, R9 reactivation_tokens UNIQUE(email,target_expo_id), R14 backend template `{{activation_url}}` placeholder validation.

**Reactivation Monitoring UI Sprint (13 May 2026, afternoon):**

Built on top of the 70k pre-launch sprint above, this pass turned the View Campaigns tab into a live monitoring surface and added a manual close lifecycle. Yaprak's 32k drain ran throughout — frontend deploys never touched the email worker (separate Render service).

Code commits (all deployed):
- **Tier 1 + 2 + Resend safety (`1b9c87e`..`777bb6c`, 7 commits):**
  - `1b9c87e` — Auto-refresh dropdown (Off/10s/30s/60s, default 30s) + "Last updated: X ago" indicator. Scoped to View Campaigns tab; pauses when user switches tabs; `beforeunload` clears intervals.
  - `0978a8c` — Progress bar + ETA per card. Formula: `(total_tokens - pending) / total_tokens` for drain progress; ETA = `pending / 300` minutes (5 email/sec worker throughput). Stalled-history heuristic: same `pending` across 3 consecutive refreshes → yellow fill + "Stalled?" warning.
  - `5d4de9e` — Activation Rate color coding: 0%=red, 1-5%=orange, 5%+=green. Native `title` tooltip "X out of Y activated".
  - `573d182` — Backend `GET /api/reactivation/campaign/:expoId/stats`. Returns per-status email_queue breakdown (count + MIN(created_at) + MAX(sent_at) FILTER `status='sent'`) plus top-level `last_global_sent_at`. SELECT only, organizer-scoped. EXPLAIN ANALYZE in production under 32k live drain: **45ms** (Parallel Seq Scan, expo_id+created_at 24h filter, no index added).
  - `695c28c` — Per-card "Mail Delivery Status" row: `📤 Sent / ⏳ Queued / ⚠️ Failed` + "Last email sent: X ago". 120s+ idle while queue > 0 → yellow "Worker may be stalled". `Promise.allSettled` per-card fetches.
  - `f31a6b1` — Backend `GET /api/reactivation/campaign/:expoId/is-active`. Returns `{ is_active, pending_count, last_queued_at }`. `is_active = (pending+processing in queue > 0) OR (queued in last 10 min)`. Drives resend button enabled state.
  - `777bb6c` — Resend button disabled-while-active + 3-layer confirm: (1) confirm "Resend N emails?" → (2) prompt "Type expo name EXACTLY" (case-sensitive) → (3) confirm "FINAL WARNING". Button carries `data-expo-id`/`data-expo-name`/`data-pending` for the flow.
- **Categorization + sort + test protection (`cdc295a`):**
  - 4 status badges: 🟢 Active, 🟡 Stalled, ⚪ Completed, 🔴 Test (test name prefix `[TEST]` overrides everything).
  - Card sort by `statusOrder = { Active:0, Stalled:1, Completed:2, Test:3 }`, then `last_queued_at` DESC within same status.
  - Test campaigns: permanent resend disable (tooltip "Test campaign — resend disabled to protect from accidental mass send"), `.is-test` opacity 0.55 on stats grid, progress fill gray, caption shows "Test campaign" instead of ETA.
  - Refactor: collapsed previous `loadAllResendButtonStates`/`updateResendButtonState` N+1 fetch pattern into a single batch `Promise.all` of `/is-active` calls that feeds both status computation and resend button state.
  - Empty-active hint: blue info bar above list when no Active/Stalled card exists.
- **Awaiting Activation badge (`0820b00`):**
  - New 🔵 Awaiting badge (`badge-awaiting`, blue). Triggered when `email_queue.pending = 0 AND reactivation_tokens.pending > 0`. Tooltip: "Email delivery complete. Waiting for user activations to come in over time."
  - Stalled redefined: queue still has pending rows AND worker idle 10+ minutes. No longer the catch-all bucket for drained-but-unactivated campaigns.
  - Before this fix, Yaprak's drained-but-pre-activation 32k campaign was wrongly flagged Stalled.
- **Past Campaigns separator + compact view (`384b3fe`):**
  - View Campaigns is now split into two visual sections. Top: full cards for Active/Awaiting/Stalled. Separator (`<hr>` + "PAST CAMPAIGNS" uppercase header). Bottom: compact rows (opacity 0.72, hover→1, single line "[icon] Name • Nk total • N activated (X%) [badge]").
  - Per-card render extracted to `buildFullCardHtml(c)` and new `buildCompactCardHtml(c)`.
  - `loadAllMailDeliveryStatus` and `applyResendButtonState` now iterate only `currentCampaigns` — compact cards skip their mailStatus + resendBtn DOM lookups.
- **Close Campaign + reopen (`4e61c35`) + migration 006:**
  - Migration: `migrations/006_reactivation_closed_at.sql` — `ALTER TABLE expos ADD COLUMN reactivation_closed_at TIMESTAMPTZ NULL, ADD COLUMN reactivation_closed_by INTEGER NULL`. Additive, IF NOT EXISTS, run from Render Shell.
  - Backend: `POST /api/reactivation/campaign/:expoId/close` (idempotent, 409 if already closed, 503 pre-migration), `POST /campaign/:expoId/reopen` (same surface). `GET /campaigns` augmented with `LEFT JOIN organizers o ON o.id = e.reactivation_closed_by` to surface `closed_by_name`, **wrapped in try/catch with legacy-query fallback** so the dashboard never breaks pre-migration.
  - Frontend: 🔒 Closed badge (`badge-closed`, indigo). `computeCampaignStatus` priority: Test > Closed > Active > Awaiting > Stalled > Completed. Full-card header shows a small "🔒 Close" link (current campaigns only). 2-layer confirm: (1) "Close this campaign? Visitors who haven't activated yet will no longer be expected" → (2) "...mark as closed, can reopen later". Closed campaigns render as compact cards in Past Campaigns with `• Closed on DD MMM YYYY by NAME` and a small Reopen link.
  - **Close is a UI/intent signal, not a kill switch** — email_worker keeps draining whatever is already in `email_queue`. Use case: stop expecting more activations from this list.

New endpoints (this sprint):
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reactivation/campaign/:expoId/stats` | Per-status email_queue breakdown (last 24h), drives Mail Delivery Status row |
| GET | `/api/reactivation/campaign/:expoId/is-active` | Light yes/no for drain state, drives resend button + Active badge |
| POST | `/api/reactivation/campaign/:expoId/close` | Mark campaign as closed (UI/intent only) |
| POST | `/api/reactivation/campaign/:expoId/reopen` | Reverse close |

Schema delta:
- `expos.reactivation_closed_at TIMESTAMPTZ NULL`
- `expos.reactivation_closed_by INTEGER NULL` (soft FK to `organizers.id`, no constraint)

Badge taxonomy reference (6 states, priority order Test > Closed > Active > Awaiting > Stalled > Completed):

| Badge | Trigger | Meaning |
|-------|---------|---------|
| 🔴 Test | `expo_name` starts with `[TEST]` | Test data; resend permanently disabled |
| 🔒 Closed | `reactivation_closed_at IS NOT NULL` | Manually closed by admin; reopen available |
| 🟢 Active | `is_active=true` (queue has pending/processing OR queued in last 10 min) | Worker is sending right now |
| 🔵 Awaiting | `queue_pending=0 AND tokens_pending>0` | Drain done, healthy wait for clicks |
| 🟡 Stalled | `queue_pending>0 AND is_active=false` | Real problem: queue has work but worker idle 10+ min |
| ⚪ Completed | `tokens_pending=0 AND activated>0` | All resolved |

Reactivation monitor open backlog (post-fair):
- "Stalled" 3-fetch heuristic is intentionally short — replace with a smarter detector that considers actual worker `sent_at` cadence.
- Reactivation drop-off analytics: daily activation curve graph (currently only a single percentage).
- Auto-close N days after `expos.end_date` (replace manual close click for routine cases).
- ETA formula currently hardcoded at 300/min (5/sec) — make dynamic from observed throughput.
- Custom modal in place of native `prompt()` for 3-layer resend confirm (some browsers let users mute prompts).
- Bulk-card SendGrid stats endpoint (current per-card fetch is fine at 1-3 expos; revisit if list grows).

**Test Email Cleanup (14 May 2026):**
- 5 internal test email addresses removed from all expos to give Mega Clima Nigeria 2026 (19-21 May) clean baseline metrics:
  - `yaprakguzelcik@gmail.com` (27 visitor rows across expos 1, 3, 5, 7, 9, 10)
  - `suer@elan-expo.com` (3 rows: expos 3, 5, 7)
  - `elan02@elan-expo.com` (7 rows: expos 3, 5, 6, 7, 8, 9, 10)
  - `info@siemamaroc.com` (4 rows: expos 3, 5, 7, 9)
  - `info@moroccofoodexpo.com` (4 rows: expos 3, 5, 6, 7)
- Migration: `migrations/007_test_email_cleanup.sql` (commits `aae78f4` original, `aa7dbcc` post-dry-run fix)
- Backup: `visitors_test_backup_20260514` (46 visitor rows snapshot — DROP after fair end 21 May 2026; see todo.md post-fair backlog)
- Rows affected: 46 visitors + ~389 related rows across 10 tables (campaign_recipients, conference_certificates, exhibitor_leads, reactivation_tokens, visitor_event_status, email_queue, email_logs, email_events via CASCADE, checkins via CASCADE).
- **First cleanup-pattern migration in this repo.** Migrations 001-006 are schema-only; 007 is the first data-only / pre-fair-housekeeping migration. Wrapped in a single transaction with explicit pre-cleanup of all RESTRICT FKs before the visitors DELETE.
- **Audit gap surfaced + caught by dry-run:** initial FK audit (13 May "delete capability" analysis) only mapped FKs pointing TO `visitors.id` and missed inbound FKs on the intermediate tables. Specifically `email_queue.campaign_recipient_id → campaign_recipients(id)` is a RESTRICT FK that blocked the first dry-run. Fix added a new STEP 1 in the migration to clean those email_queue rows before STEP 2 deletes campaign_recipients. No data harmed — transaction rolled back cleanly.
> ↪ **Two-phase migration pattern** maddesi (iki alt adımıyla) CLAUDE.md'ye taşındı (2026-10-21) → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.
- Apply this template to upcoming post-fair cleanup work: country pollution (44 distinct strings → ~33 canonical, audit 14 May), conference topic variants beyond what `conferenceCleanup.js` can handle (see ADR-021 + post-fair TODO).
- Verification post-execute: `SELECT COUNT(*) FROM visitors_test_backup_20260514` → 46; all four `remaining_*` validation counters → 0.

**Conference Scanner Pre-Display + Force Confirm (14 May 2026):**
- `public/conference-scanner.html` — two UX layers added before fair-day operation:
  - **Change A:** Visitor preview between QR lookup and `/checkin-and-certify` call. Hostess sees visitor's currently-registered sessions (parsed from `custom_fields.conference_topic` via `" || "` split) and a match/mismatch banner for the selected session, then taps "Confirm & Issue Certificate" or "Cancel / Re-scan". New helpers: `showVisitorPreview`, `confirmAndIssue`, `cancelPreview`, `splitTopicsClient`.
  - **Change B:** Custom confirm modal wrapping the "Save & Send Certificate" button in `showUnregCard`. Two-step: hostess must tap "Yes, Issue Certificate" in the modal (danger-red) after reading "this action cannot be undone". New helpers: `confirmForce`, `closeForceConfirm`, `executeForceCertify`.
- Backend untouched. `/checkin-and-certify` POST body shape, response handling, `forceCertify()` body, `showUnregCard` layout — all preserved. Only the call-site wrappers and pre-display layer added.
- Field name compatibility verified: backend response uses `customFields` (camelCase, `terminalCheckins.js:190` transforms snake_case `custom_fields` column).
- Frontend-only deploy (Render web service auto-deploy ~30s); email worker separate service, unaffected.
- Commit: `27ddae7`. Deploy verified 14 May 2026 11:38 UTC.
- Audit reference: `CONFERENCE_FORCE_AUDIT_20260514.md` (Karar Soru 2 + Karar Soru 3).

> ↪ `### Conference Topic Architecture` bölümü CLAUDE.md'de kaldı → "Versiyon Geçmişinden Ayrılıp Burada Kalanlar" bölümü.

### v4.0.2 (6 Şubat 2026)
- Import email QR fix (UUID → img tag)
- Reactivation Campaign modülü
- Email worker iki mod desteği
- Existing visitor re-registration email
- Webhook log formatı iyileştirmesi

### v4.0.1
- Temel EMS sistemi (expo, visitor, checkin, form, email, badge, terminal)

### v4.0.12 — Call-Center extended to Madesign (expo 18) alongside LIVE SIEMA (19 September 2026)

**Context:** `callcenter_leads` had to hold two fairs at once — SIEMA (expo 9,
22-24 Sep, live cohort calling daily) and Madesign (expo 18, 1-3 Oct). Every
agent/supervisor query was whole-table, so importing Madesign leads on the old
code would have mixed both pools for every agent, offered SIEMA scripts on
Madesign cards, pointed Register-now at form 59 (wrong fair) and resent
template 74 (SIEMA) with an expo-18 token. Two commits, one daytime push
(Saturday — no send day, no fair day, G42 satisfied).

Full record: `docs/sessions/DEPLOY_CALLCENTER_MADESIGN_20260919.md`.
Discovery + verification narrative: same doc §2.

#### `5496c3a` — per-expo settings + `?expo=` scoping + report phase 1
- **`EXPO_SETTINGS` in `routes/callcenter.js`** replaces the three SIEMA
  constants (`SIEMA_ACTIVATE_TEMPLATE_ID` 74, `ATTENDED_2025_EXPO_ID` 1,
  `CAMPAIGN_BY_EXPO_SEGMENT` 78/79). Expo 9 keeps exactly those values.
  Expo 18: activate template **90**, C-resend template **93**, register form
  **64**, campaigns **80/81**, label MADESIGN.
- **Attendance is per-expo by KIND, not just by id.** Expo 19 (Madesign 2025)
  has **zero `checkins` rows** — attendance lives only as
  `visitors.source='madesign2025_checkin'` (1,427 rows). Reusing the SIEMA
  checkins query would have flagged every Madesign lead as "did not attend".
  Measured 4.8 ms via `idx_visitors_expo_id`.
- **`?expo=`** (allowlist {9,18}, absent → 9, else 400 `INVALID_EXPO`) scopes
  `/next` (pool + remaining + stuck-claim reaper), `/stats/me`, `/stats/live`
  (cache key gains the expo), `/stats/agent/:name`, `/admin/dump`.
  `/outcome`, `/skip`, `/resend` stay id-addressed and read the lead's own
  `expo_id`. `/next` gains additive `register_form_id`, `expo_label`,
  `c_resend_enabled` — the agent page no longer hardcodes a form id.
- **New unauth `GET /api/callcenter/expo-meta?expo=`** — label + register form
  + agent-card texts (pills, scripts, WhatsApp). Unauthenticated because the
  splash renders before any key is entered. Display-only payload; pages **fail
  closed** ("Unknown or unreachable expo") rather than falling back to SIEMA.
- **Segment-C resend** (Madesign only, template 93, Mode 1, same 2-min
  cooldown, honours `email_unsubscribes`). SIEMA segment C keeps returning
  400 `RESEND_WRONG_SEGMENT` — `c_resend_template_id: null` is what gates it.
- New guards `RESEND_EXPO_NOT_CONFIGURED` + `RESEND_TOKEN_EXPO_MISMATCH`
  (both 0 rows at build time).
- **Report phase 1:** `utils/callCenterReport.js` pins all 4 queries to
  `REPORT_EXPO_ID = 9`; subject + HTML byte-identical, so the worker's
  `SIEMA Call-Center — %` 20 h probe is untouched. **`email_worker.js` is NOT
  modified in this push** — it requires the util, so the worker picks the
  filter up on its own deploy. ⚠️ Madesign call activity appears in **no**
  daily report until phase 2 (own subject prefix + per-expo probe).

#### `708a531` — form prefill (deferred Stage-6)
- `form-public.html` `renderField` default branch reads `?<field.name>=` and
  emits an `esc()`'d `value=`. Absent param → `''` → **byte-identical markup**
  (verified HEAD vs new across 10 field types × 4 URL shapes). `id` and `_lc`
  never prefill. Select/radio/checkbox/textarea not prefilled.
- `agent.html` Register-now passes `name, last_name, company, email, mobile`
  for segments **B/C only** — segment A is the wrong-email escape hatch, so a
  stale address must not ride along. ⚠️ **SIEMA agents gain prefill too** —
  benign (fields editable, nothing auto-submits) but a visible live change.

#### SIEMA equivalence — measured before commit (read-only production)
29 old-vs-new read comparisons identical (stats/live ×5 × 3 windows, stats/me
pool, /next remaining ×4 segments, 8 agents' outcomes, whole-table vs expo-9
md5); `buildDailyReport()` subject + HTML byte-identical; `agent.html` `t()`
identical across 252 key×lang pairs with segment-A cards byte-identical;
`npm test` exit 0, 0 failures. All 33,635 leads were expo 9 at build time, so
adding `expo_id = 9` changed SQL text without changing any result.

#### Decisions (Suer, 19 Sep)
- **No segment B for Madesign** — import is `A_activate` + `C_register` only;
  any other sheet name is ignored by `SHEET_TO_SEGMENT`.
- **Hold-outs excluded from the call pool** — by omission from the xlsx, not
  by code.
- **`CALLCENTER_AGENTS` not yet updated** — waits for Meriem's list covering
  both fairs. Both fairs share `CALLCENTER_KEY` and one allowlist; a missing
  name returns 400 `AGENT_NOT_ALLOWED`, and editing the env var restarts the
  web service (G43 cost).
- Madesign FR scripts are Suer's verbatim text; EN/TR mirrors, pills, WhatsApp
  one-liners and the segment-B safety drafts await Meriem's review.

### v4.0.13 — Fair "today" counts count PEOPLE, not scan rows (19 September 2026)

**Context:** SIEMA (expo 9, 22-24 Sep) runs a two-stage flow — badge desk, then
gate. `qrscanner.html` writes a `checkins` row on EVERY scan at every `scanner`
terminal (fail-closed, `e900b70`), and `/terminal/checkin` dedupes only per
terminal within `duplicate_threshold_seconds`. A desk scan + a gate scan is
therefore two rows, and every `COUNT(*)` "today" surface would show ~2× the
day-1 visitors. Re-entry scans inflated later days the same way.

**Change (read side only — nothing about how check-ins are WRITTEN changed):**
- `routes/reports.js:88` (`/summary` `checkins_today`) and `:403` (organizer
  summary `checkins_today`) → `COUNT(DISTINCT CASE WHEN … THEN visitor_id END)`
- `routes/checkins.js:499` (`/stats/summary`) and `:591` (`/stats`)
  `today_count` → `COUNT(DISTINCT visitor_id)` — feeds the Check-ins page "Today" tile
- `routes/expos.js:647` (`/:id/stats` `checkins_today`) → `COUNT(DISTINCT visitor_id)`
- `public/main-panel-v2.html` day-by-day list renders `unique_count` (already
  returned by `reports.js:268-277`), falling back to `count`

Field names and response shapes are unchanged — every consumer keeps working.

**Deliberately NOT changed:** hourly charts (`reports.js:833-850`, `:963-973`)
stay raw — they measure gate FLOW, where every scan is signal. `/live`
`fair_total_checkins` and the reports-page overlay chart were already DISTINCT.
`total_checkins` and the `entries/exits/reentries` split stay raw (row counts
by definition). `checkinReports.js` untouched.

⚠️ **Semantics:** "check-ins today" now means *people checked in today*. A
visitor who attends day 1 and day 2 counts once on each day (correct per-day);
the fair-wide total of people remains `fair_total_checkins` / `unique_visitors_checked_in`.

⚠️ **Day boundary is UTC** (`leena_v401_db` has `TimeZone=utc` at DB level;
`utils/db.js` sets no override) → 01:00 Casablanca. Outside fair hours.

**Measured on expo 13 (Mega Project Nigeria, single-stage flow), raw vs people:**
25 Aug 1,116 → 1,047 (6.2%) · 26 Aug 1,277 → 1,213 (5.0%) · 27 Aug 858 → 846 (1.4%).
The gap is small there because expo 13 scanned once per visit; under SIEMA's
two-stage flow it is expected to approach 2× on day 1.

Tests: `npm run test:setup && npm test` → 120 ✅ / 0 ❌ (finance suites; they do
not exercise these routes). New SQL expressions executed read-only against
production before commit.

### v4.0.14 — form-public.html French polish (19 September 2026)

**Context:** audit of form 67 (SIEMA on-site registration, expo 9) found four
visitor-facing English strings hardcoded in the shared `form-public.html`.
No DB setting can reach them. Items V1 / F2 / V12 / V13 of that audit; the
SQL-fixable defects (consent radio, "Website", Western Sahara, …) are NOT in
this commit.

- **V1 `:259`** — select placeholder `Choose...` → `pickUi('selectPlaceholder')`.
  Form 67 has **4** selects (Pays, Q1, Q5, Q6) that showed English.
- **F2 `:352`** — `Submitting...` → `pickUi('submittingLabel')`.
- **F2 `:418`** — after a FAILED submit the button was restored to hardcoded
  `Submit Registration`, overwriting `config.style.buttonText`. Now
  `buttonLabel()` = the form's own `buttonText`, else the language default.
- **V13 `:7` / `setFormLanguage`** — tab title `Registration Form` →
  `Formulaire d'inscription` for `fr`.
- **V12 `:524`** — `N° d'enregistrement:` → `N° d'enregistrement :` (FR spacing).

**Language read — the ordering trap.** `renderForm()` runs at `:203`,
`applyFormStyle()` at `:204`, and the select placeholder is built DURING
render. `formLanguage` was set inside `applyFormStyle` — one line too late, so
a render-time read would always have seen `'en'`. The assignment is now
`setFormLanguage(config)` (`:512`), called from `loadForm()` **before**
`renderForm()` and again from `applyFormStyle()` (`:635`). Idempotent, single
source of truth, handles the double-stringified-config case.

⚠️ **Not `formStyle`** — that is still null during render, by design. Only
`buttonLabel()` reads it, and that runs post-submit, long after style is applied.

**EN byte-identical — verified, not assumed.** A Node harness rendered all 8
field types against `HEAD` and the new file with a stubbed DOM: **0 diffs** for
`en` / null / `''` / non-'fr' config; exactly **1** diff under `fr` (the select).
`UI_DEFAULTS_EN` values are the old hardcoded strings verbatim.

**Side benefit (measured):** Madesign form **64** (expo 18, `language='fr'`,
2 selects) picks up the French strings automatically — same mechanism, no
per-form work. Forms 59 (2 selects) and 66 (3 selects) on expo 9 too.

⚠️ **Residual, NOT fixed here (out of scope):** the button's FIRST render at
`:226` is still the hardcoded `Submit Registration` until `applyFormStyle`
replaces it. Invisible on forms that set `buttonText` (59/64/66/67 all do).
Form **69** sets `buttonText='Register'` on a `language='fr'` form — an
English button on a French form, a DB defect, fixable by SQL.

Tests: `npm run test:setup && npm test` → 120 ✅ / 0 ❌ (finance suites; they do
not exercise this page — the harness above is the real evidence).

### v4.0.15 — qrscanner.html phone camera, opt-in via ?camera=1 (20 September 2026)

**Context:** the gate phones (Samsung A07 / Android Chrome) have no HID reader,
and `qrscanner.html` had **no camera path at all** — its only input was the
`scanInput` text box + Enter (`:159`, `:629`). Measured 20 Sep: no
`getUserMedia` / `BarcodeDetector` / `jsQR` / `<video>` anywhere in the file.

**The proven pattern was copied verbatim, not reinvented.** Source:
`conference-scanner.html:359-385` (same as `lead-scan.html`):
html5-qrcode@2.3.8 · `new Html5Qrcode(...)` · `facingMode:'environment'` ·
`fps:10` · the 60%-of-min-dimension `qrbox` function · `pause()` → handle →
`resume()` after 3 s · and the same "Camera not available. Enter QR code
manually below." fallback when `start()` rejects.

**Opt-in by construction — `?camera=1` only.** `cameraMode` is read in
`processUrlParameters` (`:577`) and is deliberately **NOT** persisted to
localStorage, unlike `terminalKey`/`hall`/`terminal`, so a desk can never
inherit camera mode from a phone that used the same key.
`initCameraScanner()` (`:458`) returns on its FIRST statement (`:459`) when
`cameraMode` is false: the library is never fetched, no `<video>` is created,
no camera permission is requested, and `#scannerContainer` stays
`display:none` (`:154`).

**ONE decode path.** The camera callback (`:493-501`) applies the same
`isProcessing` guard the keypress handler uses, writes the decoded text into
`scanInput`, then calls `handleQRScan()` — the identical function the Enter
key calls. There is no second submit route, so fail-closed check-in (`e900b70`)
and the duplicate note apply to camera scans unchanged.

**Regression proof: `git diff --numstat` = 83 insertions, 0 deletions.** Not a
single existing line was modified. The HID flow (`:159` autofocus, `:629`
Enter handler, `:642`/`:736`/`:917` clear-and-refocus) is untouched.

Verified with a stubbed-DOM harness over the real script: for `''`,
`?terminal_key=abc`, `?camera=0` → `cameraMode=false` and **0** scripts
appended; for `?camera=1` and `?terminal_key=abc&camera=1` → the html5-qrcode
URL is appended once and the container becomes visible.

⚠️ **Open risk, NOT solved here:** `scanInput` keeps `autofocus`, so Android
Chrome may raise the soft keyboard over the viewfinder. Left as-is
deliberately — removing focus would change the HID desks' behavior. Needs a
field decision on the actual phone.

Tests: `npm run test:setup && npm test` → 120 ✅ / 0 ❌ (finance suites; they do
not exercise this page).

**Devil's-advocate hardening (same day, second pass on the same branch):**

- **Reentrancy, double lock.** Camera callback still guards `isProcessing`
  (`:513`) and `pause()`s (`:514`); `handleQRScan()` now ALSO returns early on
  `isProcessing` at its first statement (`:672`). No-op for the keyboard path:
  the keypress handler (`:647`) already tested `!isProcessing` before calling.
  `isProcessing` is set true at `:685` (scan) / `:785` (manual) and cleared at
  `:757`, `:834`, `:841`, `:852`. Measured: with `isProcessing=true`,
  `handleQRScan()` issues **0** fetches; with false, **1**.
- **Camera mode skips the badge popup and the refocus** (`:932-941`). A gate
  phone has no printer, the popup would be eaten by the pop-up blocker, and
  focus raises the soft keyboard over the viewfinder. Without `camera=1` the
  function is byte-identical (popup 1, focus 1). NOTE: this choke point is
  shared with the manual-registration path (`finishManual` → `:947`), so on a
  camera phone manual registration also prints no badge — intended.
- **`inputmode="none"` set at runtime in camera mode only** (`:465-466`); the
  markup at `:159` is untouched.
- **`parseQR` copied verbatim from `conference-scanner.html:396-408`**
  (`:476-489`), applied ONLY to camera input (`:516`). Measured:
  `…badge.html?qr=ABC-123` → `ABC-123`, bare `ABC-123` → unchanged,
  `…/badge/XYZ-9` → `XYZ-9`.

### v4.0.16 — camera-mode feedback + compact phone layout (20 September 2026)

Camera mode (`?camera=1`) only. Every addition sits behind the same gate as
v4.0.15; the parameter-less page is unchanged.

- **Beep.** Web Audio oscillator, no audio file → works offline. Success: one
  880 Hz / 140 ms tone. Failure: **two** 220 Hz / 160 ms tones, 220 ms apart.
  Measured: success `[880]`, failure `[220,220]`.
- **Autoplay policy solved the conference-scanner way** (`:283-289` there): a
  context built inside the decode callback starts `suspended` and stays silent,
  because a camera decode is not a user gesture. `initCamAudio` is wired to the
  first `touchstart` / `click` / input `focus` (`once`), and `camTone` calls
  `resume()` again on every tone in case Android suspended it in the
  background. Measured with `camera=1`: 1 context, 5 `resume()` calls, listeners
  `doc:touchstart, doc:click, scanInput:focus`. Without the parameter: **0**
  contexts, none of those listeners.
- **Flash.** `#camFlash`, a fixed full-screen layer created at runtime (no
  markup change), green on success / red on failure, ~300 ms. Measured:
  `["ok show","ok"]` / `["err show","err"]`.
- **Vibrate.** `navigator.vibrate(200)` on success only, in try/catch — Android
  buzzes, iPhone ignores it silently. Measured `[200]`.
- **"Already checked in" gets the SUCCESS signal** — at the gate it is a valid
  entry. The yellow duplicate note carries the nuance.
- **Compact layout:** `body.camera-mode` class + CSS scoped to it (`:75-101`),
  shrinking the header, hiding the subtitle and tightening paddings so
  viewfinder + status + input fit one portrait screen. Without the class not
  one of those selectors can match.
- **`beep()` delegates to `camBeep` in camera mode** (`:1006`) so
  `showCheckinError` cannot sound twice — the legacy per-call AudioContext
  would be `suspended` on Android anyway. Without `camera=1` the original path
  runs untouched (measured: 2 contexts for 2 beeps).

⚠️ The ONE pre-existing line touched across v4.0.15+v4.0.16 is
`beep(false);` in `showCheckinError` — a trailing comment plus a new
`camFlash(false)` line after it. The call itself is unchanged.

Tests: `npm test` → 120 ✅ / 0 ❌.

### v4.0.17 — camera-mode: zero layout jump + one-screen fit (20 September 2026)

Camera mode (`?camera=1`) only; same gate as v4.0.15/16.

**The bug, measured before the fix** (headless Chrome, 360×780, real layout):
the viewfinder's top moved **182 → 158 → 214 → 497 → 84 px** as the alert,
duplicate note and check-in-error panel appeared and went. All three sit ABOVE
`#scannerContainer` in the DOM, so every one of them pushed the camera down.

**Fix:** in camera mode those three blocks are taken **out of flow**
(`position:absolute`, `z-index:6`) and overlaid on a band reserved by
`.scanner-body { padding-top: 56px }`. Out-of-flow elements cannot move their
siblings, so show/hide is geometrically inert. `max-height:46vh; overflow-y:auto`
keeps a long message from covering the whole viewfinder.

**Viewfinder is now a fixed box:** `height: min(42vh, 300px)` plus
`video { height:100%; object-fit:cover }`, so the page fits one portrait screen
and the qrbox maths has a stable input.

**Measured after the fix** — viewfinder top identical across all five states
(empty → alert → duplicate → error → cleared) at every size, and the page fits
without scrolling:

| viewport | viewfinder | qrbox (60%, floor 120) | fits one screen |
|---|---|---|---|
| 360×780 (A07-like) | 336×300 | **180** | yes |
| 412×915 | 388×300 | **180** | yes |
| 375×667 | 351×280 | **168** | yes |
| 360×640 | 336×269 | **161** | yes |
| 320×568 (smallest) | 296×239 | **143** | yes |

The 120 px floor is never reached — the smallest case still computes 143.
`.scanner-body` bottom padding went 12 → 6 px because 320×568 overflowed by
exactly 1 px before that.

**Parameter-less page unchanged — measured, not asserted.** The same headless
run against `HEAD` and the new file with no `camera=1`: the rects of
`.scanner-header`, `.scanner-body`, `#scanInput`, `.divider`, `.toggle-manual`
and `document.body.scrollHeight` are **identical** at 360×780 and 1280×800,
across the message show/hide cycle.

⚠️ Headless measures the full viewport; a real phone loses height to browser
chrome. The `vh` units scale with it, but the one-screen claim should still be
eyeballed on the A07.
⚠️ The error panel now overlays the running viewfinder, and the camera still
resumes 3 s after a scan (v4.0.15 behaviour), so a badge left in frame can
re-trigger while the panel is up. Pre-existing; not changed here.

### v4.0.18 — certificate-siema.html readable on a phone (26 September 2026)

**Symptom (visitor complaint, Houria Goumih):** on iPhone Safari portrait only the
top band rendered — logo + "Certificat de Participation" — and nothing else.
Landscape and desktop were fine, and "Enregistrer en PDF" always produced a
correct 1-page A4-landscape file, so the print path was never the problem.

**Cause, measured (headless Chromium, 390×844, pre-fix):** the certificate is a
fixed A4-landscape box whose inner type is absolute (`font-size:54px`,
`width:min(235mm,96%)`, …), so it cannot reflow. Two rules shrank the BOX while
the CONTENT kept its size:
- `.certificate{ max-width:98vw }` (base rule)
- `@media (max-width:1100px){ .certificate{ width:100%; height:auto; aspect-ratio:297/210 } }`

At 390 px the box became ~276 px tall against ~794 px of content, and
`.certificate{ overflow:hidden }` clipped the rest. Measured element positions
before the fix: session text at y=1255-1307, signature at y=1394 — both far
below the 844 px viewport, and `right:460` past the 390 px width.

**Fix:** keep the box at its natural 297mm × 210mm and scale it proportionally
with a CSS transform computed from the viewport (`fitCertificate()`), origin
top-left, with a new `.cert-fit` wrapper carrying the scaled layout size so the
document gets no phantom overflow. `.page` gains top padding under 1100 px so
the fixed toolbar never covers the certificate.

**@media print untouched.** A print-scoped override neutralises the transform
and the wrapper size, so the PDF still renders the unscaled page.

**Measured after the fix:**
| viewport | transform | name | session | signature | toolbar | doc scrollWidth |
|---|---|---|---|---|---|---|
| 390×844 | scale(0.333) | visible | visible | visible | visible | 390 (no h-scroll) |
| 1280×800 | none | visible | visible | visible | visible | 1280 |

PDF from the same page: **1 page, MediaBox 842.9 × 595.9 pt (landscape)**.

⚠️ At 1280×800 the certificate still ends 12 px below the fold (794 px + 18 px
padding = 812) — pre-existing, unchanged by this fix.

### v4.0.19 — Expo editing is self-service (28 September 2026)

**Two gaps, one PR.**

**1. The dashboard pencil did nothing.** `public/dashboard_new.html:734` rendered
`<button class="btn btn-secondary"><i class="bi bi-pencil"></i></button>` with
**no `onclick` at all**, inside a wrapper that calls `event.stopPropagation()`
(`:732`) — so the card's own "Enter" handler never fired either. Clicking it was
a silent no-op. Now `onclick="editExpo(${expo.id})"` → `editExpo()` (`:769-771`)
navigates to `expo-form.html?id=<id>`, the same target `expo-list.html:276`
already used. (`expo-list.html` was already wired; no other page had a dead edit
control — `main-panel-v2.html:1441` is a FORM edit button, unrelated.)

**2. `expos.settings` was database-only.** Edit Expo existed
(`expo-form.html:240`) but never showed the two check-in keys, and
`routes/expos.js` PUT could not write them: `WRITABLE_FIELDS` (`:186-196`) has no
`settings`, so `auto_checkin_on_badge_print` could only be changed from Render
Shell (this is how expo 9 got `false` on 18 Sep, and why expo 18 still sits at
`true`). Readers: `routes/terminalCheckins.js:294-295`.

Now: a "Check-in settings" block in edit mode (`expo-form.html`, checkbox +
10-3600 s number), loaded from `GET /api/expos/:id` (which **already** returned
`settings` — `routes/expos.js:120` `SELECT e.*`, so no API change was needed),
sent by `save()` only when editing.

**The PUT merges, never replaces** (`routes/expos.js:337-371`):
```sql
settings = COALESCE(settings, '{}'::jsonb) || $n::jsonb
```
`settings` is deliberately kept OUT of `WRITABLE_FIELDS`: a plain assignment
would silently drop keys this endpoint does not know about. Only the two keys are
accepted; booleans and 10-3600 integers are enforced; any other key is a 400.

**Measured (local stub DB, real route + real SQL):** unknown key
`korunmali_anahtar` survived the merge; `5` and `4000` rejected; `"yes"`
rejected; `default_badge_template_id` rejected; `[1,2]` rejected; date + settings
in one PUT → 200, then restored → 200.

⚠️ **Browser→PUT could not be exercised locally:** the CORS whitelist is
hardcoded to leena.app (`index.js:21`), so a localhost page's PUT is refused
(500) — a local-only obstacle. The UI half was verified separately: the form
loads real expo-17 values from production (read-only) and `save()` builds the
right payload. Production rows were never written.

### v4.0.20 — Night pack: bulk-email unsubscribe filter, wizard badge-token guard, qr-image 404 (28 September 2026)

Three items from the C-list. **The 4th (Madesign certificate page) was NOT built — see the stop note below.**

**C1.16 — `POST /api/visitors/bulk-email` now honours the unsubscribe list.**
It had none: the handler queued Mode-2 rows straight from the visitor filter
(`routes/visitors.js:1224`), and the worker's own unsubscribe re-check
(`email_worker.js:635`) only guards the CAMPAIGN path — so an unsubscribed
visitor really did receive bulk mail from the Visitors page. The same loop the
segment sender uses (`routes/emailSegments.js:122-131`) is now applied, and the
response carries `skipped_unsubscribed` / `skipped_invalid`. Measured on expo 9,
unfiltered: **21,669 → 21,514 queued** (76 unsubscribed + 79 invalid skipped).

**C2.4 — the campaign wizard now REFUSES badge-only placeholders.**
`qr_code` / `badge_link` / `badge_url` / `badge_id` exist only in the Mode-2
badge build (`email_worker.js:255-270`); the campaign build (`:666-674`) has
name/first_name/last_name/email/company/date + extra_fields, and
`utils/email.js:21` turns an unmatched token into `''`. Measured 21 Sep on
template 99: `{{qr_code}}` rendered as nothing, `{{badge_link}}` as `href=""`.
New `BADGE_TOKEN_IN_CAMPAIGN` (severity **error**) in `validateTemplateBody`.
Verified against the real templates: **90, 91, 92, 93, 94, 95 all clean** — so
the live campaigns 80/81 and tomorrow's step-3 send are untouched — while
86/87/88/99/101/103 are now blocked in the wizard, which is exactly the trap.

**C2.3 — `/api/qr-image/:qrcode` answers 404 for unknown codes and caches.**
It used to render a valid QR of any string with 200, indistinguishable from a
real badge. Now: UUID-v4 shape check + `SELECT 1 FROM visitors WHERE qr_code`,
then `Cache-Control: public, max-age=604800, immutable`. Measured against
production data (read-only): real code → 200 + header + image/png; unknown
UUID → 404; `not-a-uuid` → 404; `--` → 404.

⚠️ **Unchanged, proven byte-identical:** `certificate.html`,
`certificate-ng.html`, `certificate-mp26.html`, `certificate-siema.html`,
`routes/conferenceCertificates.js`, `email_worker.js`,
`routes/terminalCheckins.js`, `routes/emailSegments.js`, `utils/email.js`.
`npm test` → 120 ✅ / 0 ❌.

**STOP — Madesign certificate page not built.** The logo exists
(`https://madesignmaroc.com/landing/images/madesign-logo.png`, live in templates
91/92/94/95), but the SIEMA certificate's substance does not transfer: it names a
conference programme ("Food Factory Africa Forum by SIEMA"), a theme ("CAP AGRO
2030 — …"), and scientific-programme partner logos (Harvard Consulting, Atlas
Speaker Bureau, AMDIE). For expo 18 none of these exist in repo or DB, and no
expo-18 form carries `conference_topic` (measured: 0 of forms 62/63/64/71), so
there is no session list either. Writing that text would mean inventing brand
copy on a document that gets emailed to visitors. Needed from Yaprak/Suer:
forum name, theme line, partner logo set, signature image, and the certificate
number prefix (SIEMA uses `FFAF-2026-`; proposed Madesign form `MDSN-2026-`).

### v4.0.21 — Madesign nightly call-center report (28 September 2026)

**Context:** since v4.0.12 phase 1, `utils/callCenterReport.js` was pinned to
`REPORT_EXPO_ID = 9`, so Madesign (expo 18) call activity appeared in **no**
daily report — measured tonight: **1,019 calls done today on expo 18**, none of
them visible to anyone. Phase 2 adds a SECOND, independent report.

**One entry per fair, each with its OWN subject prefix:**
```js
const REPORT_EXPOS = {
  9:  { label: 'SIEMA',    prefix: REPORT_SUBJECT_PREFIX },   // byte-identical to phase 1
  18: { label: 'MADESIGN', prefix: 'MADESIGN Call-Center — ' }
};
```
`buildDailyReport(pool, expoId = 9)` and `sendDailyReport(pool, expoId = 9)` —
the four queries bind `expoId` where they bound the constant, the `<h2>` uses
`cfg.label`, the subject uses `cfg.prefix`, and the `email_queue` INSERT writes
`expo_id` as `$4` instead of a literal `9`.

**The 20-hour probe is now PER REPORT** (`email_worker.js`, inside
`maybeFireCallCenterDailyReport` only). The loop probes `prefix || '%'` per fair,
so SIEMA's fire can no longer suppress Madesign's or vice versa, and the
try/catch sits INSIDE the loop — one fair's failure cannot skip the other's
report for the whole night. `REPORT_TO_NOT_SET` still returns immediately
(no recipients at all → every fair would fail identically, and the warning
stays once-per-process).

**`?expo=` on send-now** — `POST /api/callcenter/report/send-now` uses the same
`resolveExpoId` every other endpoint in the file uses (absent → 9, unknown →
400 `INVALID_EXPO`), and `admin.html` gained `EXPO_QS1` (the `?`-leading form of
`EXPO_QS`, which leads with `&`). `admin.html?expo=18` → MADESIGN; the
parameter-less page → SIEMA, unchanged.

**SIEMA byte-identical — measured, not asserted.** HEAD vs new
`buildDailyReport` against the same stubbed rows: subject string identical,
html **md5 `5840e4bd…`, 2,455 bytes, equal**, all 4 SQL texts identical, all 4
param arrays identical (`[todayStart, 9]` ×3 + `[9]`). Expo 18's html equals
expo 9's after a single `MADESIGN→SIEMA` swap. The only SIEMA-side SQL text
change is the INSERT's `9` → `$4`; the row written is identical (measured:
`expo_id=9`, same subject, ×3 recipients).

**Campaign path zero touch — measured.** `email_worker.js` diff hunks are line
**10** (the require) and **838-877** (`maybeFireCallCenterDailyReport`) only.
md5 of every campaign/queue function is unchanged HEAD vs new:
`enqueueStepEmail` `7c2ba39d`, `evaluateCondition` `ea3341c9`,
`processRecipient` `fcf95b44`, `computeNextDue` `05da9325`,
`checkCampaignCompletion` `704509fd`, `runCampaignScheduler` `0685701d`,
`processTask` `68cb2b71`, `logToEmailLogs` `2acf8b21`. Campaigns 80/81's next
step is due **30 Sep 08:17 / 08:56 UTC** — 1 day 15 h away, untouched.

**Deploy gate at 16:46 UTC:** `email_queue` pending/processing **0**; recipients
due within 30 min **0**. Worker hour cap (18:00-22:59 UTC) means a restart now
cannot fire a report early.

⚠️ **A manual send-now suppresses that fair's auto-fire for 20 h — per fair.**
Sending Madesign by hand this evening is expected to make tonight's 18:01 UTC
tick send **SIEMA only**; Madesign resumes automatically tomorrow.

⚠️ **The Casa-day boundary is `Africa/Casablanca` on the WORKER host** — with
current tzdata that is UTC+1, so "today" starts 23:00 UTC. Morocco has been on
GMT since 20 Sep 2026, so the window is shifted one hour. Pre-existing since
phase 1, identical for both reports, deliberately NOT changed here.

Tests: `npm run test:setup && npm test` → **120 ✅ / 0 ❌**, exit 0.

