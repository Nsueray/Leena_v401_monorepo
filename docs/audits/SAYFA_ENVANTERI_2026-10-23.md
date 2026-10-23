# SAYFA ENVANTERİ — 2026-10-23, salt-okunur (UI-0b sonrası yeniden koşum)

- Görev: Sentez 23 Eki, PAKET UI-0b (f) — envanter betiğini yeniden koş. Önceki rapor KALIR:
  `docs/audits/SAYFA_ENVANTERI_2026-10-22.md` (`9e17f69`'dan bayt bayt aynı alındı, sha256 `1ddd7e1f094e5c5a…`).
- Ölçüm tabanı: `eliza-next` @ **`312bc2d`** (UI-0b inşa commit'i; `cb37f24` = canlı `main` + UI-0b). Ölçüm ayrı
  worktree'de (`git worktree add --detach <scratchpad>/wt-envanter 312bc2d`); ana çalışma kopyası okunmadı.
- Yöntem, tanımlar ve kanıt kuralı 22 Eki raporuyla AYNI (§1, §1.4). Betik farkı yalnız Ek E'deki dört uyarlama +
  satır atıflarının güncellenmesi. **Regresyon:** uyarlanmış betik 22 Eki tabanında (`613ce8e`) koşulunca 22 Eki ana
  tablosunu **satırı satırına aynı** üretti (81 sayfa · 752 referans · ölü aday 14 · ulaşılamaz 22; `diff` 0 satır).
- Kanıt kuralı (değişmedi): kullanım kanıtı yalnız **kod + git izi**; canlı log/analytics/DB okunmadı. Yazılan hüküm
  "kod izinde kullanıcı yok"tur, "kimse kullanmıyor" değil.

---

## 0. ÖZET (sayılar) — 22 Eki → 23 Eki

| ölçü | 2026-10-22 (`613ce8e`) | 2026-10-23 (`312bc2d`) |
|---|---|---|
| toplam HTML (public/ altı) | 81 — kök 61 · `ui2/` 16 · `callcenter/` 3 · `email_templates/` 1 (7'si `*.backup.html`) | **79** — kök 51 · `ui2/` 25 · `callcenter/` 3 · `email_templates/` 0 (`*.backup.html` 0) |
| alan dağılımı | EMS 49 · finance 18 · auth 6 · ops 4 · ui2 kabuk 3 · admin 1 · sales 0 | **EMS 42 · finance 18** (eski 7 + ui2 11) · **auth 4 · ops 4 · ui2 kabuk 9 · admin 2 · sales 0** |
| ölü aday (4 koşul) | 14 | **3** — `checkin-import.html` (Suer istisnası, KALSIN) · `dashboard.html` · `main-panel.html` |
| İZSİZ-FUAR · İZSİZ-YENİ | 7 · 1 | **7 · 1** (`expo-create.html`) — liste aynı |
| hiçbir kökten ulaşılamayan | 22 | **11** (= 3 + 7 + 1) |
| fuar yüzeyi | 18 (7'si kod linksiz) | **18** (7'si kod linksiz) — değişmedi |
| fuar no gömülü | id 2 · içerik 9 · yerel 3 | **id 2 · içerik 9 · yerel 3** — değişmedi (KAPSAM DIŞI, v402 / Paket 3 sonrası) |
| ui2 ikizi | var 0 · kısmi 3 · yok 62 · ui2 16 | **var 0 · kısmi 3 · yok 51 · ui2 25** |
| eski arayüzden ui2'ye kod içi link | 0 (ui2 adası) | **1** — `main-panel-v2.html:968` "ELIZA Finance (new)" → `/ui2/` (UI-0b KAPI-1) |
| ui2'den eski arayüze | `/login.html` yönlendirmeleri | + **2 köprü** (nav.json `legacy=true`: `commissions.html` `:22`, `sales-agents.html` `:23`) |
| referans eşleşmesi (yorum) | 752 (77) | **769 (77)**; bunun 29'u ui2 `nav.json` |

**Erişilebilirlik:** `login.html` kökünden (L) ui2'nin **25/25** sayfasına ulaşılıyor (main-panel-v2 → `/ui2/` →
`ui2/index.html` → `shell.js` → `nav.json`); ui2 kökünden (U) köprüler üzerinden **37** eski sayfaya ulaşılıyor.

## 0.1 22 Eki → 23 Eki farkı (ne değişti, neden)

- **Silinen 11 sayfa** (UI-0b (a), Sentez SİL listesi; silme öncesi ve commit anında backend + public'te sınır duyarlı ad
  araması 0): `admin-dashboard.html` · `login_new.html` · `register.html` · `email_templates/modern-default.html` ·
  `checkins.backup.html` · `dashboard.backup.html` · `expo-create.backup.html` · `main-panel.backup.html` ·
  `qrscanner.backup.html` · `register.backup.html` · `reports.backup.html`.
- **SİL listesinde olup KALAN 2** (ad araması 0 değil → kural gereği silinmedi): `dashboard.html` (`js/common.js:126`,
  `:488`, `:496` + `expo-create.html:333`, `:402` + `main-panel.html:93`, `:145`) · `main-panel.html` (`js/common.js:452`
  + `expo-create.html:326`, `:327`). `public/js/common.js`'i yükleyen dosya **0** (`common.js` adı backend + public'te
  geçmiyor) — bu betik yüklenmeyen JS'in linklerini saymaz (22 Eki §1.2), bu yüzden tabloda görünmez; bağ ad aramasıyla
  bulundu. `common.js` silinirse ikisi de ad araması 0'a iner (Sentez kararı).
- **ŞARTLI `expo-create.html` → KALSIN:** `dashboard_new.html`'deki Create Expo modal'ı aynı uca (`POST /api/expos`)
  `name · location · country_code · start_date · end_date` gönderir (`dashboard_new.html:797-809`, country `8907612`);
  `expo-create.html` ayrıca **`description` + `logo_url`** gönderir (`:296-297`) — backend ikisini de yazar
  (`routes/expos.js:255` INSERT, `:274` değerler) ve başka hiçbir ekran (`expo-form.html` dahil) bu iki alanı girmez.
  Ek farklar: `location` burada zorunlu (`:362`), modalda değil · başarıda yeni fuarı seçip `main-panel.html`'e gider
  (`:321-327`), modal listeyi tazeler. Ayrıca kalan `dashboard.html:233-234` ona link verir (ad araması 0 değil).
- **`checkin-import.html` KALSIN** (Suer istisnası) — ölçüm değişmedi: gelen link 0, özel API `/api/import-checkins`.
- **ui2 +9 sayfa:** Paket 2 (`admin-users`, `admin-user`, `invite`) + UI-0 (`placeholder`, `_sablon/` × 5). ui2 menüsü
  `shell.js`'ten `nav.json`'a taşındı (UI-02) — betik uyarlandı (Ek E).
- **KAPI-1:** `main-panel-v2.html` yalnız 1 satır eklendi (`:968`); satır çıkarılınca dosya `cb37f24` ile bayt bayt aynı.
  Bu, 22 Eki'deki "ui2 adası" bulgusunu (A4) kapatır.

---

## 1. YÖNTEM

22 Eki raporu §1 AYNEN geçerli (dosya listesi · referans çıkarımı · kökler L/B/U · tanımlar). Bu koşumdaki farklar:

- Kök dizin parametreli (`ENV_ROOT`); 90 gün sınırı **2026-07-25** (2026-10-23 − 90 g).
- `<base href="/x/">` taşıyan sayfada bağlantı ve betikler o dizine göre çözülür (UI-0 `_sablon/` sayfaları
  `<base href="/ui2/">` kullanır; eski betik onları `ui2/_sablon/`'a göre çözerdi).
- Dizin isteği bağlantısı (`"/ui2/"` → `ui2/index.html`, express.static index) referans sayılır; `<base href>` satırı
  bağlantı değildir, sayılmaz.
- ui2 menüsü: `public/ui2/nav.json` (UI-02 tek kaynak). Her `path` bir referanstır (tür: üst sekme · alt menü · alt sayfa ·
  kabuk · klasik köprü); kenarları `shell.js`'i yükleyen her sayfadan çıkar, yollar `/ui2/`'ye göre çözülür.
- `report.py`: alan sözlüğüne yeni ui2 sayfaları; satır atıfları güncellendi (`CLAUDE.md:498`, `:555`, `:988` ·
  `main-panel-v2.html:1254`); menü sütununa `nav.json` türleri.

Çalıştırma: `ENV_ROOT=<worktree> python3 -I scan.py scan.json && python3 -I report.py scan.json table|stats|api`.

---

## 2. ANA TABLO

| # | dosya | alan | fuar yüzeyi | menü izi | link/akış izi | son commit | ui2 ikizi | API uçları | fuar no gömülü | ölü aday |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `agent-statement.html` | finance | — | — | sales-agents.html:232 | 2026-10-21 `c15ac1f` (5 commit) | yok | agents(2) ledger(2) offices(1) sales-agents(1) · özel: agents | hayır | hayır |
| 2 | `badge-print.html` | EMS | ziyaretçi · `?qr=` (:148) · mail badge linki | — | backend email_worker.js:247 · backend routes/emailSend.js:58/187 · backend routes/visitors.js:402/891 · backend utils/qrcode.js:64 | 2026-09-10 `2eee318` (8 commit) | yok | visitors(1) | hayır | hayır |
| 3 | `badge-templates.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-05-08 `5f39aec` (18 commit) | yok | badge-templates(2) expos(1) qr-image(1) visitors(2) | hayır | hayır |
| 4 | `badge.html` | EMS | terminal/hostes · `terminal_key` (:179) | — | badge-templates.html:754 · qrscanner.html:762 · visitorlog-paginated.html:457 | 2026-05-15 `d9908d9` (11 commit) | yok | badge-templates(2) terminal(2) visitors(1) | hayır | hayır |
| 5 | `bulk-badge-print.html` | EMS | terminal `bulk_print` · `?key=` (:125) | — | belge: docs/sessions/TERMINAL_CHECK_20260819.md:192 · docs/CLAUDE_ARCHIVE.md:404 · middleware/dualAuth.js:44 (`bulk_print` yolu) | 2026-05-18 `5a66070` (1 commit) | yok | badge-templates(1) qr-image(1) visitors(2) | hayır | İZSİZ-FUAR |
| 6 | `callcenter/admin.html` | EMS | callcenter admin · JWT (:412) + süpervizör anahtarı (:469) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:21 · mount index.js:170 | 2026-09-28 `8895919` (5 commit) | yok | callcenter(5) | içerik: SIEMA markası (:143) | İZSİZ-FUAR |
| 7 | `callcenter/agent.html` | EMS | callcenter ajanı · `x-callcenter-key` (:664) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:19 · mount index.js:170 | 2026-09-19 `708a531` (9 commit) | yok | callcenter(6) | içerik: SIEMA varsayılan metinleri (:179, :277, :329); `?expo=` ile değişir (:552) | İZSİZ-FUAR |
| 8 | `callcenter/supervisor.html` | EMS | callcenter süpervizör · `x-callcenter-supervisor-key` (:393) | — | belge: docs/sessions/DEPLOY_CALLCENTER_20260907.md:20 · mount index.js:170 | 2026-09-19 `5496c3a` (5 commit) | yok | callcenter(2) | içerik: SIEMA başlığı (:114) | İZSİZ-FUAR |
| 9 | `cash-forecast.html` | finance | — | sidebar ×2 (örn. main-panel-v2.html) | — | 2026-08-03 `e83b805` (5 commit) | yok | cash-forecast(1) · özel: cash-forecast | hayır | hayır |
| 10 | `certificate-ke.html` | EMS | ziyaretçi · sertifika (expo 10) | — | certificate.html:542 | 2026-10-12 `48c12e1` (1 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Clima Kenya 2026, :6) | hayır |
| 11 | `certificate-mp26.html` | EMS | ziyaretçi · sertifika (expo 13) | — | certificate.html:530 | 2026-08-24 `668fd5c` (2 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Project Nigeria 2026, :6) | hayır |
| 12 | `certificate-ng.html` | EMS | ziyaretçi · sertifika (expo 7) | — | certificate.html:524 | 2026-05-18 `9a20641` (1 commit) | yok | conference-certificates(1) | içerik: tek fuar (Mega Clima Nigeria 2026, :6) | hayır |
| 13 | `certificate-siema.html` | EMS | ziyaretçi · sertifika (expo 9) | — | certificate.html:536 | 2026-09-26 `c55aed3` (3 commit) | yok | conference-certificates(1) | içerik: tek fuar (Food Factory Africa Forum 2026, :6) | hayır |
| 14 | `certificate.html` | EMS | ziyaretçi · `?token=` (:504) | — | backend routes/conferenceCertificates.js:499/673/801 | 2026-10-12 `48c12e1` (7 commit) | yok | conference-certificates(1) | **EVET-id**: :523/:529/:535/:541 `expo_id === 7/13/9/10` → ayrı sayfa; varsayılan "Mega Clima Ghana 2026" :402/:550 | hayır |
| 15 | `checkin-import.html` | EMS | — | — | — | 2026-05-08 `5f39aec` (10 commit) | yok | import-checkins(1) · özel: import-checkins | hayır | **EVET** |
| 16 | `checkin-reports.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-05-22 `16adf0c` (17 commit) | yok | checkins(1) visitors(1) | hayır | hayır |
| 17 | `checkins.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1459 | 2026-04-27 `1b22cde` (21 commit) | yok | checkins(2) | hayır | hayır |
| 18 | `commissions.html` | finance | — | sidebar ×4 (örn. main-panel-v2.html); ui2 nav.json klasik köprü (legacy=true) :22 | — | 2026-07-25 `f28e6a6` (1 commit) | yok | commissions(1) · özel: commissions | hayır | hayır |
| 19 | `conference-cleanup.html` | EMS | — | — | conference-sessions.html:127 | 2026-05-12 `aa7012f` (1 commit) | yok | conference-cleanup(6) · özel: conference-cleanup | içerik: :138 "Mega Clima Nigeria 2026 sonrası kaldırılacak" bandı | hayır |
| 20 | `conference-scanner.html` | EMS | hostes · `terminal_key` (:256) | — | belge: CLAUDE.md:555 · CLAUDE.md:988 (G22: Copy URL bu sayfayı üretmez) | 2026-09-18 `954dd8e` (11 commit) | yok | conference-certificates(4) terminal(3) | hayır | İZSİZ-FUAR |
| 21 | `conference-sessions.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-cleanup.html:135 | 2026-05-12 `aa7012f` (7 commit) | yok | visitors(2) | hayır | hayır |
| 22 | `contract-detail.html` | finance | — | — | cash-forecast.html:268 · commissions.html:227 · contract-list.html:221 | 2026-10-21 `c15ac1f` (14 commit) | kısmi: ui2/finance-contract.html (GET sözleşme+ödemeler; ödeme/iade/plan/transfer/atama yok) | contracts(8) expos(1) ledger(2) offices(1) sales-agents(1) | hayır | hayır |
| 23 | `contract-list.html` | finance | — | sidebar ×7 (örn. main-panel-v2.html) | contract-detail.html:125 | 2026-07-28 `e289c7d` (6 commit) | kısmi: ui2/finance-contracts.html (yalnız GET liste; `/status` yok) | contracts(2) | hayır | hayır |
| 24 | `dashboard.html` | EMS | — | — | yalnız ölü-aday kaynak: expo-create.html, main-panel.html | 2026-02-24 `b486d7c` (7 commit) | yok | expos(1) | hayır | **EVET** |
| 25 | `dashboard_new.html` | EMS | — | sidebar ×30 (örn. main-panel-v2.html) | checkin-reports.html:359 · checkins.html:223 · conference-sessions.html:188 · +12 sayfa | 2026-09-28 `0c11e63` (19 commit) | yok | expos(1) reference(1) | hayır | hayır |
| 26 | `email-campaigns.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | email-history.html:151 · reactivation-campaign.html:440 | 2026-09-03 `f6e7f44` (10 commit) | yok | campaigns(13) email-templates(1) expos(1) | hayır | hayır |
| 27 | `email-history.html` | EMS | — | — | email-segments.html:326 · email-send.html:132 | 2026-04-27 `1b22cde` (6 commit) | yok | email-send(1) email-templates(1) | hayır | hayır |
| 28 | `email-segments.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-08-28 `d1cebcf` (17 commit) | yok | email-segments(2) email-templates(1) · özel: email-segments | yerel: :163 "Lagos time" etiketi | hayır |
| 29 | `email-send.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-sessions.html:244 · email-history.html:150 | 2026-05-08 `5f39aec` (18 commit) | yok | email-send(1) email-templates(1) expos(1) visitors(1) | hayır | hayır |
| 30 | `email-templates.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | email-send.html:133 · main-panel-v2.html:1461 | 2026-05-08 `5f39aec` (20 commit) | yok | email-templates(4) | hayır | hayır |
| 31 | `expo-clusters.html` | ops | — | sidebar ×2 (örn. expo-list.html) | expo-form.html:198 | 2026-06-18 `335dacd` (1 commit) | yok | clusters(2) | hayır | hayır |
| 32 | `expo-create.html` | EMS | — | — | yalnız ölü-aday kaynak: dashboard.html | 2026-09-09 `8907612` (7 commit) | yok | expos(1) reference(1) | hayır | İZSİZ-YENİ |
| 33 | `expo-form.html` | ops | — | — | dashboard_new.html:773 · expo-list.html:276 · expo-partners.html:133 | 2026-09-28 `0c11e63` (2 commit) | yok | clusters(2) expos(3) reference(2) | hayır | hayır |
| 34 | `expo-list.html` | ops | — | sidebar ×3 (örn. expo-clusters.html) | expo-form.html:88 · expo-partners.html:76 | 2026-06-18 `335dacd` (1 commit) | yok | expos(2) reference(1) | hayır | hayır |
| 35 | `expo-partners.html` | ops | — | — | expo-form.html:321 | 2026-06-18 `335dacd` (1 commit) | yok | expos(1) partners(2) · özel: partners | hayır | hayır |
| 36 | `floorplan-builder.html` | EMS | — | sidebar ×16 (örn. main-panel-v2.html) | — | 2026-04-27 `1b22cde` (19 commit) | yok | exhibitors(1) floorplan(12) · özel: exhibitors,floorplan | hayır | hayır |
| 37 | `form-builder.html` | EMS | — | yalnız ölü-aday sayfa sidebar'ı ×2 | form-list.html:176 · main-panel-v2.html:1190 | 2026-09-10 `1c2b353` (23 commit) | yok | expos(1) forms(3) templates(1) · özel: templates | hayır | hayır |
| 38 | `form-list.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | form-builder.html:774 · main-panel-v2.html:1392 | 2026-09-18 `b511cc7` (19 commit) | yok | expos(1) forms(4) webhook(1) | hayır | hayır |
| 39 | `form-public.html` | EMS | ziyaretçi · public · backend URL | — | backend utils/trackingPixel.js:196 · form-list.html:349 · main-panel-v2.html:1421 | 2026-09-19 `5abd9e3` (13 commit) | yok | forms(1) qr-image(1) visitors(1) | hayır | hayır |
| 40 | `hostess-guide.html` | EMS | hostes · statik rehber | — | belge: docs/CLAUDE_ARCHIVE.md:322-325 | 2026-05-15 `7e852ba` (1 commit) | yok | — | içerik: Mega Clima Nigeria 2026 (:8) | İZSİZ-FUAR |
| 41 | `import.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1463 | 2026-09-02 `9d868e3` (24 commit) | yok | email-templates(1) expos(1) visitors(2) | hayır | hayır |
| 42 | `lead-scan.html` | EMS | exhibitor · badge QR girişi (`/leads/auth` :244) | — | belge: CLAUDE.md:498 (akış I) | 2026-05-08 `5f39aec` (4 commit) | yok | leads(3) · özel: leads | **EVET-id**: :185 `EXPO_ID = 3` → API :247/:329/:380 | İZSİZ-FUAR |
| 43 | `login.html` | auth | — | — | agent-statement.html:149 · badge-templates.html:507 · cash-forecast.html:175 · +35 sayfa | 2026-02-24 `f3d5a95` (8 commit) | kısmi: ui2/login.html (users · `/api/user-auth`; organizer kaydı yok) | auth(2) · özel: auth | hayır | hayır |
| 44 | `main-panel-v2.html` | EMS | — | sidebar ×18 (örn. badge-templates.html) | badge-templates.html:175 · checkins.html:137 · conference-sessions.html:128 · +10 sayfa | 2026-10-23 `312bc2d` (32 commit) | yok | expos(1) forms(2) reports(2) webhook(1) | yerel: :1254 "Africa/Lagos" etiketi | hayır |
| 45 | `main-panel.html` | EMS | — | — | yalnız ölü-aday kaynak: expo-create.html | 2026-02-24 `b486d7c` (12 commit) | yok | expos(1) forms(2) reports(1) visitors(1) | hayır | **EVET** |
| 46 | `offices.html` | finance | — | sidebar ×1 (örn. main-panel-v2.html) | — | 2026-08-04 `3ebe8b5` (1 commit) | yok | offices(2) reference(1) | hayır | hayır |
| 47 | `qrscanner.html` | EMS | terminal/hostes · `terminalKey` (:708) | — | terminals.html:277 | 2026-09-20 `96c5a54` (26 commit) | yok | badge-templates(1) checkins(1) terminal(3) visitors(3) | yerel: :927 ülke varsayılanı `Nigeria` | hayır |
| 48 | `reactivate-fr.html` | EMS | ziyaretçi · `?token=` (FR) | — | backend routes/callcenter.js:937 · backend routes/campaignBuilder.js:1178 · backend routes/reactivation.js:67/998 · reactivation-campaign.html:444 | 2026-09-07 `a9a44fd` (2 commit) | yok | reactivation(3) | hayır | hayır |
| 49 | `reactivate.html` | EMS | ziyaretçi · `?token=` (:450) | — | backend routes/callcenter.js:937 · backend routes/campaignBuilder.js:1178 · backend routes/reactivation.js:67/998 · reactivation-campaign.html:444 | 2026-09-07 `a9a44fd` (7 commit) | yok | reactivation(3) | hayır | hayır |
| 50 | `reactivation-campaign.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | — | 2026-09-04 `3120810` (38 commit) | yok | campaigns(4) email-templates(1) expos(1) forms(2) reactivation(9) | hayır | hayır |
| 51 | `reports.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1462 | 2026-05-08 `5f39aec` (21 commit) | yok | reports(2) | hayır | hayır |
| 52 | `sales-agents.html` | finance | — | sidebar ×7 (örn. main-panel-v2.html); ui2 nav.json klasik köprü (legacy=true) :23 | — | 2026-10-21 `c15ac1f` (5 commit) | yok | ledger(1) offices(1) sales-agents(2) | hayır | hayır |
| 53 | `terminals.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | main-panel-v2.html:1460 | 2026-05-18 `1324296` (23 commit) | yok | badge-templates(1) terminals(5) · özel: terminals | hayır | hayır |
| 54 | `ui2/_sablon/detail.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :45 | ui2/_sablon/list.html:47 · ui2/_sablon/summary.html:44 | 2026-10-22 `1ad8456` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 55 | `ui2/_sablon/form.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :46 | — | 2026-10-22 `1ad8456` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 56 | `ui2/_sablon/index.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :43 | ui2/_sablon/detail.html:30 · ui2/_sablon/form.html:30 · ui2/_sablon/list.html:30 · +2 sayfa | 2026-10-22 `1ad8456` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 57 | `ui2/_sablon/list.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :44 | ui2/_sablon/detail.html:40 · ui2/_sablon/form.html:47 · ui2/_sablon/summary.html:36 | 2026-10-22 `1ad8456` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 58 | `ui2/_sablon/summary.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :47 | — | 2026-10-22 `1ad8456` (1 commit) | (ui2) kabuk | — | hayır | hayır |
| 59 | `ui2/admin-user.html` | admin | — | ui2 nav.json alt sayfa (ebeveyni etkin) :36 | ui2/admin-users.html:29 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | users(3) | hayır | hayır |
| 60 | `ui2/admin-users.html` | admin | — | ui2 nav.json alt menü :35 · üst sekme :8 | ui2/admin-user.html:112 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | users(3) | hayır | hayır |
| 61 | `ui2/finance-account.html` | finance | — | ui2 nav.json alt sayfa (ebeveyni etkin) :26 | ui2/finance-accounts.html:33 · ui2/finance-summary.html:43 · ui2/finance-supplier.html:57 | 2026-10-22 `1ad8456` (3 commit) | (ui2) eski karşılık yok | ledger(1) | hayır | hayır |
| 62 | `ui2/finance-accounts.html` | finance | — | ui2 nav.json alt menü :25 | ui2/finance-account.html:50 · ui2/finance-summary.html:34 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | ledger(5) offices(1) | hayır | hayır |
| 63 | `ui2/finance-budget.html` | finance | — | ui2 nav.json alt menü :33 | — | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | expos(1) ledger(3) | hayır | hayır |
| 64 | `ui2/finance-contract.html` | finance | — | ui2 nav.json alt sayfa (ebeveyni etkin) :21 | ui2/finance-contracts.html:30 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski: contract-detail.html — kısmi | contracts(2) | hayır | hayır |
| 65 | `ui2/finance-contracts.html` | finance | — | ui2 nav.json alt menü :20 | ui2/finance-contract.html:92 · ui2/finance-summary.html:35 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski: contract-list.html — kısmi | contracts(1) | hayır | hayır |
| 66 | `ui2/finance-drafts.html` | finance | — | ui2 nav.json alt menü :31 | ui2/finance-expenses.html:114 | 2026-10-22 `1ad8456` (3 commit) | (ui2) eski karşılık yok | expense-drafts(2) expos(1) ledger(3) | hayır | hayır |
| 67 | `ui2/finance-expenses.html` | finance | — | ui2 nav.json alt menü :28 | ui2/finance-drafts.html:113 · ui2/finance-supplier.html:69 · ui2/finance-suppliers.html:75 | 2026-10-22 `1ad8456` (3 commit) | (ui2) eski karşılık yok | expense-drafts(1) expos(1) ledger(6) | hayır | hayır |
| 68 | `ui2/finance-summary.html` | finance | — | ui2 nav.json alt menü :18 · üst sekme :7 | — | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | ledger(1) | hayır | hayır |
| 69 | `ui2/finance-supplier.html` | finance | — | ui2 nav.json alt sayfa (ebeveyni etkin) :30 | ui2/finance-account.html:36 · ui2/finance-expenses.html:106 · ui2/finance-suppliers.html:29 | 2026-10-22 `1ad8456` (3 commit) | (ui2) eski karşılık yok | ledger(3) offices(1) | hayır | hayır |
| 70 | `ui2/finance-suppliers.html` | finance | — | ui2 nav.json alt menü :29 | ui2/finance-expenses.html:113 · ui2/finance-supplier.html:69 | 2026-10-22 `1ad8456` (3 commit) | (ui2) eski karşılık yok | ledger(3) offices(1) | hayır | hayır |
| 71 | `ui2/finance-transfers.html` | finance | — | ui2 nav.json alt menü :27 | — | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | expos(1) ledger(3) | hayır | hayır |
| 72 | `ui2/index.html` | ui2 kabuk | — | sidebar ×1 (örn. main-panel-v2.html); ui2 nav.json kabuk (menüde değil) :38 | ui2/login.html:20 · ui2/placeholder.html:34 · ui2/shell.js:125 | 2026-10-22 `1ad8456` (4 commit) | (ui2) kabuk | — | hayır | hayır |
| 73 | `ui2/invite.html` | auth | — | ui2 nav.json kabuk (menüde değil) :40 | backend utils/invites.js:46 | 2026-10-22 `1ad8456` (2 commit) | (ui2) eski karşılık yok | user-auth(2) | hayır | hayır |
| 74 | `ui2/login.html` | auth | — | ui2 nav.json kabuk (menüde değil) :39 | backend utils/permissions.js:98 · leena-fetch.js:28 · ui2/admin-ui.js:23 · ui2/invite.html:39 · +1 sayfa | 2026-10-22 `1ad8456` (5 commit) | (ui2) eski: login.html — kısmi | user-auth(3) | hayır | hayır |
| 75 | `ui2/operations.html` | ui2 kabuk | — | ui2 nav.json üst sekme :6 | — | 2026-10-22 `1ad8456` (2 commit) | (ui2) kabuk | — | hayır | hayır |
| 76 | `ui2/placeholder.html` | ui2 kabuk | — | ui2 nav.json kabuk (menüde değil) :42 | ui2/finance-summary.html:36 | 2026-10-23 `312bc2d` (2 commit) | (ui2) kabuk | — | hayır | hayır |
| 77 | `ui2/sales.html` | ui2 kabuk | — | ui2 nav.json üst sekme :5 | — | 2026-10-22 `1ad8456` (2 commit) | (ui2) kabuk | — | hayır | hayır |
| 78 | `ui2/whoami.html` | auth | — | ui2 nav.json kabuk (menüde değil) :41 | ui2/shell.js:85 | 2026-10-22 `1ad8456` (5 commit) | (ui2) eski karşılık yok | user-auth(1) | hayır | hayır |
| 79 | `visitorlog-paginated.html` | EMS | — | sidebar ×18 (örn. main-panel-v2.html) | conference-sessions.html:243 · main-panel-v2.html:1331 | 2026-08-31 `34061f8` (33 commit) | yok | email-send(1) email-templates(1) unsubscribes(2) visitors(7) · özel: unsubscribes | hayır | hayır |

---

## 3. EK A — Ulaşılamayan 11 sayfanın dökümü

### A1. ölü aday — EVET (3)
| dosya | kanıt (kod + git) | hüküm (Sentez 23 Eki) |
|---|---|---|
| `checkin-import.html` | gelen link 0 · özel API `/api/import-checkins` · son commit 2026-05-08 `5f39aec` | KALSIN (Suer istisnası) |
| `dashboard.html` | gelen link yalnız ulaşılamayan sayfalardan: `expo-create.html:333/402`, `main-panel.html:93/145`; ayrıca yüklenmeyen `js/common.js:126/488/496` · 2026-02-24 `b486d7c` | SİL listesinde — ad araması 0 değil → KALDI |
| `main-panel.html` | `/main-panel-v2.html`'e yönlendirme kabuğu; gelen link yalnız `expo-create.html:326/327` + yüklenmeyen `js/common.js:452` · 2026-02-24 `b486d7c` | SİL listesinde — ad araması 0 değil → KALDI |

Not: `dashboard.html` ↔ `main-panel.html` ↔ `expo-create.html` kendi aralarında linkli kapalı küme (22 Eki notu aynen);
kümeye kökten (L/B/U) giren link yok. Kümeyi dışarıdan tutan tek iz `public/js/common.js` (yükleyen 0).

### A2. İZSİZ-YENİ (1)
| dosya | kanıt | hüküm |
|---|---|---|
| `expo-create.html` | gelen link yalnız `dashboard.html:234` (ulaşılamaz) · son commit 2026-09-09 `8907612` | KALSIN — modal `description` + `logo_url`'u kapsamıyor (§0.1) |

### A3. İZSİZ-FUAR (7) — kod linki yok, fuar yüzeyi (22 Eki A3 ile aynı; dosyalar değişmedi)
`bulk-badge-print.html` · `conference-scanner.html` · `lead-scan.html` · `hostess-guide.html` · `callcenter/agent.html` ·
`callcenter/supervisor.html` · `callcenter/admin.html` — kimlik biçimi ve belge izi 22 Eki A3 tablosunda; belge izi satır
atıfları güncel: `CLAUDE.md:555` · `CLAUDE.md:988` (conference-scanner) · `CLAUDE.md:498` (lead-scan).

### A4. ui2 ↔ eski arayüz (22 Eki "ui2 adası" bulgusunun güncel hâli)
- Eski arayüzden ui2'ye yorum dışı link: **1** — `main-panel-v2.html:968` (`href="/ui2/"`, sidebar Finance bölümü).
  `leena-fetch.js:28` (`'login.html'`, göreli) 22 Eki'deki gibi yalnız ui2 sayfası yüklediğinde `ui2/login.html`'e çözülür.
- ui2'den eski arayüze: `/login.html` yönlendirmeleri (`ui2/shell.js:99`, `ui2/ledger-ui.js:26`, `ui2/finance-contract.html:99`,
  `ui2/finance-contracts.html:57`, `ui2/login.html:27`) + **nav.json köprüleri** (`legacy=true`): `commissions.html` (`:22`),
  `sales-agents.html` (`:23`) — menü önce `placeholder.html?id=<id>`'e gider, klasik bağlantı oradan (`placeholder.html`
  `it.path`'i nav.json'dan okur).
- Eski finans sayfaları EMS menüsünde değişmedi: `main-panel-v2.html:963-967` (Contracts, Sales Agents, Commissions, Cash
  Forecast, Offices) + yeni `:968`.

---

## 4. EK B — Gömülü fuar dökümü

22 Eki Ek B AYNEN geçerli (KAPSAM DIŞI — v402, Paket 3 sonrası). Kaynak dosyaların hepsi `613ce8e` ile aynı; tek satır
atıfı değişti: `main-panel-v2.html:1253` → **`:1254`** ("Today vs yesterday (Africa/Lagos)" — KAPI-1 satırı üstüne eklendi).
EVET-id 2 sayfa: `certificate.html:523/529/535/541` · `lead-scan.html:185`.

---

## 5. EK C — Sayfa başına API uçları (tam liste)

Çıkarım 22 Eki §5 ile aynı (`:p` = yol parametresi; sorgu dizgisi atıldı; HTTP metodu kaydedilmedi).

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
- `checkins.html` (2): `/api/checkins`, `/api/checkins/stats/summary`
- `commissions.html` (1): `/api/commissions`
- `conference-cleanup.html` (6): `/api/conference-cleanup`, `/api/conference-cleanup/bulk-update`, `/api/conference-cleanup/canonical-topics`, `/api/conference-cleanup/expos`, `/api/conference-cleanup/topic-variants`, `/api/conference-cleanup/visitors`
- `conference-scanner.html` (7): `/api/conference-certificates/blocked-topics`, `/api/conference-certificates/checkin-and-certify`, `/api/conference-certificates/resend`, `/api/conference-certificates/topics`, `/api/terminal/status`, `/api/terminal/visitor-by-email`, `/api/terminal/visitor-by-qr`
- `conference-sessions.html` (2): `/api/visitors/conference-topics`, `/api/visitors/export`
- `contract-detail.html` (13): `/api/contracts/:p`, `/api/contracts/:p/assignment`, `/api/contracts/:p/payments`, `/api/contracts/:p/payments/:p/reverse`, `/api/contracts/:p/schedule`, `/api/contracts/:p/schedule/default`, `/api/contracts/:p/status`, `/api/contracts/:p/transfer`, `/api/expos`, `/api/ledger/accounts`, `/api/ledger/currencies`, `/api/offices`, `/api/sales-agents`
- `contract-list.html` (2): `/api/contracts`, `/api/contracts/:p/status`
- `dashboard.html` (1): `/api/expos`
- `dashboard_new.html` (2): `/api/expos`, `/api/reference/countries`
- `email-campaigns.html` (15): `/api/campaigns`, `/api/campaigns/:p`, `/api/campaigns/:p/activate`, `/api/campaigns/:p/lift`, `/api/campaigns/:p/pause`, `/api/campaigns/:p/recipients`, `/api/campaigns/:p/recipients/:p`, `/api/campaigns/:p/recipients/from-expo`, `/api/campaigns/:p/recipients/upload`, `/api/campaigns/:p/resume`, `/api/campaigns/:p/steps`, `/api/campaigns/:p/steps/:p`, `/api/campaigns/:p/steps/:p/recipients`, `/api/email-templates`, `/api/expos`
- `email-history.html` (2): `/api/email-send/history`, `/api/email-templates`
- `email-segments.html` (3): `/api/email-segments/preview`, `/api/email-segments/send`, `/api/email-templates`
- `email-send.html` (4): `/api/email-send/bulk`, `/api/email-templates`, `/api/expos`, `/api/visitors/paginated`
- `email-templates.html` (4): `/api/email-templates`, `/api/email-templates/:p`, `/api/email-templates/clone/:p`, `/api/email-templates/defaults`
- `expo-clusters.html` (2): `/api/clusters`, `/api/clusters/:p`
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
- `main-panel-v2.html` (6): `/api/expos/:p`, `/api/forms/:p`, `/api/forms/expo/:p`, `/api/reports/live`, `/api/reports/summary`, `/api/webhook/zoho/:p/:p/:p`
- `main-panel.html` (5): `/api/expos/:p`, `/api/forms/:p`, `/api/forms/expo/:p`, `/api/reports/summary`, `/api/visitors/paginated`
- `offices.html` (3): `/api/offices`, `/api/offices/:p`, `/api/reference/countries`
- `qrscanner.html` (8): `/api/badge-templates/for-terminal/:p`, `/api/checkins`, `/api/terminal/checkin`, `/api/terminal/visitor-by-email`, `/api/terminal/visitor-by-qr`, `/api/visitors/badge/:p`, `/api/visitors/manual`, `/api/visitors/paginated`
- `reactivate-fr.html` (3): `/api/reactivation`, `/api/reactivation/activate`, `/api/reactivation/verify/:p`
- `reactivate.html` (3): `/api/reactivation`, `/api/reactivation/activate`, `/api/reactivation/verify/:p`
- `reactivation-campaign.html` (17): `/api/campaigns/reactivation/build`, `/api/campaigns/reactivation/job/:p`, `/api/campaigns/reactivation/segment`, `/api/campaigns/validate-template`, `/api/email-templates`, `/api/expos`, `/api/forms`, `/api/forms/expo/:p`, `/api/reactivation/campaign/:p/close`, `/api/reactivation/campaign/:p/is-active`, `/api/reactivation/campaign/:p/reopen`, `/api/reactivation/campaign/:p/stats`, `/api/reactivation/campaigns`, `/api/reactivation/create-from-excel`, `/api/reactivation/create-from-expo`, `/api/reactivation/job/:p`, `/api/reactivation/resend-pending`
- `reports.html` (2): `/api/reports/export`, `/api/reports/summary`
- `sales-agents.html` (4): `/api/ledger/currencies`, `/api/offices`, `/api/sales-agents`, `/api/sales-agents/:p`
- `terminals.html` (6): `/api/badge-templates`, `/api/terminals`, `/api/terminals/:p`, `/api/terminals/:p/toggle`, `/api/terminals/all`, `/api/terminals/clone/:p`
- `ui2/_sablon/detail.html` (0): —
- `ui2/_sablon/form.html` (0): —
- `ui2/_sablon/index.html` (0): —
- `ui2/_sablon/list.html` (0): —
- `ui2/_sablon/summary.html` (0): —
- `ui2/admin-user.html` (3): `/api/users/:p`, `/api/users/:p/invite`, `/api/users/options`
- `ui2/admin-users.html` (3): `/api/users`, `/api/users/invite`, `/api/users/options`
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
- `ui2/invite.html` (2): `/api/user-auth/invite/accept`, `/api/user-auth/invite/check`
- `ui2/login.html` (3): `/api/user-auth/change-password`, `/api/user-auth/login`, `/api/user-auth/me`
- `ui2/operations.html` (0): —
- `ui2/placeholder.html` (0): —
- `ui2/sales.html` (0): —
- `ui2/whoami.html` (1): `/api/user-auth/me`
- `visitorlog-paginated.html` (11): `/api/email-send/single`, `/api/email-templates`, `/api/unsubscribes`, `/api/unsubscribes/status`, `/api/visitors/:p`, `/api/visitors/:p/emails`, `/api/visitors/bulk-email`, `/api/visitors/conference-topics`, `/api/visitors/export`, `/api/visitors/paginated`, `/api/visitors/sources`

---

## 6. EK D — ui2 canlı ölçüm

Bu koşumda ui2 sayfa geçişi yeniden ölçülmedi. En yakın canlı ölçüm (defter, PAKET UI-0 CANLIDA, 2026-10-23 10:14 UTC,
curl, oturumsuz): canlı ui2 32/32 dosya = `main` (`cb37f24`) · `ui2/finance-summary.html` TTFB 0.242 / 0.244 / 0.247 s.
UI-0'dan beri her ui2 sayfası `tokens.css` + `signal.css` + `nav.json` (+1 istek) yükler; `themes.css` / `ledger.css` yok.

## 7. ⚠️ ÖLÇÜLMEDİ / GÖZLENEMEDİ

- 22 Eki §7'deki sınırlar aynen (canlı kullanım, DB'deki e-posta şablonlarının sayfa URL'leri, elden dağıtılan URL'ler,
  dinamik kurulmuş URL'ler, API uçlarının backend karşılığı).
- **Silinen 11 sayfanın canlıdaki son erişimi** — log okunmadı; `login_new.html` eski yer imleri push sonrası 404 alır
  (kod izinde kullanıcı yok, 22 Eki A1).
- Yüklenmeyen JS'lerin (`js/common.js`) linkleri tabloda sayılmaz (22 Eki yöntemi); yalnız ad aramasıyla görüldü.
- `nav.json`'daki yollar statik okundu; `shell.js`'in oturuma göre gizlediği öğeler (`ui2CanSee`, `userOnly`) erişilebilirlik
  hesabında ayrılmadı — menüde görünmeyen öğe de ulaşılabilir sayıldı.
- ui2 canlı geçiş süresi bu koşumda ölçülmedi (Ek D).

## 8. Bilinçle yapılmayanlar

- `js/common.js` silinmedi (SİL listesinde yok; Sentez kararı) → `dashboard.html` + `main-panel.html` kaldı.
- EMS sayfalarının içeriği, fuar no gömülü 2 sayfa, TAŞI (UI-1) — KAPSAM DIŞI.
- 22 Eki raporu değiştirilmedi (bayt bayt aynı alındı).
- Ek D yeniden ölçülmedi.

---

## 9. EK E — Betik farkları (yeniden üretim)

Tam metin = 22 Eki raporu Ek E (`scan.py`, `report.py`) + aşağıdaki iki fark. Regresyon: farklı betik `613ce8e`
worktree'sinde 22 Eki §2 tablosunu birebir üretti (`diff` 0 satır).

<details><summary>scan.py farkı</summary>

```diff
--- scan.py (2026-10-22)
+++ scan.py (2026-10-23)
@@ -1,8 +1,9 @@
 #!/usr/bin/env python3
-"""Sayfa envanteri tarayıcısı — salt-okunur. Worktree: /tmp/ell-envanter (613ce8e)."""
+"""Sayfa envanteri tarayıcısı — salt-okunur. Worktree: ENV_ROOT (2026-10-22: /tmp/ell-envanter @ 613ce8e).
+2026-10-23 uyarlaması: kök parametreli · <base href> · dizin bağlantısı (/x/ → x/index.html) · ui2 nav.json menü kaynağı."""
 import os, re, subprocess, json, sys, collections
 
-ROOT = '/tmp/ell-envanter'
+ROOT = os.environ.get('ENV_ROOT', '/tmp/ell-envanter')
 BE = ROOT + '/backend/leena-v401-backend'
 PUB = BE + '/public'
 OUT = sys.argv[1]
@@ -52,9 +53,16 @@
     txt = read(os.path.join(PUB, js))
     for m in IMP_RE.finditer(txt):
         walk_js(page, resolve(m.group(1), os.path.dirname(js)))
+BASE_RE = re.compile(r'<base\s+href=["\']([^"\']+)["\']', re.I)
+def page_dir(h, txt):
+    # <base href="/ui2/"> → bağlantı ve betikler o dizine göre çözülür (UI-0 _sablon sayfaları)
+    b = BASE_RE.search(txt)
+    if b and b.group(1).startswith('/'):
+        return os.path.normpath(b.group(1).strip('/')) if b.group(1).strip('/') else ''
+    return os.path.dirname(h)
 for h in html:
     txt = read(os.path.join(PUB, h))
-    d = os.path.dirname(h)
+    d = page_dir(h, txt)
     for m in SRC_RE.finditer(txt):
         if m.group(1).startswith(('http://', 'https://', '//')):
             continue
@@ -86,6 +94,7 @@
         spans.append((m.start(), end, (cls.group(1) if cls else tag)))
     return spans
 
+DIR_RE = re.compile(r'''["'](/[A-Za-z0-9_-]+/)["']''')
 BLOCK_RE = re.compile(r'(?<![\'"*])/\*.*?\*/|<!--.*?-->', re.S)
 refs = collections.defaultdict(list)   # target -> [(src, line, kind, comment)]
 def scan_text(src_label, txt, src_dirs, kind_fn):
@@ -104,6 +113,17 @@
             tgt = resolve(tok, sd)
             if tgt in HTML:
                 refs[tgt].append((src_label, li + 1, kind_fn(m.start()), com, tok))
+    # dizin isteği (express.static index): "/ui2/" → ui2/index.html — 2026-10-23 eklendi (KAPI-1 linki)
+    for m in DIR_RE.finditer(txt):
+        tok = m.group(1)
+        li = bisect.bisect_right(offs, m.start()) - 1
+        line = lines[li]; col = m.start() - offs[li]
+        if '<base' in line.lower():   # <base href> bağlantı değil
+            continue
+        com = is_comment(line, col) or any(a <= m.start() < b for a, b in blocks)
+        tgt = os.path.normpath(tok.strip('/')) + '/index.html'
+        if tgt in HTML:
+            refs[tgt].append((src_label, li + 1, kind_fn(m.start()), com, tok + 'index.html'))
 
 for p in pub_text:
     txt = read(os.path.join(PUB, p))
@@ -114,7 +134,7 @@
                 if a <= pos <= b:
                     return 'nav:' + c
             return 'body'
-        scan_text('public/' + p, txt, [os.path.dirname(p)], kf)
+        scan_text('public/' + p, txt, [page_dir(p, txt)], kf)
     elif p.endswith('.js'):
         loaders = js_loaded_by.get(p)
         if loaders:
@@ -124,6 +144,27 @@
         else:
             scan_text('public/' + p, txt, [os.path.dirname(p)], lambda pos: 'js(unloaded)')
 
+# ui2 nav.json — UI-0'dan beri ui2 menüsünün TEK kaynağı (shell.js okur). Yollar /ui2/'ye göre; legacy=true köprü
+# öğesinin yolu ui2 dışındaki klasik ekran. Tür: nav-json:domain (üst sekme) · :item (alt menü) · :child (alt sayfa,
+# menüde satır değil) · :shell (kabuk, menüde değil) · :legacy (klasik köprü). — 2026-10-23 eklendi
+NAVJ = os.path.join(PUB, 'ui2', 'nav.json')
+if os.path.exists(NAVJ):
+    nav_txt = read(NAVJ); nav = json.loads(nav_txt); nav_lines = nav_txt.split('\n')
+    def nav_line(eid, pth):
+        # öğenin kendi satırı: aynı yolu taşıyan sekme + öğe ayrı satırlarda (ör. finance-summary.html)
+        for i, ln in enumerate(nav_lines, 1):
+            if '"id": "%s"' % eid in ln and '"path": "%s"' % pth in ln:
+                return i
+        return 0
+    entries = [(d['id'], d['path'], 'domain') for d in nav.get('domains', [])]
+    for it in nav.get('items', []):
+        k = 'legacy' if it.get('legacy') is True else 'shell' if it.get('domain') == 'shell' else 'child' if it.get('parent') else 'item'
+        entries.append((it['id'], it['path'], k))
+    for eid, pth, k in entries:
+        tgt = resolve(pth, 'ui2')
+        if tgt in HTML:
+            refs[tgt].append(('public/ui2/nav.json', nav_line(eid, pth), 'nav-json:' + k, False, pth))
+
 # backend (public/node_modules dışı)
 LIVE_PREFIX = ('routes/', 'utils/', 'middleware/', 'config/', 'services/')
 LIVE_FILES = ('index.js', 'email_worker.js')
@@ -282,6 +323,10 @@
         if sp.endswith('.html'):
             if sp != tgt:
                 edges[sp].add(tgt)
+        elif sp == 'ui2/nav.json':
+            for L in js_loaded_by.get('ui2/shell.js', ()):
+                if L != tgt and resolve(tok, 'ui2') == tgt:
+                    edges[L].add(tgt)
         else:
             for L in js_loaded_by.get(sp, ()):
                 if resolve(tok, os.path.dirname(L)) == tgt and L != tgt:
```
</details>

<details><summary>report.py farkı</summary>

```diff
--- report.py (2026-10-22)
+++ report.py (2026-10-23)
@@ -4,12 +4,14 @@
 
 d = json.load(open(sys.argv[1]))
 P = {p['file']: p for p in d['pages']}
-CUT = '2026-07-24'   # 90 gün sınırı (2026-10-22 − 90 g)
+CUT = '2026-07-25'   # 90 gün sınırı (2026-10-23 − 90 g; 2026-10-22 raporunda 2026-07-24)
 
 DOMAIN = {}
-for f in ['login.html', 'login_new.html', 'register.html', 'register.backup.html', 'ui2/login.html', 'ui2/whoami.html']:
+for f in ['login.html', 'login_new.html', 'register.html', 'register.backup.html', 'ui2/login.html', 'ui2/whoami.html', 'ui2/invite.html']:
     DOMAIN[f] = 'auth'
 DOMAIN['admin-dashboard.html'] = 'admin'
+for f in ['ui2/admin-users.html', 'ui2/admin-user.html']:   # Paket 2 (2026-10-23 eklendi)
+    DOMAIN[f] = 'admin'
 for f in ['agent-statement.html', 'cash-forecast.html', 'commissions.html', 'contract-detail.html',
           'contract-list.html', 'offices.html', 'sales-agents.html']:
     DOMAIN[f] = 'finance'
@@ -18,9 +20,12 @@
         DOMAIN[f] = 'finance'
 for f in ['expo-list.html', 'expo-form.html', 'expo-clusters.html', 'expo-partners.html']:
     DOMAIN[f] = 'ops'
-for f in ['ui2/index.html', 'ui2/sales.html', 'ui2/operations.html']:
+for f in ['ui2/index.html', 'ui2/sales.html', 'ui2/operations.html', 'ui2/placeholder.html']:
     DOMAIN[f] = 'ui2 kabuk'
 for f in P:
+    if f.startswith('ui2/_sablon/'):   # UI-0 şablonları (2026-10-23 eklendi)
+        DOMAIN[f] = 'ui2 kabuk'
+for f in P:
     DOMAIN.setdefault(f, 'EMS')
 
 FAIR = {
@@ -46,8 +51,8 @@
 # Kod linki olmayan sayfalar için belge izi (git'teki belge; canlı log değil)
 DOC = {
     'bulk-badge-print.html': 'docs/sessions/TERMINAL_CHECK_20260819.md:192 · docs/CLAUDE_ARCHIVE.md:404 · middleware/dualAuth.js:44 (`bulk_print` yolu)',
-    'conference-scanner.html': 'CLAUDE.md:554 · CLAUDE.md:985 (G22: Copy URL bu sayfayı üretmez)',
-    'lead-scan.html': 'CLAUDE.md:497 (akış I)',
+    'conference-scanner.html': 'CLAUDE.md:555 · CLAUDE.md:988 (G22: Copy URL bu sayfayı üretmez)',
+    'lead-scan.html': 'CLAUDE.md:498 (akış I)',
     'hostess-guide.html': 'docs/CLAUDE_ARCHIVE.md:322-325',
     'callcenter/agent.html': 'docs/sessions/DEPLOY_CALLCENTER_20260907.md:19 · mount index.js:170',
     'callcenter/supervisor.html': 'docs/sessions/DEPLOY_CALLCENTER_20260907.md:20 · mount index.js:170',
@@ -80,7 +85,7 @@
     'callcenter/admin.html': 'içerik: SIEMA markası (:143)',
     'conference-cleanup.html': 'içerik: :138 "Mega Clima Nigeria 2026 sonrası kaldırılacak" bandı',
     'qrscanner.html': 'yerel: :927 ülke varsayılanı `Nigeria`',
-    'main-panel-v2.html': 'yerel: :1253 "Africa/Lagos" etiketi',
+    'main-panel-v2.html': 'yerel: :1254 "Africa/Lagos" etiketi',
     'email-segments.html': 'yerel: :163 "Lagos time" etiketi',
 }
 
@@ -102,12 +107,16 @@
     for i, f in enumerate(sorted(P), 1):
         p = P[f]
         live = [r for r in p['refs'] if not r[3]]
-        nav_src = sorted({short(r[0]) for r in live if r[2].startswith('nav')
+        # 'nav:' = HTML <nav>/<aside> (sidebar); 'nav-json:' ayrı (2026-10-23)
+        nav_src = sorted({short(r[0]) for r in live if r[2].startswith('nav:')
                           and short(r[0]) in LIVE_ROOTS})
-        nav_dead = sorted({short(r[0]) for r in live if r[2].startswith('nav')
+        nav_dead = sorted({short(r[0]) for r in live if r[2].startswith('nav:')
                            and short(r[0]) not in LIVE_ROOTS})
         # shell.js nav tanımı :17-19 (üst nav) ve :30-35 (subnav); diğer satırlar (:76 auth yönlendirmesi) menü değil
-        shell = [r for r in live if r[2] == 'shell-nav' and r[1] <= 40]
+        shell = []   # 2026-10-23: ui2 menüsü shell.js'te değil nav.json'da (UI-02) → aşağıda nav-json
+        NAVK = {'domain': 'üst sekme', 'item': 'alt menü', 'child': 'alt sayfa (ebeveyni etkin)', 'shell': 'kabuk (menüde değil)',
+                'legacy': 'klasik köprü (legacy=true)'}
+        navj = sorted({NAVK[r[2].split(':', 1)[1]] + ' :%d' % r[1] for r in live if r[2].startswith('nav-json:')})
         menu = []
         if nav_src:
             menu.append('sidebar ×%d (örn. %s)' % (len(nav_src), nav_src[0] if len(nav_src) == 1 else
@@ -115,6 +124,8 @@
         if shell:
             kinds = sorted({'üst nav' if r[1] <= 20 else 'subnav' for r in shell}, reverse=True)
             menu.append('ui2 shell %s (shell.js:%s)' % ('+'.join(kinds), ','.join(str(r[1]) for r in shell)))
+        if navj:
+            menu.append('ui2 nav.json ' + ' · '.join(navj))
         if nav_dead and not nav_src:
             menu.append('yalnız ölü-aday sayfa sidebar\'ı ×%d' % len(nav_dead))
         menu_s = '; '.join(menu) or '—'
```
</details>
