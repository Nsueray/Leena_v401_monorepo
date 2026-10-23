# tests/

Finans/komisyon modülü (ELL) için bespoke Node test suite'i. Framework YOK — düz
`node` script + `require` (ürün route'larını mount eder) + `fetch` (HTTP) + elle sayaç.

## Gereksinimler
- Çalışan bir **yerel PostgreSQL** (varsayılan `localhost:5432`, `postgres` kullanıcısı, trust auth).
- Bağımlılıklar kurulu (`npm install`) — testler `node_modules/pg`, `express`, `jsonwebtoken` kullanır.
- **Migration'lar `../migrations/` içinde** (repo ile gelir). Setup bunları 012→028 sırayla koşar.

## Bağlantı (sır repoda YOK)
Bağlantı **env**'den okunur:
```
TEST_DATABASE_URL   (default: postgresql://postgres@localhost:5432/ell_comm_test)
```
Başka bir DB/host için bu değişkeni ver. Dosyalarda literal host/şifre yoktur.

## Koşum
```
npm run test:setup     # ell_comm_test + _premig + _p1 + _p1b'yi SIFIRDAN kurar (idempotent)
npm test               # package.json zinciri — 22 suite (2026-10-22 PAKET UI-0; sayı defterde)
```
`test:setup` idempotenttir: `DROP DATABASE IF EXISTS` + `CREATE` → art arda koşulabilir.

**İki DB (Paket 1, 2026-10-21):** `ell_comm_test` (012 → son migration; 036+ runner'ın
`applyMigrationFile` yoluyla) ve `ell_comm_test_premig` (≤ 035 = canlının Paket 1 öncesi şeması —
"deploy migration'dan önce" testleri ve runner'ın gerçek dosyalarla dry-run'ı).
Ledger suite'leri: `test_ledger.js` · `test_ledger_premig.js` · `test_migrate.js` · `test_ui2_ledger_pages.js`.

**Üçüncü DB (Paket 1b, 2026-10-21):** `ell_comm_test_p1` (≤ 040 = canlının Paket 1 sonrası, 1b öncesi şeması).
Paket 1b suite'leri: `test_ledger_p1b.js` (tedarikçi + gider taslağı + TABAN) · `test_ledger_p1b_premig.js`
(yeni kod + ≤ 040 şema) · `test_ui2_p1b_pages.js`. `test_migrate.js` R9-R14 Paket 1 geçişinin provasıdır ve
dosya kümesi ≤ 040'a DONDURULUR (beklentiler aynen); R15-R17 Paket 1b geçişi (gerçek migrations/).

**Dördüncü DB (Paket 2, 2026-10-22):** `ell_comm_test_p1b` (≤ 042 = canlının Paket 1b sonrası, Paket 2 öncesi şeması).
Paket 2 suite'leri: `test_users_admin.js` (aktiflik · yetki çözümlemesi · DB korumaları · kapı + kapsam · davet ·
pasifleştirme · B10/B32 · denetim · regresyon · TABAN) · `test_users_premig.js` (yeni kod + ≤ 042 şema) ·
`test_ui2_p2_pages.js` (menü etkin yetkiyi okur, Admin ekranları, davet sayfası). `test_migrate.js` R15-R17 aynı
gerekçeyle ≤ 042'ye DONDURULDU; R18-R21 Paket 2 geçişi (gerçek migrations/; R21 043'ün veri değiştiren bağ adımı).
**email_queue stub'ı** (Paket 2): davet e-postası transactional satır olarak yazıldığı için girer (YON-09) —
kolonlar canlı ölçümü, FK'lerden yalnız organizers.
**Fixture notu (Paket 2):** yazma uçları kapılı (eski token → 409 köprü) → `test_ledger` / `test_ledger_p1b` /
`test_payouts`'un varsayılan aktörü Owner kullanıcı oturumu; assertion'lar değişmedi. Kapının kendisi
`test_users_admin.js`'te.

**PAKET UI-0 (2026-10-22, ui2 arayüz çekirdeği — kütük UI-01..06):**
- `test_ui2_ui0.js` (DB YOK): nav.json şeması + **iki yönlü nav testi** (nav'daki her yol var · ui2'deki her sayfa nav'da) ·
  Finance 4 grup · giriş → Finance özet · Sales/Operations boş-durum · **bileşen-kopya testi** (sayfada ham tablo/form/düğme,
  bileşen sınıfı, `style=` = KIRMIZI) · para çifti · özet kartı · üç durum · liste `data-label` · tokens.css dışında sabit renk 0 ·
  tanımsız token 0 · dört şablon × üç durum.
- `test_ui2_ui0_render.js` (test DB): `helpers/ui0Seed.js` tohumu (TABAN dahil) → her ui2 ekranı `helpers/ui2Render.js` ile
  tarayıcısız çizilir → API'nin her rakamı ekran metninde AYNEN (kabul 8, contract sr earned €342.00).
- `ui0_compare.js` — zincirde DEĞİL (Playwright + Chromium ister): taşıma öncesi (`BEFORE_REF`, varsayılan `ce670ab`) /
  sonrası ekran görüntüsü + `<main>` sayı karşılaştırması + 390 px yatay kaydırma ölçümü + uçtan uca ui2 login → Finance özeti.
  `PW=<playwright modülü> CHROME=<chromium> OUT=<dizin> node tests/ui0_compare.js`

## Ne kuruluyor
- **Stub tablolar** (migration'larda yok, FK hedefi): `expos` (1-5, organizer_id=1),
  `core_countries` (TR/MA/NG/KE/CN). Şema, ayakta duran DB'den ÖLÇÜLEREK yazıldı.
- **Migration'lar** 012→028 (17 dosya) → `contracts` · `sales_agents` · `payments` ·
  `contract_line_items` · `commission_payouts` · `offices` (+5 seed) · `payment_schedule_items`.

## Kapsam
`test_cash_forecast.js`: PS3-B nakit öngörü (T1-T24) + TAH-04 eşleştirme (T25-T38) +
regresyon assertion'ları (R1-R8) + **taban** contract 4 sr earned = 342.00 (T35). Toplam 67.

⚠️ Silinen 8 eski suite (M1/M2/payout/PS1/PS2-A/PS2-B1/PS2-C/PS3-A) burada YOK — yeniden
yazımı ayrı iş (bkz defter TAH-04 kaydı + kütük Ö5 kapsam listesi).
`.gitignore` bu repoda yok; test/tmp deseni açmak ayrı karar (kapsam dışı bırakıldı).
