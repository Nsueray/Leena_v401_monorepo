-- ============================================================================
-- 025_commission_payouts.sql — LEENA Finance: agent'a FİİLİ komisyon ödemeleri
-- (PAYOUT P1, Faz 3b sonrası — cari hesap modeli)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablo; mevcut hiçbir tabloya/kolona/veriye dokunmaz.
-- Bu migration uygulandığında hiçbir kod payout'ları okuyup/yazmıyor olabilir;
-- endpoint'ler aynı dilimde gelir ama tablo eksikse yüklenmez (deploy güvenli).
--
-- Bağımlılık: 012_finance_foundation.sql (sales_agents tablosu).
--
-- ── MODEL (cari hesap — Suer kararı 2026-07-27) ──
-- - Bu tablo KOMİSYONU değil, agent'a yapılan ÖDEMEYİ saklar. Hak ediş (earned)
--   HER OKUMADA türetilir (D2), asla saklanmaz. Bakiye = Σ earned (türetilmiş)
--   − Σ payout.amount_eur, okuma anında hesaplanır.
-- - Dönem / kesim (cut_date) kolonu BİLİNÇLİ YOK — cari hesap, dönem-kilitli
--   defter değil. İleride "eksik" sanılıp EKLENMEYECEK.
-- - Clawback ayrı mekanizma DEĞİL: fazla ödeme → bakiye negatif → sonraki
--   ödemede doğal mahsup. Negatif bakiye ENGELLENMEZ.
-- - Düzeltme = YENİ satır + negatif tutar + reverses_payout_id. UPDATE/DELETE YOK
--   (payments 018 storno emsali). Tablo append-only/immutable olay akışıdır.
-- - `updated_at` KOYULMADI: immutable olay (payments 017:22-23 emsali birebir).
-- - `payment_method` KOYULMADI: Sentez'de yok; gerekirse ayrı dilimde eklenir
--   (spekülatif kolon açmaktan kaçınıldı).
-- - Frozen-EUR dörtlüsü payments 017:39-42'den BİREBİR: amount/currency/
--   exchange_rate/amount_eur. currency DEFAULT 'EUR' (payout'lar çoğunlukla EUR).
-- - amount_eur ÜZERİNDE CHECK YOK: payments'ta da yok (018:27 — işaret tutarlılığı
--   server garantisi, DB'de ikinci CHECK kurulmaz). Emsali izliyoruz.
-- - PK integer serial (S7 v1.2 — LEENA native tip; UUID değil).
--
-- ── BİLİNEN SAPMA (zararsız, tetikli) ──
-- - sales_agents.default_commission_pct agent+SR için ORTAK kolon (020:49 —
--   bilinen sapma). 2026-07-27 ölçümü: çift-rollü (hem agent/SR hem SD) agent
--   sayısı = 0 → bugün zararsız. TETİK: ilk çift-rollü agent doğunca kolon ayrılır.
-- ============================================================================

CREATE TABLE commission_payouts (
  id                 serial        PRIMARY KEY,
  organizer_id       integer       NOT NULL,
  sales_agent_id     integer       NOT NULL,
  amount             numeric(14,2) NOT NULL,
  currency           text          NOT NULL DEFAULT 'EUR',
  exchange_rate      numeric(18,8) NOT NULL,
  amount_eur         numeric(14,2) NOT NULL,
  payout_date        date          NOT NULL,
  notes              text,
  reverses_payout_id integer,
  created_by         integer,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT commission_payouts_sales_agent_id_fkey
    FOREIGN KEY (sales_agent_id) REFERENCES sales_agents(id),
  CONSTRAINT commission_payouts_reverses_fkey
    FOREIGN KEY (reverses_payout_id) REFERENCES commission_payouts(id),
  -- 018:51-53 deseni: normal ödeme pozitif + reversal negatif (işaret zorunlu).
  CONSTRAINT commission_payouts_amount_check
    CHECK ((reverses_payout_id IS NULL AND amount > 0)
        OR (reverses_payout_id IS NOT NULL AND amount < 0)),
  CONSTRAINT commission_payouts_exchange_rate_check
    CHECK (exchange_rate > 0)
);

-- 018:55-57 deseni: bir payout yalnız bir kez terslenebilir (yarış → 23505/409).
CREATE UNIQUE INDEX uq_commission_payouts_reverses
  ON commission_payouts (reverses_payout_id)
  WHERE reverses_payout_id IS NOT NULL;

-- Statement sorgusu (agent bazında SUM) + organizer scope için.
CREATE INDEX ix_commission_payouts_agent
  ON commission_payouts (organizer_id, sales_agent_id, payout_date);

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('025_commission_payouts', now())
ON CONFLICT (version) DO NOTHING;
