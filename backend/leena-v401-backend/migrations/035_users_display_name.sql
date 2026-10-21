-- ============================================================================
-- 035_users_display_name.sql — kullanıcının görünen adı (Sentez K-F, 19 Eki)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Bağımlılık: 013 (schema_migrations), 032 (users).
-- Faz 4 dilim 2 (2026-10-21). YAZILIR, ÇALIŞTIRILMAZ — Suer koşar.
--
-- ── HÜKÜMLER ──
-- - K-F: users'a NULLABLE ad kolonu, dilim 2 penceresinde AYRI migration. NULL =
--   "ad girilmedi"; token `name` claim'i doluysa adı, boşsa e-postayı taşır (SEM-05).
-- - Ad: `display_name` — B32 kullanıcının kendi değiştirebildiği alanı bu adla anar.
--   `display_role`'den (B9, yalnız görüntü) bağımsızdır; yetkide KULLANILMAZ.
-- - Boş/yalnız-boşluk değer YASAK (CHECK): "ad yok" yalnız NULL ile söylenir
--   (SEM-04 ile aynı ilke — veride yalan yok). Mevcut satırlar NULL kalır → CHECK geçer.
-- - Kod bu kolon YOKKEN de çalışır (routes/userAuth.js `to_jsonb(u)->>'display_name'`)
--   → deploy bu migration'dan ÖNCE yapılabilir (tek değişken).
-- - İdempotent: ADD COLUMN IF NOT EXISTS + koşullu CONSTRAINT + ON CONFLICT DO NOTHING.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'users_display_name_not_blank'
                    AND conrelid = to_regclass('public.users')) THEN
    ALTER TABLE users ADD CONSTRAINT users_display_name_not_blank
      CHECK (display_name IS NULL OR btrim(display_name) <> '');
  END IF;
END $$;

-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('035_users_display_name', now())
ON CONFLICT (version) DO NOTHING;

-- ============================================================================
-- Verify (koşum sonrası)
-- ============================================================================
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'display_name';
SELECT conname, pg_get_constraintdef(oid) AS tanim
  FROM pg_constraint WHERE conname = 'users_display_name_not_blank';
SELECT version, applied_at FROM schema_migrations WHERE version = '035_users_display_name';
