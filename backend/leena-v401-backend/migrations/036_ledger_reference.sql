-- ============================================================================
-- 036_ledger_reference.sql — LEDGER L-1: hesaplar + referans veri (Paket 1, 2026-10-21)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablolar; mevcut hiçbir tabloya/kolona/veriye dokunmaz.
-- Bağımlılık: 026 (offices), 032 (users, organizers FK hedefi).
-- YALNIZ scripts/migrate.js ile uygulanır (aşağıdaki koruma). Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - LED-02: para birimleri referans TABLOSU (ISO kodu); arayüz listeleri buradan okur
--   (SEM-02). Tohum AYRI dosyada (037).
-- - LED-03: "account" = para hesabı (bank / cash / virtual). Hesap SİLİNMEZ, pasiflenir
--   (REQ R1). Kimlik alanları (organizer/currency/type/office/person) sonradan değişmez:
--   hareketler hesabın para biriminde okunur (LED-11 önerisi), değişirse geçmiş bozulur.
-- - LED-07: sahibin cari hesabı = `virtual` tipinde hesap + person_id (users). Şema
--   kişiye hesap açmaya izin verir (boşluk 16), UI yalnız owner için açar.
-- - BAKİYE KOLONU YOK (D2, R13): bakiye ledger_entries'ten (038) türetilir.
-- - Ofisin varsayılan hesabı: `is_office_default` — (organizer, office, currency) başına
--   en fazla bir aktif varsayılan (partial UNIQUE). Ödeme formunda hesap verilmezse API
--   buna düşer (P1-4 KAPI-2 şartı).
-- - Gider iki seviyeli (kategori → tip), gelir kategorisi düz liste (REQ:1680-1682).
-- - Çok-kiracı (YON-07): her tabloda organizer_id; yeni tablolar arası referanslar
--   (organizer_id, id) bileşik FK ile — başka kiracının satırına bağlanmak DB'de imkânsız.
-- - Kaçış anahtarı `ell.allow_ledger_reset` (034 deseni): yalnız test temizliği açar
--   (SET LOCAL). Ürün kodunda YOK — tests/test_ledger.js kaynak taraması bekçiler.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '036: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Ortak: değişmezlik reddi (statement-level, 034 ell_reject_line_item_change deseni)
-- ----------------------------------------------------------------------------
CREATE FUNCTION ell_reject_ledger_change() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_ledger_reset', true), '') <> 'on' THEN
    RAISE EXCEPTION 'LED: % degistirilemez (% reddedildi) — duzeltme ters kayittir', TG_TABLE_NAME, TG_OP;
  END IF;
  RETURN NULL;  -- statement-level: dönüş yok sayılır
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- currencies — LED-02
-- ----------------------------------------------------------------------------
CREATE TABLE currencies (
  organizer_id integer     NOT NULL REFERENCES organizers(id),
  code         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_pkey PRIMARY KEY (organizer_id, code),
  CONSTRAINT currencies_code_check CHECK (code ~ '^[A-Z]{3}$')
);

-- ----------------------------------------------------------------------------
-- accounts — LED-03 / LED-07
-- ----------------------------------------------------------------------------
CREATE TABLE accounts (
  id                serial      PRIMARY KEY,
  organizer_id      integer     NOT NULL REFERENCES organizers(id),
  name              text        NOT NULL,
  account_type      text        NOT NULL,
  currency          text        NOT NULL,
  office_id         integer     REFERENCES offices(id),
  person_id         uuid        REFERENCES users(id),
  is_office_default boolean     NOT NULL DEFAULT false,
  is_active         boolean     NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid        REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT accounts_org_name_key UNIQUE (organizer_id, name),
  CONSTRAINT accounts_currency_fkey FOREIGN KEY (organizer_id, currency)
    REFERENCES currencies (organizer_id, code),
  CONSTRAINT accounts_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT accounts_type_check CHECK (account_type IN ('bank', 'cash', 'virtual')),
  -- LED-07: kişiye bağlı hesap yalnız sanal olabilir.
  CONSTRAINT accounts_person_virtual_check CHECK (person_id IS NULL OR account_type = 'virtual'),
  -- Ofis varsayılanı gerçek para hesabıdır ve bir ofise bağlıdır.
  CONSTRAINT accounts_office_default_check
    CHECK (NOT is_office_default OR (office_id IS NOT NULL AND account_type <> 'virtual'))
);

CREATE UNIQUE INDEX uq_accounts_office_default
  ON accounts (organizer_id, office_id, currency)
  WHERE is_office_default AND is_active;

-- Hesap silinmez; kimlik alanları değişmez. ad / is_active / is_office_default / notes serbest.
CREATE FUNCTION ell_guard_accounts() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_ledger_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LED: accounts silinmez, pasiflenir (DELETE reddedildi)';
  END IF;
  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id
     OR NEW.currency     IS DISTINCT FROM OLD.currency
     OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.office_id    IS DISTINCT FROM OLD.office_id
     OR NEW.person_id    IS DISTINCT FROM OLD.person_id
     OR NEW.created_by   IS DISTINCT FROM OLD.created_by
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LED: accounts kimlik alanlari (organizer/currency/type/office/person) degistirilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_guard
  BEFORE UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION ell_guard_accounts();
CREATE TRIGGER trg_accounts_no_truncate
  BEFORE TRUNCATE ON accounts
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();

-- ----------------------------------------------------------------------------
-- expense_categories → expense_types (iki seviye) · income_categories (düz)
-- ----------------------------------------------------------------------------
CREATE TABLE expense_categories (
  id           serial      PRIMARY KEY,
  organizer_id integer     NOT NULL REFERENCES organizers(id),
  name         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_categories_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT expense_categories_org_name_key UNIQUE (organizer_id, name),
  CONSTRAINT expense_categories_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE expense_types (
  id           serial      PRIMARY KEY,
  organizer_id integer     NOT NULL,
  category_id  integer     NOT NULL,
  name         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_types_org_id_key UNIQUE (organizer_id, id),
  -- Bütçe satırı (040) tipin kategorisini bileşik FK ile doğrular.
  CONSTRAINT expense_types_org_cat_id_key UNIQUE (organizer_id, category_id, id),
  CONSTRAINT expense_types_cat_name_key UNIQUE (category_id, name),
  CONSTRAINT expense_types_category_fkey FOREIGN KEY (organizer_id, category_id)
    REFERENCES expense_categories (organizer_id, id),
  CONSTRAINT expense_types_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE income_categories (
  id           serial      PRIMARY KEY,
  organizer_id integer     NOT NULL REFERENCES organizers(id),
  name         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_categories_org_name_key UNIQUE (organizer_id, name),
  CONSTRAINT income_categories_name_check CHECK (btrim(name) <> '')
);
