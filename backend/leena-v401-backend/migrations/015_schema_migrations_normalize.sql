-- ============================================================================
-- 015_schema_migrations_normalize.sql — takip tablosu sürüm adlarını normalize et
-- ----------------------------------------------------------------------------
-- GEREKÇE: 013 + 014 canlıya Render Shell'den inline SQL ile uygulandı ve
-- kısa sürüm adları yazıldı ('000', '011', '013' …), oysa commit'li
-- 013_schema_migrations.sql tam dosya adlarını kullanıyor
-- ('000_production_baseline_tables' …). Ayrıca 000a_reconcile_production_drift
-- backfill'i inline sürümde atlanmıştı.
--
-- İki somut risk:
--   1. 000a izlenmiyor — takip tablosu eksik başlıyor.
--   2. Commit'li 013 ileride başka bir ortamda (veya burada tekrar)
--      çalıştırılırsa, ON CONFLICT (version) kısa adlara ÇARPMAZ; 14 tane
--      daha uzun-isimli satır eklenir ve tablo ikiye ayrışır.
--
-- KARAR (2026-07-21): uzun format kazanır — dosya adıyla birebir eşleşir.
-- 013 dosyasına DOKUNULMADI; bu migration canlıyı dosyaya hizalar.
--
-- Bağımlılık: 013_schema_migrations.sql (schema_migrations tablosu)
-- Güvenli/idempotent: ikinci kez çalıştırılırsa UPDATE hiçbir satır bulmaz
-- (kısa adlar kalmamıştır), INSERT'ler ON CONFLICT ile no-op olur.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Kısa adları tam dosya adlarına çevir
-- ----------------------------------------------------------------------------
-- applied_at DEĞİŞTİRİLMEZ: 000-012 backfill'lerinde NULL (zaman bilinmiyor),
-- 013/014'te gerçek uygulama zamanı — ikisi de olduğu gibi taşınır.
--
-- NOT EXISTS koruması: hedef uzun ad zaten varsa (örn. commit'li 013 başka bir
-- ortamda çalıştırılmışsa) UPDATE o satırı atlar ve PK ihlali oluşmaz.
UPDATE schema_migrations m
   SET version = v.uzun
  FROM (VALUES
    ('000', '000_production_baseline_tables'),
    ('001', '001_floorplan_tables'),
    ('002', '002_reactivation_form_id'),
    ('003', '003_exhibitors_table'),
    ('004', '004_sequence_campaigns'),
    ('005', '005_import_jobs'),
    ('006', '006_reactivation_closed_at'),
    ('007', '007_test_email_cleanup'),
    ('008', '008_add_allow_manual_registration_to_terminals'),
    ('009', '009_add_kind_to_terminals'),
    ('010', '010_expo_operations'),
    ('011', '011_seed_reference_data'),
    ('012', '012_finance_foundation'),
    ('013', '013_schema_migrations'),
    ('014', '014_sales_agents_invariants')
  ) AS v(kisa, uzun)
 WHERE m.version = v.kisa
   AND NOT EXISTS (
     SELECT 1 FROM schema_migrations s2 WHERE s2.version = v.uzun
   );

-- ----------------------------------------------------------------------------
-- 2. Eksik backfill: 000a (inline sürümde atlanmıştı)
-- ----------------------------------------------------------------------------
-- applied_at NULL — geçmişe dönük kayıt, gerçek uygulama zamanı bilinmiyor.
INSERT INTO schema_migrations (version, applied_at)
VALUES ('000a_reconcile_production_drift', NULL)
ON CONFLICT (version) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Bu migration'ın kendi kaydı — applied_at gerçek (DEFAULT now())
-- ----------------------------------------------------------------------------
INSERT INTO schema_migrations (version) VALUES ('015_schema_migrations_normalize')
ON CONFLICT (version) DO NOTHING;

-- ----------------------------------------------------------------------------
-- BEKLENEN SON DURUM: 17 satır, hepsi uzun isim.
--   14 backfill (000, 000a, 001-012) → applied_at NULL
--   013, 014                          → applied_at 2026-07-21 12:12:07+00
--   015                               → applied_at now()
--
-- Doğrulama:
--   SELECT count(*) FROM schema_migrations;                        -- 17
--   SELECT count(*) FROM schema_migrations WHERE version !~ '^\d{3}a?_'; -- 0
--
-- SONRAKİ: Faz 3a'nın ilk migration'ı 016'dan başlar.
-- ----------------------------------------------------------------------------
