-- ============================================================================
-- 020_commission_agents.sql — komisyon agent yapısı (EXPAND adımı)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni kolon + CHECK ekler; mevcut kolonlara/veriye dokunmaz.
-- Hiçbir kod yeni kolonları okumaz — deploy etkisiz.
--
-- ÜÇLÜ MODEL (req :461-469 — Agent / SR / SD):
--   - Agent: dış partner (acente/freelance), login yok.
--   - SR:    iç satışçı (deal'i doğrudan kapatan).
--   - SD:    SR'ın komisyon paylaşan yöneticisi.
--   Dışlayıcılık (req :459): "Only one of Agent vs SR is set per contract,
--   never both." + SD yalnız SR varken anlamlı. Bu tek-satır kuralları
--   CHECK'in tam işi → DB'de zorlanır (uygulama katmanında değil):
--     - contracts_agent_sr_exclusive_check: agent XOR sr (ikisi birden dolamaz)
--     - contracts_sd_requires_sr_check: sd varsa sr zorunlu
--
-- ORAN ÇÖZÜMÜ (motor diliminde, bu migration'da DEĞİL): contract override pct
--   doluysa o kazanır; boşsa sales_agents.default_commission_pct (req :475).
--   Bu dosya yalnız alanları + sınırları kurar; çözüm mantığı endpoint dilimi.
--
-- B18: tüm yüzde alanları 0-100 range CHECK (schema-level, tutarlı pattern).
-- Tüm CHECK'ler AÇIK ADLA yazıldı (017 dersi: isimsiz CHECK'in Postgres'in
-- ürettiği otomatik adını sonradan tahmin etmek zorunda kalmıştık).
--
-- SUER ONAYLI EK — öksüz pct engeli (contracts_*_pct_requires_fk_check):
--   override ancak ilgili FK doluyken anlamlı; agent_pct dolu ama
--   agent_sales_agent_id NULL ise "kime %kaç" belirsiz kalır → DB engeller.
--
-- EXPAND → CONTRACT: 012'deki tekil sales_agent_id (bugün hep NULL) bu dosyada
--   DÜŞÜRÜLMEDİ — canlı kod hâlâ okuyor (contracts.js GET join + transfer klon).
--   Kod yeni üçlü kolonlara geçtikten SONRA 022'de DROP edilecek
--   (expand→contract deseni, sıfır kırılma penceresi). K2a kararı geçerli,
--   yalnız sıralandı.
--
-- Yeni FK'lere INDEX EKLENMEDİ — ölçek gereği gereksiz (bilinçli; contracts
--   tablosu bugün 2 satır, komisyon sorguları contract-bazlı).
--
-- MEVCUT VERİ: canlıdaki 2 contract + sales_agents satırları tüm yeni CHECK'leri
--   NULL'la trivially geçer. ADD CONSTRAINT mevcut satırları da DOĞRULAR —
--   ihlal hatası çıkarsa DUR, uygulama.
--
-- Bağımlılık: 012 (contracts, sales_agents) · 014 (sales_agents invariant'ları)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sales_agents: kişi bazlı default komisyon yüzdesi (req :475)
-- ----------------------------------------------------------------------------
ALTER TABLE sales_agents
  ADD COLUMN default_commission_pct numeric(5,2);

ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_default_pct_range_check
  CHECK (default_commission_pct >= 0 AND default_commission_pct <= 100);

-- ----------------------------------------------------------------------------
-- contracts: üçlü FK + üçlü override pct (req :461-469)
-- ----------------------------------------------------------------------------
ALTER TABLE contracts
  ADD COLUMN agent_sales_agent_id integer REFERENCES sales_agents(id),
  ADD COLUMN sr_sales_agent_id    integer REFERENCES sales_agents(id),
  ADD COLUMN sd_sales_agent_id    integer REFERENCES sales_agents(id),
  ADD COLUMN agent_pct numeric(5,2),
  ADD COLUMN sr_pct    numeric(5,2),
  ADD COLUMN sd_pct    numeric(5,2);

-- Dışlayıcılık: Agent ve SR aynı anda dolamaz (req :459).
ALTER TABLE contracts
  ADD CONSTRAINT contracts_agent_sr_exclusive_check
  CHECK (agent_sales_agent_id IS NULL OR sr_sales_agent_id IS NULL);

-- SD yalnız SR varken anlamlı (SD, SR'ın yöneticisi).
ALTER TABLE contracts
  ADD CONSTRAINT contracts_sd_requires_sr_check
  CHECK (sd_sales_agent_id IS NULL OR sr_sales_agent_id IS NOT NULL);

-- B18: yüzde sınırları 0-100.
ALTER TABLE contracts
  ADD CONSTRAINT contracts_agent_pct_range_check
  CHECK (agent_pct >= 0 AND agent_pct <= 100);

ALTER TABLE contracts
  ADD CONSTRAINT contracts_sr_pct_range_check
  CHECK (sr_pct >= 0 AND sr_pct <= 100);

ALTER TABLE contracts
  ADD CONSTRAINT contracts_sd_pct_range_check
  CHECK (sd_pct >= 0 AND sd_pct <= 100);

-- Suer onaylı ek: öksüz pct engeli — override ancak ilgili FK doluyken anlamlı.
ALTER TABLE contracts
  ADD CONSTRAINT contracts_agent_pct_requires_fk_check
  CHECK (agent_pct IS NULL OR agent_sales_agent_id IS NOT NULL);

ALTER TABLE contracts
  ADD CONSTRAINT contracts_sr_pct_requires_fk_check
  CHECK (sr_pct IS NULL OR sr_sales_agent_id IS NOT NULL);

ALTER TABLE contracts
  ADD CONSTRAINT contracts_sd_pct_requires_fk_check
  CHECK (sd_pct IS NULL OR sd_sales_agent_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('020_commission_agents', now())
ON CONFLICT (version) DO NOTHING;
