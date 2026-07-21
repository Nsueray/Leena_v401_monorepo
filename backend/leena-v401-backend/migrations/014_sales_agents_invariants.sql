-- ============================================================================
-- 014_sales_agents_invariants.sql — sales_agents semantik invariant'ları (B3)
-- ----------------------------------------------------------------------------
-- KAYNAK: S7 HÜKMÜ (Mimari + Sentez onaylı, kilitli — 2026-07-21).
--   sales_agents integer KALIR; UUID'ye yükseltme YOK.
--   Fiziksel tip, tabloyu barındıran sistemin native tipini izler (LEENA
--   döneminde integer SERIAL); nihai tip Faz 4 kimlik birleşmesinde çözülür.
--   B3 v1.1 amendment: archive/ELL_ARCHITECTURE_STAGE_2_SECTION_1_IDENTITY_v1_0.md
--
-- Bu migration FİZİKSEL TİPE DOKUNMAZ. Sadece B3'ün semantik invariant'larını
-- veritabanı seviyesinde zorunlu kılar — bunlar tipten bağımsızdır ve Faz 4'te
-- tip değişse bile aynen geçerli kalır.
--
-- Kilitlenen invariant'lar (B3 v1.1):
--   1. agent_type üçlüsü: internal / external_agency / external_freelance
--      → 012'de zaten var (sales_agents_agent_type_check), tekrarlanmıyor.
--   2. user_id nullable + UNIQUE  → bir user en fazla bir agent olabilir.
--   3. CHECK: internal → user_id NOT NULL; external_* → user_id NULL.
--
-- GÜVENLİ: tablo 0 satır (2026-07-21 ölçümü), hiçbir mevcut kayıt ihlal edemez.
-- Uygulanmadan önce satır sayısı tekrar doğrulanmalı (bkz. uygulama planı).
--
-- Bağımlılık: 012_finance_foundation.sql (sales_agents tablosu)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Invariant 2 — bir user en fazla bir agent
-- ----------------------------------------------------------------------------
-- NOT: PostgreSQL'de UNIQUE, NULL'ları birbirinden farklı sayar; bu yüzden
-- user_id'si NULL olan sınırsız sayıda external agent bulunabilir. İstenen
-- davranış tam olarak budur (external agent'ların login'i yoktur).
ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_user_id_key UNIQUE (user_id);

-- ----------------------------------------------------------------------------
-- Invariant 3 — agent_type ↔ user_id tutarlılığı
-- ----------------------------------------------------------------------------
--   internal          → sistemde login'i olan iç ekip üyesi  → user_id ZORUNLU
--   external_agency   → dış acente, login yok                → user_id NULL
--   external_freelance→ dış freelancer, login yok            → user_id NULL
ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_type_user_link_check CHECK (
       (agent_type = 'internal' AND user_id IS NOT NULL)
    OR (agent_type IN ('external_agency', 'external_freelance') AND user_id IS NULL)
  );

-- ----------------------------------------------------------------------------
-- Migration kaydı (013 deseni)
-- ----------------------------------------------------------------------------
INSERT INTO schema_migrations (version) VALUES ('014_sales_agents_invariants')
ON CONFLICT (version) DO NOTHING;

-- ----------------------------------------------------------------------------
-- KAPSAM DIŞI (bilinçli):
--   - Fiziksel tip değişikliği (integer → UUID): S7 hükmüyle REDDEDİLDİ.
--     Faz 4 kimlik birleşmesinde yeniden değerlendirilecek.
--   - organization_id kolonu: LEENA bugün organizer_id kullanıyor (B1 emeklilik
--     kararı Faz 4 kapsamında). Bu migration isim değişikliği YAPMAZ.
--   - updated_at trigger'ı: 012'deki eksik, ayrı ele alınacak.
-- ----------------------------------------------------------------------------
