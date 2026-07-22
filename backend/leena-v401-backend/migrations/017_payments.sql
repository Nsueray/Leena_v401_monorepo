-- ============================================================================
-- 017_payments.sql — LEENA Finance: fiili ödeme kayıtları (Faz 3a-2)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablo; mevcut hiçbir tabloya/kolona/veriye dokunmaz.
-- Bu migration uygulandığında hiçbir kod payments'ı okumuyor/yazmıyor —
-- deploy etkisizdir (endpoint'ler sonraki dilimde gelir).
--
-- MODEL (requirements 2.6): "each actual payment event is one Revenue record,
-- attributed to the originating contract" (req :1002). Bir contract çok ödeme
-- alır; ilişki many-to-one.
--
-- FROZEN-EUR (req 3.3, :1513): tutar kendi para biriminde + giriş anında donan
-- kur + EUR karşılığı birlikte saklanır. Kur kaydedildikten sonra o ödemenin
-- ömrü boyunca değişmez (req :1525).
--
-- D2 — HESAPLANAN, SAKLANMAYAN: contract'ın "toplam tahsilat"ı bu tablonun
-- SUM'ıdır, contracts'ta denormalize alan tutulmaz (req :1004, :519, :1543).
-- Bu yüzden paid_eur / balance_eur benzeri hiçbir toplam kolonu YOK.
--
-- BİLİNÇLİ OLARAK YOK (sonraki dilimler — eklemeyin):
--   - account_id, payer      → ledger fazı (additive eklenecek)
--   - updated_at             → payments bu dilimde immutable event; UPDATE
--                              endpoint'i yok
--   - payment_schedule / installment → kapsam dışı (plan ≠ gerçekleşen,
--                              req :509-511, :564)
--   - trigger, view, ek index → yok
--
-- organizer_id: 012_finance_foundation.sql:67'deki contracts tanımıyla birebir
-- (integer NOT NULL, FK YOK — contracts'ta da organizer_id üzerinde FK yok;
-- oradaki FK'ler yalnız expo_id ve sales_agent_id üzerinde, 012:90 ve 012:92).
--
-- Bağımlılık: 012_finance_foundation.sql (contracts tablosu)
-- ============================================================================

CREATE TABLE payments (
  id             serial PRIMARY KEY,
  organizer_id   integer NOT NULL,
  contract_id    integer NOT NULL REFERENCES contracts(id),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  currency       text NOT NULL,
  exchange_rate  numeric(18,8) NOT NULL CHECK (exchange_rate > 0),
  amount_eur     numeric(14,2) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN
                 ('bank_transfer','cash','cheque','credit_card','other')),
  payment_date   date NOT NULL,
  notes          text,
  created_by     integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_contract_id ON payments (contract_id);

-- ----------------------------------------------------------------------------
-- Migration kaydı (013_schema_migrations.sql:65-67 şablonu)
-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut 18 kayıtla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('017_payments', now())
ON CONFLICT (version) DO NOTHING;
