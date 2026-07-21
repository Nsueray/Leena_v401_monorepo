-- ============================================================================
-- 016_contract_operational_columns.sql — contracts operasyonel kolonlar (Faz 3a-1)
-- ----------------------------------------------------------------------------
-- TAMAMI ADDITIVE. Mevcut kolonlara, constraint'lere ve verilere dokunmaz;
-- canlı akışlara (POST /api/contracts/convert dahil) sıfır etki. Yeni kolonların
-- hepsi nullable ve DEFAULT'suz — mevcut tek satır (id=1) etkilenmez, convert
-- endpoint'inin INSERT kolon listesi değişmediği için çalışmaya devam eder.
--
-- KAPSAM DIŞI (bilinçli):
--   - total_m2: türev değer, sqm/free_sqm'den HESAPLANIR — kolon olarak
--     tutulmaz (D2 kararı).
--   - Komisyon kolonları: bilinçli erteleme.
--
-- NOT: Bu dosya schema_migrations INSERT'i İÇERMEZ — kayıt cümlesi ayrıca
-- verilir ve uygulama sırasında elle çalıştırılır.
--
-- Bağımlılık: 012_finance_foundation.sql (contracts tablosu)
-- ============================================================================

ALTER TABLE contracts
  ADD COLUMN scan_link                    text,
  ADD COLUMN stand_design_link            text,
  ADD COLUMN catalogue_page               text,
  ADD COLUMN stand_type                   text,
  ADD COLUMN sqm                          numeric(10,2),
  ADD COLUMN free_sqm                     numeric(10,2),
  ADD COLUMN sales_group                  text,
  ADD COLUMN transportation               text,
  ADD COLUMN transferred_from_contract_id integer REFERENCES contracts(id);

-- transportation: serbest metin değil, iki değerli. NULL serbest (henüz
-- belirlenmemiş sözleşmeler için).
ALTER TABLE contracts ADD CONSTRAINT contracts_transportation_check
  CHECK (transportation IS NULL OR transportation IN ('Included', 'Excluded'));

-- Bir sözleşme kendisinden devredilmiş olamaz. (Daha uzun döngüleri —
-- A→B→A — bu CHECK yakalamaz; satır-içi kontrol yalnız kendine referansı
-- engeller.)
ALTER TABLE contracts ADD CONSTRAINT contracts_no_self_transfer_check
  CHECK (transferred_from_contract_id IS NULL
         OR transferred_from_contract_id <> id);
