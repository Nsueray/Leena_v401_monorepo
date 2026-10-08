-- ============================================================================
-- 034_contract_line_items_immutable.sql — kontrat kalemi değiştirilemez (Sentez K-D)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Bağımlılık: 013 (schema_migrations), 024 (contract_line_items).
-- Faz 4 dilim 2 (2026-10-08). YAZILIR, ÇALIŞTIRILMAZ — Suer koşar.
--
-- ── HÜKÜMLER ──
-- - RTM B2: contract_line_items'ın değişmezliği bugün yalnız yorumdaydı (024:29);
--   DB seviyesinde zorlanır. UPDATE, DELETE ve TRUNCATE REDDEDİLİR; INSERT serbest.
-- - Ürün kodu ölçüldü (2026-10-08): routes/utils/middleware/scripts'te bu tabloya
--   UPDATE/DELETE/TRUNCATE YOK; FK ON DELETE CASCADE YOK (024:30, 024:51-52) ve
--   ürün kodunda DELETE FROM contracts YOK → çalışan uygulama etkilenmez.
-- - Kaçış anahtarı: oturum ayarı `ell.allow_line_item_reset`. Yalnız değeri tam 'on'
--   iken geçer; tanımsız / boş / başka değer = KAPALI. Yalnız test kurulumu/temizliği
--   açar (SET LOCAL, transaction süresince). Ürün kodunda anahtar YOK — kaynak
--   taraması testi (tests/test_line_item_immutable.js) bunu bekçiler.
-- - Statement-level BEFORE trigger: TRUNCATE yalnız statement düzeyinde tetiklenir;
--   UPDATE/DELETE de aynı fonksiyonla, satır sayısından bağımsız reddedilir.
-- - İdempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + ON CONFLICT DO NOTHING.
-- ============================================================================

CREATE OR REPLACE FUNCTION ell_reject_line_item_change() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_line_item_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'K-D: contract_line_items degistirilemez (% reddedildi)', TG_OP;
  END IF;
  RETURN NULL;  -- statement-level: dönüş yok sayılır
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contract_line_items_immutable ON contract_line_items;
CREATE TRIGGER trg_contract_line_items_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON contract_line_items
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_line_item_change();

-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('034_contract_line_items_immutable', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- Verify (koşum sonrası)
-- ============================================================================
SELECT tgname, pg_get_triggerdef(oid) AS tanim
  FROM pg_trigger
 WHERE tgrelid = to_regclass('public.contract_line_items') AND NOT tgisinternal;
SELECT version, applied_at FROM schema_migrations WHERE version = '034_contract_line_items_immutable';
