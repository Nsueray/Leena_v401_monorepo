-- ============================================================================
-- 033_users_truncate_guard.sql — B10'u TRUNCATE'e genişlet + 029-032 geriye dönük kayıt
-- ----------------------------------------------------------------------------
-- ADDITIVE. Bağımlılık: 013 (schema_migrations), 032 (users + B10 fonksiyonu).
-- Faz 4 dilim 2 (2026-10-08). YAZILIR, ÇALIŞTIRILMAZ — Suer koşar.
--
-- ── HÜKÜMLER ──
-- - B10 açığı (defter 2026-09-14): trg_min_one_active_owner AFTER UPDATE OR DELETE;
--   TRUNCATE trigger'ı atlıyordu. Fonksiyon gövdesi TG_OP'a BAKMAZ (032:59-66) —
--   aktif Owner sayısı 0 ise RAISE. AFTER TRUNCATE FOR EACH STATEMENT'ta aynen
--   çalışır: TRUNCATE sonrası sayım 0 → RAISE → TRUNCATE geri alınır.
--   Fonksiyon DEĞİŞMEZ; yalnız ikinci bir trigger eklenir.
-- - Geriye dönük kayıt (Sentez şartı): 029/030/031/032 dosyaları schema_migrations'a
--   kendini yazmadı. Satır YALNIZ o migration'ın şema izi veritabanında VARSA eklenir.
--   İzi olmayan EKLENMEZ. applied_at = NULL: gerçek uygulama zamanı bilinmiyor
--   (013'ün 000-012 toplu kaydıyla aynı kural). Kayıt yazmak uygulama kanıtı değildir;
--   iz kontrolü kanıttır.
--     029 → email_campaigns.delivered_count kolonu
--     030 → callcenter_leads tablosu + 4 index'i
--     031 → iki email_queue index'i, ikisi de GEÇERLİ (CONCURRENTLY yarım kalırsa
--           index INVALID kalır — o durumda kayıt YOK)
--     032 → users tablosu + trg_min_one_active_owner + sales_agents_user_id_fkey
-- - version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu.
-- - İdempotent: DROP TRIGGER IF EXISTS + ON CONFLICT (version) DO NOTHING.
-- ============================================================================

-- ── 1) B10: TRUNCATE de korunur ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_min_one_active_owner_truncate ON users;
CREATE TRIGGER trg_min_one_active_owner_truncate
  AFTER TRUNCATE ON users
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_min_one_active_owner();

-- ── 2) Geriye dönük kayıt — yalnız şema izi kanıtlı olanlar ─────────────────
INSERT INTO schema_migrations (version, applied_at)
SELECT '029_campaign_delivered_count', NULL
 WHERE EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'email_campaigns'
                  AND column_name = 'delivered_count')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version, applied_at)
SELECT '030_callcenter_leads', NULL
 WHERE to_regclass('public.callcenter_leads')               IS NOT NULL
   AND to_regclass('public.idx_callcenter_leads_pool')       IS NOT NULL
   AND to_regclass('public.idx_callcenter_leads_callback')   IS NOT NULL
   AND to_regclass('public.idx_callcenter_leads_email_expo') IS NOT NULL
   AND to_regclass('public.idx_callcenter_leads_agent')      IS NOT NULL
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version, applied_at)
SELECT '031_callcenter_email_queue_indexes', NULL
 WHERE (SELECT count(*) FROM pg_index i
         WHERE i.indisvalid
           AND i.indexrelid IN (to_regclass('public.idx_queue_campaign_email'),
                                to_regclass('public.idx_queue_expo_email_txn'))) = 2
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version, applied_at)
SELECT '032_users_and_first_owner', NULL
 WHERE to_regclass('public.users') IS NOT NULL
   AND EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgname = 'trg_min_one_active_owner'
                  AND tgrelid = to_regclass('public.users'))
   AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_agents_user_id_fkey')
ON CONFLICT (version) DO NOTHING;

-- ── 3) 033'ün kendi kaydı — applied_at gerçek ───────────────────────────────
INSERT INTO schema_migrations (version, applied_at)
VALUES ('033_users_truncate_guard', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- Verify (koşum sonrası)
-- ============================================================================
-- users üzerindeki trigger'lar — iki satır beklenir (UPDATE|DELETE ve TRUNCATE):
SELECT tgname, pg_get_triggerdef(oid) AS tanim
  FROM pg_trigger WHERE tgrelid = to_regclass('public.users') AND NOT tgisinternal;
-- 029-033 kayıtları — izi olmayan satır GÖRÜNMEMELİ:
SELECT version, applied_at FROM schema_migrations
 WHERE version ~ '^03[0-3]_|^029_' ORDER BY version;
