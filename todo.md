# Leena EMS — TODO & Roadmap

> Son güncelleme: 12 Mayıs 2026
> Aktif modül: Leena EMS Core + Email Campaigns + Visitor Management
> Admin panel: masaüstü/laptop kullanılıyor (mobil öncelik düşük)

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

### Visitor Management
- [ ] Madde 3: Visitor delete (hard delete, checkin-less visitors only)
- [ ] Visitor detail panel: add check-in history (all check-in timestamps)

### Conference Module (post-fair)
- [ ] Sprint Cleanup: remove /api/conference-cleanup routes + conference-cleanup.html + Topic Cleanup button from conference-sessions
- [ ] Conference Entity Migration: new tables (expo_conferences, visitor_conferences), migrate JSONB strings to FKs, refactor 8-10 affected modules. See ADR-021.
- [ ] Webhook input validation: normalize conference_topic against canonical form options
- [ ] Audit DB: remove any remaining test data ("Choice One" etc.)
- [ ] Ghana expo (id=5) cleanup decision: archive or migrate

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
