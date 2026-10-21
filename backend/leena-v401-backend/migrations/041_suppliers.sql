-- ============================================================================
-- 041_suppliers.sql — PAKET 1b P1b-1: tedarikçi (para karşı tarafı) kaydı (2026-10-21)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablo + expenses'e nullable kolon.
-- Mevcut satır DEĞİŞMEZ (expenses.supplier_id hepsinde NULL; counterparty metni kalır).
-- Bağımlılık: 026 (offices), 032 (users), 036, 039 (expenses, ledger_lines),
-- core_countries (canlıda 230 satır; offices.country_code'un da FK hedefi).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - Suer ilkesi (defter, kilitli): veri sistemde varsa elle girilmez; kaçınılmaz elle giriş
--   serbest metin değil SEÇMELİ → gider karşı tarafı artık bir KAYIT (suppliers), metin değil.
--   Eski kayıtların `counterparty` metni silinmez/taşınmaz (geçmiş olduğu gibi kalır).
-- - Tür: supplier | venue | contractor | other — expo_partners.partner_role'ün 11 değeriyle
--   AYRI sözlük: orası fuar-operasyon rolü, burası para karşı tarafı. expo_partners bağı
--   bu pakette KURULMAZ.
-- - Tedarikçi SİLİNMEZ, pasiflenir (LED-03 hesap deseni). Pasif tedarikçi yeni gidere
--   seçilemez (API), geçmişi okunur.
-- - Ad tekliği: kiracı içinde (normalize ad, ülke) — aynı ad başka ülkede ayrı kayıt olabilir.
-- - Ödeme geçmişi SAKLANMAZ (D2): ledger_lines (gider hareketleri) → expenses.supplier_id ile türetilir.
-- - Çok-kiracı (YON-07): expenses → suppliers bileşik FK (organizer_id, id).
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '041: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

CREATE TABLE suppliers (
  id            serial      PRIMARY KEY,
  organizer_id  integer     NOT NULL REFERENCES organizers(id),
  name          text        NOT NULL,
  supplier_type text        NOT NULL,
  country_code  char(2)     NOT NULL REFERENCES core_countries(code),
  office_id     integer     REFERENCES offices(id),
  tax_number    text,
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT suppliers_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT suppliers_type_check CHECK (supplier_type IN ('supplier', 'venue', 'contractor', 'other')),
  CONSTRAINT suppliers_tax_number_check CHECK (tax_number IS NULL OR btrim(tax_number) <> '')
);

CREATE UNIQUE INDEX uq_suppliers_org_name_country
  ON suppliers (organizer_id, lower(btrim(name)), country_code);

-- Silinmez; kimlik alanları (kiracı / oluşturan / zaman) değişmez. Ad, tür, ülke, ofis,
-- vergi no, not, aktiflik düzeltilebilir (ana veri düzeltmesi — geçmiş FK ile bağlı kalır).
CREATE FUNCTION ell_guard_suppliers() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_ledger_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LED: suppliers silinmez, pasiflenir (DELETE reddedildi)';
  END IF;
  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LED: suppliers kimlik alanlari (organizer/created_by/created_at) degistirilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_suppliers_guard
  BEFORE UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION ell_guard_suppliers();
CREATE TRIGGER trg_suppliers_no_truncate
  BEFORE TRUNCATE ON suppliers
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();

-- ----------------------------------------------------------------------------
-- expenses.supplier_id — nullable; mevcut satırlar NULL kalır (geriye dönük eşleme YOK)
-- ----------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN supplier_id integer,
  ADD CONSTRAINT expenses_supplier_fkey FOREIGN KEY (organizer_id, supplier_id)
    REFERENCES suppliers (organizer_id, id);
CREATE INDEX ix_expenses_supplier ON expenses (supplier_id) WHERE supplier_id IS NOT NULL;
-- ledger_lines (039) DEĞİŞMEZ: tedarikçi geçmişi ledger_lines.expense_id → expenses.supplier_id
-- join'iyle okunur. (View'ı CREATE OR REPLACE ile genişletmek runner'ın yarım-uygulama
-- izi denetimine "relation ledger_lines" olarak takılırdı — LED-16.)

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM expenses;
  RAISE NOTICE '041: expenses % rows — supplier_id NULL on all (counterparty text kept, no backfill)', n;
END $$;
