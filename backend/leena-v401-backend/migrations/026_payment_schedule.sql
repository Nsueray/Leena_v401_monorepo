-- ============================================================================
-- 026_payment_schedule.sql — LEENA Finance: ödeme planı (PS1) + ofis referansı
-- ----------------------------------------------------------------------------
-- ADDITIVE. Üç bölüm: (A) offices referansı · (B) payment_schedule_items ·
-- (C) payments'a iki nullable kolon. Mevcut veriye dokunmaz.
-- Bağımlılık: 010 (core_countries), 012 (contracts), 017 (payments).
--
-- ── KİLİTLİ HÜKÜMLER ──
-- - Schedule PLANDIR, payments OLAYDIR — ikisi ayrı kalır, eşleşme ZORLANMAZ (S-13r).
-- - Kur DONDURULMAZ: plan bir para hareketi değildir → exchange_rate/amount_eur YOK (S-4).
-- - Revizyonda satır SİLİNMEZ/UPDATE EDİLMEZ: eski satırlara `superseded_at` damgası +
--   yeni satırlar. Aktif plan = superseded_at IS NULL (S-5).
-- - "Ödenmemiş" durumu SAKLANMAZ, türetilir: Σ schedule > Σ payments, kontrat
--   seviyesinde (S-7). Zoho'nun "Payment Done ✓" / "Validity" deseni KOPYALANMAZ.
-- - `schedule_item_id` (payments'ta) bilinçli olarak MANTIKSIZ eklendi: plan↔ödeme
--   eşleştirmesi PS2+ işi; kolon şimdi, mantık sonra (S-6).
-- - offices = LEENA-master referans; LIFFY office verisiyle uzlaştırma BİRLEŞME işi (S-11r).
-- - Ofis listesi KODA GÖMÜLMEZ; tüketici tablodan okur (S-16r). payment_method bu kuralın
--   DIŞINDA — kapalı küme, CHECK kalır (H6).
-- - default üretici expo tarihine bağımlıdır; expo_id bugün nullable (Convert-1 ertelendi).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) offices — sade LEENA-master referans (S-11r/S-16r)
-- ----------------------------------------------------------------------------
CREATE TABLE offices (
  id           serial      PRIMARY KEY,
  name         text        NOT NULL,
  country_code char(2)     NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offices_name_key UNIQUE (name),
  CONSTRAINT offices_country_code_fkey
    FOREIGN KEY (country_code) REFERENCES core_countries(code)   -- expos.country_code emsali (010:88)
);

-- SEED: tam 5 ofis (İngilizce ad). Çarpım tablosu YOK. Tekrar-çalıştırılabilir.
INSERT INTO offices (name, country_code) VALUES
  ('Turkey',  'TR'),
  ('Morocco', 'MA'),
  ('Nigeria', 'NG'),
  ('Kenya',   'KE'),
  ('China',   'CN')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- (B) payment_schedule_items — plan kalemleri (revizyonlu, kur-suz, durum-suz)
-- ----------------------------------------------------------------------------
CREATE TABLE payment_schedule_items (
  id                 serial        PRIMARY KEY,
  organizer_id       integer       NOT NULL,                     -- payments/commission_payouts emsali
  contract_id        integer       NOT NULL,
  revision           integer       NOT NULL DEFAULT 1,
  item_no            integer       NOT NULL,
  due_date           date          NOT NULL,                     -- takvim günü, TZ yok
  amount             numeric(14,2) NOT NULL,
  currency           text          NOT NULL,                     -- kontrattan kopyalanır; CHECK YOK (ev deseni)
  percent            numeric(5,2),                               -- yüzdeyle girildiyse kaynak yüzde (izlenebilirlik)
  source             text          NOT NULL,
  expected_office_id integer,
  expected_method    text,
  notes              text,
  superseded_at      timestamptz,                                -- H3: revizyon damgası
  created_by         integer,
  created_at         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT payment_schedule_items_contract_id_fkey
    FOREIGN KEY (contract_id) REFERENCES contracts(id),
  CONSTRAINT payment_schedule_items_expected_office_id_fkey
    FOREIGN KEY (expected_office_id) REFERENCES offices(id),
  CONSTRAINT payment_schedule_items_amount_check
    CHECK (amount > 0),
  CONSTRAINT payment_schedule_items_percent_range_check
    CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  CONSTRAINT payment_schedule_items_source_check
    CHECK (source IN ('manual_amount', 'manual_percent', 'default')),
  -- H7: expected_method sözlüğü = payments.payment_method ile AYNI beş değer.
  CONSTRAINT payment_schedule_items_expected_method_check
    CHECK (expected_method IS NULL OR expected_method IN
           ('bank_transfer', 'cash', 'cheque', 'credit_card', 'other'))
);

-- Aktif planda item_no tekilliği (yarış-korumalı; superseded satırlar hariç).
CREATE UNIQUE INDEX uq_payment_schedule_items_active_item
  ON payment_schedule_items (contract_id, item_no)
  WHERE superseded_at IS NULL;

CREATE INDEX ix_payment_schedule_items_contract
  ON payment_schedule_items (organizer_id, contract_id, due_date);

-- ----------------------------------------------------------------------------
-- (C) payments — iki nullable kolon, TEK turda (027/028 dersi: ikinci ALTER'dan kaçın)
-- ----------------------------------------------------------------------------
-- payment_method'a DOKUNULMADI (H7). Mantık PS2+ (S-6/S-12r).
ALTER TABLE payments
  ADD COLUMN schedule_item_id   integer REFERENCES payment_schedule_items(id),  -- S-6
  ADD COLUMN received_office_id integer REFERENCES offices(id);                  -- S-12r

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('026_payment_schedule', now())
ON CONFLICT (version) DO NOTHING;
