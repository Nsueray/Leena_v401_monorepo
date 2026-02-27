# Leena EMS — TODO & Roadmap

> Son güncelleme: 27 Şubat 2026
> Aktif fuar: Mega Horeca Ghana
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

## 🔴 Bugün Yapılacak (27 Şubat 2026)

- [ ] Conference topic backfill: Zoho'dan Excel export → import page ile conference_topic güncelle

---

## 🟡 Sprint 3 — Email Stabilizasyon (Fuar sonrası, 1 hafta)

Fuar sırasındaki "email gitmiyor" sorununun kök nedeni: 5 yerde direkt SendGrid çağrısı var.

- [ ] webhook.js → email_queue üzerinden gönder (direkt sgMail.send kaldır)
- [ ] visitors.js import → email_queue üzerinden gönder
- [ ] visitors.js public form → email_queue üzerinden gönder
- [ ] emailSend.js bulk/single → email_queue üzerinden gönder
- [ ] emailSegments.js → email_queue üzerinden gönder
- [x] `email_worker.js` — FOR UPDATE transaction fix ✅ 24 Şubat
- [x] `emailSend.js` — BASE_BADGE_URL fallback ✅ 23 Şubat

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

## 📋 Stratejik Notlar

1. **Sprint 3 en büyük operasyonel iyileştirme** — email güvenilirliğini kökten çözer
2. **Sprint 5 (UI Unification) diğer tüm UI işlerini kolaylaştırır** — sidebar component yapılınca aynı link güncelleme işi tekrarlanmaz
3. **CSS nesil birleştirme, sidebar genişliği** — SaaS fazına bırakıldı, fuar öncesi riskli
