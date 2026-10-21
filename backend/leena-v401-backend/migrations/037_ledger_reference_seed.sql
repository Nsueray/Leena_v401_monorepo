-- ============================================================================
-- 037_ledger_reference_seed.sql — LEDGER L-1 referans tohumu (Paket 1, 2026-10-21)
-- ----------------------------------------------------------------------------
-- SALT VERİ (INSERT … ON CONFLICT DO NOTHING). Bağımlılık: 036.
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── KAPSAM ──
-- Tohum, aktif Owner'ı olan kiracılara (users.is_owner AND is_active) yazılır — bugün
-- ölçülen canlıda tek: organizer 1 (Elan). Referans veri kiracınındır (REQ:1101); Owner'ı
-- olmayan kiracıya (canlıda organizer 2, finans verisi 0) Elan'ın Zoho listesi yazılmaz.
--
-- ── KAYNAKLAR (yalnız BELGELİ değerler — VARSAYIM YOK) ──
-- - Para birimleri: REQ amendment 2026-10-08 (REQ:17) — 8 ISO kodu, TL→TRY (LED-02).
--   + kiracının finans satırlarında ZATEN kullanılan kodlar (payments / commission_payouts /
--   contracts / sales_agents.commission_currency) — mevcut hiçbir satır listede yetim kalmaz.
-- - Gider kategorileri: REQ:1680 "six top-level categories (Office, Operation, Pre-Event,
--   Sales, Marketing, Conference)" — adlar AYNEN.
-- - Gider tipleri: YALNIZ kategorisi belgede yazan tipler:
--     Sales  ← Agent / HQ / Local Sales Commission (REQ:1059 "category Sales Costs")
--     Office ← Salaries/Wages (archive/ZOHO_USAGE_REFERENCE.md §3.7 örnek kayıt,
--              kategori "OFFICE EXPENCES")
--   ⚠️ İki ad eşlemesi belgeler arası: REQ:1059 "Sales Costs" ↔ REQ:1680 "Sales";
--   Zoho "OFFICE EXPENCES" ↔ REQ:1680 "Office". Owner admin ekranından yeniden adlandırabilir.
--   BULAMADIM: Zoho'nun 6 kategori × ~75 tip ve 15 gelir kategorisinin TAM listesi hiçbir
--   belgede yok (REQ:1718 "exported from Zoho" der; export dosyası repolarda yok). Belgede
--   adı geçip kategorisi YAZILMAYAN tipler (Communication/Technology/Software ·
--   Rent/Maintenance/Utilities · Taxes/Legal Expenses/Bank Fees · Hall Rent · Stand
--   Construction · Catering · Flight Tickets) TOHUMLANMADI — kategori tahmini yasak;
--   admin ekranından girilir.
-- - Gelir kategorileri: REQ:1682 (Expo Participation, Sponsorship Income, Stand
--   Construction) + ZOHO_USAGE_REFERENCE §3.8 (Extra Equipment).
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '037: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

DO $$
DECLARE
  o          record;
  n_owner    integer := 0;
  n_cur      integer;
  n_used     integer;
  n_cat      integer;
  n_type     integer;
  n_inc      integer;
  bad        text;
BEGIN
  FOR o IN SELECT DISTINCT organizer_id AS id FROM users WHERE is_owner AND is_active ORDER BY 1 LOOP
    n_owner := n_owner + 1;

    INSERT INTO currencies (organizer_id, code)
    SELECT o.id, c FROM unnest(ARRAY['EUR','NGN','MAD','TRY','USD','KES','DZD','GHS']) AS c
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_cur = ROW_COUNT;

    -- Kullanımdaki kodlar (normalize: btrim + upper). Biçimi bozuk olan YAZILMAZ, raporlanır.
    WITH used AS (
      SELECT upper(btrim(currency)) AS code FROM payments WHERE organizer_id = o.id
      UNION SELECT upper(btrim(currency)) FROM commission_payouts WHERE organizer_id = o.id
      UNION SELECT upper(btrim(currency)) FROM contracts WHERE organizer_id = o.id AND currency IS NOT NULL
      UNION SELECT upper(btrim(commission_currency)) FROM sales_agents
             WHERE organizer_id = o.id AND commission_currency IS NOT NULL
    )
    INSERT INTO currencies (organizer_id, code)
    SELECT o.id, code FROM used WHERE code ~ '^[A-Z]{3}$'
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_used = ROW_COUNT;

    SELECT string_agg(DISTINCT x, ', ') INTO bad FROM (
      SELECT upper(btrim(currency)) AS x FROM payments WHERE organizer_id = o.id
      UNION SELECT upper(btrim(currency)) FROM commission_payouts WHERE organizer_id = o.id
      UNION SELECT upper(btrim(currency)) FROM contracts WHERE organizer_id = o.id AND currency IS NOT NULL
    ) u WHERE x !~ '^[A-Z]{3}$';

    INSERT INTO expense_categories (organizer_id, name)
    SELECT o.id, n FROM unnest(ARRAY['Office','Operation','Pre-Event','Sales','Marketing','Conference']) AS n
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_cat = ROW_COUNT;

    INSERT INTO expense_types (organizer_id, category_id, name)
    SELECT o.id, ec.id, t.name
      FROM (VALUES ('Sales',  'Agent Sales Commission'),
                   ('Sales',  'HQ Sales Commission'),
                   ('Sales',  'Local Sales Commission'),
                   ('Office', 'Salaries/Wages')) AS t(cat, name)
      JOIN expense_categories ec ON ec.organizer_id = o.id AND ec.name = t.cat
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_type = ROW_COUNT;

    INSERT INTO income_categories (organizer_id, name)
    SELECT o.id, n FROM unnest(ARRAY['Expo Participation','Sponsorship Income','Stand Construction','Extra Equipment']) AS n
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_inc = ROW_COUNT;

    RAISE NOTICE '037: organizer % → currencies +% (REQ) +% (in use) · expense categories +% · expense types +% · income categories +%',
      o.id, n_cur, n_used, n_cat, n_type, n_inc;
    IF bad IS NOT NULL THEN
      RAISE NOTICE '037: organizer % — malformed currency values NOT seeded: %', o.id, bad;
    END IF;
  END LOOP;
  IF n_owner = 0 THEN
    RAISE NOTICE '037: no active Owner user — nothing seeded';
  END IF;
END $$;
