-- ============================================================================
-- 023_drop_contracts_sales_agent_id.sql — eski tekil sales_agent_id DROP
-- ----------------------------------------------------------------------------
-- EXPAND → CONTRACT'ın CONTRACT adımı (K2a). 020'de üçlü agent/sr/sd FK+pct
-- eklendi (expand); 3b-1'de tüm kod bu üçlüye geçti ve eski tekil kolona yazan/
-- okuyan kod SIFIRLANDI (word-boundary grep 0, routes/public/scripts/utils).
-- Artık DROP güvenli.
--
-- IF EXISTS KULLANILMADI (bilinçli): kolon yoksa hata almak İSTİYORUZ — bu
-- migration'ın iki kez uygulanması ya da beklenmedik şema durumu DUR sinyali
-- olsun.
--
-- DROP COLUMN, kolon üzerindeki FK constraint'i (contracts_sales_agent_id_fkey,
-- 012:91) otomatik düşürür — ayrı DROP CONSTRAINT gerekmez.
--
-- Bağımlılık: 012 (kolon burada tanımlı) · 020 (üçlü model — halef)
-- ============================================================================

ALTER TABLE contracts DROP COLUMN sales_agent_id;

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('023_drop_contracts_sales_agent_id', now())
ON CONFLICT (version) DO NOTHING;
