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
npm run test:setup     # ell_comm_test'i SIFIRDAN kurar (idempotent — her koşuda düşür+yarat)
npm test               # test_cash_forecast.js (67 test) koşar
```
`test:setup` idempotenttir: `DROP DATABASE IF EXISTS` + `CREATE` → art arda koşulabilir.

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
