# Leena EMS — TODO & Roadmap

> Son güncelleme: 20 Nisan 2026
> Aktif modül: Form Design + Leena EMS Core
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

## 🔴 Floor Plan Builder — Sprint 4 (Next)

- [ ] Background image UX (resize, reposition, alignment)
- [ ] Batch stand workflow (draw large area → split into grid)
- [ ] PDF export (branded, server-side — Phase 2)
- [ ] Connected shape validation (cell adjacency check)
- [ ] Sidebar link to existing 15 admin pages
- [ ] Stand resize (edge drag to expand/shrink)

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
- [ ] Visitor detail panel: add edit capability (currently read-only)
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
