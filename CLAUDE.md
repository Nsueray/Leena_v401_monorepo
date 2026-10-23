# CLAUDE.md — Leena EMS

> Bu dosya Claude Code'un her oturumda otomatik okuduğu proje hafızasıdır.
> Son güncelleme: 18 Mayıs 2026 | Versiyon: v4.0.5
> Arşiv: docs/CLAUDE_ARCHIVE.md
> (2026-10-21: versiyon geçmişi, oturum/deploy kayıtları ve tarihsel notlar oraya AYNEN
> taşındı; otomatik yüklenmez — orası tarih kaydıdır, güncel durum değil, YON-01.)

---

## ⚡ ELL FİNANS MODÜLÜ — ÖNCE BUNU OKU

Bu dosyanın geri kalanı **Leena EMS**'i anlatır (fuar/ziyaretçi/e-posta/
konferans) ve o taraf için geçerlidir. **ELL finans/komisyon modülü**
(contracts · payments · sales_agents · commission_payouts ·
payment_schedule_items · offices; migrations 012-028) BU DOSYADA
ANLATILMAZ — kaynakları aşağıdadır.

### Kanonik kaynaklar (finans işi için)
- `~/Projects/ell-docs/ELL_DURUM_DEFTERI_v2.md` — defter, kronolojik,
  tek gerçek kaynak
- `~/Projects/ell-docs/ELL_LOCKED_KARARLAR_OZET.md` — kütük, kural
  indeksi (GRUP-NN)
- Çelişkide **DEFTER kazanır**. Kütük yalnız indekstir.
- ⚠️ **KURAL 4 (:42) finans işi için GEÇERSİZ:** finans değişiklikleri
  CLAUDE.md'ye değil **deftere** işlenir. EMS tarafı için KURAL 4 aynen geçerli.

### Davranış kuralları (istisnasız)
- **VARSAYIM YASAK.** Bu turda ölçmediğin hiçbir şeyi iddia etme.
- **YON-01:** tarihsel kayıt ≠ güncel durum. Defterden okunan bugün
  geçerli sanılmaz.
- **BULAMADIM:** bulunamayan yazılır, çıkarım yapılmaz. Her iddia
  `file:line` veya komut çıktısıyla gelir.
- **Repo/git beyanı:** her beyan AYNI yanıtta `git status --short` +
  `git log --oneline -3` + `git status --branch` çıktısıyla gelir.
- "Talimat verildi" ≠ "talimat uygulandı."

### Sabit sınırlar
- Migration **YAZILIR, ÇALIŞTIRILMAZ** — Suer koşar.
- **PUSH YOK** — Suer atar. Commit serbest.
- Canlı LEENA DB'ye **YAZILMAZ**.
- **TABAN: contract 4 sr earned = 342.00 EUR.** Her turda korunur.
- UI/UX bilinçle iskelet — cila yok, tasarım fazı en sonda.
- **eliza-legacy EMEKLİ (AD-01). ELIZA = ürünün adı.** (`ell-docs/eliza/CLAUDE.md` onu canlı sanıyor —
  o dosya bayat, referans alınmaz.)

### Test
- `npm run test:setup && npm test` (backend/leena-v401-backend) —
  beklenen **418/418** (2026-10-23 Paket UI-0b ölçümü; UI-0: 416; Paket 2: 379; Paket 1b: 316; Paket 1: 269; eski "67/67" bayattı — o tek suite'in sayısıydı).
- Testler `tests/` altında yaşar. Test mantığı/assertion değiştirilmez;
  kapsam genişletme AYRI dilim işidir.

### Defter kaydı
- İşle **AYNI turda, aynı commit'te** yazılır. Ayrı tur açılmaz.
- Yerleşim: kronolojik-artan, son kayıttan sonra, `★ SIRADAKİ ADAYLAR`
  bloğundan önce. Format için son 3 kaydı örnek al.
- Zorunlu başlıklar: ne yapıldı · commit · ölçülenler ·
  `⚠️ ÖLÇÜLMEDİ / GÖZLENEMEDİ` · bilinçle yapılmayanlar.

### Çalışma kuralları (Suer, 2026-09-13)
- **K1 — TEK İŞ.** Suer'e aynı anda tek görev verilir. Bitirip onay
  alınmadan sonraki görev verilmez.
- **K2 — ÇOK AŞAMALI İŞ AYRI TURDA.** Üç iş varsa ve biri çok aşamalıysa,
  tek aşamalılar önce, çok aşamalı ayrı turda. Adımlar karışmasın, hata
  olursa kaynak belli olsun.
- **K3 — SUER YAZMAZ, YAPIŞTIRIR.** Yazma/uygulama işi CC'ye veya ilgili
  chat'e gider. Suer'e yalnız kopyala-yapıştır blok ve terminal komutu
  gelir. "Şunu şöyle düzenle" denmez.
- **K4 — SIR DEĞERİ EKRANA BASILMAZ; MASKELİ OKUMA ZORUNLU** (Sentez 23 Eki): env / `.env` / bağlantı dizesi / ayar dosyası okuyan HER komut değer yerine yalnız ad + uzunluk + ilk 2 karakter basar (sır içeren satırı tool çağrısına da yazma; regex'le değiştir); üçüncü ihlal = dur.

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

**Quick reference (memorize this — the two commands, no exceptions):**
- Render Shell (Suer, writes): `psql "$DATABASE_INTERNAL_URL"`
- Claude Code (read-only):     `psql "$RENDER_DATABASE_READONLY_URL"`  — WARP off, IP allowlisted

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
│   ├── expo-create.html            # Expo oluşturma (gelen link yalnız dashboard.html; description + logo_url yalnız burada)
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
# ⚠️ 2026-10-23 (UI-0b, Sentez envanter hükmü): 11 ölü sayfa SİLİNDİ — admin-dashboard.html,
#    login_new.html, register.html, email_templates/modern-default.html ve 7 *.backup.html.
#    Eski varyantlar dashboard.html + main-panel.html KALDI: hiçbir HTML'in yüklemediği
#    public/js/common.js hâlâ onlara link veriyor (silme kuralı: ad araması 0 olmalı).
#    Kayıt: docs/audits/SAYFA_ENVANTERI_2026-10-23.md + ell-docs defteri.
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

> ↪ `### ✅ FIXED (23 Feb 2026)` … `### ✅ FIXED (1 Mar 2026 — Conference Certificate Fixes)`
> (4 tarihli düzeltme kaydı) → docs/CLAUDE_ARCHIVE.md. Açık maddeler aşağıda.

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
- `main-panel-v2.html` — Ana expo dashboard. selectedExpoId zorunlu, yoksa → dashboard_new.html.
  Sidebar Finance bölümünün son satırı "ELIZA Finance (new)" → `/ui2/` (2026-10-23, UI-0b KAPI-1; YALNIZ bu
  sayfada — diğer sidebar'lara eklenmedi). Eski arayüzden ui2'ye tek kod içi link.
- ~~`login_new.html`~~ — 2026-10-23 silindi (gelen link 0; eski yer imi artık 404)

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

## ⚠️ GOTCHAS & OPERATIONAL LEARNINGS

Traps hit in production. Each cost real time or nearly cost real damage — read before touching
the email, reactivation or deploy paths.

| # | Trap | Why it bites |
|---|---|---|
| G1 | **`??` vs `\|\|` on empty strings** | `??` falls through only on `null`/`undefined`, **not `''`**. A `?? req.body.title` appended to a chain that already yielded `''` fixes nothing. Use `\|\|` unless you specifically need `0`/`false` preserved. Verified: Zoho *omits* absent keys, so `??` did work for `phone` — but `\|\|` is correct under both hypotheses. |
| G2 | **psql heredoc without `COMMIT` silently rolls back** | A `BEGIN`-wrapped script that ends without `COMMIT` discards everything and exits 0. Always end with an explicit `COMMIT;` and re-verify with a SELECT **after** it. |
| G3 | **Render restarts are NOT zero-downtime** | Measured **10-50 s of HTTP 502** on web-service deploys (10 s, 20 s, and 50 s on three separate deploys the same day). Any inbound webhook landing in that window fails. Deploy at low traffic. *(The email worker is a separate service — web deploys don't touch it.)* |
| G4 | **WARP / VPN changes egress IP and breaks the DB allowlist** | The read-only Postgres connection dies with `Connection terminated unexpectedly` or `timeout expired` — looks like a DB outage, is actually the Render inbound-IP rule. Fix: Render → leena_v401_db → PostgreSQL Inbound IP Rules. Happened 3× in one day. |
| G5 | **VARCHAR overflow rolls back the WHOLE chunk** | `processReactivationChunks` inserts 1,000 rows per statement. **One** 303-char `company` against `VARCHAR(255)` killed all 1,000 — `failed_count=1000`, `error_message=null` (per-chunk errors are console-only). Truncate to column limits before bulk insert. |
| G6 | **Campaign `sent` event = ENQUEUE, not delivery** | `email_events` `sent` is written in `enqueueStepEmail` (`email_worker.js:537-539`) at enqueue time. A campaign can show 26,262 `sent` events while only 6,765 have reached SendGrid. **Always compute open/click rates against `email_queue.status='sent'`**, never against the event count. |
| G7 | **`{{unsubscribe_url}}` is unfillable in campaign mode** | The campaign data build (`email_worker.js:520-528`) has no such key, and `injectUnsubscribeLink` (`trackingPixel.js:41-51`) **appends its own footer** rather than replacing the placeholder. It renders `href=""`. A working footer + RFC 8058 headers still ship, so compliance holds — but the visible dead link invites spam complaints. **Platform gap → future work.** |
| G8 | **Scheduler enqueue rate ≠ worker delivery rate** | Two independent limits. `CAMPAIGN_SCHEDULER_BATCH_LIMIT` controls how fast rows enter `email_queue`; `EMAIL_WORKER_BATCH_SIZE` × `PROCESS_INTERVAL` controls how fast they leave. C16 enqueued 14,941 in **4 m 37 s** but took **9 h** to deliver. Step delays are measured from **enqueue**, so a slow worker can make step 2 fire before step 1 is delivered. |
| G9 | **LEENA has ZERO bounce visibility** | No `failed` status ever appears in `email_queue` or `email_logs`; `email_events` has no bounce/dropped/spamreport type. There is no SendGrid bounce webhook. **The SendGrid dashboard is the only source of bounce/complaint data.** "sent" means SendGrid *accepted* the API call — nothing more. |
| G10 | **Step delays run from the previous step's enqueue, not from activation** | Activating an hour earlier than planned shifts every downstream step by that hour. Compute offsets from the *actual* activation time, or accept the drift. Observed: 53-60 min early activation → step 2 landing ~1 h before target. |
| G11 | **`prefetchEmails` uses `LOWER()` without `TRIM()`** | `routes/reactivation.js` builds its dedup Sets with `LOWER(email)` while the filter loop compares `.toLowerCase().trim()`. A stored address with surrounding whitespace evades the "already exists" check. Currently harmless — **0 untrimmed emails in production** — but any import that introduces padding breaks dedup. |
| G13 | **`email_queue` sent rows are PURGED on campaign completion** | `checkCampaignCompletion` (`email_worker.js:632-645`) deletes a campaign's `status='sent'` rows older than 1 h once it completes, to stop bloat (each row carries a full rendered `html_content`). **Never build a durable metric on `email_queue` for a completed campaign.** Campaign 15 retained 4 rows against 5 unique opens — a 125% open rate. Use `email_campaigns.delivered_count` (migration 029), snapshotted in the same transaction as the purge. |
| G14 | **Campaign `sent` event and `total_sent` are ENQUEUE-time counters** | Both are written in `enqueueStepEmail` (`email_worker.js:537-539`) when the row enters `email_queue`, not when SendGrid accepts it. Campaign 17 showed **26,262 sent against 6,765 delivered** — a 4× overstatement mid-drain. Delivery truth = `email_queue.status='sent'` while **active**, `delivered_count` once **completed**. Never compute open/click rates against the event count. |
| G15 | **`POST /api/terminals/clone/:id` drops `kind` AND `allow_manual_registration`** | The clone INSERT (`routes/terminals.js:70-80`) omits both columns, so each falls to its DB default (`'scanner'`, `true`). **Cloning a `bulk_print` terminal yields a `scanner`**, which `middleware/dualAuth.js` then rejects with `403 WRONG_TERMINAL_KIND`. Clone also forces `is_active=false` and copies `hall`/`terminal_no` verbatim — that verbatim copy is how you tell a clone from a fresh create. |
| G16 | **`trim()` in an email predicate silently drops the index** | `idx_reactivation_tokens_email_target (email, target_expo_id)` and `idx_visitors_unique_email_per_expo (organizer_id, expo_id, lower(email))` are only usable when the predicate matches their expression. Wrapping the column in `trim()` forces a scan: measured **0.09 ms → 21 ms** on `reactivation_tokens`, a 230× regression, for an identical result set. Production holds **0 untrimmed emails** in `visitors`/`reactivation_tokens` and `campaign_recipients.email` is normalised on upload, so `lower(col) = lower($1)` is both correct and fast. Related: G11. |
| G17 | **Campaign templates are referenced LIVE, never copied** | `enqueueStepEmail` fetches `email_templates` by `step.template_id` at send time (`email_worker.js:503-508`). Editing a template changes what an **already-active** campaign will send on its next step. Powerful — the 14:12 greeting fix reached campaigns 16/17 without touching them — and dangerous: any template edit while a campaign is active **requires a re-audit and a re-render check** before the next step fires. **Note (10 Sep):** the new `{{badge_link}}` variable (commit `696568a`) resolves ONLY on three render paths: worker Mode 2 (`email_worker.js:225-231, :249`), `routes/visitors.js` public-form (`:375, :387`), and `routes/visitors.js` import existing-visitor email (`:864, :872`). `routes/emailSend.js` (Send Emails admin panel) does NOT set it — sending a `{{badge_link}}`-bearing template from that panel renders `href=""` (dead link). Post-fair follow-up on todo.md item 27. |
| G18 | **No index on `email_queue.campaign_recipient_id`** | The FK `email_queue_campaign_recipient_id_fkey` has no supporting index, so deleting one `campaign_recipients` row forces a scan of the **361,000-row** `email_queue`. `DELETE /api/campaigns/:id/recipients` **500s** on any real list (14,308 rows timed out); deleting 79 rows individually took 30 s. Delete in small batches until an index exists. Post-fair fix. |
| G19 | **Single-step campaigns are forced to `condition='all'`** | `POST /:id/steps` hard-codes step 1 to `delay=0, condition='all'`, and `POST /:id/activate` re-validates it. A one-step campaign therefore **cannot filter at send time** — its recipient list is frozen at build. On a pool moving at ~740 registrations/day, expect tens of stale recipients per day of delay. Rebuild the list immediately before activating. |
| G20 | **`Dear {{chain}}` produces a double greeting** | The chain's own literal is `"Dear Visitor"`, so `Dear {{first_name\|last_name\|company\|"Dear Visitor"}},` renders **`Dear Dear Visitor,`** when every name field is empty. Templates #61/#62 carry this pattern; it cannot trigger on the current pools (100% have `first_name`) but must be fixed before those templates are reused on a list with incomplete names. Write the chain bare — it supplies its own salutation. |
| G21 | **Excel agency exports store phones as NUMBERS, and the import hard-fails on them** | A phone cell typed as a number arrives as a JS number, so `phone.trim()` throws and the row dies. **It is visually indistinguishable in Excel** — the cell displays identically to a text phone, and changing the *display format* does not change the stored type. The fix is cell-type coercion (`String(v).trim()`), not formatting. Hit **twice in two days on two different agency files**; manual surgery applied both times. Ask for a CSV, or coerce before trimming. |
| G22 | **Terminals-page "Copy URL" always emits the scanner page** | The button builds `qrscanner.html?terminalKey=…` for **every** terminal regardless of purpose. A conference lane needs **`conference-scanner.html?terminal_key=…`** — different page *and* different param spelling (`terminal_key`, not `terminalKey`; bulk print uses `key`). Copying the URL for a conference terminal therefore yields a working *check-in* desk that can never issue a certificate. This is exactly what happened on day 1: the conference lane ran ordinary check-ins for hours with **0 certificates**. Hand out purpose-specific URLs, never the Copy button, until the page is fixed. |
| G23 | **Campaign completion fires mid-drain, freezing `delivered_count` early** | `checkCampaignCompletion` fires when the last recipient's last step is **enqueued**, not when the queue drains — so the snapshot is always taken with the final step still in flight, and the same transaction purges the older sent rows so the live count can no longer recover the truth. **Not single-step-only**, as first assumed: C18 froze at **950 against a real 14,227**, and the multi-step C16/C17 froze at **~70%** (30,990 / 43,466 and 52,410 / 78,145). Readers prefer the non-null snapshot permanently, so completed campaigns under-report delivery by roughly a third and over-state every per-delivered rate. **Display-only** — sending is unaffected. |
| G24 | **NEVER pre-render bulk email HTML in a request path** | `email_queue` supports two modes: **Mode 1** stores the fully rendered `html_content` in the queue row; **Mode 2** stores just `visitor_id + template_id` and the worker renders per-message at drain time (`email_worker.js:162`). Mode 1 is fine for single/small sends (reactivation confirmation, badge email, single-recipient `/email-send/single`). **Anything targeting >1k recipients MUST use Mode 2** — otherwise the request path holds `N × template_bytes` in Node heap and pushes that same payload across the INSERT wire, which OOMs the Node process OR blows the Render HTTP window at ~N=8k with a ~10 KB template. Measured 28 Aug 2026: segments `/send` on 3,065 recipients (33 MB) survived; on 7,860 (82 MB) died with zero rows written and a browser "Network error." **Rule for any future bulk-send endpoint: the request path must be constant-size in recipient count.** See v4.0.11 for the incident, `SEGMENT_FORENSICS_20260828.md` for the reconstruction. |
| G25 | **"Network error" toast in our frontends ≠ HTTP failure — it means the response never completed** | The catch clause that renders `"Network error"` (e.g. `email-segments.html:290`, `email-segments.html:335`) fires **only** when `fetch()` itself throws (connection reset, DNS, browser network layer) OR `res.json()` throws (non-JSON body — typically a Render 502 HTML page). A backend 500 with a JSON body goes through `if (!res.ok)` and renders `data.message` — a **different** toast string. **Diagnostic shortcut:** if the user reports "Network error" specifically, the response never made it back with a valid HTTP body — suspect OOM/proxy kill/Render restart/upstream cut, NOT an application-level 4xx/5xx. This distinction was the load-bearing piece of evidence in the segment-failure reconstruction. |
| G26 | **Diagnosis without app logs costs hours** | The M1-M4 segment failure took ~2 h to reconstruct because I could not read the Render web-service application logs from my access surface — every hypothesis had to be tested through DB-side evidence and code inspection. A 5-minute `grep` on the `[emailSegments/send] Error:` line would have collapsed the whole exercise. **P1 infra follow-up:** either wire Render log-shipping to somewhere Claude Code can read, OR add a `LOG_LEVEL=debug` env var that surfaces `console.log('POST /api/…', body)` at each POST handler entry + `console.log('resp', status)` at each exit, OR add a lightweight `logs/access.log` file on the Render disk that DB-side queries can join against. Any of the three closes the gap. |
| G27 | **Smoke test run order on trash expo 17: reactivation FIRST, then import.** The import creates visitors on expo 17; those visitors then make the reactivation smoke's rows skip as `already_registered` — assertion `valid === 5` fails. Reversed once on 2 Sep; caught by the diagnostic. Always run reactivation → import, and cleanup between rounds if reruns are needed. |
| G28 | **A smoke test that reuses a file on disk MUST verify its shape first.** `tests/test_reactivation_phone_smoke.js` on 2 Sep read a leftover 3-row `/tmp/phone_smoke.xlsx` (from a prior 3-row era) and posted the stale shape via job 34 — server was correct, test was wrong. **Rule:** never `if (fs.existsSync(tmpPath))` on a shared temp file. Cheaper to rebuild every run than to reason about disk-cache freshness. |
| G29 | **A smoke test that reads the DB must load dotenv itself, path-relative to the file.** `test_import_phone_smoke.js` on 2 Sep silently skipped its stored-phone DB verification with `RENDER_DATABASE_READONLY_URL not set` because it did not `require('dotenv').config(...)`. Suer had to verify the 5 stored phones in psql by hand. **Rule:** `require('dotenv').config({ path: path.join(__dirname, '..', '.env') })` at the top of any test that opens a `Pool`. Do not rely on the caller's `cwd` or exported env — CI, cron, and IDE test-runners all invoke node from different dirs. |
| G30 | **`require('dotenv').config()` prints a banner to STDOUT** — `[dotenv@X.Y.Z] injecting env (N) from .env`. Pollutes `$(node -e '…console.log(x)…')` capture in shell pipelines: the caller receives banner + value on separate lines and reads the wrong one. **Rule:** in any script whose stdout is captured, use `require('dotenv').config({ quiet: true })`, or filter with `| tail -n 1`. Surfaced 3 Sep in the SIEMA env-audit shell scripts. |
| G31 | **MillionVerifier rejects openpyxl-written xlsx** with *"column with email addresses not found"* — its column sniff is picky about xlsx structure. **CSV works.** Additionally, **it misreads digit-leading emails as phones** (e.g. `1abc@example.com` gets classified as a phone number, not an email). **Rule:** always upload CSV to MillionVerifier; screen the source for `^\d.*@` addresses before upload if any exist. |
| G32 | **`psql \copy` needs a single-line query.** Multi-line SQL inside `\copy (…)` fails with parser errors. For multi-line SQL, use **`COPY (…) TO STDOUT > file.csv`** from the read-only URL on the Mac (WARP off). `\copy` is client-side and cannot straddle newlines; `COPY TO STDOUT` is server-side and takes any SQL. |
| G33 | **Token attributes (`form_id`, `phone`) are written at MINT — a wizard re-run reuses pending tokens and, before Phase 2b (`7e34f9e`), kept the OLD values.** Confirm-panel choices had no effect on repeat runs: reused tokens rendered the yellow default theme and empty phone even when a form + row-phone was supplied. **Language is per-URL, NOT per-token** — Phase 3 URL builder picks `reactivate.html` vs `reactivate-fr.html` based on `activation_lang` at build time, and the same token works for either page. Only `form_id` + `phone` live on the row. Phase 2b now UPDATEs both on reuse (always for `form_id`, empty-only for `phone` via COALESCE guard). |
| G34 | **Worker env vars live on the `leena-email-worker` service, NOT the web service.** `CAMPAIGN_SENDER_NAME` is read by `email_worker.js:256-265` — setting it on the `Leena_v401` web service has zero effect. There is no auto-provisioning; the variable must be **created by hand** in Render Dashboard → leena-email-worker → Environment. Setting on the wrong service is silent — mail ships with bare `noreply@leena.app` and no error surfaces. |
| G35 | **`email_campaigns` rows with `email_queue` children cannot be deleted** — the `email_queue.campaign_recipient_id → campaign_recipients(id)` FK is `ON DELETE RESTRICT`. Trying to `DELETE FROM email_campaigns WHERE id=N` on a campaign that has ever enqueued any row will 500 or the psql client will report `update or delete on table "campaign_recipients" violates foreign key constraint`. **To stop a test campaign, force `status='completed'`** — the scheduler stops picking it up on the next cycle and `email_queue` rows drain / purge naturally (per G13, 1 h post-completion). Surfaced 3 Sep during campaign 42 cleanup on expo 9. |
| G36 | **Pasting multi-line SQL into the Render bash prompt (not psql) fails silently with `command not found`.** The bash prompt reads the first line as a command and errors on subsequent lines. Nothing runs, no obvious signal — feels like the paste "worked". **Rule:** always start `psql "$DATABASE_INTERNAL_URL"` FIRST inside Render Shell, then paste SQL. Test the transition with a trivial `SELECT 1;` before any UPDATE/DELETE. Surfaced 3 Sep during preheader repair (initially pasted at bash prompt, no rows changed, took a re-check to realise). |
| G37 | **Step-1 condition has THREE independent gates — change all or none.** (1) Wizard `normaliseStep1` at `routes/campaignBuilder.js:869` clamps `activate_steps[0].condition` at build. (2) Worker `evaluateCondition` at `email_worker.js:479` — the early return `if (!prevStep) return true;` short-circuits ANY condition on step 1 (`recipient.current_step=0` → `prevStep = stepsMap[0] = undefined`). (3) Legacy `routes/campaigns.js` at `:383` (POST /:id/steps), `:444` (PUT), `:483` (DELETE renumber), `:891` (activate) — each independently forces `condition='all'` on `step_number=1`. Shipping the wizard change alone (`87c6c4c`) left gate (2) silently no-op'ing `not_registered` at send time AND gate (3.activate) 400-ing on Activate. Full fix required all three (`87c6c4c` + `3120810`). Rule: any future change to step-1 condition semantics must touch all three or none — grep `routes/campaigns.js routes/campaignBuilder.js email_worker.js` for `condition.*'all'\|step_number.*= 1\|current_step\|prevStep` before shipping. |
| G38 | **`emailSend.js` never sets `first_name` — Send Emails page renders `{{first_name\|...}}` chains as LAST name.** `emailData` at `routes/emailSend.js:91-100` (`/single`) and `:229-238` (`/bulk`) only carries `name` / `email` / `company` / `expo_name` / `qr_code` / `badge_url` / `date` plus `visitorCustomFields` spread. `first_name` is not populated — `visitors.custom_fields` uses `name` (not `first_name`) for the first name, mirroring the column. Chain `{{first_name\|last_name\|company\|"Madame, Monsieur"}}` finds `first_name` undefined → falls through to `last_name`. Yaprak sent a template-76 test 4 Sep and got *"Bonjour Güzelcik,"* — last name. **The campaign worker path is fine** (`email_worker.js:614-623` explicitly maps `campaign_recipients.first_name → data.first_name`). Test-path bug only. Smallest fix ~10 lines: extend the visitor SELECT + `emailData` build to map `visitors.name → first_name`, `visitors.last_name → last_name`. Queued as post-fair P2. |
| G39 | **The raw MillionVerifier CSV MUST NEVER go into the wizard directly.** MV's output CSV does not carry the `email` header the wizard reader looks for — the wizard's `/segment` reports 0 recipients / silent skip. Ops workflow: MV verifies → "Good" subset downloaded → column-mapped to the canonical wizard header set (`email, name, last_name, company, country, job_title, phone[, source]`) before upload. Related to G31 (MV rejects openpyxl xlsx). Never upload MV output raw; always transform first. |
| G40 | **The wizard's new-step default flipped `'all'` → `'not_registered'` on 4 Sep (commit `3120810`).** `public/reactivation-campaign.html:1883` `wAddStep()` now pushes `condition:'not_registered'` on every new step (matches the "every step `not_registered` for reactivation" drip guidance). Operator can still pick any other `VALID_CONDITIONS` value from the dropdown. The dead guard `if (arr[0].condition == null)` at `wRenderSteps` `:1919` was removed at the same time — the default lives at the push site instead. Anyone reading the wizard flow after 4 Sep should NOT expect step 1 to default to `'all'`; the whole recommendation is `'not_registered'` end-to-end. |
| G41 | **`form-public.html` success/error strings are language-aware since 5 Sep (commit `4d0263d`).** Resolution order per string: `config.style.<key>` override → language default (from `config.language: 'en'|'fr'`, default `'en'`) → today's English fallback (byte-identical to the strings that were hardcoded before). Editable keys in `config.style`: `successTitle`, `successHeading`, `successQrInstruction`, `successMessage`, `successButtonLabel` (5 total, editable in form-builder Design tab's "Thank-you page" collapsible section). NOT editable but language-aware: the 3 error-card strings (`errorTitle`/`errorHeading`/`errorButtonLabel` — `Oops!` / `Oups !` etc.) and the always-shown `receivedNote` (`Your registration has been received.` / `Votre inscription a bien été enregistrée.`). `<html lang>` is set from `config.language` via `applyFormStyle()`. **Rule:** forms with no `config.language` and no `config.style.success*` keys render byte-identical output — verified programmatically for forms 51 + 59 pre-deploy, verified live for form 51 post-deploy. **Contract:** template writers can rely on `<html lang>` reflecting `config.language`; ops can override any of the 5 keys per-form without a code change; error-card strings can only be reworded via `ERROR_DEFAULTS_{EN,FR}` at `form-public.html` module scope (no per-form override). Full doc: `docs/sessions/DEPLOY_THANKYOU_PAGE_20260905.md`. |
| G42 | **No deploys during campaign-send days except 22:00–07:00 Casablanca.** Rule set 7 Sep after the SIEMA launch. Three daytime deploys (12:22 / 12:47 / 13:58 IST) each hit the standard 22-45 s 502 window (G3) while campaigns 78+79 were mid-drain — one visitor reported *"the site is inaccessible"* mid-click on their activation link. Click rate is a one-shot per recipient: even a 20-second outage costs registrations we cannot recover. **Casablanca fair days: no code push except overnight (22:00–07:00) unless Suer explicitly authorises a hotfix.** Documentation-only pushes are always fine. Applies to any live-send day, not just SIEMA. |
| G43 | **Render Health Check Path = `/health` — cutover window 20-60 s, plan with 60 s.** Original measurement (7 Sep evening, `1f8692a+a9a44fd`) landed at **20 s**; broader sampling since then shows the window is variable and can stretch to a minute. **Measured Sep 8-9:** `194b646+97ffcac+fc79da6` 8 Sep = **42 s**; `6ccfdb3` 9 Sep AM = **50 s**; `8907612` 9 Sep midday = **41 s**; `4b69814` 9 Sep afternoon = **28 s**. Why the range: Render waits for `/health` to return 200 on the new container before switching traffic; the total window = module-load + first-DB-connect on the new process (variable) + upstream cut. The health check narrows the *lower* bound; it does not cap the upper bound. **Plan every push at 60 s. Retire the "20 s" figure.** Combined with G42, deploy cost is still bounded but bigger than first advertised. |
| G44 | **Smoke cleanup SQL must use `DELETE ... RETURNING id` and a per-session source tag.** 7 Sep: five smoke rows disappeared from `callcenter_leads` and it took a full read-only investigation (pg_stat_user_tables, repo grep for `DELETE FROM callcenter_leads`, migration re-run check, deploy-path audit) to trace back to the design-doc cleanup SQL having been run twice. First run silently removed 5 rows; second run *"returned 0"* and everyone forgot the first. **Rule for future smoke plans:** the cleanup SQL block in the design doc must (a) end with `RETURNING id` so re-runs can be compared, (b) use a per-session source tag like `cc_smoke_YYYYMMDD_HHMM` so the predicate can never accidentally match a real row inserted afterwards. Verdict + evidence: this file `§7` of `docs/sessions/DEPLOY_CALLCENTER_20260907.md`. |
| G45 | **A page that treats `400` as an auth error logs users out — only `401` and `503` may clear credentials.** Bug found on the call-center agent page 7 Sep: `ccFetch` at `agent.html:597` (pre-fix) cleared sessionStorage on `401 OR 400`. Business validation returns 400 (e.g. `POST /api/callcenter/resend/:id` returns `400 RESEND_NO_TOKEN` when a lead has no reactivation token). Every business 400 dropped the agent to the splash and made them re-enter their key. **Fix (Stage 4c-a, commit `a403d2f`):** narrow the credential-clear branch to `401` (bad key / bad agent shape from the auth middleware) + `503` (env var unset — misconfigured server). Everything else (400/404/409/429/500) returns the Response to the caller; every caller already has an `else { toast(j.error) }` fallback. **Rule:** when adopting the same fetch-wrapper pattern for a new module, list the exact status codes that mean "credentials are wrong" vs. "your request is wrong" — only the former should clear session state. |
| G46 | **Never deploy while a psql transaction is open. Render Shell shares the web-service instance — a code deploy restarts it and drops the psql client between `BEGIN` and `COMMIT`, silently rolling the transaction back.** 9 Sep: **two** multi-step Render Shell transactions were lost mid-flight to code deploys landing during the paste. Sweep #2 of the C78 'registered' backfill died in the **11:24 `6ccfdb3` cutover**; the expo-9 badge cleanup's first attempt died in the **12:29 `8907612` cutover**. Both traced to the same failure mode: Shell restart mid-transaction → rollback → looks exactly like "nothing happened" to the operator. **Rule 1:** paste every SQL block as one atomic unit — from `BEGIN` through `COMMIT`, verification `SELECT`s included, no intermediate manual prompts. **Rule 2:** on days when a deploy is imminent, run production SQL BEFORE pushing, never after — or wait for the cutover window to fully close (G43 upper bound = 60 s). **Rule 3:** if a Shell paste fails partway, run the verification SELECT first — a silent rollback and "the command didn't run" look identical, and re-running a non-idempotent UPDATE against half-committed input can double-write. Combined with G42/G43: deploys are cheap, but transactions in flight aren't. |
| G47 | **Render Web Shell corrupts multi-KB pastes — stage long string payloads via a TEMP table with self-verification, never paste the same large literal twice.** 10 Sep: inserting a ~450-byte bilingual HTML fallback block into 6 email templates via Render Shell required the same string literal in 4 SQL statements (2 preview + 2 UPDATE for html_content + body). Pasting the literal repeatedly risks Web-Shell buffer corruption (invisible dropped chars, especially inside dollar-quoted `$$...$$` blocks with embedded quotes/newlines). **Rule:** for any SQL payload >1 KB or containing quotes/newlines/HTML, first create a TEMP table with the string as a single dollar-quoted row, then self-verify with `SELECT LENGTH(payload), payload LIKE '%probe%' FROM __payload` before referencing it in the real UPDATE. Every subsequent statement uses `SELECT payload FROM __payload` instead of re-pasting. The verify step catches paste corruption before the UPDATE runs. Applied 10 Sep: `CREATE TEMP TABLE __block AS SELECT $$<p>…{{badge_link}}…</p>$$ AS payload; SELECT LENGTH(payload), payload LIKE '%badge_link%' FROM __block; UPDATE email_templates SET html_content = REPLACE(html_content, '{{qr_code}}', '{{qr_code}}' \|\| (SELECT payload FROM __block)) WHERE …` — worked cleanly on all 6 templates × 2 columns. |
| G48 | **SendGrid Inbound Parse "POST the raw, full MIME message" checkbox stays OFF — permanently.** When ON, SendGrid delivers only the raw MIME to `POST /api/email/inbound` in `req.body.email` and NOT the pre-decoded `req.body.text`/`req.body.html`. `routes/emailInbound.js:22-64` falls through to a manual header/body split that does NOT decode Content-Transfer-Encoding — quoted-printable entities (`=E7`, `=92`, `=C3=A9`), base64 blocks, and multipart boundaries all get emitted verbatim into the forwarded `[Visitor Reply]` email. Suer flipped the checkbox OFF ~13:20 UTC 10 Sep after multiple raw-MIME-dumped forwards during Sep 7-10; parsed `text` field now populated on every inbound. **Rule:** the checkbox MUST stay OFF; anyone re-enabling it (to inspect raw MIME during debugging) must flip it back before the next visitor reply. If the raw MIME is ever needed for a specific investigation, log it via a temporary `console.log(req.body.email)` in `emailInbound.js` and read it from Render app logs instead. Full narrative: `docs/sessions/SIEMA_OPS_20260910.md §4`. |

### Additional notes surfaced 3 Sep

- **DB-access line for the export pattern.** When exporting production data via read-only URL from the Mac: WARP off, current IP in Render's PostgreSQL Inbound IP Rules (G4 recurrence), then `COPY (SELECT …) TO STDOUT > /tmp/file.csv` — never `\copy` for multi-line SQL (G32).
- **Test campaigns on real expo leave overlap warnings.** Running `[SMOKE-WIZARD]%` campaigns on a production expo (e.g. expo 9) leaves `campaign_recipients` rows behind — after which the wizard's cross-campaign overlap query will flag those same addresses as *"already in another campaign for this expo"* on any subsequent real run. Use trash expos (11 / 17) for smokes; the standard cleanup only knows the `[SMOKE-WIZARD]%` name prefix, not a specific expo scope.

---

## Versiyon Geçmişinden Ayrılıp Burada Kalanlar

> "## Versiyon Geçmişi" bölümünün tamamı docs/CLAUDE_ARCHIVE.md'ye taşındı (2026-10-21).
> Aşağıdaki bloklar oradaydı ama tarih kaydı değil, güncel referans/kural oldukları için
> burada kaldı. Metinleri değişmedi, yalnız yer değiştirdi. Eski yerleri her bloğun üstünde.

_(eski yer: Versiyon Geçmişi — v4.0.9 kaydının hemen altı)_

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

_(eski yer: Versiyon Geçmişi — Shared Frontend Components'ın hemen altı)_

### Authentication

- **JWT lifetime:** 30 days (`routes/auth.js:54`, `{ expiresIn: '30d' }`)
- **Storage:** `localStorage.setItem('token', data.token)` in login.html
- **Middleware:** `authMiddleware.js` (JWT_SECRET required, no fallback)
- **Dead middleware:** `middleware/auth.js` exists but unused by any route (has `'your-secret-key'` fallback) — to be deleted in post-fair cleanup
- **Status codes:** 401 = token missing/malformed, 403 = token expired/invalid signature
- **Frontend handling:** leena-fetch.js catches both 401 and 403 as session expiry

_(eski yer: Versiyon Geçmişi — `### v4.0.2 (6 Şubat 2026)` kaydının hemen üstü)_

### Conference Topic Architecture

**Current model (legacy):** Conference topics stored as free-text in `visitors.custom_fields->>'conference_topic'` (multi-topic via `" || "` separator) and `conference_certificates.conference_topic` column. Canonical source: `forms.fields` JSONB array for active conference form per expo.

**Known issue:** No canonical entity model. Renaming requires multi-table updates. Form changes don't propagate to existing visitors. Anti-pattern documented in ell-docs ADR-021.

**Cleanup tool (temporary):** `/api/conference-cleanup` endpoints allow bulk segment-aware rename of variants to canonical topic within an expo. Transaction-wrapped, conflict-detection (cert UNIQUE constraint), CHUNK_SIZE=100.

**Planned refactor (post-fair):** Conference Entity Migration — new tables `expo_conferences` (id, expo_id, name, day, order_no) and `visitor_conferences` (junction). See ADR-021.

### Kurallar — versiyon kayıtlarının içinden

_(eski yer: v4.0.8 → "Campaign results funnel (commit 6d798ab)" alt bölümü)_

**⭐ CANONICAL JOIN RULE — campaign ↔ visitor is by EMAIL, never `visitor_id`.**
`campaign_recipients.visitor_id` is written **only** by the from-expo path
(`campaigns.js` recipients/from-expo INSERT). The **Excel upload path never sets it**, so on
real campaigns it is **100% NULL** — measured 0 populated across 14,941 (C16) and 26,262 (C17)
rows. **Any join on `campaign_recipients.visitor_id` silently returns zero.** Join on
`lower(trim(email))`. Postgres resolves the check-in join to a Hash Semi Join — measured
**11.5 ms**, scaling with check-in count rather than recipient count.

_(eski yer: v4.0.9 — Greeting Chain Rule + Final Push Waves)_

#### ⭐ RULE — templates MUST use the greeting fallback chain, never bare `{{first_name}}`

```
✅  {{first_name|last_name|company|"Dear Visitor"}},
❌  Dear {{first_name}},
```

**Why.** `processEmailTemplate` (`utils/email.js:12-23`) is the resolver for **both** the
campaign path (`email_worker.js:531-532`) and the visitor+template path. Its lookup is
`if (data[part]) return data[part]` — a **truthy** test. A bare `{{first_name}}` against an
empty value renders **empty string**, producing `"Dear ,"`. There is no per-token default.

The chain rescues it: `expr.split('|')` walks the alternatives in order and
`/^".*"$/` returns the quoted literal, so an empty `first_name` falls through to `last_name`,
then `company`, then the literal `Dear Visitor`.

**This is exactly what the reported incident was.** The test-send supplied a recipient whose
`first_name` was empty. The *subject* already used the chain and slid down to the next non-empty
field (rendering a surname, "Ay"); the *body* used bare `{{first_name}}` and had nothing to fall
back to. **Same data, two token forms, two outcomes** — which is why a template-page test can
look broken while the live campaign path is fine.

⚠️ **Corollary — do not write `Dear {{chain}}`.** The chain's own literal is already
`"Dear Visitor"`, so `Dear {{first_name|last_name|company|"Dear Visitor"}}` renders
**`Dear Dear Visitor,`** when every name field is empty. Templates #61/#62 carry this today;
it cannot trigger on the current pools (100% have `first_name`) but must be fixed before reuse.

_(eski yer: v4.0.2+ → **Pre-launch Mega Clima Nigeria 70k Reactivation Sprint (13 May 2026)**)_

Lessons learned (operational rules):
- **L1 — SendGrid sends to invalid-DNS test domains:** `@leena-test.local`-style fake-domain bulk inserts trigger MX lookup → deferred → 72h retry → hard bounce. Reputation risk. Mitigations: (a) plus-addressing on real mailbox (`suer+test1@elan-expo.com`); (b) pre-add fake domain to SendGrid suppression before bulk send; (c) SendGrid sandbox mode for simulation. *Candidate ELL_RULES.md cross-system rule — pending Suer decision.*
- **L2 — PostgreSQL string match apostrophe types:** `'` (ASCII U+0027) and `'` (typographic U+2019) are distinct codepoints. Form inputs often autocorrect to typographic. SQL hardcoded strings WILL NOT match — derive byte-exact value from DB via subquery (this sprint's 76-visitor split SQL relied on this).
- **L3 — Render Shell vs external DB access:** Render Shell uses `$DATABASE_INTERNAL_URL`. External access requires IP whitelist via Render Dashboard → leena_v401_db → Inbound IP Rules — update when Suer's IP changes.

_(eski yer: v4.0.8 → "Campaign results funnel (commit `6d798ab`)" alt bölümü; 2026-10-21 Paket 1 ön işiyle arşivden geri taşındı)_

**Attribution honesty — deliberate, do not "simplify" away:**
- the checked-in row reads *"campaign recipients who checked in"*, never ROI framing, and the
  tab states it is an **upper bound on attribution** — someone who would have attended anyway
  still appears
- until the target expo opens it reads *"target expo not yet open"*; `expoOpen` defaults to
  **false** when the date is unknown, so a pre-fair 0 is never rendered as a measured zero
- an amber banner names the base while rows are still pending

**`42703` fallback — deploy-before-migration ordering.** Both read paths catch PostgreSQL
`42703` (`undefined_column`) and re-run with `delivered_count` as `NULL::int`, so shipping the
code before the migration degrades to the live count instead of 500-ing. Verified on production
against the un-migrated schema. Same legacy-fallback pattern as migration 006 in
`routes/reactivation.js`. **Use this pattern for any read that references a fresh column.**

_(eski yer: v4.0.11 → "Act 2 — the wrong hotfix (commit `5794e2a`)" alt bölümü; 2026-10-21 Paket 1 ön işiyle arşivden geri taşındı)_

**Lesson worth recording: `EXPLAIN` before optimizing.** I had the read-only DB
access to check this in 30 seconds and skipped it because the correlation
"looked slow." Two hours of debug + a wasted deploy is what that habit costs.

_(eski yer: v4.0.2+ → **Test Email Cleanup (14 May 2026)**; 2026-10-21 Paket 1 ön işiyle arşivden geri taşındı)_

- **Two-phase migration pattern proven and adopted as the template for future cleanup migrations:**
  1. Phase 1 — dry run: `sed 's/^COMMIT;$/ROLLBACK;/' migrations/NNN.sql | psql $DATABASE_INTERNAL_URL` — runs every DELETE, prints row counts, rolls back at end. Any FK violation or syntax error surfaces here, zero risk to production data.
  2. Phase 2 — real run: `psql $DATABASE_INTERNAL_URL -f migrations/NNN.sql` — same file, but COMMIT instead of ROLLBACK at end.
