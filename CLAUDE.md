# CLAUDE.md — Leena EMS

> Bu dosya Claude Code'un her oturumda otomatik okuduğu proje hafızasıdır.
> Son güncelleme: 22 Şubat 2026 | Versiyon: v4.0.2+

---

## 🔴 ANA KURALLAR (HER ZAMAN GEÇERLİ, İSTİSNASIZ)

### KURAL 1: TAHMİN YÜRÜTME YASAĞI
Tahmin yürüterek kod yazmak veya değişiklik yapmak **kesinlikle yasaktır.**
- Önce analiz yap, ilgili dosyaları oku, veri akışını takip et
- Kesin emin olduktan sonra değişiklik öner
- Emin değilsen → DUR, sor, dosyayı oku
- Asla "muhtemelen böyledir" diye kod yazma
- Fonksiyon isimleri, parametreler, DB kolonları, değişkenler — hepsini dosyadan doğrula

Eksik bilgi varsa:
1. Durmalısın
2. İlgili dosyayı `cat` ile okumalısın
3. Yanıtı bekleyip ondan sonra devam etmelisin

### KURAL 2: MEVCUT SİSTEMİ BOZMA YASAĞI
Leena.app **aktif olarak kullanılmaktadır.** Mevcut sistemi bozacak hiçbir değişiklik yapılamaz.
- Her değişiklik öncesi "bu mevcut işleyişi bozar mı?" sorusu sorulmalı
- Backward compatibility her zaman korunmalı
- Mevcut endpoint'lerin davranışı değiştirilmemeli
- Riskli değişikliklerde detaylı açıklama hazırla ve onay al

### KURAL 3: VERİTABANI DEĞİŞİKLİĞİ KISITLAMASI
DB ve tablolarda değişiklik yapmak **varsayılan olarak yasaktır.**
- Yeni tablo/kolon eklemek nispeten güvenlidir ama yine de onay gerekir
- `DROP`, `DELETE`, `ALTER ... DROP COLUMN` gibi yıkıcı operasyonlar özellikle tehlikelidir
- Detaylı açıklama hazırla (hangi tablo, hangi kolon, neden, ne etkilenir)

### KURAL 4: DEĞİŞİKLİK DÖKÜMANTASYONU ZORUNLULUĞU
Yapılan **her değişiklik** bu CLAUDE.md dosyasına güncellenmelidir.
- **Güncellenmemiş CLAUDE.md = eksik iş**

---

## Proje Nedir?

**Leena EMS**, fuar/kongre yönetimi için geliştirilmiş B2B SaaS platformudur. Organizatörler etkinlik oluşturur, ziyaretçiler kayıt olur, giriş çıkışlar QR kod ile takip edilir, otomatik email'ler gönderilir.

### Temel Tasarım Prensipleri

1. **Tek Sistem, Değişen Fuarlar:** Yeni fuar açmak = yeni sistem kurmak DEĞİL. Fuarlar (expo) sistem içinde değişen varlıklardır.

2. **Tek Kişi Kaynağı (Single Source of Truth):** Sistemde tek bir kişi tablosu vardır (`visitors`). Visitor, Exhibitor, Staff, VIP, Speaker — hepsi aynı tabloda, farkı `visitor_type` alanı belirler.

3. **Exhibitor = visitor_type, ayrı tablo DEĞİL:** Exhibitor visitors tablosunda `visitor_type='exhibitor'` olarak tutulur. Tek QR, tek badge, tek check-in sistemi.

---

## Ortam Bilgileri

### Lokal Geliştirme
- **Proje Dizini:** `/Users/nsa/Desktop/Leena_v401_monorepo`
- **Backend+Frontend Kökü:** `backend/leena-v401-backend/`
- Backend ve frontend aynı repo, aynı dizin
- `app.use(express.static(path.join(__dirname, 'public')));` (index.js satır 46)

### GitHub
- **Repo:** `https://github.com/Nsueray/Leena_v401_monorepo.git`

### Production
- **Domain:** `https://leena.app`

### Render Servisleri (3 adet — hepsi Oregon region)
| Servis | Tip | Açıklama |
|--------|-----|----------|
| **Leena_v401** | Web Service (Node.js) | Ana uygulama + API + frontend |
| **leena-email-worker** | Background Worker (Node.js) | `node email_worker.js` |
| **leena_v401_db** | PostgreSQL 17 (Managed DB) | Veritabanı |

### DB Bağlantısı
```
psql "postgresql://leena_v401_db_user:xlM5m9TWwT4gXqqiicMA6QjZboJ6njmu@dpg-d2smvl75r7bs73al6scg-a/leena_v401_db"
```

### Deploy Akışı
```
git add . → git commit -m "mesaj" → git push → Render otomatik deploy
```
⚠️ `git push` = production'a deploy. Dikkatli ol.

---

## Teknoloji Stack

| Katman | Teknoloji |
|--------|-----------|
| Backend | Node.js + Express **5.1.0** (⚠️ Express 5 — v4'ten önemli API farkları var) |
| Veritabanı | PostgreSQL 17 (Render Managed) |
| Frontend | Static HTML/JS (Express static serve, `public/` klasörü) |
| Email | SendGrid (async email_worker ile) |
| QR | Sunucu tarafı QR üretimi (uuid v4) |
| CSS | Sayfa bazlı inline CSS (Inter font, Bootstrap Icons) |
| Auth | JWT (organizer), x-terminal-key (terminal) |
| Hosting | Render.com |

---

## Dizin Yapısı

```
backend/leena-v401-backend/
├── index.js                    # Ana giriş noktası (CORS, static serve, route mount)
├── initial.sql                 # Temel DB şeması (DİKKAT: production ile tam senkron DEĞİL)
├── email_worker.js             # Async email kuyruğu işçisi (Render Background Worker)
├── routes/
│   ├── auth.js                 # Login/Register, JWT
│   ├── organizers.js           # Organizer profil (GET /, GET /:id)
│   ├── expos.js                # Expo CRUD + stats
│   ├── visitors.js             # Visitor CRUD, import (upsert), manual registration, badge
│   ├── forms.js                # Form CRUD (9 endpoint, public submit dahil)
│   ├── checkins.js             # Check-in listeleme + stats
│   ├── checkinReports.js       # Check-in rapor verileri (saatlik/günlük)
│   ├── terminalCheckins.js     # Terminal check-in + visitor-by-qr + visitor-by-email + badge-print
│   ├── terminals.js            # Terminal CRUD (5 endpoint)
│   ├── webhook.js              # Zoho form webhook + existing visitor email resend
│   ├── emailSend.js            # Bulk + single email gönderimi
│   ├── emailTemplates.js       # Email template CRUD + defaults
│   ├── emailSegments.js        # Email segment yönetimi (send)
│   ├── emailInbound.js         # Inbound email webhook (POST /inbound)
│   ├── import-checkins.js      # Checkin import (POST /, GET /stats)
│   ├── reports.js              # Raporlama (summary, export, comparison)
│   ├── badgeTemplates.js       # Badge template CRUD + terminal endpoint
│   ├── reactivation.js         # Reactivation campaign API + resend-pending
│   └── leads.js                # Exhibitor lead scanner API (public, QR auth)
├── middleware/
│   ├── authMiddleware.js       # JWT doğrulama (req.organizer_id atar)
│   ├── auth.js                 # Alternatif JWT middleware (req.user objesi atar — aşağıya bak)
│   └── terminalAuth.js         # Terminal key doğrulama (x-terminal-key header)
├── utils/
│   ├── db.js                   # PostgreSQL bağlantısı (pool)
│   ├── email.js                # processEmailTemplate helper
│   └── qrcode.js               # QR generation helpers
├── public/                     # TÜM frontend dosyaları burada
│   ├── login.html
│   ├── main-panel-v2.html          # Ana dashboard
│   ├── visitorlog-paginated.html   # Visitor listesi + visitor_type filtre
│   ├── qrscanner.html              # Terminal QR tarayıcı + email arama + popup badge
│   ├── badge.html                  # Badge görüntüleme (word-wrap, auto-size)
│   ├── badge-templates.html        # Badge template yönetimi + bulk print
│   ├── form-builder.html
│   ├── form-list.html
│   ├── checkins.html
│   ├── terminals.html
│   ├── email-templates.html
│   ├── email-segments.html
│   ├── email-send.html
│   ├── reactivation-campaign.html  # Campaign yönetimi + resend to pending
│   ├── reactivate.html             # Visitor onay sayfası (public)
│   ├── reports.html                # Genel raporlar
│   ├── checkin-reports.html        # Check-in analytics dashboard (Charts, CSV export)
│   ├── lead-scan.html              # Exhibitor lead scanner (public, mobil, kamera QR)
│   ├── import.html
│   ├── register.html               # Organizer kayıt
│   ├── expo-create.html            # Expo oluşturma
│   ├── form-public.html            # Public form submit sayfası
│   ├── badge-print.html            # Badge print sayfası
│   ├── checkin-import.html         # Checkin import sayfası
│   └── assets/                     # Logo vb.
# ⚠️ public/ altında *.backup.html ve eski dashboard varyantları (dashboard.html,
#    dashboard_new.html, admin-dashboard.html, main-panel.html, login_new.html) mevcut,
#    aktif olarak kullanılmıyor.
└── uploads/                    # Kullanıcı yüklemeleri
```

---

## Veritabanı Şeması

### Ana Tablolar

| Tablo | Amaç |
|-------|------|
| organizers | Hesap sahipleri, auth |
| expos | Etkinlik tanımları (organizer_id) |
| visitors | Kayıt verileri (organizer_id, expo_id, form_id) — TEK kişi kaynağı |
| checkins | Giriş logları (visitor_id, expo_id, terminal, hall, checkin_time) |
| visitor_event_status | Kişi başı event durumu (check-in yapılınca upsert) |
| terminals | Fiziksel tarayıcı tanımları (terminal_key ile auth) |
| forms | Kayıt form yapılandırması (email_template_id) |
| email_templates | HTML email tasarımları (organizer_id) |
| email_queue | Async email görevleri (iki mod: direct HTML veya visitor+template) |
| badge_templates | Badge tasarımları (visitor_type bazlı) |
| email_logs | Email gönderim logları (emailSend + emailSegments tarafından yazılır) |
| reactivation_tokens | Kampanya tokenları (source_expo_id → target_expo_id) |
| exhibitor_leads | Exhibitor lead kayıtları (exhibitor_company bazlı) |

### visitors Tablosu Önemli Kolonlar
- `id`, `name`, `last_name`, `email` (unique per expo), `phone`
- `company`, `country`, `job_title`
- `visitor_type` — visitor, exhibitor, vip, press, staff, speaker (DEFAULT: visitor)
- `booth_number` — exhibitor'lar için stand numarası
- `qr_code` — unique UUID (upsert'te korunur, DEĞİŞMEZ)
- `badge_id` — qr_code'un ilk 8 karakteri
- `source` — manual, form, import, webhook, email
- `origin` — massimport, manual_entry, zoho, manual_email_send
- `expo_id`, `organizer_id`, `form_id`
- `updated_at` — upsert'te güncellenir
- `custom_fields` — JSONB (ek alanlar)

### exhibitor_leads Tablosu (v402+)
```sql
CREATE TABLE exhibitor_leads (
  id SERIAL PRIMARY KEY,
  expo_id INTEGER NOT NULL REFERENCES expos(id),
  exhibitor_visitor_id INTEGER NOT NULL REFERENCES visitors(id),
  exhibitor_company VARCHAR(255) NOT NULL,
  lead_visitor_id INTEGER NOT NULL REFERENCES visitors(id),
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);
```

### email_logs Tablosu
Email gönderim sonuçlarının loglandığı tablo. `emailSend.js` ve `emailSegments.js` tarafından yazılır.
- `id`, `organizer_id`, `expo_id`, `visitor_id`, `template_id`
- `email` — Alıcı email adresi
- `status` — sent, failed
- `message` — Hata/başarı mesajı
- `sent_at` — Gönderim zamanı

### email_queue Ek Kolonlar (v402)
- `recipient_email`, `subject`, `html_content` — Direct HTML modu için
- `sent_at`, `error_message` — Takip için

> **⚠️ Gerçek şemayı görmek için her zaman production DB'yi kontrol et, initial.sql'e güvenme.**

---

## Kimlik Doğrulama

### 1. Organizer Auth (JWT)
- `POST /api/auth/login` → JWT token
- Frontend: `localStorage.getItem('token')`
- Header: `Authorization: Bearer <token>`
- **İki farklı JWT middleware var:**
  - `middleware/authMiddleware.js` — `req.organizer_id` atar. Çoğu route bunu kullanır.
  - `middleware/auth.js` — `req.user` objesi atar (`{id, email, organizer_id}`). Daha esnek payload parsing: `decoded.id || decoded.organizer_id || decoded.userId`. JSON response döner.
- **⚠️ JWT expire olduğunda UI çalışıyor gibi görünür ama veri yazılmaz (sessiz kayıp)**

### 2. Terminal Auth (Key-Based)
- JWT yok, `x-terminal-key` header'ı kullanılır
- `middleware/terminalAuth.js` ile doğrulanır
- **Süresiz** — event admin kapatana kadar açık
- Terminal işlemleri: badge lookup, check-in, email arama

### 3. Public Endpoint'ler (Auth yok)
- `/api/reactivation/verify/:token`, `/api/reactivation/activate`
- `/api/leads/auth`, `/api/leads/scan`, `/api/leads/list`
- Badge görüntüleme, public form submit

---

## Kritik Veri Akışları

### A. Zoho Webhook → Visitor
```
Zoho Form POST → /api/webhook/zoho/:org/:expo/:form
  → x-webhook-token doğrula → badge_id & qr_code üret
  → INSERT visitors (veya UPDATE if existing email — keep QR, resend email)
  → Email gönder (SendGrid via email_queue)
```

### B. Check-in (Terminal)
```
Terminal QR tarar → POST /api/terminal/checkin (x-terminal-key)
  → checkins INSERT + visitor_event_status UPSERT
```

### C. Import (Upsert Mantığı)
```
Excel upload → POST /api/visitors/import
  → Her satır: email+expo_id ile kontrol
  → Varsa: UPDATE (COALESCE ile boş alanları koru, QR KORU)
  → Yoksa: INSERT (yeni UUID qr_code)
```

### D. Manual Registration (Upsert)
```
QR Scanner manual form → POST /api/visitors/manual
  → Aynı upsert mantığı: varsa güncelle (QR koru), yoksa oluştur
```

### E. QR Scanner Email Arama
```
Scanner input'a email yazılırsa (@içeriyorsa):
  → Terminal modda: GET /api/terminal/visitor-by-email?email=X
  → Normal modda: GET /api/visitors/paginated?search=X&limit=1
  → Bulunan visitor'ın qr_code'u ile normal akış devam eder
```

### F. Badge Print
- QR scan / manual registration sonrası `window.open(badge.html?qr=X&terminal_key=Y, popup)`
- Scanner sayfası açık kalır (popup olarak açılır, redirect yok)
- Badge text: word-wrap aktif, auto-size (15/25 karakter threshold)

### G. Email Worker (İki Mod)
```
MODE 1 — Direct HTML: html_content + recipient_email varsa direkt gönder
MODE 2 — Visitor + Template: visitor_id + template_id → bilgi çek → template işle → gönder
```

### H. Reactivation Campaign
```
Admin: Excel veya kaynak expo seç → token üret → email_queue'ya ekle
Visitor: link tıklar → verify → activate → yeni expo'ya kayıt
Resend: POST /api/reactivation/resend-pending → pending olanlara farklı template ile tekrar gönder
```

### I. Exhibitor Lead Scanner
```
Exhibitor: leena.app/lead-scan.html açar
  → Kendi badge QR'ını okutarak giriş (visitor_type=exhibitor kontrolü)
  → Visitor QR'larını okutarak lead kaydeder
  → Firma bazlı: aynı company'deki tüm exhibitor'ların leadleri paylaşılır
  → CSV export + vCard kaydetme
  → QR URL formatı parse edilir (kamera URL döndürürse qr parametresi çıkarılır)
```

---

## API Endpoint Özeti

### Auth
- `POST /api/auth/login` — Giriş, JWT döner
- `POST /api/auth/register` — Kayıt

### Organizers
- `GET /api/organizers` — Organizer listesi
- `GET /api/organizers/:id` — Organizer detay

### Expos
- `GET /api/expos` — Expo listesi
- `GET /api/expos/:id` — Expo detay
- `GET /api/expos/slug/:slug` — Slug ile expo arama
- `POST /api/expos` — Yeni expo oluştur
- `PUT /api/expos/:id` — Expo güncelle
- `DELETE /api/expos/:id` — Expo sil
- `GET /api/expos/:id/stats` — Expo istatistikleri

### Visitors
- `GET /api/visitors/paginated` — Sayfalı listeleme (search, source, origin, visitor_type, date filtreleri)
- `GET /api/visitors/badge/:qr_code` — Badge görüntüleme
- `POST /api/visitors/public` — Public form submit (auth yok)
- `POST /api/visitors/manual` — Manuel kayıt (upsert)
- `POST /api/visitors/import` — Excel import (upsert: varsa güncelle+QR koru, yoksa oluştur)

### Forms
- `GET /api/forms` — Form listesi
- `GET /api/forms/expo/:expo_id` — Expo'ya ait formlar
- `GET /api/forms/:id` — Form detay
- `GET /api/forms/:id/submissions` — Form submission'ları
- `GET /api/forms/public/:id` — Public form görüntüleme (auth yok)
- `POST /api/forms` — Yeni form oluştur
- `PUT /api/forms/:id` — Form güncelle
- `PATCH /api/forms/:id/toggle` — Form aktif/pasif toggle
- `DELETE /api/forms/:id` — Form sil

### Terminal
- `GET /api/terminal/visitor-by-qr` — QR ile visitor arama
- `GET /api/terminal/visitor-by-email` — Email ile visitor arama (⚠️ camelCase response: qrCode)
- `POST /api/terminal/checkin` — Check-in (x-terminal-key auth)
- `POST /api/terminal/badge-print` — Badge print kaydı
- `GET /api/terminal/status` — Terminal durum kontrolü

### Terminals (CRUD)
- `GET /api/terminals` — Terminal listesi
- `POST /api/terminals` — Yeni terminal oluştur
- `PUT /api/terminals/:id` — Terminal güncelle
- `PATCH /api/terminals/:id/toggle` — Terminal aktif/pasif toggle
- `DELETE /api/terminals/:id` — Terminal sil

### Checkins
- `POST /api/checkins` — Check-in oluştur
- `GET /api/checkins` — Listeleme (pagination, filtreler, visitor detayları dahil)
- `GET /api/checkins/stats/summary` — Özet istatistikler (total, unique, today, by_hall, by_source)
- `GET /api/checkins/stats` — İstatistikler (alternatif)

### Checkin Reports
- `GET /api/checkins/reports` — Check-in rapor verileri (saatlik/günlük dağılım)

### Import Checkins
- `POST /api/import-checkins` — Checkin import
- `GET /api/import-checkins/stats` — Import istatistikleri

### Webhook
- `POST /api/webhook/zoho/:org/:expo/:form` — Zoho form webhook (existing visitor → update+resend)

### Email Templates
- `GET /api/email-templates` — Template listesi (`{success, templates}`)
- `GET /api/email-templates/templates` — Template listesi (alternatif format)
- `GET /api/email-templates/:id` — Template detay
- `POST /api/email-templates` — Yeni template oluştur
- `PUT /api/email-templates/:id` — Template güncelle
- `DELETE /api/email-templates/:id` — Template sil
- `POST /api/email-templates/defaults` — Varsayılan template'ler oluştur

### Email Send
- `POST /api/email-send/single` — Tekli email gönderimi
- `POST /api/email-send/bulk` — Toplu email gönderimi

### Email Segments
- `POST /api/email-segments/send` — Segment bazlı email gönderimi

### Email Inbound
- `POST /api/email/inbound` — Inbound email webhook (SendGrid parse)

### Reports
- `GET /api/reports/summary` — Özet rapor
- `GET /api/reports/export` — Rapor export
- `GET /api/reports/comparison` — Karşılaştırma raporu

### Reactivation
- `GET /api/reactivation/campaigns` — Kampanya listesi
- `GET /api/reactivation/campaign/:expoId` — Detay
- `POST /api/reactivation/create-from-excel` — Excel'den kampanya
- `POST /api/reactivation/create-from-expo` — Expo'dan kampanya
- `POST /api/reactivation/resend-pending` — Pending'lere yeni template ile tekrar gönder
- `GET /api/reactivation/verify/:token` — Token doğrula (PUBLIC)
- `POST /api/reactivation/activate` — Aktivasyon (PUBLIC)
- `GET /api/reactivation/stats/:expoId` — İstatistikler

### Leads (Exhibitor Lead Scanner)
- `POST /api/leads/auth` — Exhibitor QR ile giriş (PUBLIC, visitor_type=exhibitor kontrolü)
- `POST /api/leads/scan` — Visitor QR okutarak lead kaydet (duplicate kontrolü)
- `GET /api/leads/list` — Firma bazlı lead listesi (exhibitor_company + expo_id)

### Badge Templates
- `GET /api/badge-templates` — Listeleme
- `GET /api/badge-templates/:id` — Template detay
- `POST /api/badge-templates` — Yeni template oluştur
- `PUT /api/badge-templates/:id` — Template güncelle
- `DELETE /api/badge-templates/:id` — Template sil
- `GET /api/badge-templates/for-terminal/:terminalKey` — Terminal'e atanmış template

### Inline Endpoint'ler (index.js)
- `GET /api/templates` — Form-builder dropdown için email template listesi
- `GET /api/qr-image/:qrcode` — Dinamik QR kod resmi (PNG)
- `GET /health` — Health check

---

## Frontend State Yönetimi

| Key | Set Eden | Kullanan | Risk |
|-----|----------|----------|------|
| token | Login | Tüm admin sayfalar | Yoksa auth fail |
| selectedExpoId | Dashboard | Main Panel, Forms, Checkins, Reports | Yoksa redirect |
| organizer | Login | Webhook URL generator | Profil |
| terminalKey | URL param | QR Scanner | Yoksa terminal auth fail |
| leadScannerAuth | lead-scan.html | lead-scan.html | Exhibitor session |

---

## Bilinen Sorunlar ve Kısıtlar

1. **CORS:** `https://leena.app` ve `https://www.leena.app` ile sınırlı
2. **initial.sql senkron değil:** Production DB'de olan bazı tablolar initial.sql'de yok
3. **Sidebar tutarsızlığı:** Sadece bazı sayfalarda güncel (main-panel-v2, reports, reactivation-campaign). Diğerleri: terminals, checkins, email-templates, email-segments, form-list, import — eksik linkler olabilir
4. **leena.css merkezi stil dosyası:** CLAUDE.md'de referans verilmiş ama **aslında her sayfa kendi inline CSS'ini taşıyor.** Ortak stil dosyası kullanımı henüz tam uygulanmadı. Yeni sayfa yaparken mevcut sayfaların CSS pattern'ini takip et.
5. **QR kod içeriği:** Badge QR'ların içinde sadece UUID var (URL değil). Telefonla okutunca düz text görünür. lead-scan.html'de kamera scanner ile okunan QR'lar URL formatında gelebilir — parse logic mevcut.

---

## Geliştirme Kuralları

### Kod Yazarken
1. Her değişiklikten önce ilgili dosyayı `cat` ile oku — asla tahmin etme
2. Route eklerken `index.js`'e mount etmeyi unutma (try/catch pattern'i ile)
3. Email gönderimi her zaman `email_queue` üzerinden (direkt SendGrid çağrısı yapma)
4. QR kod her zaman `<img>` tag'i olarak email'lerde gönderilmeli, UUID string olarak DEĞİL
5. Import/manual registration'da upsert mantığı kullan (email+expo_id ile kontrol, QR koru)

### Frontend Yazarken
1. Tüm frontend dosyaları `public/` altında
2. `localStorage.getItem('token')` ve `localStorage.getItem('selectedExpoId')` kontrolü yapılmalı
3. Bazı sayfalarda `const token = localStorage.getItem('token')` var, bazılarında inline kullanılıyor — dosyayı kontrol et
4. API base URL: bazı sayfalarda `'/api'`, bazılarında `API_BASE_URL` — dosyaya göre değişir
5. Badge print: `window.open(url, '_blank', 'width=600,height=400')` — popup, redirect değil
6. Font: Inter (Google Fonts), İkonlar: Bootstrap Icons (bi-*)
7. Renkler: Her sayfada CSS variables tanımlı (--primary, --sidebar-bg, vb.)

### Test Ederken
1. Email testlerinde `email+tag@gmail.com` formatını kullan
2. Terminal endpoint'leri camelCase response döner (qrCode, lastName vs)
3. Paginated endpoint snake_case response döner (qr_code, last_name vs)
4. QR kodun resim olarak göründüğünü kontrol et

---

## Deploy

- **Platform:** Render.com
- **Web Service:** `node index.js` (auto-deploy on git push)
- **Background Worker:** `node email_worker.js` (Root: `backend/leena-v401-backend`)
- Deploy ~10-20 saniye restart süresi

---

## index.js Route Mount Sırası

```javascript
// Route loading (try/catch pattern) — index.js satır 87-105
1.  authRoutes            → app.use('/api/auth', authRoutes)
2.  organizerRoutes       → app.use('/api/organizers', organizerRoutes)
3.  expoRoutes            → app.use('/api/expos', expoRoutes)
4.  visitorRoutes         → app.use('/api/visitors', visitorRoutes)
5.  formRoutes            → app.use('/api/forms', formRoutes)
6.  checkinRoutes         → app.use('/api/checkins', checkinRoutes)
7.  emailTemplateRoutes   → app.use('/api/email-templates', emailTemplateRoutes)
8.  emailSendRoutes       → app.use('/api/email-send', emailSendRoutes)
9.  reportRoutes          → app.use('/api/reports', reportRoutes)
10. webhookRoutes         → app.use('/api/webhook', webhookRoutes)
11. terminalRoutes        → app.use('/api/terminals', terminalRoutes)
12. importCheckinsRoutes  → app.use('/api/import-checkins', importCheckinsRoutes)
13. checkinReportRoutes   → app.use('/api/checkins/reports', checkinReportRoutes)
14. terminalCheckinRoutes → app.use('/api/terminal', terminalCheckinRoutes)
15. emailSegmentRoutes    → app.use('/api/email-segments', emailSegmentRoutes)
16. emailInboundRoutes    → app.use('/api/email', emailInboundRoutes)
17. leadRoutes            → app.use('/api/leads', leadRoutes)
18. reactivationRoutes    → app.use('/api/reactivation', reactivationRoutes)
19. badgeTemplateRoutes   → app.use('/api/badge-templates', badgeTemplateRoutes)

// Inline route'lar (index.js satır 107-142):
// GET /api/templates       — form-builder dropdown (authMiddleware)
// GET /api/qr-image/:qrcode — dinamik QR PNG
// GET /health              — health check
```

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

### v4.0.2 (6 Şubat 2026)
- Import email QR fix (UUID → img tag)
- Reactivation Campaign modülü
- Email worker iki mod desteği
- Existing visitor re-registration email
- Webhook log formatı iyileştirmesi

### v4.0.1
- Temel EMS sistemi (expo, visitor, checkin, form, email, badge, terminal)
