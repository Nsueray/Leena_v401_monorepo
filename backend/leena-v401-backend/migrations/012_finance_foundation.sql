-- ============================================================================
-- 012_finance_foundation.sql — LEENA Finance çekirdeği (contracts + sales_agents)
-- ----------------------------------------------------------------------------
-- NOT: Bu dosya 2026-07-21'de canlı DB kataloğundan birebir yeniden kuruldu
-- (pg_dump değil; orijinal 2026-06-20 Render Shell'den elle uygulanmıştı,
-- dosyası hiç commit'lenmemişti).
--
-- Kaynak: information_schema.columns + pg_constraint + pg_indexes sorguları
-- (ELL_MUTABAKAT_2026-07-21.md, Ek A). Kolonlar, tipler, NOT NULL/DEFAULT,
-- CHECK, FK ve index tanımları canlı DB ile birebir eşleşir. Orijinal dosyanın
-- yorumlarını içermez.
--
-- Şema CANLIDA ZATEN MEVCUT. Bu dosya iki amaca hizmet eder:
--   1. Sıfırdan kurulan ortamların (staging, yeni geliştirici) 011'de kalmaması
--   2. 013+ migration'ların dayanacağı yazılı şema tanımı
-- Bu yüzden tüm CREATE'ler IF NOT EXISTS ile sarmalanmıştır — canlı DB'de
-- çalıştırılırsa no-op olur.
--
-- Bağımlılık: expos tablosu (contracts.expo_id → expos(id) FK)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sales_agents — komisyon entity'si (≠ user; çoğu agent'ın login'i yok)
-- ----------------------------------------------------------------------------
-- ⚠️ AÇIK KARAR (S7, ELL_MUTABAKAT_2026-07-21.md): Bu tablo canlıda integer
-- SERIAL PK ile duruyor (LEENA konvansiyonu). Locked B2/B3 hedef şeması ise
-- UUID PK + organization_id + user_id nullable UNIQUE diyor (ELIZA Slice 1
-- kökenli). Karar Faz 3b öncesi verilecek — bu dosya CANLI DURUMU yansıtır,
-- hedef şemayı değil. user_id UNIQUE her durumda eklenecek (henüz yok).
-- id: canlıda klasik SERIAL (DEFAULT nextval('sales_agents_id_seq')), IDENTITY değil.
CREATE TABLE IF NOT EXISTS sales_agents (
  id           serial      NOT NULL,
  organizer_id integer     NOT NULL,
  name         text        NOT NULL,
  agent_type   text        NOT NULL,
  user_id      integer,
  created_by   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_agents_pkey PRIMARY KEY (id),
  CONSTRAINT sales_agents_agent_type_check
    CHECK (agent_type = ANY (ARRAY['internal', 'external_agency', 'external_freelance']))
);

CREATE INDEX IF NOT EXISTS idx_sales_agents_organizer_id
  ON sales_agents USING btree (organizer_id);

-- ----------------------------------------------------------------------------
-- contracts — post-convert finans çekirdeği
-- ----------------------------------------------------------------------------
-- Tasarım notları (defter 2026-06-20 bloğu):
--   - 4-status CHECK, 'Draft' BİLİNÇLİ DIŞARIDA: contract signed quote'tan
--     doğar, doğduğu an Active.
--   - Frozen-EUR: revenue/currency/exchange_rate/revenue_eur birlikte saklanır,
--     kur sonradan değişse de belge değişmez (bilgi kaybını önler).
--   - LIFFY soft-ref'leri (source_quote_id/sales_owner_user_id/company_id) uuid
--     ve FK'siz — kaynak sistemin tipinde, cross-DB gerçek FK yok.
--   - expo_id → expos(id) AYNI DB gerçek FK (2026-06-19 ELIZA-terk kararının
--     somut kazancı: UUID↔integer çıkmazı yok).
--   - sales_agent_id kolonu şimdi, doldurma Faz 3b (027/028 dersi: ikinci
--     ALTER'dan kaçın).
--   - Audit (created_by integer / converted_by uuid) bilinçli iki tip, iki
--     kaynak; Faz 4 kimlik birleşmesinde çözülecek.
-- id: canlıda klasik SERIAL (DEFAULT nextval('contracts_id_seq')), IDENTITY değil.
CREATE TABLE IF NOT EXISTS contracts (
  id                  serial       NOT NULL,
  organizer_id        integer      NOT NULL,
  expo_id             integer,
  af_number           text,
  company_name        text,
  contract_date       date,
  revenue             numeric(14,2),
  currency            text,
  exchange_rate       numeric(18,8),
  revenue_eur         numeric(14,2),
  status              text         NOT NULL DEFAULT 'Active'::text,
  source_quote_id     uuid,
  sales_owner_user_id uuid,
  company_id          uuid,
  sales_agent_id      integer,
  created_by          integer,
  converted_by        uuid,
  converted_at        timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contracts_pkey PRIMARY KEY (id),
  CONSTRAINT contracts_status_check
    CHECK (status = ANY (ARRAY['Active', 'On Hold', 'Transferred', 'Cancelled'])),
  CONSTRAINT contracts_expo_id_fkey
    FOREIGN KEY (expo_id) REFERENCES expos(id),
  CONSTRAINT contracts_sales_agent_id_fkey
    FOREIGN KEY (sales_agent_id) REFERENCES sales_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_contracts_expo_id
  ON contracts USING btree (expo_id);

CREATE INDEX IF NOT EXISTS idx_contracts_organizer_id
  ON contracts USING btree (organizer_id);

-- ⚠️ IDEMPOTENCY ANAHTARI — routes/contracts.js:33 bu index ADINI bekler
-- (mapWriteError: err.constraint === 'idx_contracts_source_quote_id' → 409).
-- Adı değiştirilirse convert endpoint'inin 409 yolu sessizce bozulur.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_source_quote_id
  ON contracts USING btree (source_quote_id)
  WHERE (source_quote_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Bilinen eksikler (bu dosya canlı durumu yansıtır, düzeltme İÇERMEZ):
--   - Her iki tabloda da updated_at trigger'ı YOK; updated_at uygulama
--     katmanının sorumluluğunda.
--   - sales_agents.user_id üzerinde UNIQUE constraint YOK (S7 kararıyla
--     birlikte eklenecek).
-- ----------------------------------------------------------------------------
