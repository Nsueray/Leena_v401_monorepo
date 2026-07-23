-- ============================================================================
-- 022_sales_agents_import_prep2.sql — Zoho import delta kolonları
-- ----------------------------------------------------------------------------
-- ADDITIVE. 021 CANLIDA ve DEĞİŞMEZ — bu delta AYRI dosyadır (uygulanmış
-- migration'a dokunulmaz). Hiçbir kod yeni kolonları okumaz → deploy etkisiz.
--
-- PROBE SONRASI EKLER (probe: 150 kayıt, 2026-07-23, Sentez onaylı):
--   default_director_pct  numeric(5,2) = Zoho Director_Comm_Rate. SD (Sales
--     Director) default komisyon kaynağı; motor dilimine kadar KULLANILMAZ.
--     Canlı örnek: bir contract'ta SR %5 + SD %2 birlikte işliyor — SR default'u
--     021'deki default_commission_pct, SD default'u bu kolon.
--   sales_team text  = Zoho Sales_Team. Sales_Group'tan FARKLI bir boyut
--     (grup ≠ takım) — Suer ilkesi "kaynakta olan kaybedilmez".
--   country text  = Zoho Country. Yine ayrı boyut, aynı ilke.
--
-- default_director_pct 0-100 range CHECK (B18 tutarlı pattern, açık ad).
-- sales_team / country CHECK'siz serbest text (değer listesi import sonrası
-- netleşince CHECK adayı — 021'deki sales_group ile aynı yaklaşım).
--
-- MEVCUT VERİ: yeni kolonlar nullable, mevcut satırları etkilemez; range CHECK
-- NULL'ı geçer. İhlal beklenmiyor; "violated by some row" çıkarsa DUR.
--
-- Bağımlılık: 012 (sales_agents) · 020 (default_commission_pct deseni)
-- ============================================================================

ALTER TABLE sales_agents
  ADD COLUMN default_director_pct numeric(5,2),
  ADD COLUMN sales_team text,
  ADD COLUMN country text;

ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_default_director_pct_range_check
  CHECK (default_director_pct >= 0 AND default_director_pct <= 100);

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('022_sales_agents_import_prep2', now())
ON CONFLICT (version) DO NOTHING;
