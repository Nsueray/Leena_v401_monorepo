# CLAUDE.md — Leena EMS

> Bu dosya Claude Code'un her oturumda otomatik okuduğu proje hafızasıdır.
> Son güncelleme: 13 Mayıs 2026 | Versiyon: v4.0.3

---

## ELL Cross-System Rules
Before making architectural decisions, read: `docs/ELL_RULES.md`
If in doubt, mark with 🔶 ELL onayı gerek and ask the user to check with ELIZA chat.

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

2. **Tek Kişi Kaynağı (Single Source of Truth):** Sistemde tek bir kişi tablosu vardır (`visitors`). Visitor, Exhibitor, Conference, VIP, Press, Staff, Speaker — hepsi aynı tabloda, farkı `visitor_type` alanı belirler.

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

### Database Access

**Read-only (Claude Code, local development):**
- Connection: `process.env.RENDER_DATABASE_READONLY_URL`
- User: `claude_readonly`
- Permission: SELECT only — UPDATE/DELETE/INSERT/ALTER/DROP fail
- Use for: Analysis, hypothesis testing, COUNT/JOIN/EXPLAIN
- Located in: `backend/leena-v401-backend/.env`

**Read-write (Suer, Render Shell only):**
- Connection: `$DATABASE_INTERNAL_URL` from inside Render Shell
- User: `leena_v401_db_user`
- Permission: Full
- Use for: Migrations, cleanup, data fixes — executed by Suer manually

**Rule:** Claude Code uses ONLY read-only for analysis. If a task requires UPDATE/DELETE/INSERT/ALTER/TRUNCATE/CREATE/DROP, prepare the SQL and ask Suer to run it via Render Shell.

**IP Whitelist:** External access requires Suer's current IP in Render's PostgreSQL Inbound IP Rules. If connection fails with "SSL connection has been closed unexpectedly", the IP may have changed — Suer needs to update via Render Dashboard → leena_v401_db → PostgreSQL Inbound IP Rules.

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
├── migrations/
│   ├── 001_floorplan_tables.sql # Floor Plan Builder tables (expo_halls, expo_floorplan_versions, expo_stands, expo_stand_cells)
│   ├── 002_reactivation_form_id.sql # Adds form_id to reactivation_tokens for design inheritance
│   └── 003_exhibitors_table.sql # Exhibitor registry (expo_exhibitors) + expo_stands.exhibitor_id FK
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
│   ├── leads.js                # Exhibitor lead scanner API (public, QR auth)
│   ├── conferenceCertificates.js # Conference certificate system (scan, certify, email)
│   └── floorplan.js            # Floor Plan Builder CRUD (halls, versions, stands, cells)
├── middleware/
│   ├── authMiddleware.js       # JWT doğrulama (req.organizer_id atar)
│   ├── auth.js                 # Alternatif JWT middleware (req.user objesi atar — aşağıya bak)
│   └── terminalAuth.js         # Terminal key doğrulama (x-terminal-key header)
├── utils/
│   ├── db.js                   # PostgreSQL bağlantısı (pool)
│   ├── email.js                # processEmailTemplate helper
│   └── qrcode.js               # QR generation helpers
├── public/                     # TÜM frontend dosyaları burada
│   ├── login.html                  # Login sayfası (Gen 4 modern UI, login+register tabs)
│   ├── dashboard_new.html              # Expo seçim sayfası (login sonrası ilk durak)
│   ├── main-panel-v2.html          # Ana dashboard (expo seçildikten sonra)
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
│   ├── conference-sessions.html    # Conference topic tracking + targeted email
│   ├── email-history.html          # Email send history log (paginated, filtered)
│   ├── conference-scanner.html    # Hostess conference check-in scanner (mobile, terminal auth)
│   ├── certificate.html           # Public certificate view (print-to-PDF)
│   ├── floorplan-builder.html     # Floor Plan Builder (Konva.js canvas, ES modules)
│   ├── floorplan/                 # Floor Plan Builder JS modules (ES modules)
│   │   ├── api.js                 # API fetch wrapper
│   │   ├── state.js               # Central state + event emitter
│   │   ├── grid.js                # Konva grid rendering, zoom/pan, cell interaction
│   │   ├── stands.js              # Stand CRUD, detail panel, stats
│   │   └── toolbar.js             # Tool selection, hall/version dropdowns
│   └── assets/                     # Logo vb.
# ⚠️ public/ altında *.backup.html ve eski varyantlar (dashboard.html,
#    admin-dashboard.html, main-panel.html) mevcut, aktif olarak kullanılmıyor.
#    login_new.html sadece login.html'e redirect yapar (eski bookmark uyumu).
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
| import_logs | Import operation logs (per-import stats, errors, options) |
| conference_certificates | Conference attendance certificates (visitor_id, expo_id, topic, token) |
| expo_halls | Floor Plan: physical hall definitions (expo_id, grid dimensions) |
| expo_floorplan_versions | Floor Plan: plan versions per hall (draft/active/archived) |
| expo_stands | Floor Plan: stand units (cells-based geometry, commercial status) |
| expo_stand_cells | Floor Plan: individual grid cells per stand (1 row = 1m²) |
| expo_stand_assignments | Floor Plan: assignment history (Phase 2, not used in MVP) |
| expo_exhibitors | Exhibitor registry per expo (name, contact, email, sector, company_id nullable) |

### visitors Tablosu Önemli Kolonlar
- `id`, `name`, `last_name`, `email` (unique per expo), `phone`
- `company`, `country`, `job_title`
- `visitor_type` — visitor, exhibitor, conference, vip, press, staff, speaker (DEFAULT: visitor) — DB: free TEXT, no constraint
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

### conference_certificates Tablosu (v402+)
```sql
CREATE TABLE conference_certificates (
  id SERIAL PRIMARY KEY,
  visitor_id INTEGER NOT NULL REFERENCES visitors(id),
  expo_id INTEGER NOT NULL REFERENCES expos(id),
  organizer_id INTEGER NOT NULL,
  conference_topic TEXT NOT NULL,
  certificate_token VARCHAR(64) NOT NULL UNIQUE,
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(visitor_id, expo_id, conference_topic)
);
```
- One certificate per visitor per topic (UNIQUE constraint)
- `certificate_token` used for public certificate URL
- Written by `conferenceCertificates.js` on conference check-in

### forms.config JSONB Usage (v403)
The `config` column stores style configuration for form design customization:
```
config.style.headerBannerImage (base64 data URI or null)
config.style.headerBannerColor, headerGradientEnd, headerHeight
config.style.footerBannerImage, footerBannerColor, footerGradientEnd, footerHeight, footerText
config.style.primaryColor, backgroundColor, fontFamily, buttonText, borderRadius
```
Default fallback: when config is null, hardcoded CSS defaults apply (backward compatible).

### reactivation_tokens.form_id (v403)
- `ALTER TABLE reactivation_tokens ADD COLUMN form_id INTEGER REFERENCES forms(id)`
- Links reactivation campaigns to a form's design (colors, banners)
- NULL = default yellow theme preserved

### expo_exhibitors (v403)
```sql
CREATE TABLE expo_exhibitors (
  id SERIAL PRIMARY KEY,
  expo_id INTEGER NOT NULL REFERENCES expos(id) ON DELETE CASCADE,
  organizer_id INTEGER NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  country VARCHAR(100),
  sector VARCHAR(100),
  company_id INTEGER,  -- LiFFY FK (nullable, no constraint — ADR-014)
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
- Basic exhibitor registry per expo
- `expo_stands.exhibitor_id` FK links stands to exhibitors
- `company_id` nullable — will link to LiFFY companies when Phase 2 ready

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

### C. Import (Upsert + Email/QR Options + Custom Fields)
```
Excel upload → POST /api/visitors/import
  → Custom fields extraction: columns NOT in knownColumns → customFields JSONB
  → Per row: email+expo_id check
  → Existing: UPDATE (COALESCE, custom_fields merge) + optional email (resent/first_time) + optional QR regen
  → New: INSERT (new UUID qr_code) + optional email
  → Custom field placeholders (e.g. {{conference_topic}}) work in email templates via ...customFields spread
  → New params: existing_email_option (none|resent|first_time), existing_qr_option (keep|regenerate), existing_template_id
  → Defaults: email=none, qr=keep (backward compatible — no params = old behavior)
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

### K. Public Form → Visitor Kayıt (Upsert eklendi 24 Şubat 2026)
```
form-public.html → POST /api/visitors/public
  → Backend form_id üzerinden forms tablosundan visitor_type çekiyor (authoritative source)
  → visitor_type ve form_id INSERT'e dahil ediliyor
  → Frontend'den gelen visitor_type'a GÜVENİLMEZ
  → UPSERT: email+expo_id ile mevcut visitor kontrolü (lower(email) + expo_id)
    → Varsa: COALESCE UPDATE (boş alanlar korunur, QR korunur) + email resend "(Resent)"
    → Yoksa: INSERT yeni QR + email gönder
  → Exhibitor formu ile gelen kişi artık visitor_type='exhibitor' olarak kaydediliyor
  → Email template placeholders: custom_fields (e.g. conference_topic) spread into emailData
    → {{conference_topic}}, {{any_custom_field}} etc. work in email templates
```

### J. Email Gönderim Mimarisi

**Queue Kullanan (Doğru):**
- Reactivation campaign emailleri → email_queue → email_worker (Direct HTML modu)

**Queue Bypass Eden (Riskli — Senkron SendGrid):**
- `webhook.js:232` — Zoho form submit → direkt sgMail.send()
- `visitors.js:214` — Public form submit → direkt sgMail.send()
- `visitors.js:505` — Excel import (satır başı) → direkt sgMail.send()
- `emailSend.js:76,178` — Single + bulk send → direkt sgMail.send()
- `emailSegments.js:159` — Segment send (300ms delay) → direkt sgMail.send()

**Etkisi:**
- Büyük import'larda (500+ satır) timeout riski
- SendGrid rate limit'e takılınca email sessizce kaybolur
- Fuar sırasında yaşanan "email gitmiyor" sorununun muhtemel kaynağı

### L. Expo-Based Resource Grouping (23 Şubat 2026)

Email templates, forms, and terminals now support expo-based grouping with cross-expo clone:

| Resource | expo_id Column | Clone Endpoint | Frontend Grouping |
|----------|---------------|----------------|-------------------|
| Email Templates | `email_templates.expo_id` (ALTER ile eklendi) | `POST /api/email-templates/clone/:id` | email-templates.html: current expo cards + other compact list |
| Forms | `forms.expo_id` (zaten vardı) | `POST /api/forms/clone/:id` | form-list.html: current expo cards + other compact list |
| Terminals | `terminals.expo_id` (zaten vardı) | `POST /api/terminals/clone/:id` | terminals.html: current expo table + other compact list |

- Clone always creates with `is_active: false` (safety — admin must manually activate)
- Terminals clone generates a new `terminal_key` (UUID v4)
- Frontend pattern: current expo resources shown as full cards/table, other expo resources as compact single-row list with clone + edit buttons
- Statistics (form-list.html) calculated from current expo forms only

### M. Conference Certificate System (1 Mart 2026, refined 1-3 Mart 2026)

```
Hostess opens conference-scanner.html?terminal_key=X
  → Selects conference topic from dropdown
  → Scans visitor QR code
  → POST /api/conference-certificates/checkin-and-certify
    → Validates registration via isVisitorRegisteredForTopic()
    → If NOT registered and NOT force → returns warning (no action)
    → If force → adds topic to visitor via addTopicToVisitor()
    → Creates checkin record (source='conference-cert')
    → Creates conference_certificates record (UNIQUE per visitor+expo+topic)
    → Queues certificate email via email_queue Mode 1 (pre-processed HTML)
  → Duplicate scan → persistent overlay with "Resend Certificate" button
    → POST /api/conference-certificates/resend (uses existing token, no new cert)
  → Visitor receives email with link to certificate.html?token=X
  → Visitor views/prints certificate (Save as PDF via browser)
```

- Terminal auth (x-terminal-key) — no JWT needed for hostess
- Duplicate prevention: ON CONFLICT (visitor_id, expo_id, conference_topic) DO NOTHING
- Certificate token: crypto.randomBytes(32) hex — used for public URL
- Check-ins appear in existing reports (standard checkins table)

#### conference_topic Separator & Multi-Topic Logic

**Separator: `" || "` (double pipe with spaces).** Commas are NOT separators — topic names themselves contain commas (e.g. "Engineering for a Healthy Buildings, Designing for Life").

**`splitTopics(raw)`** — Helper in conferenceCertificates.js. Splits ONLY by `" || "`. Returns array of trimmed topic strings. Used by isVisitorRegisteredForTopic(), /topics endpoint, addTopicToVisitor().

**`isVisitorRegisteredForTopic(customFields, selectedTopic)`** — Case-insensitive check. Splits both visitor's topics and selected topic by `" || "`, returns true if ANY match found.

**`addTopicToVisitor(client, visitorId, customFields, newTopic)`** — Appends topic with `" || "` separator. Duplicate-safe (case-insensitive check before append). Uses `jsonb_build_object` to update custom_fields.

**Multi-topic append on re-registration:**
- Webhook (webhook.js): reads existing `conference_topic` from DB, appends new with `" || "` if not duplicate
- Public form (visitors.js /public): same merge logic
- Import (visitors.js /import): uses `COALESCE || jsonb` merge (preserves existing custom_fields)
- All three: if topic already exists → keeps existing value unchanged

**Topic unnesting in endpoints:**
- `GET /api/visitors/conference-topics` — splits `" || "` to count individual topics
- `GET /api/conference-certificates/topics` — same unnesting with certificate counts
- `GET /api/visitors/paginated` — `ILIKE %topic%` filter (supports multi-topic values)
- `GET /api/visitors/export` — same ILIKE filter

**Example flow:**
```
1. Visitor registers for "Session A" → DB: "Session A"
2. Same visitor registers for "Session B" → DB: "Session A || Session B"
3. Same visitor registers for "Session A" again → DB unchanged (duplicate prevention)
4. Scanner checks "Session A" → isRegistered = true ✅
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
- `GET /api/visitors/paginated` — Sayfalı listeleme (search, source, origin, visitor_type, conference_topic, date filtreleri + conference_topic computed column)
- `GET /api/visitors/export` — Excel export of ALL filtered visitors (.xlsx download, same filters as /paginated but no pagination)
- `GET /api/visitors/conference-topics` — Conference topic counts with check-in data ({topic, registered_count, checked_in_count})
- `GET /api/visitors/badge/:qr_code` — Badge görüntüleme
- `POST /api/visitors/public` — Public form submit (auth yok)
- `POST /api/visitors/manual` — Manuel kayıt (upsert)
- `POST /api/visitors/import` — Excel import (upsert: varsa güncelle+QR koru, yoksa oluştur)
- `GET /api/visitors/import-logs` — Import history logs (paginated, ?page=1&limit=20&expo_id=)
- `PUT /api/visitors/:id` — Visitor edit (name, email, company, job_title, phone, country, visitor_type, booth_number, conference_topic — qr_code/badge_id protected, auth required)
- `GET /api/visitors/sources` — Distinct source values for filter dropdown (auth required)
- `POST /api/visitors/bulk-email` — Bulk email send to filtered visitors (Mode 2 queue, transaction, 10K limit, auth required)
- `GET /api/visitors/:id/emails` — Visitor email history (email_queue + email_logs, auth required)

### Forms
- `GET /api/forms` — Form listesi
- `GET /api/forms/expo/:expo_id` — Expo'ya ait formlar
- `GET /api/forms/:id` — Form detay
- `GET /api/forms/:id/submissions` — Form submission'ları
- `GET /api/forms/public/:id` — Public form görüntüleme (auth yok)
- `POST /api/forms` — Yeni form oluştur
- `PUT /api/forms/:id` — Form güncelle
- `PATCH /api/forms/:id/toggle` — Form aktif/pasif toggle
- `POST /api/forms/clone/:id` — Form klonla (cross-expo clone)
- `DELETE /api/forms/:id` — Form sil
- `POST /api/forms/upload-banner` — Banner image upload (base64, max 500KB, authMiddleware)

### Terminal
- `GET /api/terminal/visitor-by-qr` — QR ile visitor arama
- `GET /api/terminal/visitor-by-email` — Email ile visitor arama (⚠️ camelCase response: qrCode)
- `POST /api/terminal/checkin` — Check-in (x-terminal-key auth)
- `POST /api/terminal/badge-print` — Badge print kaydı
- `GET /api/terminal/status` — Terminal durum kontrolü

### Terminals (CRUD)
- `GET /api/terminals` — Terminal listesi (expo_id required)
- `GET /api/terminals/all` — Tüm terminaller (expo_name dahil)
- `POST /api/terminals` — Yeni terminal oluştur
- `POST /api/terminals/clone/:id` — Terminal klonla (cross-expo clone, yeni terminal_key)
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
- `POST /api/email-templates/clone/:id` — Clone template (cross-expo clone)
- `POST /api/email-templates/defaults` — Create default templates

### Email Send
- `POST /api/email-send/single` — Tekli email gönderimi
- `POST /api/email-send/bulk` — Toplu email gönderimi
- `GET /api/email-send/history` — Email send history (paginated, filtered by expo_id, template_id, status, email search)

### Email Segments
- `POST /api/email-segments/send` — Segment bazlı email gönderimi

### Email Inbound
- `POST /api/email/inbound` — Inbound email webhook (SendGrid parse)

### Reports
- `GET /api/reports/summary` — Özet rapor (visitor_type_breakdown, job_title_breakdown, daily_checkin_trend, checkin_by_hall, checkin_by_terminal dahil)
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

### Conference Certificates
- `POST /api/conference-certificates/checkin-and-certify` — Conference check-in + certificate email (terminalAuth). Validates registration via `isVisitorRegisteredForTopic()`. Supports `force: true` to add topic + issue cert for unregistered visitors.
- `POST /api/conference-certificates/resend` — Resend existing certificate email (terminalAuth). Uses existing `certificate_token`, no new cert created. Subject gets "(Resent)" suffix.
- `GET /api/conference-certificates/verify/:token` — Public certificate data (no auth, token-based)
- `GET /api/conference-certificates/topics` — Conference topics for hostess dropdown (terminalAuth). Unnests `" || "`-separated multi-topic values.
- `GET /api/conference-certificates/stats` — Certificate stats per topic (JWT auth)

### Floor Plan Builder
- `GET /api/floorplan/halls?expo_id=X` — Hall list for expo (JWT)
- `POST /api/floorplan/halls` — Create hall (JWT)
- `PUT /api/floorplan/halls/:id` — Update hall (JWT)
- `GET /api/floorplan/halls/:hallId/versions` — Version list for hall (JWT)
- `POST /api/floorplan/halls/:hallId/versions` — Create new draft version (JWT)
- `GET /api/floorplan/versions/:versionId/stands` — All stands + cells for version (JWT)
- `POST /api/floorplan/versions/:versionId/stands` — Create stand with cells (JWT, transaction)
- `PUT /api/floorplan/stands/:id` — Update stand (structural=draft only, commercial=active OK)
- `PUT /api/floorplan/stands/:id/status` — Change commercial status (allowed on active)
- `PUT /api/floorplan/stands/:id/move` — Move stand cells (draft-only, transaction)
- `POST /api/floorplan/stands/:id/split` — Split stand into 2+ stands (draft-only, transaction)
- `POST /api/floorplan/stands/merge` — Merge 2+ stands into one (draft-only, transaction)
- `DELETE /api/floorplan/stands/:id` — Delete stand (JWT, draft-only)
- `POST /api/floorplan/versions/:id/activate` — Activate version (draft→active, archives current)
- `POST /api/floorplan/versions/:id/clone` — Clone version (deep copy stands+cells)
- `PUT /api/floorplan/versions/:id` — Update version label/notes

### Inline Endpoint'ler (index.js)
- `GET /api/templates` — Form-builder dropdown için email template listesi
- `GET /api/qr-image/:qrcode` — Dinamik QR kod resmi (PNG)
- `GET /health` — Health check

---

## Frontend State Yönetimi

| Key | Set Eden | Kullanan | Risk |
|-----|----------|----------|------|
| token | login.html | Tüm admin sayfalar | Yoksa → login.html |
| selectedExpoId | dashboard_new.html (expo select) | main-panel-v2 + tüm admin sayfalar | Yoksa → dashboard_new.html |
| selectedExpoName | dashboard_new.html (expo select) | All 14 admin sidebar expo indicators | Display only |
| organizerId | login.html | Zoho webhook URL generation | Yoksa webhook URL bozulur |
| organizer | login.html | Profil display | JSON object |
| terminalKey | URL param | QR Scanner | Yoksa terminal auth fail |
| leadScannerAuth | lead-scan.html | lead-scan.html | Exhibitor session |

---

## Bilinen Buglar ve Güvenlik Sorunları

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

### KRİTİK
(All Sprint 1 items fixed — see above)

### YÜKSEK

6. ~~**email_worker FOR UPDATE transaction'sız**~~ ✅ FIXED 24 Feb — `fetchNextTask()` now uses `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` transaction. Atomically updates `status = 'processing'` via `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`. Prevents duplicate email on concurrent workers.

7. ~~**BASE_BADGE_URL fallback yok**~~ ✅ FIXED 23-24 Feb — `emailSend.js` + `emailSegments.js` now use `process.env.BASE_BADGE_URL || 'https://leena.app'` (emailSegments had `http://localhost:3000` fallback, fixed 24 Feb)

8. **Race condition** — `leads.js:99-128`, ~~`visitors.js:248,389`~~ (visitors.js public route fixed 24 Feb, manual+import already had upsert)
   - Check-then-insert pattern, ON CONFLICT kullanılmıyor, eşzamanlı request'te duplicate oluşabilir

### ORTA

9. Hata yanıt formatı tutarsız (5 farklı format: `{error}`, `{success,message}`, `{success,error}`, `{success,error,code}`, `{error,details}`)
10. ~~Sidebar inconsistent~~ ✅ FIXED 23 Feb — All 15 admin pages standardized with unified 13-link sidebar
11. Frontend auth kontrol boşlukları: form-builder, checkin-import, expo-create'te auth check eksik/hatalı
12. ~~Login redirect tutarsız~~ ✅ FIXED 24 Feb — All admin pages redirect to login.html (no token) and dashboard_new.html (no expo). Login → dashboard_new.html → main-panel-v2.html flow restored.
13. ~~Template placeholder uyumsuz~~ ✅ FIXED 24 Feb — `{{date}}` and `{{expo_name}}` added to all 13 email flows (visitors.js import/public, webhook.js, email_worker.js mode2/3, reactivation.js 4 flows)
14. Leads endpoint'te server-side session yok — exhibitor_company bilen herkes lead yazabilir/okuyabilir

---

## Bilinen Sorunlar ve Kısıtlar

1. **CORS:** `https://leena.app` ve `https://www.leena.app` ile sınırlı
2. **initial.sql senkron değil:** Production DB'de olan bazı tablolar initial.sql'de yok
3. **Sidebar links:** ✅ All 15 admin pages standardized (23 Feb 2026). CSS `::before` accent bar also added to all pages.
4. **leena.css merkezi stil dosyası:** CLAUDE.md'de referans verilmiş ama **aslında her sayfa kendi inline CSS'ini taşıyor.** Ortak stil dosyası kullanımı henüz tam uygulanmadı. Yeni sayfa yaparken mevcut sayfaların CSS pattern'ini takip et.
5. **QR kod içeriği:** Badge QR'ların içinde sadece UUID var (URL değil). Telefonla okutunca düz text görünür. lead-scan.html'de kamera scanner ile okunan QR'lar URL formatında gelebilir — parse logic mevcut.
6. **CSS class naming:** Bootstrap CSS loaded on admin pages. Avoid generic class names (.toast, .modal, .alert) — use prefix (.app-toast, .leena-modal) to prevent Bootstrap override conflicts.
7. **PostgreSQL bigint serialization:** `COUNT(*)` returns bigint, pg driver serializes as string. Use `::int` cast in backend or `parseInt()` in frontend for numeric operations.

### Frontend Nesil Haritası
Sayfalar 5 farklı CSS neslinde yazılmış. Yeni geliştirmelerde Gen 3/4 pattern kullanılmalı.

| Nesil | Primary | Sidebar | Sidebar Width | Sayfalar |
|-------|---------|---------|---------------|----------|
| Gen 0 | #e53935 | Yok | - | ~~login.html~~ (replaced with Gen 4) |
| Gen 1 | #0066ff | leena.css (harici) | 240px | dashboard.html, checkin-import.html |
| Gen 2 | #4a6fa5 | Inline CSS + ::before | 256px | terminals, checkins, form-list, email-templates, email-segments, email-send, import, visitorlog-paginated |
| Gen 3 | #4a6fa5 | Inline CSS + ::before | 256px | reports, reactivation-campaign, badge-templates, checkin-reports, form-builder, conference-sessions |
| Gen 4 | #4a6fa5 | Inline CSS + ::before + responsive | 260px | login.html, main-panel-v2, dashboard_new |

### Sidebar Status (Updated 20 Apr 2026)
- ✅ All 20 admin pages sidebar links standardized
- Standard order: Overview → Management → Communication → Settings → Tools
- 16 links: Dashboard, Visitors, Forms, Check-ins, Terminals, **Conferences**, **Floor Plan**, Email Templates, Send Emails, Email Segments, Badge Templates, Re-activation, Check-in Reports, Reports, Import
- ✅ CSS `::before` accent bar added to all 15 pages (Gen 2 pages updated 23 Feb 2026)
- ✅ Active expo indicator added to all 14 admin sidebars (24 Feb 2026) — reads `selectedExpoName` from localStorage, hidden if no expo selected
- ✅ Expo indicator is now a clickable `<a>` link to `dashboard_new.html` (25 Feb 2026) — allows switching expo from any page. Small `⇄` icon on the right as visual hint.
- Mobile sidebar only works on main-panel-v2, other pages sidebar disappears below 768px

### Navigasyon Akışı (Updated 24 Feb 2026)

**Ana akış:**
```
login.html → dashboard_new.html (expo seç) → main-panel-v2.html (expo dashboard)
```

**Sayfa rolleri:**
- `login.html` — Login + Register (Gen 4 modern UI). Token varsa → dashboard_new.html'e auto-redirect
- `dashboard_new.html` — Expo seçim sayfası. selectedExpoId'yi temizler, expo listesi gösterir, seçince main-panel-v2'ye gider
- `main-panel-v2.html` — Ana expo dashboard. selectedExpoId zorunlu, yoksa → dashboard_new.html
- `login_new.html` — Sadece login.html'e redirect (eski bookmark uyumu)

**Redirect kuralları:**
- Token yoksa → `login.html` (tüm admin sayfalar)
- Expo seçili değilse → `dashboard_new.html` (tüm admin sayfalar)
- Logout → `login.html` (localStorage.clear)

**Diğer sayfalar:**
- Forms listesi: form-list.html (form-builder.html DEĞİL)
- Public sayfalar (auth yok): lead-scan.html, reactivate.html, form-public.html, badge.html

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

### Language Rule
- Leena EMS is a global SaaS platform. **Only English** must be used in UI text, log messages, error messages, placeholders, and all user-facing strings.
- Turkish or any other non-English text must never be written in the codebase.
- If existing Turkish text is found in the code, it must be translated to English.
- Code comments and commit messages should also be in English.

### Test Ederken
1. Email testlerinde `email+tag@gmail.com` formatını kullan
2. Terminal endpoint'leri camelCase response döner (qrCode, lastName vs)
3. Paginated endpoint snake_case response döner (qr_code, last_name vs)
4. QR kodun resim olarak göründüğünü kontrol et

### Skills Maintenance Rule

Leena uses 3 custom Claude Skills in `.claude/skills/`:
- `leena-backend` — Route patterns, auth, DB queries, email queue
- `leena-frontend` — Admin page template, sidebar, CSS, API call patterns
- `leena-db-schema` — All tables, FK map, naming conventions, known gaps

**When to update skills:**
- New route added or modified → update `leena-backend` route mount table in `references/route-patterns.md`
- New admin page added → update `leena-frontend` sidebar in `references/sidebar.md`
- New sidebar link added → update sidebar in `references/sidebar.md` AND `templates/admin-page-template.html`
- Schema changed (new table, column, index) → update `leena-db-schema/SKILL.md`
- New environment variable added → update env vars table in `leena-db-schema/SKILL.md`
- Always update "Last verified: vXXX" label in all affected skill files when deploying a new version

**Skills are NOT application code:**
- Files in `.claude/skills/` are documentation/pattern files for Claude, not runtime code
- They do not affect the running application
- They must reflect the CURRENT state of production code
- If a skill contradicts actual code, the actual code is the source of truth — fix the skill

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
20. conferenceCertRoutes  → app.use('/api/conference-certificates', conferenceCertRoutes)
21. floorplanRoutes       → app.use('/api/floorplan', floorplanRoutes)

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

### Shared Frontend Components (public/leena-*.js)

Two shared components reduce duplication across admin pages:

**leena-toast.js** — Notification component
- API: `window.showToast(message, type, duration)`
- Types: success, error, warning, info
- Auto-injects CSS once, container auto-create
- Bootstrap conflict-safe (.app-toast prefix)

**leena-fetch.js** — Authenticated fetch wrapper
- API: `window.leenaFetch(url, options)` — returns Promise<Response>
- Auto-attaches Authorization from localStorage token
- 401/403 → toast + auto-logout + redirect (1500ms delay)
- 15s timeout via AbortController
- All non-auth errors thrown to caller for contextual handling
- Caller catch pattern: `if (err.status === 401 || err.status === 403) return;`

Migration status: 3 pages (visitorlog, email-campaigns, dashboard_new). Remaining 16+ admin pages: post-fair backlog.

### Authentication

- **JWT lifetime:** 30 days (`routes/auth.js:54`, `{ expiresIn: '30d' }`)
- **Storage:** `localStorage.setItem('token', data.token)` in login.html
- **Middleware:** `authMiddleware.js` (JWT_SECRET required, no fallback)
- **Dead middleware:** `middleware/auth.js` exists but unused by any route (has `'your-secret-key'` fallback) — to be deleted in post-fair cleanup
- **Status codes:** 401 = token missing/malformed, 403 = token expired/invalid signature
- **Frontend handling:** leena-fetch.js catches both 401 and 403 as session expiry

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

Lessons learned (operational rules):
- **L1 — SendGrid sends to invalid-DNS test domains:** `@leena-test.local`-style fake-domain bulk inserts trigger MX lookup → deferred → 72h retry → hard bounce. Reputation risk. Mitigations: (a) plus-addressing on real mailbox (`suer+test1@elan-expo.com`); (b) pre-add fake domain to SendGrid suppression before bulk send; (c) SendGrid sandbox mode for simulation. *Candidate ELL_RULES.md cross-system rule — pending Suer decision.*
- **L2 — PostgreSQL string match apostrophe types:** `'` (ASCII U+0027) and `'` (typographic U+2019) are distinct codepoints. Form inputs often autocorrect to typographic. SQL hardcoded strings WILL NOT match — derive byte-exact value from DB via subquery (this sprint's 76-visitor split SQL relied on this).
- **L3 — Render Shell vs external DB access:** Render Shell uses `$DATABASE_INTERNAL_URL`. External access requires IP whitelist via Render Dashboard → leena_v401_db → Inbound IP Rules — update when Suer's IP changes.

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

### Conference Topic Architecture

**Current model (legacy):** Conference topics stored as free-text in `visitors.custom_fields->>'conference_topic'` (multi-topic via `" || "` separator) and `conference_certificates.conference_topic` column. Canonical source: `forms.fields` JSONB array for active conference form per expo.

**Known issue:** No canonical entity model. Renaming requires multi-table updates. Form changes don't propagate to existing visitors. Anti-pattern documented in ell-docs ADR-021.

**Cleanup tool (temporary):** `/api/conference-cleanup` endpoints allow bulk segment-aware rename of variants to canonical topic within an expo. Transaction-wrapped, conflict-detection (cert UNIQUE constraint), CHUNK_SIZE=100.

**Planned refactor (post-fair):** Conference Entity Migration — new tables `expo_conferences` (id, expo_id, name, day, order_no) and `visitor_conferences` (junction). See ADR-021.

### v4.0.2 (6 Şubat 2026)
- Import email QR fix (UUID → img tag)
- Reactivation Campaign modülü
- Email worker iki mod desteği
- Existing visitor re-registration email
- Webhook log formatı iyileştirmesi

### v4.0.1
- Temel EMS sistemi (expo, visitor, checkin, form, email, badge, terminal)
