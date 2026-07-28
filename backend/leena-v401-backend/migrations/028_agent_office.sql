-- ============================================================================
-- 028_agent_office.sql — sales_agents'a ofis bağı + 3 kademeli backfill
-- ----------------------------------------------------------------------------
-- ADDITIVE. sales_agents'a nullable office_id + idempotent backfill.
-- Bağımlılık: 012 (sales_agents), 026 (offices).
--
-- ── HÜKÜMLER ──
-- - office_id NULLABLE kalır (Z-1): canlı ofissiz satırlar var; zorunluluk yalnız
--   form/API katmanında (payment/payout POST), DB'de NOT NULL YOK.
-- - Backfill 3 kademeli (Suer kuralı 2026-07-28): sales_team → sales_group →
--   country → Turkey. Takım etiketi country'den ÖNCE gelir (ör. "Nigeria Office"
--   takımı country'nin üstünde).
-- - Kaynak alanlar Zoho'dan serbest metin (021:56 sales_group, 022:28-29 sales_team/
--   country) — FK/CHECK yok, bu yüzden ILIKE ile eşleşme.
-- - Ofis id'leri ALT SORGUYLA çözülür (SAYISAL ID GÖMÜLMEZ).
-- - UPDATE idempotent (WHERE office_id IS NULL); tekrar çalıştırmak zarar vermez.
-- - Kapanan ofis silinmez, is_active=false olur; eski kayıtlarda görünmeye devam eder.
-- - Yeni index YOK (bu kolon üstünden sorgu yok; PS3'te gelirse eklenir).
-- ============================================================================

ALTER TABLE sales_agents
  ADD COLUMN office_id integer
    CONSTRAINT sales_agents_office_id_fkey REFERENCES offices(id);

-- 3 kademeli COALESCE backfill. Her kademe eşleşen ofis ADINI verir, id alt sorguyla
-- çözülür; kademe eşleşmezse CASE NULL → COALESCE bir sonrakine düşer; son çare Turkey.
UPDATE sales_agents SET office_id = COALESCE(
  -- 1) sales_team ILIKE '%ülke%'
  (SELECT id FROM offices WHERE name = (CASE
     WHEN sales_team ILIKE '%turkey%'  THEN 'Turkey'
     WHEN sales_team ILIKE '%morocco%' THEN 'Morocco'
     WHEN sales_team ILIKE '%nigeria%' THEN 'Nigeria'
     WHEN sales_team ILIKE '%kenya%'   THEN 'Kenya'
     WHEN sales_team ILIKE '%china%'   THEN 'China'
   END)),
  -- 2) sales_group ILIKE '%ülke%'
  (SELECT id FROM offices WHERE name = (CASE
     WHEN sales_group ILIKE '%turkey%'  THEN 'Turkey'
     WHEN sales_group ILIKE '%morocco%' THEN 'Morocco'
     WHEN sales_group ILIKE '%nigeria%' THEN 'Nigeria'
     WHEN sales_group ILIKE '%kenya%'   THEN 'Kenya'
     WHEN sales_group ILIKE '%china%'   THEN 'China'
   END)),
  -- 3) country ILIKE 'ülke' (tam ad, case-insensitive)
  (SELECT id FROM offices WHERE name = (CASE
     WHEN country ILIKE 'turkey'  THEN 'Turkey'
     WHEN country ILIKE 'morocco' THEN 'Morocco'
     WHEN country ILIKE 'nigeria' THEN 'Nigeria'
     WHEN country ILIKE 'kenya'   THEN 'Kenya'
     WHEN country ILIKE 'china'   THEN 'China'
   END)),
  -- 4) son çare: Turkey (merkez)
  (SELECT id FROM offices WHERE name = 'Turkey')
)
WHERE office_id IS NULL;

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('028_agent_office', now())
ON CONFLICT (version) DO NOTHING;
