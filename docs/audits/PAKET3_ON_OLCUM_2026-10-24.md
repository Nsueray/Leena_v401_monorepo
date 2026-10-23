# PAKET 3 ÖN-ÖLÇÜM — 2026-10-24, salt-okunur (teslimat ölçümü, YON-11)

- Görev: Sentez 23 Eki — Paket 3 kriter turundan ÖNCE teslimat ölçümü. **İNŞA YOK:** hiçbir repoda kod değişmedi, DB'ye
  yazılmadı, migration yok.
- Ölçüm tabanları:
  - liffyv1 `main` @ **`0e4b8a7`** (= `origin/main`; `backend/`'de `d260f83`'ten fark 0 dosya)
  - liffy-ui `main` @ **`7b15ced`** (= `origin/main`, 2026-06-12)
  - LEENA `origin/main` @ **`2463259`** (= yerel `main`); `backend/leena-v401-backend/routes/contracts.js` `eliza-next` @
    `1a1f252` ile aynı (fark 0 satır)
  - ell-docs `main` @ **`776ae4b`**
  - LIFFY DB: canlı `liffy-db`, **2026-10-23 19:38 UTC**, `BEGIN READ ONLY` + `default_transaction_read_only=on`
    (`transaction_read_only = on` sorguyla doğrulandı), `ROLLBACK` ile kapandı.
- **K4 (allowlist):** bağlantı dizesi Suer'in panosundan betiğe okundu; hiçbir tool çağrısına / çıktıya yazılmadı;
  okunduktan sonra pano boşaltıldı. Basılanlar yalnız kolon adı · sayı · durum adı · ofis kodu · türetilmiş AF numarası
  · boolean. Satır verisi (şirket adı, e-posta, kimlik) basılmadı.
- Kanıt kuralı: kod hükmü = dosya:satır; DB hükmü = bu oturumun sorgu çıktısı. "Yok / 0" = ölçülen kapsamda iz yok.

---

## 0. ÖZET

| # | soru | sonuç |
|---|---|---|
| 1a | `products` — 242 SKU girdi mi | **HAYIR** — **1 satır** (`category = TestCategory`, `unit_type = m2`); `RF%` / `PES%` / `SYK%` kodlu ürün 0 |
| 1b | `product_prices` doluluk | **0 satır** — 7 ofisin hiçbirinde fiyat yok; fiyatı olmayan ürün 1/1 |
| 1c | `quotes` sayısı + durum | **2** — `signed` 1 · `sent` 1 (`draft` 0 · `declined` 0) |
| 1c | ATR-100000 · QMA-100001 | **İKİSİ DE DURUYOR** — ATR-100000 `signed` (scan var, `signed_at` 2026-06-12, 1 kalem) · QMA-100001 `sent` (1 kalem) |
| 1e | `expos` (LIFFY) + `canonical_expo_id` | **1 satır** — `canonical_expo_id` **dolu 0 / boş 1** |
| 1f | `users.office_id` | **3 kullanıcı (3 aktif) — dolu 0 / boş 3** |
| 2a | convert payload'ı `line_items` taşıyor mu | **LIFFY'de convert payload'ı YOK** — `routes/quotes.js`'te convert ucu / payload kurucusu yok; sign `:1020-1069` yalnız durum günceller + log. En yakın şekil `GET /:id` `enrichQuote` `:103-116` (`line_items[]` döner) — LEENA L2a alanları (`product_code`, `is_registration_fee`) yok, `line_total` vergi DAHİL (§2.1) |
| 2b | LIFFY → LEENA HTTP / transport izi | **0** — backend'de HTTP istemcili 11 dosya: Zoho, ZeroBounce, ReedExpo, `liffy.app`, madencilik hedef URL'leri; liffy-ui tek hedef `/api/*` → `api.liffy.app` |
| 3 | LEENA convert ucu L3 / L4 | **İNŞA EDİLMİŞ, `main`'de** — L3 `contracts.js:100-140` (`line_items` **OPSİYONEL**), L4 `:142-153` (`±0.01` dışı → 400). "LIFFY aktivasyonunda `line_items` ZORUNLU" **henüz yok** (`:101` satırsız contract'ı kabul eder) |
| 4 | REQ 21 Eki amendment SAT-01..04 + katalog | amendment bloğu `ELAN_EXPO_REQUIREMENTS_v1_0.md:30-106` · SAT-02 `:38-43` · SAT-01 `:44-47` · SAT-03/04 `:48-52` · 2.4 katalog `:58-64` (§4) |
| 5 | LIFFY UI 401'de login'e yönlendirme | **YOK** — "401" yalnız `components/sidebar.tsx:219/241/262` (sayaç yoklaması durur). Login'e yönlendirme yalnız token yok / çözülemiyor / `exp` geçmiş (`layout-client.tsx:75-97`, `hooks/useAuthGuard.ts:34-45`; imza denetimi yok) |

---

## 1. LIFFY DB (canlı, salt-okunur)

### 1.0 Şema (`information_schema.columns` — liffyv1 CLAUDE.md zorunlu kuralı; sorgular bu listeyle kuruldu)

| tablo | kolonlar |
|---|---|
| `products` | id, organizer_id, code, name, category, unit_type, is_active, created_by_user_id, created_at, updated_at |
| `product_prices` | id, product_id, office_id, currency, unit_price, created_by_user_id, created_at, updated_at |
| `quotes` | id, organizer_id, af_sequence, office_id, expo_id, person_id, sales_owner_user_id, subject, status, currency, exchange_rate_to_eur, valid_until, sent_at, signed_at, declined_at, signed_scan_url, notes, created_by_user_id, created_at, updated_at, company_name |
| `quote_line_items` | id, quote_id, product_id, description, unit_type, quantity, unit_price, discount_percent, tax_percent, sort_order, created_at, updated_at |
| `expos` | id, organizer_id, name, country_code, city, start_date, end_date, payment_deadline, default_currency, canonical_expo_id, is_active, created_by_user_id, created_at, updated_at |
| `users` | id, organizer_id, email, password_hash, role, is_active, created_at, daily_email_limit, first_name, last_name, manager_id, reports_to, permissions, office_id |
| `offices` | id, code, name, default_currency, created_at, updated_at |

### 1.1 Ürün kataloğu

- `products`: **toplam 1** · farklı kod 1 · aktif 1 · organizer 1 · `unit_type` m2 1 · `category` `TestCategory` 1 ·
  `RF%` 0 · `PES%` 0 · `SYK%` 0. REQ `:220` "~242 SKUs" → **girmemiş**.
- `product_prices`: **toplam 0** · fiyatlı ürün 0 · ofis başına (CN, DZ, GH, KE, MA, NG, TR) hepsi 0.
- İki quote kalemi de `product_id` dolu (ürünsüz kalem 0) ve tabloda tek ürün var → iki kalem de bu test ürününe bağlı
  (FK `quote_line_items.product_id → products.id`).

### 1.2 Quote'lar

| AF (türetilmiş) | status | scan | signed_at | `expo_id` dolu | kalem | vergili kalem | ürünsüz kalem |
|---|---|---|---|---|---|---|---|
| **ATR-100000** | signed | var | 2026-06-12 | evet | 1 | 0 | 0 |
| **QMA-100001** | sent | yok | — | evet | 1 | 0 | 0 |

- `quotes`: toplam 2 · organizer 1. `quote_line_items`: toplam 2 · vergili (`tax_percent > 0`) 0 · indirimli 1 · ürünsüz 0.
- AF numarası **saklanmaz, türetilir**: `A` (signed) / `Q` (diğer) + `offices.code` + `-` + `af_sequence`
  (`liffyv1/backend/routes/quotes.js:26-30`; `migrations/051_add_quotes.sql:3`, `:24`). Sorgu aynı formülle türetti
  (`af_sequence` 100000 / 100001).

### 1.3 Expo'lar

- `expos` (LIFFY): **toplam 1** · organizer 1 · `canonical_expo_id` **dolu 0 / boş 1**. Kolon "LEENA/ELIZA `expos.id` ile
  eşleşme, FK yok" diye açıklanmış (`migrations/050_add_offices_expos_catalog.sql:76`, `:90`, `:122`). İki quote'un
  `expo_id`'si bu expo'ya dolu → quote → LEENA expo bağı bugün kurulamaz.

### 1.4 Kullanıcı / ofis

- `users`: toplam 3 · aktif 3 · `office_id` **dolu 0 / boş 3** (ofis başına: `<NULL>` 3).
- `offices`: 7 — CN, DZ, GH, KE, MA, NG, TR. Quote'lar ofis taşıyor (ATR → TR, QMA → MA; `quotes.office_id`,
  `quotes.js:80-83` JOIN).

### 1.5 Yan bulgu — oturum kimliği

Bağlantı dizesindeki kullanıcı `liffy_app_2026b` (boolean doğrulandı), ama `current_user = liffy_user` döndü.
`session_user` ve `pg_roles.rolcanlogin` sorgulanmadı → açıklama ÖLÇÜLMEDİ. Olası: yeni kimlik eski sahip role rol
ayarıyla (`SET ROLE`) bağlı — Suer: `liffy_user` Faz A'da NOLOGIN (NOLOGIN rol `SET ROLE` hedefi olabilir; çelişki
değil). Kapatma sorgusu (salt-okunur): `SELECT session_user, current_user;` +
`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'liffy%';`

---

## 2. liffyv1 kod

### 2.1 Convert payload'ı

- `backend/routes/quotes.js` (1071 satır) uçları: ofis / kur / expo / ürün / fiyat (`:124-427`) · quote CRUD (`:428-962`)
  · durum geçişleri `send` `:963`, `decline` `:992`, `sign` `:1021`. **`convert` adlı uç / fonksiyon / payload kurucusu
  YOK.** liffyv1 izlenen kodunda (node_modules hariç) quote / contract bağlamında "convert" **0**.
- `POST /:id/sign` (`:1020-1069`): `sent → signed` UPDATE (`:1043-1047`) + `[QUOTE_SIGNED]` log (`:1055-1062`); dışarı
  çağrı yok. TODO `:1052-1054`: "when LEENA SendGrid pipeline integration is available … Future: convert to full
  project distribution notification".
- Payload'a en yakın şekil **`enrichQuote`** (`:103-116`): quote'un tüm kolonları + `af_number` + `line_items[]` (her
  satır `quote_line_items`'ın tüm kolonları + `line_total`) + `totals`. LEENA convert yorumu bunu bekler
  (`contracts.js:9-10` "LIFFY GET /quotes/:id enrichQuote bunları zaten verir").
- **LEENA convert sözleşmesiyle uyuşmazlıklar (Paket 3 girdisi — karar değil):**

| LEENA beklentisi | LIFFY bugün | kanıt |
|---|---|---|
| `line_items[].product_code` (L2a; `contracts.js:137`) | yok — satırda yalnız `product_id` (→ `products.code`) | §1.0 şema; `051_add_quotes.sql:112-137` |
| `line_items[].is_registration_fee === true` (L2a; `contracts.js:134`) | yok — kolon / bayrak yok; `RF%` kodlu ürün 0 | §1.0 · §1.1 |
| L4 satır toplamı `q × p × (1 − d/100)` **vergi HARİÇ** (`contracts.js:136`, `:144`) | `line_total` / `grand_total` **vergi DAHİL** (`quotes.js:16-21`, `:58`) | bugün vergili kalem 0 → fark yok; ilk vergili kalemde `revenue = grand_total` gönderilirse L4 400 |
| `af_number` okunur, yeniden hesaplanmaz (`contracts.js:9`, `:91-93`) | türetilmiş; signed'da `A…`, öncesinde `Q…` (`quotes.js:26-30`) | convert yalnız `signed` kabul eder (`contracts.js:96-98`) → `A…` gelir |
| `revenue` · `currency` · `exchange_rate` · `revenue_eur` (`contracts.js:70-73`) | `currency` · `exchange_rate_to_eur` (kolon) · tutar `totals.grand_total` / `grand_total_eur` (hesaplanan, `quotes.js:58-66`) | alan adları farklı → eşleme gerek |
| `company_id` soft-ref (`contracts.js:76`) | quote'ta `company_id` YOK, `company_name` var (052) | §1.0 şema |
| `expo_id` | contract'ta NULL kalır (`contracts.js:17`, `:192`); LIFFY expo `canonical_expo_id` 0/1 | §1.3 |

### 2.2 LIFFY → LEENA transport

- HTTP istemcisi (fetch / axios / http.request) kullanan backend dosyaları (node_modules ve yedekler hariç) **11**:
  `services/zohoService.js` (Zoho hesap / API host'ları) · `services/verificationService.js` (`api.zerobounce.net`) ·
  `services/urlMiners/reedExpoMiner.js`, `mcexpocomfortMiner.js` (`api.reedexpo.com`) · `services/urlMiner.js`
  (`liffy.app`) · `services/urlMiners/documentMiner.js`, `services/superMiner/services/pageAnalyzer.js`,
  `paginationHandler.js`, `services/superMiner/adapters/httpBasicMinerAdapter.js`, `services/miningOrchestrator.js`,
  `routes/miningJobs.js` (sabit host yok — madencilik hedef URL'leri). **LEENA / ELIZA adresi 0.**
- "leena / eliza" geçen kod satırları yalnız YORUM: `engines/action-engine/actionEngine.js:137`, `routes/quotes.js:1053`,
  `utils/bootGuards.js:2`.
- `process.env` adlarında LEENA / ELIZA tabanı yok; taban URL değişkenleri kendini gösterir: `API_BASE_URL` →
  `api.liffy.app` (`utils/unsubscribeHelper.js:25`), `MINING_API_BASE` → `api.liffy.app/api`
  (`services/playwrightMinerRunner.js:4`).
- liffy-ui: tek dış hedef `next.config` rewrite `/api/:path*` → `https://api.liffy.app/api/:path*` (`:4-8`); "leena /
  eliza" 0 (yalnız `app/help/page.tsx` destek e-posta adresi). Convert arayüzü yok ("convert" yalnız CSV dışa aktarımı,
  `app/mining/page.tsx:2409`).
- Karşı taraf: LEENA `contracts.js:7-8` "cross-system fetch YOK (transport LIFFY aktivasyonuna ertelendi)"; uç LEENA
  kullanıcı JWT'si ister (`authMiddleware`, `:25`, `:79`) — LIFFY'de LEENA kimliği / adresi taşıyan env yok.

---

## 3. LEENA convert ucu (`backend/leena-v401-backend/routes/contracts.js`, `origin/main` @ `2463259`, 1516 satır)

| karar (defter `ELL_DURUM_DEFTERI_v2.md:474-483`) | durum | kanıt |
|---|---|---|
| L1 `contract_line_items` (donmuş kopya) | ✅ var | INSERT `:200-209`; migration 024 (defter `:493-502`) |
| L2a `product_code` donmuş + `is_registration_fee` | ✅ var | `:134`, `:137`, `:202-207` |
| **L3** opsiyonel `line_items[]` | ✅ **İNŞA** | `:100-140` — yok / `[]` → satırsız contract (`:101`); dizi değilse 400 (`:104-106`); satır varken `currency` zorunlu (`:109-112`); satır doğrulama `:113-133`; `line_no` server atar (`:115`) |
| **L4** `grand_total ↔ revenue ±0.01` → 400 | ✅ **İNŞA** | `:142-153` — `revenue` zorunlu (`:146-148`), tolerans `:149-152`; INSERT'lerden önce |
| "LIFFY aktivasyonunda `line_items` ZORUNLU" (defter `:479-480`, `:538-541`) | ❌ **YOK** | `:101` satırsız contract'ı bugün de kabul eder |
| atomik tek tx · idempotency | ✅ | `:159-221`; `source_quote_id` UNIQUE → 409 (`:33-37`) |
| convert yetkisi | ⏳ Faz 4 notu | `:83-85` (bugün organizer kapsamı + geçerli JWT) |
| `expo_id` | NULL kalır | `:17`, `:192` |

İnşa kaydı: defter 2026-07-24 "FAZ 3b-2 TAMAM … convert L3/L4" (`:485-541`; backend `bd47d99`). Testler bu turda
koşulmadı (§7).

---

## 4. REQ satır numaraları (`ell-docs/ELAN_EXPO_REQUIREMENTS_v1_0.md` @ `776ae4b`)

| madde | satır |
|---|---|
| Amendment 2026-10-21 bloğu (başlık → Part 5) | **`:30-106`** (başlık `:30-35`) |
| 2.1 Kazanım hattı (**SAT-02**) | `:38-43` |
| 2.1 Lead tanımı (**SAT-01**) | `:44-47` |
| 2.1 Sahiplik / havuz kuralları (**SAT-03**, **SAT-04**) | `:48-52` |
| 2.4 **Katalog üretimi** (amendment) | `:58-64` |
| 2.8 eşikli uyarı "catalogue submission rate below threshold" | `:74` |
| 4.4 "Catalogue review with inline comments" düştü | `:100` |
| 2.4 özgün bölüm (amendment üstüne okunur) | `:671-761` |
| Ürün kataloğu "~242 SKUs" (quote kalemleri) | `:220` |
| 2.2 "Quoted Items — line items selected from the product catalogue" | `:419` |
| Kütük SAT-01..04 | `ELL_LOCKED_KARARLAR_OZET.md:227-230` |
| Defter ★ Paket 3 satırı ("REQ amendment … 2.1 + SAT-01..04, 2.4 katalog; SAT-04 tablosu burada") | `ELL_DURUM_DEFTERI_v2.md:4162` (★SIRA `:4153`) |

---

## 5. LIFFY UI — 401'de login'e yönlendirme (liffy-ui `main` @ `7b15ced`)

- **Yok.** Repo genelinde (node_modules hariç) "401" geçen tek dosya `components/sidebar.tsx`: `:219`, `:241`, `:262` —
  üçü de sayaç yoklamasını durdurur (`stopped = true`), yönlendirme yok.
- Login'e yönlendirme yalnız istemci tarafı token denetiminde (imza doğrulaması YOK, yalnız base64 çözüm):
  `components/layout-client.tsx:75-78` (token yok) · `:83-87` (çözülemiyor / e-posta yok) · `:92-97` (`exp` geçmiş);
  `hooks/useAuthGuard.ts:34-37` (token yok) · `:40-45` (`exp` geçmiş). Elle çıkış: `lib/auth.ts:16-32`.
- Merkezi fetch sarmalayıcısı / interceptor yok (`window.fetch =` / interceptor araması 0); her sayfa kendi `fetch`'ini
  `Authorization` başlığıyla yapar.
- Sonuç (FAZ B b4 gözlemini açıklar): sırrı değişmiş ama `exp`'i geçmemiş token istemci denetimini geçer → API 401 →
  arayüz yerinde kalır, veri gelmez. → Paket 3 notu "401'de login'e at" (ell-docs defter, FAZ B TAMAMLANDI).

---

## 6. Paket 3 kriter turuna girdi (ölçümden türeyen sorular — karar Sentez'de)

1. **Ürün kataloğu boş** (1 test ürünü, 0 fiyat): 242 SKU + 7 ofis fiyatı nereden, kim yükler? (REQ `:220`). Bugün quote →
   convert zinciri gerçek kalemle denenemez.
2. **L2a alan boşluğu:** LIFFY satırında `product_code` (türetilebilir: `products.code`) ve `is_registration_fee` (kaynak
   YOK) — RF bayrağı ürün kaydında mı, kodda mı (ör. `RF` öneki)?
3. **Vergi ↔ L4:** LIFFY `grand_total` vergi dahil, LEENA L4 vergi hariç — `revenue` hangisi, vergi satır mı?
4. **Expo eşlemesi:** `canonical_expo_id` 0/1 — LIFFY expo'su LEENA expo'suna nasıl bağlanır (Convert-1 `expo_id`)?
5. **`users.office_id` 0/3:** SAT-04 bölge yasağı (ofis / kullanıcı → satabileceği ülkeler) kullanıcı-ofis bağı bugün yok.
6. **Transport yok:** payload kim gönderir (LIFFY push / LEENA pull), servis kimliği ne (LEENA `authMiddleware` kullanıcı
   JWT'si ister)? `line_items` ZORUNLU geçişi ne zaman?
7. **UI 401 → login** (FAZ B b4 notu).

---

## 7. ⚠️ ÖLÇÜLMEDİ / GÖZLENEMEDİ

- LEENA DB (`contracts`, `contract_line_items`, LEENA `expos` sayıları) — kapsamda yoktu, okunmadı.
- `session_user` + `liffy_user` `rolcanlogin` (§1.5).
- LEENA convert testleri bu turda koşulmadı (defter 2026-07-24: 27/27).
- Canlı servislerin ölçülen commit'leri koştuğu: liffy-api (`0e4b8a7` push'u `origin/main`'de ölçüldü; deploy logu
  okunmadı) · liffy-ui canlı build'i (`7b15ced`; deploy kaydı okunmadı) · LEENA canlı (`2463259`).
- 242 SKU'nun kaynağı (Zoho / Excel / eliza-legacy ürün tablosu).
- Tek test ürününün kim / ne zaman eklediği (`created_by_user_id`, `created_at` okunmadı).
- Arayüzün quote'a hangi ofisi önerdiği.

## 8. Bilinçle yapılmayanlar

- İnşa / kod değişikliği / DB yazımı / migration.
- Satır verisi basmak (şirket adı, e-posta, quote / kullanıcı kimliği) — ölçüm için gereksiz.
- Yan bulgu, Paket 3 dışı, dokunulmadı: liffyv1'de `backend/node_modules` git'te izleniyor (**1290 dosya**).

## 9. Yeniden üretim

- DB (salt-okunur; bağlantı dizesi yalnız env / pano, basılmaz): `BEGIN READ ONLY` → `SHOW transaction_read_only` →
  `information_schema.columns` (7 tablo) → `products` sayım + `unit_type` / `category` / `RF%`/`PES%`/`SYK%` →
  `product_prices` sayım + ofis başına (`LEFT JOIN offices`) + fiyatsız ürün → `quotes` sayım + `status` dağılımı +
  türetilmiş AF (`CASE status='signed' 'A' ELSE 'Q'` ‖ `offices.code` ‖ `'-'` ‖ `af_sequence`) + kalem / vergili /
  ürünsüz sayısı → `quote_line_items` sayım → `expos` `count(canonical_expo_id)` → `users` `count(office_id)` +
  `is_active` → `offices` kodları → `ROLLBACK`.
- Kod: `git grep` (liffyv1 `backend`, node_modules ve `*.backup*` hariç) — `convert.*(quote|contract)`,
  `leena|eliza|LEENA_|ELIZA_`, `fetch(|axios|http(s).request(` + dosya başına sabit host; liffy-ui `401`,
  `router.push|replace('/login')`, `removeItem('liffy_token')`, `rewrites`; LEENA `contracts.js` `origin/main`'den
  `git show` ile okundu (çalışma kopyası değil).
