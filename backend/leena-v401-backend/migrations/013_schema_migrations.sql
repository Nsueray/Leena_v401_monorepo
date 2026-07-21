-- ============================================================================
-- 013_schema_migrations.sql — migration takip tablosu + 000-012 backfill
-- ----------------------------------------------------------------------------
-- GEREKÇE (S9, ELL_MUTABAKAT_2026-07-21.md): Bu DB'de hangi migration'ın
-- uygulandığını izleyen hiçbir mekanizma yoktu. 012 tam da bu yüzden sessizce
-- kaybolabildi — canlıda uygulanmıştı ama dosyası repoda yoktu ve bunu
-- yakalayacak bir kayıt da yoktu (2026-07-21'de katalogdan yeniden kuruldu).
--
-- Bu dosya o boşluğu kapatır: 013'ten sonra her migration kendi satırını
-- yazar, "hangisi uygulandı" sorusu SELECT ile cevaplanır.
--
-- Backfill notu: 000-012 satırları GEÇMİŞE DÖNÜK kayıttır. applied_at
-- değerleri gerçek uygulama zamanları DEĞİL (o bilgi hiçbir yerde tutulmadı);
-- bu yüzden NULL bırakılmıştır — "uygulandı ama ne zaman bilinmiyor" demek,
-- uydurma bir tarih yazmaktan dürüsttür. 013'ten itibaren applied_at gerçektir.
--
-- ⚠️ SIRALAMA: Bu dosya 012'den SONRA çalıştırılmalı (backfill 012'yi de
-- kaydeder). Canlı DB'de 000-012 zaten uygulanmış durumda.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text        NOT NULL,
  applied_at timestamptz DEFAULT now(),
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

COMMENT ON TABLE schema_migrations IS
  'Uygulanmış migration kaydı. 000-012 geçmişe dönük backfill (applied_at NULL = zaman bilinmiyor). 013+ gerçek zaman.';

-- ----------------------------------------------------------------------------
-- Backfill: 000-012 (hepsi canlıda uygulanmış durumda, 2026-07-21 ölçümü)
-- applied_at NULL — gerçek uygulama zamanları kayıtlı değil.
-- ON CONFLICT DO NOTHING: tekrar çalıştırılırsa no-op.
-- ----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, applied_at) VALUES
  ('000_production_baseline_tables',            NULL),
  ('000a_reconcile_production_drift',           NULL),
  ('001_floorplan_tables',                      NULL),
  ('002_reactivation_form_id',                  NULL),
  ('003_exhibitors_table',                      NULL),
  ('004_sequence_campaigns',                    NULL),
  ('005_import_jobs',                           NULL),
  ('006_reactivation_closed_at',                NULL),
  ('007_test_email_cleanup',                    NULL),
  ('008_add_allow_manual_registration_to_terminals', NULL),
  ('009_add_kind_to_terminals',                 NULL),
  ('010_expo_operations',                       NULL),
  ('011_seed_reference_data',                   NULL),
  ('012_finance_foundation',                    NULL)
ON CONFLICT (version) DO NOTHING;

-- 013'ün kendi kaydı — applied_at gerçek (DEFAULT now()).
INSERT INTO schema_migrations (version) VALUES ('013_schema_migrations')
ON CONFLICT (version) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Backfill'e DAHİL EDİLMEYEN dosya:
--   004_sequence_campaigns_rollback.sql — rollback script'i, migration değil.
--
-- BUNDAN SONRA: her yeni migration dosyası kendi sonuna şunu eklemeli:
--   INSERT INTO schema_migrations (version) VALUES ('NNN_dosya_adi')
--   ON CONFLICT (version) DO NOTHING;
-- ----------------------------------------------------------------------------
