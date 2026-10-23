# SAYFA ENVANTERİ — 2026-10-22, salt-okunur (teslimat ölçümü)

- Görev: Sentez 22 Eki — teslimat ölçümü (YON-11 istisnası). Kod / DB değişmez; tek yazılan dosya bu rapordur.
- LEENA ölçüm tabanı: `origin/main` = **`613ce8e`** (`git ls-remote origin refs/heads/main` → `613ce8ed521a…`).
  Ölçüm ayrı worktree'de yapıldı: `git worktree add /tmp/ell-envanter origin/main` (detached `613ce8e`).
  Ana çalışma kopyası (`eliza-next` @ `ce670ab`, paralel Paket 2 oturumu) okunmadı, değiştirilmedi.
- Canlı = `613ce8e` teyidi: 16/16 ui2 HTML'inin canlı (`https://leena.app/ui2/*.html`) sha256'sı worktree ile **AYNI** (Ek D).
- Çalışma saati: 2026-10-22 12:53–13:09 +03.
- Kök dizin: `backend/leena-v401-backend/public` — servis eden satır `index.js:51` (`express.static(path.join(__dirname, 'public'))`).
- Kanıt kuralı: kullanım kanıtı yalnız **kod + git izi** (canlı log/analytics/DB okunmadı). "Kimse kullanmıyor" hükmü
  verilmez; yazılan hüküm **"kod izinde kullanıcı yok"**. KALSIN/TAŞI/SİL kararı Sentez'de, Suer onayıyla.

---

## 0. ÖZET (sayılar)

| ölçü | değer |
|---|---|
| toplam HTML (public/ altı, özyinelemeli) | **81** — kök 61 · `ui2/` 16 · `callcenter/` 3 · `email_templates/` 1 (bunların 7'si `*.backup.html`) |
| alan dağılımı | **EMS 49 · finance 18** (eski 7 + ui2 11) · **auth 6 · ops 4 · ui2 kabuk 3 · admin 1 · sales 0** |
| ölü aday (4 koşul, §1.4) | **14** |
| kod izi olmayan ama ölü aday SAYILMAYAN | İZSİZ-FUAR **7** (fuar yüzeyi; URL'si yalnız belge izinde) · İZSİZ-YENİ **1** (son 90 günde commit) |
| hiçbir kökten linkle ulaşılamayan (toplam) | **22** (= 14 + 7 + 1) |
| fuar yüzeyi | **18** (7'sinin kod içi linki yok) |
| fuar no gömülü | sayısal expo id **2** sayfa (`certificate.html`, `lead-scan.html`) · tek-fuar içeriği **9** · yerel varsayılan (Nigeria/Lagos) **3** |
| ui2 ikizi | var **0** · kısmi **3** (`contract-list`, `contract-detail`, `login`) · yok **62** · (ui2 sayfası 16) |
| ui2 adası | eski arayüzden ui2'ye kod içi link **0**; ui2'ye giriş yalnız URL (`/ui2/` → `ui2/index.html`, canlı 200) |

**ui2 sayfa geçişi (tek satır, canlı 2026-10-22 13:07 +03, curl, oturumsuz, 3 örnek medyanı):** her geçiş tam sayfa
yüklemesi (SPA yok) · sıra: HTML → `signal.css` (+ `@import` Google Fonts, `signal.css:6`) → `themes.css` → [`ledger.css`]
→ `/leena-fetch.js` → `shell.js` → [`ledger-ui.js`] → satır içi init → on-load GET'ler (Promise.all) · istek: statik
3 / 5 / 7 (login / kabuk+contract / ledger ekranları) + on-load API 0–6 (kod sayımı) → en çok `finance-expenses` 7 + 6 = 13
(fontlar hariç) · TTFB HTML **0.234–0.323 s**, statik varlık **0.230–0.249 s** · başlıklar `Cache-Control: public, max-age=0`
+ `ETag`, `cf-cache-status: DYNAMIC`.

---

## 1. YÖNTEM

### 1.1 Dosya listesi
```
$ cd /tmp/ell-envanter/backend/leena-v401-backend && find public -name "*.html" | sort | wc -l
81
$ git ls-files public | grep -c '\.html$'
81
$ find public -name "*.htm" | wc -l
0
```
Monorepo'daki diğer `public/` dizinleri (`frontend/leena-v401-clean/public`, `backend/leena-v401-backend-backup/public`,
`backend/leena-v401-backend-OLD/public`) `index.js:51`'in servis ettiği dizin değil → sayılmadı.

### 1.2 Referans çıkarımı (Ek E: `scan.py`)
- Tarananlar: `public/` altındaki tüm `.html/.js/.css` + backend'deki `.js/.sql/.json/.sh/.bak` (`node_modules`, `public`
  hariç). Desen: `[A-Za-z0-9_./${}:-]*\.html`; çözümleme kaynak dosyanın dizinine göre (göreli), `/…`, `https://host/…`
  ve `${…}/…` köke göre. Backend referansları köke göre çözüldü.
- Yorum ayıklama: satır başı `//`, `*`, `/*`, `<!--`, `#`, `--`; satır içi `//` (`://` hariç); `/* … */` ve `<!-- … -->`
  blokları. Yorumdaki ad iz sayılmadı (toplam 752 eşleşmenin 77'si yorum).
- JS dosyası: yalnız bir HTML'in `<script src>` / ES `import` ile yüklediği JS'in linkleri, yükleyen sayfa adına
  sayıldı. `public/js/common.js` hiçbir HTML tarafından yüklenmiyor → linkleri (`common.js:452-496`) sayılmadı.
- Backend sınıfı: `routes/ utils/ middleware/ config/ index.js email_worker.js` = **backend (canlı kod)**; `tests/` =
  test (kullanım sayılmadı); diğer kök betikler (`*_backup.js`, `fix_*.sh`, `debug-*.js` …) = backend-misc (sayılmadı).
- Sıfır-referanslı 22 sayfa için ayrıca basename düzeyinde `grep -rn -F` (backend + public, `node_modules` hariç)
  çapraz kontrolü yapıldı: dinamik kurulmuş ek URL izi çıkmadı.

### 1.3 Kökler ve erişilebilirlik
Kenar = yorum dışı link (HTML gövdesi, sidebar, yüklenen JS). Kökler:
- **L** = `login.html` — giriş sayfası; `ui2/shell.js:76` ve `leena-fetch.js:28` yönlendirme hedefi.
- **B** = backend'in URL'ini ürettiği 5 sayfa: `badge-print.html`, `certificate.html`, `form-public.html`,
  `reactivate.html`, `reactivate-fr.html` (file:line tablo "link/akış izi" sütununda).
- **U** = `ui2/index.html` — `/ui2/` dizin isteği (`index.js:51` express.static); canlı `GET /ui2/` → 200, `<title>ELIZA — ui2`.

Sonuç: 59 sayfa en az bir kökten ulaşılabilir; **22 sayfa hiçbir kökten ulaşılamaz** (Ek A).

### 1.4 Tanımlar
- **alan:** finance = ELL finans tablolarını/ledger'ı kullanan (API mount: `contracts`, `commissions`, `cash-forecast`,
  `sales-agents`, `agents`, `offices`, `ledger`, `expense-drafts`) · ops = expo operasyonu (`expo-list` başlığı
  "Expo Operations"; mount `clusters`, `partners`, `expos/:p`) · auth = giriş/kayıt/kimlik · admin = organizer yönetimi
  (`/api/organizers`) · ui2 kabuk = içerik taşımayan ui2 sayfası · EMS = geri kalan (ziyaretçi, form, check-in, e-posta,
  badge, konferans, floorplan, callcenter). **sales = 0:** LIFFY satış ekranı LEENA `public/`'te yok; `ui2/sales.html`
  boş kabuk ("Bu alan henüz boş", `ui2/sales.html:16`); `sales-agents.html` komisyon temsilcisi yönetimi → finance.
- **fuar yüzeyi:** sayfayı organizer-JWT dışı bir aktör açar (ziyaretçi / terminal-hostes / exhibitor / callcenter);
  kanıt = sayfanın kimlik biçimi (`terminal_key`, `?token=`, `?key=`, `x-callcenter-key` …) file:line + URL'in üretildiği yer.
  Fuar yüzeyi olmayan sayfaların aktörü JWT'li organizer oturumu (`localStorage.token` / `leenaFetch` / `shell.js`).
- **menü izi:** hedef, kökten ulaşılabilir bir sayfanın `<nav class="sidebar">` bloğunda (35 sayfada var; 30'u canlı)
  veya ui2 `shell.js` tanımında (`:17-19` üst nav, `:30-35` subnav) linkli. Sayı = linkleyen **canlı** sayfa sayısı.
- **link/akış izi:** yorum dışı gövde/JS linki (canlı kaynaktan; ilk 3 + kalan sayısı) · backend URL üretimi ·
  kod izi yoksa **belge izi** (git'teki `.md`; canlı log değil).
- **ölü aday (EVET):** (a) L/B/U köklerinden ulaşılamıyor ∧ (b) canlı backend kodunda URL'i yok ∧ (c) son commit
  2026-07-24'ten (90 gün) eski ∧ (d) fuar yüzeyi değil. a∧b∧¬c → **İZSİZ-YENİ**; a∧b∧fuar yüzeyi → **İZSİZ-FUAR**
  (URL'si elden dağıtılıyor olabilir — belge izi yazıldı, kod izi yok).
- **ui2 ikizi:** aynı işi gören ui2 sayfası. **kısmi** = aynı API kaynağı, eski sayfadaki yazma işlemlerinin bir kısmı
  yok (Ek C uç listesi karşılaştırması). ui2 satırlarında ters yön (eski karşılığı) yazıldı.
- **fuar no gömülü:** **EVET-id** = çalışan kodda (yorum dışı) sayısal expo id · **içerik** = sayfa tek fuara ait
  metin/marka taşıyor · **yerel** = fuar ülkesi/saat dilimi varsayılanı. Yer tutucu ve örnek veri sayılmadı (Ek B).
- **API uçları:** mount(benzersiz uç sayısı); "özel" = o mount'u başka hiçbir sayfa çağırmıyor. Tam liste Ek C.

---

## 2. ANA TABLO (Sentez'e tek blok)

| # | dosya | alan | fuar yüzeyi | menü izi | link/akış izi | son commit | ui2 ikizi | API uçları | fuar no gömülü | ölü aday |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `admin-dashboard.html` | admin | — | — | — | 2026-02-24 `b486d7c` (4 commit) | yok | auth(1) organizers(2) visitors(1) · özel: organizers · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 2 | `agent-statement.html` | finance | — | — | sales-agents.html:232 | 2026-10-21 `c15ac1f` (5 commit) | yok | agents(2) ledger(2) offices(1) sales-agents(1) · özel: agents | hayır | hayır |
| 3 | `badge-print.html` | EMS | ziyaretçi · `?qr=` (:148) · mail badge linki | — | backend email_worker.js:247 · backend routes/emailSend.js:58/187 · backend routes/visitors.js:402/891 · backend utils/qrcode.js:64 · yalnız ölü-aday kaynak: qrscanner.backup.html | 2026-09-10 `2eee318` (8 commit) | yok | visitors(1) | hayır | hayır |
| 4 | `badge-templates.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-05-08 `5f39aec` (18 commit) | yok | badge-templates(2) expos(1) qr-image(1) visitors(2) | hayır | hayır |
| 5 | `badge.html` | EMS | terminal/hostes · `terminal_key` (:179) | — | badge-templates.html:754 · qrscanner.html:762 · visitorlog-paginated.html:457 | 2026-05-15 `d9908d9` (11 commit) | yok | badge-templates(2) terminal(2) visitors(1) | hayır | hayır |
| 6 | `bulk-badge-print.html` | EMS | terminal `bulk_print` · `?key=` (:125) | — | belge: docs/sessions/TERMINAL_CHECK_20260819.md:192 · docs/CLAUDE_ARCHIVE.md:404 · middleware/dualAuth.js:44 (`bulk_print` yolu) | 2026-05-18 `5a66070` (1 commit) | yok | badge-templates(1) qr-image(1) visitors(2) | hayır | İZSİZ-FUAR |
| 7 | `callcenter/admin.html` | EMS | callcenter admin · JWT (:412) + süpervizör anahtarı (:469) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:21 · mount index.js:170 | 2026-09-28 `8895919` (5 commit) | yok | callcenter(5) | içerik: SIEMA markası (:143) | İZSİZ-FUAR |
| 8 | `callcenter/agent.html` | EMS | callcenter ajanı · `x-callcenter-key` (:664) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:19 · mount index.js:170 | 2026-09-19 `708a531` (9 commit) | yok | callcenter(6) | içerik: SIEMA varsayılan metinleri (:179, :277, :329); `?expo=` ile değişir (:552) | İZSİZ-FUAR |
| 9 | `callcenter/supervisor.html` | EMS | callcenter süpervizör · `x-callcenter-supervisor-key` (:393) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:20 · mount index.js:170 | 2026-09-19 `5496c3a` (5 commit) | yok | callcenter(2) | içerik: SIEMA başlığı (:114) | İZSİZ-FUAR |
| 10 | `cash-forecast.html` | finance | — | sidebar ×2 (örn. main-panel-v2.html) | — | 2026-08-03 `e83b805` (5 commit) | yok | cash-forecast(1) · özel: cash-forecast | hayır | hayır |
| 11 | `certificate-ke.html` | EMS | ziyaretçi · sertifika (expo 10) | — | certificate.html:542 | 2026-10-12 `48c12e1` (1 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Clima Kenya 2026, :6) | hayır |
| 12 | `certificate-mp26.html` | EMS | ziyaretçi · sertifika (expo 13) | — | certificate.html:530 | 2026-08-24 `668fd5c` (2 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Project Nigeria 2026, :6) | hayır |
| 13 | `certificate-ng.html` | EMS | ziyaretçi · sertifika (expo 7) | — | certificate.html:524 | 2026-05-18 `9a20641` (1 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Clima Nigeria 2026, :6) | hayır |
| 14 | `certificate-siema.html` | EMS | ziyaretçi · sertifika (expo 9) | — | certificate.html:536 | 2026-09-26 `c55aed3` (3 commit) | yok | conference-certificates(1) | içerik: tek fuar (Food Factory Africa Forum 2026, :6) | hayır |
| 15 | `certificate.html` | EMS | ziyaretçi · `?token=` (:504) | — | backend routes/conferenceCertificates.js:499/673/801 | 2026-10-12 `48c12e1` (7 commit) | yok | conference-certificates(1) | **EVET-id**: :523/:529/:535/:541 `expo_id === 7/13/9/10` → ayrı sayfa; varsayılan "Mega Clima Ghana 2026" :402/:550 | hayır |
| 16 | `checkin-import.html` | EMS | — | — | — | 2026-05-08 `5f39aec` (10 commit) | yok | import-checkins(1) · özel: import-checkins | hayır | **EVET** |
| 17 | `checkin-reports.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-05-22 `16adf0c` (17 commit) | yok | checkins(1) visitors(1) | hayır | hayır |
| 18 | `checkins.backup.html` | EMS | — | — | — | 2025-09-05 `c3cdb0b` (1 commit) | yok | checkins(1) · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 19 | `checkins.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1458 | 2026-04-27 `1b22cde` (21 commit) | yok | checkins(2) | hayır | hayır |
| 20 | `commissions.html` | finance | — | sidebar ×4 (örn. main-panel-v2.html) | — | 2026-07-25 `f28e6a6` (1 commit) | yok | commissions(1) · özel: commissions | hayır | hayır |
| 21 | `conference-cleanup.html` | EMS | — | — | conference-sessions.html:127 | 2026-05-12 `aa7012f` (1 commit) | yok | conference-cleanup(6) · özel: conference-cleanup | içerik: :138 "Mega Clima Nigeria 2026 sonrası kaldırılacak" bandı | hayır |
| 22 | `conference-scanner.html` | EMS | hostes · `terminal_key` (:256) | — | belge: CLAUDE.md:554 · CLAUDE.md:985 (G22: Copy URL bu sayfayı üretmez) | 2026-09-18 `954dd8e` (11 commit) | yok | conference-certificates(4) terminal(3) | hayır | İZSİZ-FUAR |
| 23 | `conference-sessions.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-cleanup.html:135 | 2026-05-12 `aa7012f` (7 commit) | yok | visitors(2) | hayır | hayır |
| 24 | `contract-detail.html` | finance | — | — | cash-forecast.html:268 · commissions.html:227 · contract-list.html:221 | 2026-10-21 `c15ac1f` (14 commit) | kısmi: ui2/finance-contract.html (GET sözleşme+ödemeler; ödeme/iade/plan/transfer/atama yok) | contracts(8) expos(1) ledger(2) offices(1) sales-agents(1) | hayır | hayır |
| 25 | `contract-list.html` | finance | — | sidebar ×7 (örn. main-panel-v2.html) | contract-detail.html:125 | 2026-07-28 `e289c7d` (6 commit) | kısmi: ui2/finance-contracts.html (yalnız GET liste; `/status` yok) | contracts(2) | hayır | hayır |
| 26 | `dashboard.backup.html` | EMS | — | — | — | 2025-09-05 `c3cdb0b` (1 commit) | yok | expos(1) · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 27 | `dashboard.html` | EMS | — | — | yalnız ölü-aday kaynak: expo-create.backup.html, expo-create.html, main-panel.backup.html | 2026-02-24 `b486d7c` (7 commit) | yok | expos(1) | hayır | **EVET** |
| 28 | `dashboard_new.html` | EMS | — | sidebar ×30 (örn. main-panel-v2.html) | checkin-reports.html:359 · checkins.html:223 · conference-sessions.html:188 · +12 sayfa | 2026-09-28 `0c11e63` (19 commit) | yok | expos(1) reference(1) | hayır | hayır |
| 29 | `email-campaigns.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | email-history.html:151 · reactivation-campaign.html:440 | 2026-09-03 `f6e7f44` (10 commit) | yok | campaigns(13) email-templates(1) expos(1) | hayır | hayır |
| 30 | `email-history.html` | EMS | — | — | email-segments.html:326 · email-send.html:132 | 2026-04-27 `1b22cde` (6 commit) | yok | email-send(1) email-templates(1) | hayır | hayır |
| 31 | `email-segments.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-08-28 `d1cebcf` (17 commit) | yok | email-segments(2) email-templates(1) · özel: email-segments | yerel: :163 "Lagos time" etiketi | hayır |
| 32 | `email-send.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-sessions.html:244 · email-history.html:150 | 2026-05-08 `5f39aec` (18 commit) | yok | email-send(1) email-templates(1) expos(1) visitors(1) | hayır | hayır |
| 33 | `email-templates.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | email-send.html:133 · main-panel-v2.html:1460 | 2026-05-08 `5f39aec` (20 commit) | yok | email-templates(4) | hayır | hayır |
| 34 | `email_templates/modern-default.html` | EMS | — | — | — | 2025-09-04 `ac62661` (1 commit) | yok | — | hayır | **EVET** |
| 35 | `expo-clusters.html` | ops | — | sidebar ×2 (örn. expo-list.html) | expo-form.html:198 | 2026-06-18 `335dacd` (1 commit) | yok | clusters(2) | hayır | hayır |
| 36 | `expo-create.backup.html` | EMS | — | — | — | 2025-09-05 `c3cdb0b` (1 commit) | yok | expos(1) · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 37 | `expo-create.html` | EMS | — | — | yalnız ölü-aday kaynak: dashboard.backup.html, dashboard.html | 2026-09-09 `8907612` (7 commit) | yok | expos(1) reference(1) | hayır | İZSİZ-YENİ |
| 38 | `expo-form.html` | ops | — | — | dashboard_new.html:773 · expo-list.html:276 · expo-partners.html:133 | 2026-09-28 `0c11e63` (2 commit) | yok | clusters(2) expos(3) reference(2) | hayır | hayır |
| 39 | `expo-list.html` | ops | — | sidebar ×3 (örn. expo-clusters.html) | expo-form.html:88 · expo-partners.html:76 | 2026-06-18 `335dacd` (1 commit) | yok | expos(2) reference(1) | hayır | hayır |
| 40 | `expo-partners.html` | ops | — | — | expo-form.html:321 | 2026-06-18 `335dacd` (1 commit) | yok | expos(1) partners(2) · özel: partners | hayır | hayır |
| 41 | `floorplan-builder.html` | EMS | — | sidebar ×16 (örn. main-panel-v2.html) | — | 2026-04-27 `1b22cde` (19 commit) | yok | exhibitors(1) floorplan(12) · özel: exhibitors,floorplan | hayır | hayır |
| 42 | `form-builder.html` | EMS | — | yalnız ölü-aday sayfa sidebar'ı ×4 | form-list.html:176 · main-panel-v2.html:1189 | 2026-09-10 `1c2b353` (23 commit) | yok | expos(1) forms(3) templates(1) · özel: templates | hayır | hayır |
| 43 | `form-list.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | form-builder.html:774 · main-panel-v2.html:1391 | 2026-09-18 `b511cc7` (19 commit) | yok | expos(1) forms(4) webhook(1) | hayır | hayır |
| 44 | `form-public.html` | EMS | ziyaretçi · public · backend URL | — | backend utils/trackingPixel.js:196 · form-list.html:349 · main-panel-v2.html:1420 | 2026-09-19 `5abd9e3` (13 commit) | yok | forms(1) qr-image(1) visitors(1) | hayır | hayır |
| 45 | `hostess-guide.html` | EMS | hostes · statik rehber | — | belge: docs/CLAUDE_ARCHIVE.md:322-325 | 2026-05-15 `7e852ba` (1 commit) | yok | — | içerik: Mega Clima Nigeria 2026 (:8) | İZSİZ-FUAR |
| 46 | `import.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1462 | 2026-09-02 `9d868e3` (24 commit) | yok | email-templates(1) expos(1) visitors(2) | hayır | hayır |
| 47 | `lead-scan.html` | EMS | exhibitor · badge QR girişi (`/leads/auth` :244) | — | belge: CLAUDE.md:497 (akış I) | 2026-05-08 `5f39aec` (4 commit) | yok | leads(3) · özel: leads | **EVET-id**: :185 `EXPO_ID = 3` → API :247/:329/:380 | İZSİZ-FUAR |
| 48 | `login.html` | auth | — | — | agent-statement.html:149 · badge-templates.html:507 · cash-forecast.html:175 · +35 sayfa | 2026-02-24 `f3d5a95` (8 commit) | kısmi: ui2/login.html (users · `/api/user-auth`; organizer kaydı yok) | auth(2) | hayır | hayır |
| 49 | `login_new.html` | auth | — | — | — | 2026-02-24 `cc2810c` (5 commit) | yok | — | hayır | **EVET** |
| 50 | `main-panel-v2.html` | EMS | — | sidebar ×18 (örn. badge-templates.html) | badge-templates.html:175 · checkins.html:137 · conference-sessions.html:128 · +10 sayfa | 2026-09-19 `fa85a01` (31 commit) | yok | expos(1) forms(2) reports(2) webhook(1) | yerel: :1253 "Africa/Lagos" etiketi | hayır |
| 51 | `main-panel.backup.html` | EMS | — | — | — | 2026-02-05 `188ddb4` (2 commit) | yok | expos(1) forms(2) reports(1) visitors(1) · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 52 | `main-panel.html` | EMS | — | — | yalnız ölü-aday kaynak: dashboard.backup.html, expo-create.backup.html, expo-create.html | 2026-02-24 `b486d7c` (12 commit) | yok | expos(1) forms(2) reports(1) visitors(1) | hayır | **EVET** |
| 53 | `offices.html` | finance | — | sidebar ×1 (örn. main-panel-v2.html) | — | 2026-08-04 `3ebe8b5` (1 commit) | yok | offices(2) reference(1) | hayır | hayır |
| 54 | `qrscanner.backup.html` | EMS | — | — | — | 2025-09-16 `6cf6d44` (1 commit) | yok | checkins(1) visitors(2) | hayır | **EVET** |
| 55 | `qrscanner.html` | EMS | terminal/hostes · `terminalKey` (:708) | — | terminals.html:277 | 2026-09-20 `96c5a54` (26 commit) | yok | badge-templates(1) checkins(1) terminal(3) visitors(3) | yerel: :927 ülke varsayılanı `Nigeria` | hayır |
| 56 | `reactivate-fr.html` | EMS | ziyaretçi · `?token=` (FR) | — | backend routes/callcenter.js:937 · backend routes/campaignBuilder.js:1178 · backend routes/reactivation.js:67/998 · reactivation-campaign.html:444 | 2026-09-07 `a9a44fd` (2 commit) | yok | reactivation(3) | hayır | hayır |
| 57 | `reactivate.html` | EMS | ziyaretçi · `?token=` (:450) | — | backend routes/callcenter.js:937 · backend routes/campaignBuilder.js:1178 · backend routes/reactivation.js:67/998 · reactivation-campaign.html:444 | 2026-09-07 `a9a44fd` (7 commit) | yok | reactivation(3) | hayır | hayır |
| 58 | `reactivation-campaign.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-09-04 `3120810` (38 commit) | yok | campaigns(4) email-templates(1) expos(1) forms(2) reactivation(9) | hayır | hayır |
| 59 | `register.backup.html` | auth | — | — | — | 2025-09-05 `c3cdb0b` (1 commit) | yok | auth(1) | hayır | **EVET** |
| 60 | `register.html` | auth | — | — | — | 2026-02-24 `b486d7c` (4 commit) | yok | auth(1) | hayır | **EVET** |
| 61 | `reports.backup.html` | EMS | — | — | — | 2025-09-05 `c3cdb0b` (1 commit) | yok | reports(1) · ⚠ `localhost:3000` taban | hayır | **EVET** |
| 62 | `reports.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1461 | 2026-05-08 `5f39aec` (21 commit) | yok | reports(2) | hayır | hayır |
| 63 | `sales-agents.html` | finance | — | sidebar ×7 (örn. main-panel-v2.html) | — | 2026-10-21 `c15ac1f` (5 commit) | yok | ledger(1) offices(1) sales-agents(2) | hayır | hayır |
| 64 | `terminals.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1459 | 2026-05-18 `1324296` (23 commit) | yok | badge-templates(1) terminals(5) · özel: terminals | hayır | hayır |
| 65 | `ui2/finance-account.html` | finance | — | — | ui2/finance-accounts.html:34 · ui2/finance-summary.html:30 · ui2/finance-supplier.html:57 | 2026-10-21 `8119683` (2 commit) | (ui2) eski karşılık yok | ledger(1) | hayır | hayır |
| 66 | `ui2/finance-accounts.html` | finance | — | ui2 shell subnav (shell.js:32) | ui2/finance-account.html:69 | 2026-10-21 `c15ac1f` (1 commit) | (ui2) eski karşılık yok | ledger(5) offices(1) | hayır | hayır |
| 67 | `ui2/finance-budget.html` | finance | — | ui2 shell subnav (shell.js:35) | — | 2026-10-21 `c15ac1f` (1 commit) | (ui2) eski karşılık yok | expos(1) ledger(3) | hayır | hayır |
| 68 | `ui2/finance-contract.html` | finance | — | ui2 shell üst nav+subnav (shell.js:19,30) | ui2/finance-contracts.html:54 | 2026-09-09 `493ad39` (1 commit) | (ui2) eski: contract-detail.html — kısmi | contracts(2) | hayır | hayır |
| 69 | `ui2/finance-contracts.html` | finance | — | — | ui2/index.html:24 | 2026-10-08 `8798dc6` (1 commit) | (ui2) eski: contract-list.html — kısmi | contracts(1) | hayır | hayır |
| 70 | `ui2/finance-drafts.html` | finance | — | — | ui2/finance-expenses.html:119 | 2026-10-21 `8119683` (1 commit) | (ui2) eski karşılık yok | expense-drafts(2) expos(1) ledger(3) | hayır | hayır |
| 71 | `ui2/finance-expenses.html` | finance | — | ui2 shell subnav (shell.js:34) | ui2/finance-drafts.html:117 · ui2/finance-supplier.html:72 · ui2/finance-suppliers.html:74 | 2026-10-21 `8119683` (2 commit) | (ui2) eski karşılık yok | expense-drafts(1) expos(1) ledger(6) | hayır | hayır |
| 72 | `ui2/finance-summary.html` | finance | — | ui2 shell subnav (shell.js:31) | — | 2026-10-21 `c15ac1f` (1 commit) | (ui2) eski karşılık yok | ledger(1) | hayır | hayır |
| 73 | `ui2/finance-supplier.html` | finance | — | — | ui2/finance-account.html:34 · ui2/finance-expenses.html:111 · ui2/finance-suppliers.html:33 | 2026-10-21 `8119683` (1 commit) | (ui2) eski karşılık yok | ledger(3) offices(1) | hayır | hayır |
| 74 | `ui2/finance-suppliers.html` | finance | — | — | ui2/finance-expenses.html:118 · ui2/finance-supplier.html:72 | 2026-10-21 `8119683` (1 commit) | (ui2) eski karşılık yok | ledger(3) offices(1) | hayır | hayır |
| 75 | `ui2/finance-transfers.html` | finance | — | ui2 shell subnav (shell.js:33) | — | 2026-10-21 `c15ac1f` (1 commit) | (ui2) eski karşılık yok | expos(1) ledger(3) | hayır | hayır |
| 76 | `ui2/index.html` | ui2 kabuk | — | — | — | 2026-10-08 `49fa217` (3 commit) | (ui2) kabuk | — | hayır | hayır |
| 77 | `ui2/login.html` | auth | — | — | leena-fetch.js:28 · ui2/index.html:25 · ui2/whoami.html:64 | 2026-10-21 `931e709` (3 commit) | (ui2) eski: login.html — kısmi | user-auth(2) | hayır | hayır |
| 78 | `ui2/operations.html` | ui2 kabuk | — | ui2 shell üst nav (shell.js:18) | — | 2026-09-09 `4be38ed` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 79 | `ui2/sales.html` | ui2 kabuk | — | ui2 shell üst nav (shell.js:17) | — | 2026-09-09 `4be38ed` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 80 | `ui2/whoami.html` | auth | — | — | ui2/index.html:25 · ui2/login.html:58 | 2026-10-21 `931e709` (3 commit) | (ui2) eski karşılık yok | user-auth(1) | hayır | hayır |
| 81 | `visitorlog-paginated.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-sessions.html:243 · main-panel-v2.html:1330 | 2026-08-31 `34061f8` (33 commit) | yok | email-send(1) email-templates(1) unsubscribes(2) visitors(7) · özel: unsubscribes | hayır | hayır |

---

## 3. EK A — Ulaşılamayan 22 sayfanın dökümü

### A1. ölü aday — EVET (14)
| dosya | kanıt (kod + git) |
|---|---|
| `admin-dashboard.html` | gelen link 0 · API tabanı `http://localhost:3000` (`:91`, `:131`, `:156`, `:170`) · son commit 2026-02-24 `b486d7c` |
| `checkin-import.html` | gelen link 0 (kendi sidebar'ı var, kimse ona linklemiyor) · özel API `/api/import-checkins` · son commit 2026-05-08 `5f39aec` (toplu UI düzeltmesi) |
| `checkins.backup.html` | yedek · gelen link 0 · `localhost:3000` · 2025-09-05 `c3cdb0b` |
| `dashboard.backup.html` | yedek · gelen link 0 · `localhost:3000` · 2025-09-05 `c3cdb0b` |
| `dashboard.html` | gelen link yalnız ulaşılamayan sayfalardan: `expo-create.html:333/402`, `main-panel.html:93/145`, `expo-create.backup.html`, `main-panel.backup.html` · 2026-02-24 `b486d7c` |
| `email_templates/modern-default.html` | backend dahil hiçbir yerde ad/yol izi yok (basename grep 0) · 2025-09-04 `ac62661` |
| `expo-create.backup.html` | yedek · gelen link 0 · `localhost:3000` · 2025-09-05 `c3cdb0b` |
| `login_new.html` | `login.html`'e yönlendirme kabuğu (`:5`, `:10`); gelen link 0 · 2026-02-24 `cc2810c` |
| `main-panel.backup.html` | yedek · gelen link 0 · `localhost:3000` · 2026-02-05 `188ddb4` |
| `main-panel.html` | `/main-panel-v2.html`'e yönlendirme kabuğu (`:5`); gelen link yalnız `expo-create.html:327` + yedeklerden · 2026-02-24 `b486d7c` |
| `qrscanner.backup.html` | yedek · gelen link 0 · 2025-09-16 `6cf6d44` |
| `register.backup.html` | yedek · gelen link 0 · 2025-09-05 `c3cdb0b` |
| `register.html` | gelen link 0 · aynı uç (`/api/auth/register`) `login.html`'de de çağrılıyor · 2026-02-24 `b486d7c` |
| `reports.backup.html` | yedek · gelen link 0 · `localhost:3000` · 2025-09-05 `c3cdb0b` |

Not: `dashboard.html` ↔ `main-panel.html` ↔ `expo-create.html` kendi aralarında linkli bir kapalı küme; kümeye
kökten (L/B/U) giren link yok.

### A2. İZSİZ-YENİ (1)
| dosya | kanıt |
|---|---|
| `expo-create.html` | gelen link yalnız `dashboard.html:234` + `dashboard.backup.html` (ikisi de ulaşılamaz) · son commit **2026-09-09 `8907612`** "feat(expos): country field on Create Expo" — aynı commit `dashboard_new.html`'deki Create modal'ını da değiştirdi (`git show --stat 8907612`) |

### A3. İZSİZ-FUAR (7) — kod linki yok, fuar yüzeyi
| dosya | kimlik biçimi | belge izi |
|---|---|---|
| `bulk-badge-print.html` | `?key=` (`:125`); `middleware/dualAuth.js:44` bulk_print yolu | `docs/sessions/TERMINAL_CHECK_20260819.md:192` · `docs/CLAUDE_ARCHIVE.md:404` |
| `conference-scanner.html` | `terminal_key` (`:256`) | `CLAUDE.md:554` · `CLAUDE.md:985` (G22: terminals.html Copy URL bu sayfayı üretmez; tek kod izi `qrscanner.html:71` bir yorum) |
| `lead-scan.html` | badge QR → `/api/leads/auth` (`:244`) | `CLAUDE.md:497` (akış I) |
| `hostess-guide.html` | statik (API yok) | `docs/CLAUDE_ARCHIVE.md:322-325` |
| `callcenter/agent.html` | `x-callcenter-key` (`:664`) | `docs/sessions/DEPLOY_CALLCENTER_20260907.md:19` · mount `index.js:170` |
| `callcenter/supervisor.html` | `x-callcenter-supervisor-key` (`:393`) | `docs/sessions/DEPLOY_CALLCENTER_20260907.md:20` |
| `callcenter/admin.html` | JWT (`:412`) + süpervizör anahtarı (`:469`) | `docs/sessions/DEPLOY_CALLCENTER_20260907.md:21` |

### A4. ui2 adası (bulgu)
- Eski arayüzden (ui2 dışı) ui2 sayfalarına yorum dışı link: **0**. Tek eşleşme `leena-fetch.js:28` (`'login.html'`,
  göreli) — yalnız ui2 sayfası yüklediğinde `ui2/login.html`'e çözülür (`ui2/finance-contract.html:162` yorumu bunu
  belirtir; o sayfa 401'de mutlak `/login.html` kullanır, `:163`).
- `ui2/index.html`'e gelen link 0; erişim `/ui2/` dizin isteğiyle (canlı 200).
- ui2'den eski arayüze: `ui2/shell.js:76` ve `ui2/ledger-ui.js:29` → `/login.html`.
- Eski finans sayfaları EMS ana menüsünde: `main-panel-v2.html:963-967` (Contracts, Sales Agents, Commissions,
  Cash Forecast, Offices).

---

## 4. EK B — Gömülü fuar dökümü

| sınıf | dosya:satır | içerik |
|---|---|---|
| EVET-id | `certificate.html:523` / `:529` / `:535` / `:541` | `Number(cert.expo_id) === 7 / 13 / 9 / 10` → `certificate-ng / -mp26 / -siema / -ke.html` |
| EVET-id | `lead-scan.html:185` | `const EXPO_ID = 3; // Mega Horeca Nigeria` → kullanım `:247`, `:329`, `:380` (scan / list API) |
| içerik | `certificate.html:379`, `:402`, `:550` | varsayılan "Mega Clima Ghana 2026" + Ghana logosu |
| içerik | `certificate-ng.html:6` · `certificate-mp26.html:6` · `certificate-siema.html:6` · `certificate-ke.html:6` | `<title>` tek fuar (Mega Clima Nigeria / Mega Project Nigeria / Food Factory Africa Forum / Mega Clima Kenya 2026) |
| içerik | `hostess-guide.html:8` | "Mega Clima Nigeria 2026" |
| içerik | `callcenter/agent.html:179`, `:277`, `:329` | SIEMA varsayılan metinleri; `?expo=` ile değişir (`:552`) |
| içerik | `callcenter/supervisor.html:114` · `callcenter/admin.html:143` | SIEMA başlık/marka |
| içerik | `conference-cleanup.html:138` | "will be removed after Mega Clima Nigeria 2026 fair" bandı |
| yerel | `qrscanner.html:927` | manuel kayıtta ülke varsayılanı `'Nigeria'` |
| yerel | `main-panel-v2.html:1253` | "Today vs yesterday (Africa/Lagos)" etiketi |
| yerel | `email-segments.html:163` | "Date (fair day, Lagos time)" etiketi |

Hariç tutulanlar (yer tutucu / örnek veri / yanlış pozitif): `expo-form.html:100`, `:121` · `expo-clusters.html:70` ·
`form-builder.html:587`, `:1270` · `import.html:556` · `badge.html:290` (önizleme örnek verisi) ·
`callcenter/admin.html:698` (`existing_leads_on_expo || 0` — desen eşleşmesi, expo id değil).
Kapsam dışı: backend'de gömülü expo/form id'leri (ör. `callcenter/agent.html:982` yorumu sunucu `EXPO_SETTINGS`'te
form 59/64'e işaret ediyor) sayılmadı. v402 "fuar numarası gömülü 10 dosya" (defter `:3557`) kaynak listesi
**BULAMADIM** → bu ölçümle karşılaştırılamadı.

---

## 5. EK C — Sayfa başına API uçları (tam liste)

`:p` = yol parametresi; sorgu dizgisi atıldı; HTTP metodu kaydedilmedi. Çıkarım: literal `/api/…`, taban değişken +
şablon/birleştirme (`${API_URL}/x`, `API + '/x'`), `'/api/x/' + id + '/y'` birleştirmesi ve yardımcı fonksiyon
çağrıları (`ccFetch('/next')`, `api('GET', '/campaigns')`, `apiCall('GET', '/halls')`).

- `admin-dashboard.html` (4): `/api/auth/register`, `/api/organizers`, `/api/organizers/:p`, `/api/visitors/export/:p`
- `agent-statement.html` (6): `/api/agents/:p/payouts`, `/api/agents/:p/statement`, `/api/ledger/accounts`, `/api/ledger/currencies`, `/api/offices`, `/api/sales-agents`
- `badge-print.html` (1): `/api/visitors/badge/:p`
- `badge-templates.html` (6): `/api/badge-templates`, `/api/badge-templates/:p`, `/api/expos`, `/api/qr-image/:p`, `/api/visitors/import`, `/api/visitors/paginated`
- `badge.html` (5): `/api/badge-templates/:p`, `/api/badge-templates/for-terminal/:p`, `/api/terminal/badge-print`, `/api/terminal/visitor-by-qr`, `/api/visitors/badge/:p`
- `bulk-badge-print.html` (4): `/api/badge-templates/for-terminal/:p`, `/api/qr-image/:p`, `/api/visitors/import`, `/api/visitors/paginated`
- `callcenter/admin.html` (5): `/api/callcenter/admin/dump`, `/api/callcenter/admin/import`, `/api/callcenter/expo-meta`, `/api/callcenter/report/send-now`, `/api/callcenter/stats/live`
- `callcenter/agent.html` (6): `/api/callcenter/expo-meta`, `/api/callcenter/next`, `/api/callcenter/outcome/:p`, `/api/callcenter/resend/:p`, `/api/callcenter/skip/:p`, `/api/callcenter/stats/me`
- `callcenter/supervisor.html` (2): `/api/callcenter/expo-meta`, `/api/callcenter/stats/live`
- `cash-forecast.html` (1): `/api/cash-forecast`
- `certificate-ke.html` (1): `/api/conference-certificates/verify/:p`
- `certificate-mp26.html` (1): `/api/conference-certificates/verify/:p`
- `certificate-ng.html` (1): `/api/conference-certificates/verify/:p`
- `certificate-siema.html` (1): `/api/conference-certificates/verify/:p`
- `certificate.html` (1): `/api/conference-certificates/verify/:p`
- `checkin-import.html` (1): `/api/import-checkins`
- `checkin-reports.html` (2): `/api/checkins`, `/api/visitors/paginated`
- `checkins.backup.html` (1): `/api/checkins`
- `checkins.html` (2): `/api/checkins`, `/api/checkins/stats/summary`
- `commissions.html` (1): `/api/commissions`
- `conference-cleanup.html` (6): `/api/conference-cleanup`, `/api/conference-cleanup/bulk-update`, `/api/conference-cleanup/canonical-topics`, `/api/conference-cleanup/expos`, `/api/conference-cleanup/topic-variants`, `/api/conference-cleanup/visitors`
- `conference-scanner.html` (7): `/api/conference-certificates/blocked-topics`, `/api/conference-certificates/checkin-and-certify`, `/api/conference-certificates/resend`, `/api/conference-certificates/topics`, `/api/terminal/status`, `/api/terminal/visitor-by-email`, `/api/terminal/visitor-by-qr`
- `conference-sessions.html` (2): `/api/visitors/conference-topics`, `/api/visitors/export`
- `contract-detail.html` (13): `/api/contracts/:p`, `/api/contracts/:p/assignment`, `/api/contracts/:p/payments`, `/api/contracts/:p/payments/:p/reverse`, `/api/contracts/:p/schedule`, `/api/contracts/:p/schedule/default`, `/api/contracts/:p/status`, `/api/contracts/:p/transfer`, `/api/expos`, `/api/ledger/accounts`, `/api/ledger/currencies`, `/api/offices`, `/api/sales-agents`
- `contract-list.html` (2): `/api/contracts`, `/api/contracts/:p/status`
- `dashboard.backup.html` (1): `/api/expos`
- `dashboard.html` (1): `/api/expos`
- `dashboard_new.html` (2): `/api/expos`, `/api/reference/countries`
- `email-campaigns.html` (15): `/api/campaigns`, `/api/campaigns/:p`, `/api/campaigns/:p/activate`, `/api/campaigns/:p/lift`, `/api/campaigns/:p/pause`, `/api/campaigns/:p/recipients`, `/api/campaigns/:p/recipients/:p`, `/api/campaigns/:p/recipients/from-expo`, `/api/campaigns/:p/recipients/upload`, `/api/campaigns/:p/resume`, `/api/campaigns/:p/steps`, `/api/campaigns/:p/steps/:p`, `/api/campaigns/:p/steps/:p/recipients`, `/api/email-templates`, `/api/expos`
- `email-history.html` (2): `/api/email-send/history`, `/api/email-templates`
- `email-segments.html` (3): `/api/email-segments/preview`, `/api/email-segments/send`, `/api/email-templates`
- `email-send.html` (4): `/api/email-send/bulk`, `/api/email-templates`, `/api/expos`, `/api/visitors/paginated`
- `email-templates.html` (4): `/api/email-templates`, `/api/email-templates/:p`, `/api/email-templates/clone/:p`, `/api/email-templates/defaults`
- `email_templates/modern-default.html` (0): —
- `expo-clusters.html` (2): `/api/clusters`, `/api/clusters/:p`
- `expo-create.backup.html` (1): `/api/expos`
- `expo-create.html` (2): `/api/expos`, `/api/reference/countries`
- `expo-form.html` (7): `/api/clusters`, `/api/clusters/:p/expos`, `/api/expos`, `/api/expos/:p`, `/api/expos/:p/cluster`, `/api/reference/countries`, `/api/reference/sectors`
- `expo-list.html` (3): `/api/expos`, `/api/expos/:p/clone`, `/api/reference/countries`
- `expo-partners.html` (3): `/api/expos/:p`, `/api/partners`, `/api/partners/:p`
- `floorplan-builder.html` (13): `/api/exhibitors`, `/api/floorplan`, `/api/floorplan/halls`, `/api/floorplan/halls/:p`, `/api/floorplan/halls/:p/versions`, `/api/floorplan/stands/:p`, `/api/floorplan/stands/:p/move`, `/api/floorplan/stands/:p/split`, `/api/floorplan/stands/:p/status`, `/api/floorplan/stands/merge`, `/api/floorplan/versions/:p/activate`, `/api/floorplan/versions/:p/clone`, `/api/floorplan/versions/:p/stands`
- `form-builder.html` (5): `/api/expos/:p`, `/api/forms`, `/api/forms/:p`, `/api/forms/upload-banner`, `/api/templates`
- `form-list.html` (6): `/api/expos/:p`, `/api/forms`, `/api/forms/:p`, `/api/forms/:p/toggle`, `/api/forms/clone/:p`, `/api/webhook/zoho/:p`
- `form-public.html` (3): `/api/forms/public/:p`, `/api/qr-image/:p`, `/api/visitors/public`
- `hostess-guide.html` (0): —
- `import.html` (4): `/api/email-templates`, `/api/expos`, `/api/visitors/import`, `/api/visitors/import-logs`
- `lead-scan.html` (3): `/api/leads/auth`, `/api/leads/list`, `/api/leads/scan`
- `login.html` (2): `/api/auth/login`, `/api/auth/register`
- `login_new.html` (0): —
- `main-panel-v2.html` (6): `/api/expos/:p`, `/api/forms/:p`, `/api/forms/expo/:p`, `/api/reports/live`, `/api/reports/summary`, `/api/webhook/zoho/:p/:p/:p`
- `main-panel.backup.html` (5): `/api/expos/:p`, `/api/forms/:p`, `/api/forms/expo/:p`, `/api/reports/summary`, `/api/visitors`
- `main-panel.html` (5): `/api/expos/:p`, `/api/forms/:p`, `/api/forms/expo/:p`, `/api/reports/summary`, `/api/visitors/paginated`
- `offices.html` (3): `/api/offices`, `/api/offices/:p`, `/api/reference/countries`
- `qrscanner.backup.html` (3): `/api/checkins`, `/api/visitors/badge/:p`, `/api/visitors/manual`
- `qrscanner.html` (8): `/api/badge-templates/for-terminal/:p`, `/api/checkins`, `/api/terminal/checkin`, `/api/terminal/visitor-by-email`, `/api/terminal/visitor-by-qr`, `/api/visitors/badge/:p`, `/api/visitors/manual`, `/api/visitors/paginated`
- `reactivate-fr.html` (3): `/api/reactivation`, `/api/reactivation/activate`, `/api/reactivation/verify/:p`
- `reactivate.html` (3): `/api/reactivation`, `/api/reactivation/activate`, `/api/reactivation/verify/:p`
- `reactivation-campaign.html` (17): `/api/campaigns/reactivation/build`, `/api/campaigns/reactivation/job/:p`, `/api/campaigns/reactivation/segment`, `/api/campaigns/validate-template`, `/api/email-templates`, `/api/expos`, `/api/forms`, `/api/forms/expo/:p`, `/api/reactivation/campaign/:p/close`, `/api/reactivation/campaign/:p/is-active`, `/api/reactivation/campaign/:p/reopen`, `/api/reactivation/campaign/:p/stats`, `/api/reactivation/campaigns`, `/api/reactivation/create-from-excel`, `/api/reactivation/create-from-expo`, `/api/reactivation/job/:p`, `/api/reactivation/resend-pending`
- `register.backup.html` (1): `/api/auth/register`
- `register.html` (1): `/api/auth/register`
- `reports.backup.html` (1): `/api/reports`
- `reports.html` (2): `/api/reports/export`, `/api/reports/summary`
- `sales-agents.html` (4): `/api/ledger/currencies`, `/api/offices`, `/api/sales-agents`, `/api/sales-agents/:p`
- `terminals.html` (6): `/api/badge-templates`, `/api/terminals`, `/api/terminals/:p`, `/api/terminals/:p/toggle`, `/api/terminals/all`, `/api/terminals/clone/:p`
- `ui2/finance-account.html` (1): `/api/ledger/accounts/:p/statement`
- `ui2/finance-accounts.html` (6): `/api/ledger/accounts`, `/api/ledger/accounts/:p`, `/api/ledger/currencies`, `/api/ledger/expense-types`, `/api/ledger/reference`, `/api/offices`
- `ui2/finance-budget.html` (4): `/api/expos`, `/api/ledger/budgets/:p`, `/api/ledger/budgets/:p/lock`, `/api/ledger/reference`
- `ui2/finance-contract.html` (2): `/api/contracts/:p`, `/api/contracts/:p/payments`
- `ui2/finance-contracts.html` (1): `/api/contracts`
- `ui2/finance-drafts.html` (6): `/api/expense-drafts`, `/api/expense-drafts/:p`, `/api/expos`, `/api/ledger/accounts`, `/api/ledger/reference`, `/api/ledger/suppliers`
- `ui2/finance-expenses.html` (8): `/api/expense-drafts`, `/api/expos`, `/api/ledger/accounts`, `/api/ledger/expenses`, `/api/ledger/expenses/:p`, `/api/ledger/reference`, `/api/ledger/suppliers`, `/api/ledger/suppliers/options`
- `ui2/finance-summary.html` (1): `/api/ledger/summary`
- `ui2/finance-supplier.html` (4): `/api/ledger/suppliers/:p`, `/api/ledger/suppliers/:p/history`, `/api/ledger/suppliers/options`, `/api/offices`
- `ui2/finance-suppliers.html` (4): `/api/ledger/suppliers`, `/api/ledger/suppliers/:p`, `/api/ledger/suppliers/options`, `/api/offices`
- `ui2/finance-transfers.html` (4): `/api/expos`, `/api/ledger/accounts`, `/api/ledger/transfers`, `/api/ledger/transfers/:p`
- `ui2/index.html` (0): —
- `ui2/login.html` (2): `/api/user-auth/change-password`, `/api/user-auth/login`
- `ui2/operations.html` (0): —
- `ui2/sales.html` (0): —
- `ui2/whoami.html` (1): `/api/user-auth/me`
- `visitorlog-paginated.html` (11): `/api/email-send/single`, `/api/email-templates`, `/api/unsubscribes`, `/api/unsubscribes/status`, `/api/visitors/:p`, `/api/visitors/:p/emails`, `/api/visitors/bulk-email`, `/api/visitors/conference-topics`, `/api/visitors/export`, `/api/visitors/paginated`, `/api/visitors/sources`

---

## 6. EK D — ui2 canlı ölçüm (2026-10-22, curl, oturumsuz)

Komutlar: `curl -s -o /dev/null -w '%{http_code} %{time_starttransfer} %{size_download}' https://leena.app/<yol>`
(3 tur, 13:07:10–13:07:30 +03, medyan) · `curl -s https://leena.app/<yol> | shasum -a 256` (12:53 +03) ·
`curl -s -I https://leena.app/ui2/shell.js`.

| sayfa | statik istek (HTML dahil) | on-load GET (kod sayımı) | TTFB medyan (s) | canlı sha256 = 613ce8e |
|---|---|---|---|---|
| `ui2/finance-account.html` | 7 | 1 (`:88`) | 0.323 | AYNI |
| `ui2/finance-accounts.html` | 7 | 4 (`:114-118`) | 0.288 | AYNI |
| `ui2/finance-budget.html` | 7 | 2 (`:108`) + 1 `?expo` varsa (`:116`) | 0.295 | AYNI |
| `ui2/finance-contract.html` | 5 | 2 (`:153-155`) | 0.253 | AYNI |
| `ui2/finance-contracts.html` | 5 | 1 (`:97`) | 0.244 | AYNI |
| `ui2/finance-drafts.html` | 7 | 5 (`:130-131`) | 0.259 | AYNI |
| `ui2/finance-expenses.html` | 7 | 6 (`:145-147`) | 0.255 | AYNI |
| `ui2/finance-summary.html` | 7 | 1 (`:62`) | 0.247 | AYNI |
| `ui2/finance-supplier.html` | 7 | 3 (`:91-92`) | 0.243 | AYNI |
| `ui2/finance-suppliers.html` | 7 | 3 (`:86-87`) | 0.250 | AYNI |
| `ui2/finance-transfers.html` | 7 | 3 (`:91`) | 0.258 | AYNI |
| `ui2/index.html` | 5 | 0 | 0.270 | AYNI |
| `ui2/login.html` | 3 | 0 | 0.242 | AYNI |
| `ui2/operations.html` | 5 | 0 | 0.272 | AYNI |
| `ui2/sales.html` | 5 | 0 | 0.236 | AYNI |
| `ui2/whoami.html` | 5 | 1 (`:43`) | 0.234 | AYNI |

Statik varlık TTFB medyanı (s): `signal.css` 0.246 · `themes.css` 0.249 · `ledger.css` 0.236 · `/leena-fetch.js` 0.230 ·
`shell.js` 0.232 · `ledger-ui.js` 0.241. Tek örnekte en yüksek değer 0.660 s (`finance-budget.html`, 2. tur).
`shell.js` başlıkları: `cache-control: public, max-age=0` · `etag: W/"1b18-…"` · `server: cloudflare` ·
`x-render-origin-server: Render` · `cf-cache-status: DYNAMIC`. Sebep aranmadı (görev kuralı).

---

## 7. ⚠️ ÖLÇÜLMEDİ / GÖZLENEMEDİ

- Canlı kullanım (Render logları, analytics, erişim sayıları) — görev kuralı gereği alınmadı.
- DB'de saklı e-posta şablonlarının (`email_templates`) içerdiği sayfa URL'leri — DB okunmadı (yalnız kod + git).
  Şablon gövdesiyle dağıtılan bir sayfa URL'i varsa bu envanterde görünmez.
- Elden dağıtılan URL'ler (WhatsApp, basılı QR, yer imi) — kodda iz bırakmaz; İZSİZ-FUAR için yalnız belge izi yazıldı.
- API uçlarının backend'de var olup olmadığı ve HTTP metodu eşleştirilmedi.
- Tam dinamik kurulan sayfa URL'leri (değişkenden ad) regex'e görünmez; 22 ulaşılamayan sayfada basename grep ek iz vermedi,
  diğer sayfalarda böyle bir çapraz kontrol yapılmadı.
- ui2 on-load API sayısı canlı ölçülmedi (oturum gerekir) — kod sayımıdır. Google Fonts istek/dosya sayısı, tarayıcı
  render ve tam geçiş süresi ölçülmedi (yalnız TTFB).
- Paket 2 (`ce670ab`, `eliza-next`, main'de değil): `git diff --stat 613ce8e ce670ab -- backend/leena-v401-backend/public`
  → +3 ui2 sayfası (`admin-users.html`, `admin-user.html`, `invite.html`) + `admin-ui.js`; `shell.js`, `login.html`,
  `whoami.html`, `finance-drafts/-supplier/-suppliers.html` değişiyor. Bu envantere girmedi; merge sonrası 84 sayfa olur.
- Commit sayısı yol tabanlı (`git log -- <yol>`, `--follow` yok): `ac62661` ("Move frontend into backend/public") öncesi
  geçmiş sayılmadı.
- Diğer `public/` dizinlerinin (servis edilmeyen) içeriği ölçülmedi.

## 8. Bilinçle yapılmayanlar

- KALSIN / TAŞI / SİL hükmü (Sentez + Suer).
- Kod, DB, CLAUDE.md değişikliği yok (kod değişmediği için KURAL 4 tetiklenmedi).
- Ana çalışma kopyasına dokunulmadı (stash yok); Paket 2 yalnız `git diff --stat` ile sayıldı.
- Push yok.
- Belgelerde terminal anahtarı taşıyan URL'ler (ör. `docs/sessions/FAIR_EVE_FINAL_20260824.md:25`) rapora kopyalanmadı.

---

## 9. EK E — Betikler (yeniden üretim)

Çalıştırma: `python3 -I scan.py scan.json && python3 -I report.py scan.json table|stats|api` (worktree `/tmp/ell-envanter`).

<details><summary>scan.py</summary>

```python
#!/usr/bin/env python3
"""Sayfa envanteri tarayıcısı — salt-okunur. Worktree: /tmp/ell-envanter (613ce8e)."""
import os, re, subprocess, json, sys, collections

ROOT = '/tmp/ell-envanter'
BE = ROOT + '/backend/leena-v401-backend'
PUB = BE + '/public'
OUT = sys.argv[1]

def rel_pub(p):
    return os.path.relpath(p, PUB)

# ── 1. dosya listeleri ──
html = []
pub_text = []
for dp, dn, fn in os.walk(PUB):
    for f in fn:
        full = os.path.join(dp, f)
        r = rel_pub(full)
        if f.endswith('.html'):
            html.append(r)
        if f.endswith(('.html', '.js', '.css')):
            pub_text.append(r)
html.sort(); pub_text.sort()
HTML = set(html)

def read(p):
    with open(p, encoding='utf-8', errors='replace') as fh:
        return fh.read()

# ── 2. script yükleme haritası (HTML → yerel JS, ES modül zinciri dahil) ──
SRC_RE = re.compile(r'<script[^>]*\bsrc=["\']([^"\']+)["\']', re.I)
IMP_RE = re.compile(r'''(?:import\s[^;]*?from\s*|import\s*\(\s*)["']([^"']+\.js)["']''')
def resolve(tok, src_dir):
    t = tok.split('?')[0].split('#')[0]
    absolute = False
    if '}' in t:
        t = t[t.rindex('}') + 1:]; absolute = True
    m = re.match(r'https?://[^/]+', t)
    if m:
        t = t[m.end():]; absolute = True
    if t.startswith('/') or absolute:
        return os.path.normpath(t.lstrip('/'))
    return os.path.normpath(os.path.join(src_dir, t))

js_loaded_by = collections.defaultdict(set)
page_js = collections.defaultdict(list)
def walk_js(page, js):
    if js in page_js[page] or not os.path.exists(os.path.join(PUB, js)):
        return
    page_js[page].append(js); js_loaded_by[js].add(page)
    txt = read(os.path.join(PUB, js))
    for m in IMP_RE.finditer(txt):
        walk_js(page, resolve(m.group(1), os.path.dirname(js)))
for h in html:
    txt = read(os.path.join(PUB, h))
    d = os.path.dirname(h)
    for m in SRC_RE.finditer(txt):
        if m.group(1).startswith(('http://', 'https://', '//')):
            continue
        walk_js(h, resolve(m.group(1), d))
    for m in IMP_RE.finditer(txt):
        walk_js(h, resolve(m.group(1), d))

# ── 3. referans çıkarımı ──
TOK_RE = re.compile(r'[A-Za-z0-9_./${}:-]*\.html')
def is_comment(line, pos):
    s = line.lstrip()
    if s.startswith(('//', '*', '/*', '<!--', '#', '--')):
        return True
    i = line.find('//')
    while i != -1 and i < pos:
        if i == 0 or line[i - 1] != ':':
            return True
        i = line.find('//', i + 2)
    return False

def nav_spans(txt):
    spans = []
    for m in re.finditer(r'<(nav|aside)\b([^>]*)>', txt, re.I):
        tag = m.group(1).lower()
        end = txt.lower().find('</%s>' % tag, m.end())
        if end == -1:
            end = len(txt)
        cls = re.search(r'class=["\']([^"\']*)', m.group(2))
        spans.append((m.start(), end, (cls.group(1) if cls else tag)))
    return spans

BLOCK_RE = re.compile(r'(?<![\'"*])/\*.*?\*/|<!--.*?-->', re.S)
refs = collections.defaultdict(list)   # target -> [(src, line, kind, comment)]
def scan_text(src_label, txt, src_dirs, kind_fn):
    lines = txt.split('\n')
    offs = []; o = 0
    for ln in lines:
        offs.append(o); o += len(ln) + 1
    import bisect
    blocks = [(b.start(), b.end()) for b in BLOCK_RE.finditer(txt)]
    for m in TOK_RE.finditer(txt):
        tok = m.group(0)
        li = bisect.bisect_right(offs, m.start()) - 1
        line = lines[li]; col = m.start() - offs[li]
        com = is_comment(line, col) or any(a <= m.start() < b for a, b in blocks)
        for sd in src_dirs:
            tgt = resolve(tok, sd)
            if tgt in HTML:
                refs[tgt].append((src_label, li + 1, kind_fn(m.start()), com, tok))

for p in pub_text:
    txt = read(os.path.join(PUB, p))
    if p.endswith('.html'):
        spans = nav_spans(txt)
        def kf(pos, spans=spans):
            for a, b, c in spans:
                if a <= pos <= b:
                    return 'nav:' + c
            return 'body'
        scan_text('public/' + p, txt, [os.path.dirname(p)], kf)
    elif p.endswith('.js'):
        loaders = js_loaded_by.get(p)
        if loaders:
            dirs = sorted({os.path.dirname(x) for x in loaders})
            kind = 'shell-nav' if p == 'ui2/shell.js' else 'js(loaded)'
            scan_text('public/' + p, txt, dirs, lambda pos, k=kind: k)
        else:
            scan_text('public/' + p, txt, [os.path.dirname(p)], lambda pos: 'js(unloaded)')

# backend (public/node_modules dışı)
LIVE_PREFIX = ('routes/', 'utils/', 'middleware/', 'config/', 'services/')
LIVE_FILES = ('index.js', 'email_worker.js')
for dp, dn, fn in os.walk(BE):
    dn[:] = [d for d in dn if d not in ('node_modules', 'public', '.git')]
    for f in fn:
        if not f.endswith(('.js', '.sql', '.json', '.sh', '.bak')):
            continue
        full = os.path.join(dp, f)
        r = os.path.relpath(full, BE)
        if r.startswith('tests/'):
            kind = 'test'
        elif r.endswith('.sql'):
            kind = 'sql'
        elif r.startswith(LIVE_PREFIX) and r.endswith('.js') or r in LIVE_FILES:
            kind = 'backend'
        else:
            kind = 'backend-misc'
        scan_text('backend/' + r, read(full), [''], lambda pos, k=kind: k)

# ── 4. API uçları (sayfa + yüklediği sayfa-özel JS) ──
INFRA_JS = {'leena-fetch.js', 'leena-toast.js', 'ui2/shell.js'}
LIT_RE = re.compile(r'''["'`](?:https?://[^/"'`\s]+)?(/api/[^"'`\s]*)''')
CONCAT_RE = re.compile(r'''["'`](?:https?://[^/"'`\s]+)?(/api/[^"'`\s?]*/)["'`]\s*\+\s*[^;"'`]{1,80}?\+\s*["'`](/[^"'`\s?]*)''')
HELPER_RE = re.compile(r'(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>')
VAR_RE = re.compile(r'''(?:const|let|var)\s+(\w+)\s*=\s*["'`]([^"'`]*)["'`]''')
def norm_ep(p):
    p = re.sub(r'\$\{[^}]*\}', ':p', p)
    p = re.sub(r'\$\{.*$', '', p)
    p = re.sub(r'(?<=[^/]):p', '', p)
    p = p.split('?')[0].split('#')[0]
    p = re.sub(r'(:p)+', ':p', p)
    if p.endswith('/') and len(p) > 1:
        p = p + ':p'
    p = re.sub(r'/+', '/', p)
    return p
def endpoints(txt):
    eps = set()
    lit_n = collections.Counter(m.group(1) for m in LIT_RE.finditer(txt))
    cat_n = collections.Counter()
    # '/api/x/' + expr + '/sub' birleştirmesi: taban yalnız hep birleştirmeyle kullanılıyorsa düşer
    for m in CONCAT_RE.finditer(txt):
        cat_n[m.group(1)] += 1
        eps.add(norm_ep(m.group(1) + '${p}' + m.group(2)))
    for lit, n in lit_n.items():
        if cat_n.get(lit, 0) < n:
            eps.add(norm_ep(lit))
    # yardımcı fonksiyonlar: function NAME(path…){ … `${BASE}${path}` | `/api/x${path}` … } → NAME('/y') çağrıları
    bases = {}
    for m in VAR_RE.finditer(txt):
        v = re.sub(r'^https?://[^/]+', '', m.group(2))
        if v.startswith('/api') or (m.group(2) == '' and m.group(1).upper().startswith('API')):
            bases[m.group(1)] = v
    for m in HELPER_RE.finditer(txt):
        name = m.group(1) or m.group(3)
        params = [x.split('=')[0].strip() for x in (m.group(2) if m.group(1) else m.group(4)).split(',') if x.strip()]
        body = txt[m.end():m.end() + 600]
        base = None
        for param in params:
            if not re.match(r'^\w+$', param):
                continue
            bm = re.search(r'`(/api[^`$]*)\$\{%s\}' % param, body)
            if bm:
                base = bm.group(1); break
            for var, val in bases.items():
                if re.search(r'\$\{%s\}\$\{%s\}|\b%s\s*\+\s*%s\b' % (var, param, var, param), body):
                    base = val
            if base is not None:
                break
        if base is None:
            continue
        for c in re.finditer(r'''\b%s\(\s*(?:["'`][A-Z]+["'`]\s*,\s*)?["'`](/[^"'`]*)''' % name, txt):
            eps.add(norm_ep(base + c.group(1)))
    for m in VAR_RE.finditer(txt):
        var, val = m.group(1), m.group(2)
        base = re.sub(r'^https?://[^/]+', '', val)
        if not (base.startswith('/api') or (val == '' and var.upper().startswith('API'))):
            continue
        pat = re.compile(r'''\$\{%s\}([^"'`\s]*)|\b%s\s*\+\s*["'`]([^"'`]*)["'`]''' % (var, var))
        for u in pat.finditer(txt):
            path = u.group(1) if u.group(1) is not None else u.group(2)
            full = base + path
            if full.startswith('/api'):
                eps.add(norm_ep(full))
    eps = {e for e in eps if '=' not in e and e != '/api'}
    return eps

# ── 5. gömülü fuar numarası / adı ──
ID_PATS = [
    r'expo(?:_id|Id|ID)?\)?\s*(?:===?|!==?)\s*["\']?\d+',
    r'EXPO_ID\s*=\s*["\']?\d+',
    r'[?&]expo(?:_id|Id)?=\d+',
    r'/expos/\d+',
    r'[eE]xpo\w*\)?\s*(?:\|\||\?\?)\s*["\']?\d+',
    r'form(?:_id|Id)?\)?\s*(?:===?|!==?)\s*["\']?\d+',
    r'\[\s*\d+\s*(?:,\s*\d+\s*)+\]\.includes\([^)]*expo',
]
ID_RE = re.compile('|'.join('(?:%s)' % p for p in ID_PATS))
NAME_RE = re.compile(r'SIEMA|Mega Clima|Madesign|MADESIGN|Horeca|Food Factory|Mega Project|Kenya|Nigeria|Casablanca|Lagos|Nairobi|MP26', re.I)
def embedded(page, files):
    ids, names = [], []
    for f in files:
        lines = read(os.path.join(PUB, f)).split('\n')
        in_block = False
        for i, ln in enumerate(lines, 1):
            s = ln.strip()
            if '/*' in s and '*/' not in s:
                in_block = True
            if in_block:
                if '*/' in s:
                    in_block = False
                continue
            for m in ID_RE.finditer(ln):
                if not is_comment(ln, m.start()):
                    ids.append('%s:%d `%s`' % (f, i, m.group(0).strip()))
            for m in NAME_RE.finditer(ln):
                if not is_comment(ln, m.start()):
                    names.append('%s:%d' % (f, i))
    return ids, names

# ── 6. git izi ──
def git(*a):
    return subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, text=True).stdout
result = []
for h in html:
    path = 'backend/leena-v401-backend/public/' + h
    log = [l for l in git('log', '--format=%cs|%h|%s', '--', path).split('\n') if l]
    files = [h] + [j for j in page_js.get(h, []) if j not in INFRA_JS]
    eps = set()
    for f in files:
        eps |= endpoints(read(os.path.join(PUB, f)))
    ids, names = embedded(h, files)
    result.append({
        'file': h,
        'loc': read(os.path.join(PUB, h)).count('\n'),
        'last': log[0] if log else None,
        'first': log[-1] if log else None,
        'ncommits': len(log),
        'js': page_js.get(h, []),
        'refs': [r for r in refs.get(h, []) if r[0] != 'public/' + h],
        'self_refs': len([r for r in refs.get(h, []) if r[0] == 'public/' + h]),
        'eps': sorted(eps),
        'emb_ids': ids,
        'emb_names': names,
        'localhost': [f + ':' + str(i) for f in files for i, ln in enumerate(read(os.path.join(PUB, f)).split('\n'), 1) if 'localhost:3000' in ln and not is_comment(ln, ln.find('localhost'))],
    })
# ── 7. erişilebilirlik: kök → link zinciri (yorum hariç; test/backend-misc kenar değil) ──
edges = collections.defaultdict(set)
for tgt, rl in refs.items():
    for src, ln, kind, com, tok in rl:
        if com:
            continue
        sp = src[len('public/'):] if src.startswith('public/') else None
        if sp is None:
            continue
        if sp.endswith('.html'):
            if sp != tgt:
                edges[sp].add(tgt)
        else:
            for L in js_loaded_by.get(sp, ()):
                if resolve(tok, os.path.dirname(L)) == tgt and L != tgt:
                    edges[L].add(tgt)
def reach(roots):
    seen = set(roots); st = list(roots)
    while st:
        n = st.pop()
        for m in edges.get(n, ()):
            if m not in seen:
                seen.add(m); st.append(m)
    return seen
backend_roots = sorted({t for t, rl in refs.items() for r in rl if r[2] == 'backend' and not r[3]})
R = {'L': reach(['login.html']), 'B': reach(backend_roots), 'U': reach(['ui2/index.html'])}
for r in result:
    r['reach'] = ''.join(k for k in 'LBU' if r['file'] in R[k])
    r['out_edges'] = sorted(edges.get(r['file'], ()))
with open(OUT, 'w') as fh:
    json.dump({'html': html, 'js_loaded_by': {k: sorted(v) for k, v in js_loaded_by.items()},
               'pages': result, 'backend_roots': backend_roots}, fh, indent=1, ensure_ascii=False)
print(len(html), 'pages;', sum(len(r['refs']) for r in result), 'inbound refs')
```
</details>

<details><summary>report.py</summary>

```python
#!/usr/bin/env python3
"""scan.json → tablo blokları (markdown). Elle sınıflama sözlükleri burada, kanıtlarıyla."""
import json, sys, collections

d = json.load(open(sys.argv[1]))
P = {p['file']: p for p in d['pages']}
CUT = '2026-07-24'   # 90 gün sınırı (2026-10-22 − 90 g)

DOMAIN = {}
for f in ['login.html', 'login_new.html', 'register.html', 'register.backup.html', 'ui2/login.html', 'ui2/whoami.html']:
    DOMAIN[f] = 'auth'
DOMAIN['admin-dashboard.html'] = 'admin'
for f in ['agent-statement.html', 'cash-forecast.html', 'commissions.html', 'contract-detail.html',
          'contract-list.html', 'offices.html', 'sales-agents.html']:
    DOMAIN[f] = 'finance'
for f in P:
    if f.startswith('ui2/finance-'):
        DOMAIN[f] = 'finance'
for f in ['expo-list.html', 'expo-form.html', 'expo-clusters.html', 'expo-partners.html']:
    DOMAIN[f] = 'ops'
for f in ['ui2/index.html', 'ui2/sales.html', 'ui2/operations.html']:
    DOMAIN[f] = 'ui2 kabuk'
for f in P:
    DOMAIN.setdefault(f, 'EMS')

FAIR = {
    'form-public.html': 'ziyaretçi · public · backend URL',
    'badge-print.html': 'ziyaretçi · `?qr=` (:148) · mail badge linki',
    'badge.html': 'terminal/hostes · `terminal_key` (:179)',
    'bulk-badge-print.html': 'terminal `bulk_print` · `?key=` (:125)',
    'qrscanner.html': 'terminal/hostes · `terminalKey` (:708)',
    'conference-scanner.html': 'hostes · `terminal_key` (:256)',
    'certificate.html': 'ziyaretçi · `?token=` (:504)',
    'certificate-ng.html': 'ziyaretçi · sertifika (expo 7)',
    'certificate-mp26.html': 'ziyaretçi · sertifika (expo 13)',
    'certificate-siema.html': 'ziyaretçi · sertifika (expo 9)',
    'certificate-ke.html': 'ziyaretçi · sertifika (expo 10)',
    'reactivate.html': 'ziyaretçi · `?token=` (:450)',
    'reactivate-fr.html': 'ziyaretçi · `?token=` (FR)',
    'lead-scan.html': 'exhibitor · badge QR girişi (`/leads/auth` :244)',
    'hostess-guide.html': 'hostes · statik rehber',
    'callcenter/agent.html': 'callcenter ajanı · `x-callcenter-key` (:664)',
    'callcenter/supervisor.html': 'callcenter süpervizör · `x-callcenter-supervisor-key` (:393)',
    'callcenter/admin.html': 'callcenter admin · JWT (:412) + süpervizör anahtarı (:469)',
}
# Kod linki olmayan sayfalar için belge izi (git'teki belge; canlı log değil)
DOC = {
    'bulk-badge-print.html': 'docs/sessions/TERMINAL_CHECK_20260819.md:192 · docs/CLAUDE_ARCHIVE.md:404 · middleware/dualAuth.js:44 (`bulk_print` yolu)',
    'conference-scanner.html': 'CLAUDE.md:554 · CLAUDE.md:985 (G22: Copy URL bu sayfayı üretmez)',
    'lead-scan.html': 'CLAUDE.md:497 (akış I)',
    'hostess-guide.html': 'docs/CLAUDE_ARCHIVE.md:322-325',
    'callcenter/agent.html': 'docs/sessions/DEPLOY_CALLCENTER_20260907.md:19 · mount index.js:170',
    'callcenter/supervisor.html': 'docs/sessions/DEPLOY_CALLCENTER_20260907.md:20 · mount index.js:170',
    'callcenter/admin.html': 'docs/sessions/DEPLOY_CALLCENTER_20260907.md:21 · mount index.js:170',
}

TWIN = {
    'contract-list.html': 'kısmi: ui2/finance-contracts.html (yalnız GET liste; `/status` yok)',
    'contract-detail.html': 'kısmi: ui2/finance-contract.html (GET sözleşme+ödemeler; ödeme/iade/plan/transfer/atama yok)',
    'login.html': 'kısmi: ui2/login.html (users · `/api/user-auth`; organizer kaydı yok)',
    'ui2/finance-contracts.html': '(ui2) eski: contract-list.html — kısmi',
    'ui2/finance-contract.html': '(ui2) eski: contract-detail.html — kısmi',
    'ui2/login.html': '(ui2) eski: login.html — kısmi',
}
for f in P:
    if f.startswith('ui2/') and f not in TWIN:
        TWIN[f] = '(ui2) kabuk' if DOMAIN[f] == 'ui2 kabuk' else '(ui2) eski karşılık yok'
    TWIN.setdefault(f, 'yok')

EMB = {
    'certificate.html': '**EVET-id**: :523/:529/:535/:541 `expo_id === 7/13/9/10` → ayrı sayfa; varsayılan "Mega Clima Ghana 2026" :402/:550',
    'lead-scan.html': '**EVET-id**: :185 `EXPO_ID = 3` → API :247/:329/:380',
    'certificate-ng.html': 'içerik: tek fuar (Mega Clima Nigeria 2026, :6)',
    'certificate-mp26.html': 'içerik: tek fuar (Mega Project Nigeria 2026, :6)',
    'certificate-siema.html': 'içerik: tek fuar (Food Factory Africa Forum 2026, :6)',
    'certificate-ke.html': 'içerik: tek fuar (Mega Clima Kenya 2026, :6)',
    'hostess-guide.html': 'içerik: Mega Clima Nigeria 2026 (:8)',
    'callcenter/agent.html': 'içerik: SIEMA varsayılan metinleri (:179, :277, :329); `?expo=` ile değişir (:552)',
    'callcenter/supervisor.html': 'içerik: SIEMA başlığı (:114)',
    'callcenter/admin.html': 'içerik: SIEMA markası (:143)',
    'conference-cleanup.html': 'içerik: :138 "Mega Clima Nigeria 2026 sonrası kaldırılacak" bandı',
    'qrscanner.html': 'yerel: :927 ülke varsayılanı `Nigeria`',
    'main-panel-v2.html': 'yerel: :1253 "Africa/Lagos" etiketi',
    'email-segments.html': 'yerel: :163 "Lagos time" etiketi',
}

LIVE_ROOTS = set(f for f, p in P.items() if p['reach'])
def short(src):
    if src.startswith('backend/'):
        return src[len('backend/'):]
    return src[len('public/'):] if src.startswith('public/') else src

def page_rows():
    rows = []
    # API mount → sayfa sayısı (özel API tespiti)
    mount_pages = collections.defaultdict(set)
    for f, p in P.items():
        for e in p['eps']:
            parts = e.split('/')
            if len(parts) > 2:
                mount_pages[parts[2]].add(f)
    for i, f in enumerate(sorted(P), 1):
        p = P[f]
        live = [r for r in p['refs'] if not r[3]]
        nav_src = sorted({short(r[0]) for r in live if r[2].startswith('nav')
                          and short(r[0]) in LIVE_ROOTS})
        nav_dead = sorted({short(r[0]) for r in live if r[2].startswith('nav')
                           and short(r[0]) not in LIVE_ROOTS})
        # shell.js nav tanımı :17-19 (üst nav) ve :30-35 (subnav); diğer satırlar (:76 auth yönlendirmesi) menü değil
        shell = [r for r in live if r[2] == 'shell-nav' and r[1] <= 40]
        menu = []
        if nav_src:
            menu.append('sidebar ×%d (örn. %s)' % (len(nav_src), nav_src[0] if len(nav_src) == 1 else
                        ('main-panel-v2.html' if 'main-panel-v2.html' in nav_src else nav_src[0])))
        if shell:
            kinds = sorted({'üst nav' if r[1] <= 20 else 'subnav' for r in shell}, reverse=True)
            menu.append('ui2 shell %s (shell.js:%s)' % ('+'.join(kinds), ','.join(str(r[1]) for r in shell)))
        if nav_dead and not nav_src:
            menu.append('yalnız ölü-aday sayfa sidebar\'ı ×%d' % len(nav_dead))
        menu_s = '; '.join(menu) or '—'
        be = collections.defaultdict(list)
        body = collections.defaultdict(list)
        for s, l, k, c, t in live:
            if k == 'backend':
                be[short(s)].append(l)
            elif k in ('body', 'js(loaded)') or (k == 'shell-nav' and l > 40):
                body[short(s)].append(l)
        link = []
        for s, ls in sorted(be.items()):
            link.append('backend %s:%s' % (s, '/'.join(map(str, sorted(set(ls))[:3]))))
        # yüklenen JS (leena-fetch.js, ui2/shell.js …) yalnız bir sayfa yüklediğinde sayıldı → canlı kaynak kabul
        lb = [(s, ls) for s, ls in sorted(body.items()) if s in LIVE_ROOTS or s.endswith('.js')]
        for s, ls in lb[:3]:
            link.append('%s:%d' % (s, sorted(ls)[0]))
        if len(lb) > 3:
            link.append('+%d sayfa' % (len(lb) - 3))
        db = [s for s in body if s not in LIVE_ROOTS and not s.endswith('.js')]
        if db and not lb:
            link.append('yalnız ölü-aday kaynak: ' + ', '.join(sorted(db)[:3]))
        if f in DOC:
            link.append('belge: ' + DOC[f])
        link_s = ' · '.join(link) or '—'
        date, h, subj = p['last'].split('|', 2)
        mounts = collections.Counter(e.split('/')[2] for e in p['eps'] if len(e.split('/')) > 2)
        api = ' '.join('%s(%d)' % (m, n) for m, n in sorted(mounts.items())) or '—'
        excl = sorted(m for m in mounts if mount_pages[m] == {f})
        if excl:
            api += ' · özel: ' + ','.join(excl)
        if p['localhost']:
            api += ' · ⚠ `localhost:3000` taban'
        reached = bool(p['reach'])
        has_be = bool(be)
        if reached or has_be:
            dead = 'hayır'
        elif f in FAIR:
            dead = 'İZSİZ-FUAR'
        elif date >= CUT:
            dead = 'İZSİZ-YENİ'
        else:
            dead = '**EVET**'
        rows.append(dict(i=i, f=f, dom=DOMAIN[f], fair=FAIR.get(f, '—'), menu=menu_s, link=link_s,
                         last='%s `%s` (%d commit)' % (date, h, p['ncommits']), twin=TWIN[f], api=api,
                         emb=EMB.get(f, 'hayır'), dead=dead, reach=p['reach'], subj=subj, eps=p['eps']))
    return rows

rows = page_rows()
mode = sys.argv[2] if len(sys.argv) > 2 else 'table'
if mode == 'table':
    print('| # | dosya | alan | fuar yüzeyi | menü izi | link/akış izi | son commit | ui2 ikizi | API uçları | fuar no gömülü | ölü aday |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        print('| %(i)d | `%(f)s` | %(dom)s | %(fair)s | %(menu)s | %(link)s | %(last)s | %(twin)s | %(api)s | %(emb)s | %(dead)s |' % r)
elif mode == 'stats':
    c = collections.Counter(r['dom'] for r in rows)
    print('toplam', len(rows), dict(c))
    print('ölü', collections.Counter(r['dead'] for r in rows))
    print('fuar', sum(1 for r in rows if r['fair'] != '—'))
    print('twin', collections.Counter(r['twin'].split(':')[0].split(' ')[0] for r in rows))
    print('emb', collections.Counter(r['emb'].split(':')[0] for r in rows))
    print('dir', collections.Counter(r['f'].split('/')[0] if '/' in r['f'] else 'kök' for r in rows))
    print('backup', sum(1 for r in rows if '.backup.' in r['f']))
    for r in rows:
        if r['dead'] != 'hayır':
            print(r['dead'], r['f'], r['last'], '|', r['subj'][:70])
elif mode == 'api':
    for r in rows:
        print('- `%s` (%d): %s' % (r['f'], len(r['eps']), ', '.join('`%s`' % e for e in r['eps']) or '—'))
```
</details>
