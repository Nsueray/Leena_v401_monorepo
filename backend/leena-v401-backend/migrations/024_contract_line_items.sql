-- ============================================================================
-- 024_contract_line_items.sql — contract satır kalemleri (L kararları)
-- ----------------------------------------------------------------------------
-- L1: quote satırlarının convert anında DONMUŞ kopyası. Komisyon motorunun
-- matrah önkoşulu (K7b): matrah = Σ(quantity × unit_price × (1 − discount/100))
-- yalnız is_registration_fee = false satırlar; vergi yapısal olarak dışarıda,
-- RF bayrakla dışarıda.
--
-- ── ÖLÇÜME GÖRE (012 + 016; sapmalar aşağıda) ────────────────────────────────
--   unit_price   numeric(14,2) = contracts.revenue hassasiyeti (012:72).
--   quantity     numeric(10,2) = contracts.sqm hassasiyeti (016:25).
--                ⚠️ SAPMA: taslak NUMERIC(12,2) diyordu; ölçüm sqm=(10,2) →
--                D kuralı gereği ÖLÇÜM izlendi (sqm ile birebir m² hassasiyeti).
--   currency     text = contracts.currency (012:73). contracts.currency üzerinde
--                DB-CHECK YOK → burada da CHECK KONMADI (uydurma yasak).
--                (UI/endpoint tarafı EUR/USD/TRY/MAD/NGN/KES normalize eder;
--                 ama şema seviyesinde liste zorlaması yoktur — mevcut desenle
--                 tutarlı.)
--   created_at   timestamptz NOT NULL DEFAULT now() = ev deseni (012:84, 017:36).
--
-- ── KISITLAR — HEPSİ AÇIK ADLA ───────────────────────────────────────────────
-- 016'nın açık-ad stili (contracts_transportation_check) + 017 dersi (isimsiz
-- CHECK'in otomatik adını sonradan tahmin etmek zorunda kalmıştık). Not: 017
-- payments CREATE TABLE inline/isimsiz kısıt kullanmıştı; 024 bilinçli olarak
-- TÜM kısıtları açık adla verir.
--
-- ── BİLİNÇLİ YOK'lar ─────────────────────────────────────────────────────────
--   -- satır toplamı kolonu YOK (D2: saklanmaz, okuma anında hesaplanır)
--   -- updated_at YOK (tablo immutable; UPDATE/DELETE endpoint'i olmayacak)
--   -- FK ON DELETE CASCADE YOK (bilinçli — satırlar contract'la sessizce silinmez)
--   -- ayrı index YOK: UNIQUE(contract_id, line_no) index'i contract_id ile
--      başladığı için FK araması da ondan yararlanır
--   -- product_code FK YOK (donmuş SKU metni; katalog yoksa serbest satır olabilir)
--
-- Bağımlılık: 012 (contracts)
-- ============================================================================

CREATE TABLE contract_line_items (
  id                  serial        PRIMARY KEY,
  contract_id         integer       NOT NULL,
  line_no             integer       NOT NULL,
  product_code        text,                              -- donmuş SKU; nullable; FK YOK
  description         text          NOT NULL,
  quantity            numeric(10,2) NOT NULL,
  unit_price          numeric(14,2) NOT NULL,
  discount_percent    numeric(5,2)  NOT NULL DEFAULT 0,
  is_registration_fee boolean       NOT NULL DEFAULT false,
  currency            text          NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT contract_line_items_contract_id_fkey
    FOREIGN KEY (contract_id) REFERENCES contracts(id),
  CONSTRAINT contract_line_items_contract_line_no_key
    UNIQUE (contract_id, line_no),
  CONSTRAINT contract_line_items_quantity_check
    CHECK (quantity > 0),
  CONSTRAINT contract_line_items_unit_price_check
    CHECK (unit_price >= 0),
  CONSTRAINT contract_line_items_discount_percent_check
    CHECK (discount_percent >= 0 AND discount_percent <= 100)
);

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('024_contract_line_items', now())
ON CONFLICT (version) DO NOTHING;
