-- ============================================================================
-- 040_expo_budgets.sql — LEDGER L-5: expo bütçesi (revizyon + kilit) (Paket 1)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni iki tablo. Bağımlılık: 032 (users), 036 (expense_categories/types).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - Boşluk 6 (Suer): gelir hedefi expo başına TEK EUR rakamı (`income_target_eur`);
--   gider bütçesi kategori/tip satırlıdır (REQ:1043-1045), tutar EUR.
-- - PLN-05 deseni: revizyon başlığı + satırları; tutar ASLA UPDATE edilmez. Her değişiklik
--   yeni revizyon (`revision = max+1`); eskisi `superseded_at` damgalanır. Aktif =
--   superseded_at IS NULL (expo başına tek — partial UNIQUE).
-- - LED-09: bütçeyi Owner kilitler (locked_at/locked_by). Kilitli aktif revizyonun
--   ardılını yalnız Owner yazabilir (= kilidi açma; API katmanı, users.is_owner).
--   Başlıkta izinli tek değişiklikler: NULL→dolu superseded_at, NULL→dolu locked_at/by.
-- - Satır: kategori ZORUNLU, tip opsiyonel (NULL = kategori düzeyi satır). Tip verildiyse
--   O kategorinin tipi olmalı (bileşik FK). Gerçekleşen bütçede SAKLANMAZ — ledger'dan
--   türetilir (D2).
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '040: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

CREATE TABLE expo_budgets (
  id                serial        PRIMARY KEY,
  organizer_id      integer       NOT NULL REFERENCES organizers(id),
  expo_id           integer       NOT NULL REFERENCES expos(id),
  revision          integer       NOT NULL,
  income_target_eur numeric(14,2),
  notes             text,
  locked_at         timestamptz,
  locked_by         uuid          REFERENCES users(id),
  superseded_at     timestamptz,
  created_by        uuid          REFERENCES users(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT expo_budgets_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT expo_budgets_expo_revision_key UNIQUE (expo_id, revision),
  CONSTRAINT expo_budgets_revision_check CHECK (revision >= 1),
  CONSTRAINT expo_budgets_income_target_check CHECK (income_target_eur IS NULL OR income_target_eur >= 0),
  CONSTRAINT expo_budgets_lock_pair_check CHECK ((locked_at IS NULL) = (locked_by IS NULL))
);
CREATE UNIQUE INDEX uq_expo_budgets_active ON expo_budgets (expo_id) WHERE superseded_at IS NULL;

CREATE TABLE expo_budget_lines (
  id              serial        PRIMARY KEY,
  organizer_id    integer       NOT NULL,
  budget_id       integer       NOT NULL,
  category_id     integer       NOT NULL,
  expense_type_id integer,
  amount_eur      numeric(14,2) NOT NULL,
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT expo_budget_lines_budget_fkey FOREIGN KEY (organizer_id, budget_id)
    REFERENCES expo_budgets (organizer_id, id),
  CONSTRAINT expo_budget_lines_category_fkey FOREIGN KEY (organizer_id, category_id)
    REFERENCES expense_categories (organizer_id, id),
  -- MATCH SIMPLE: tip NULL ise denetlenmez (kategori düzeyi satır).
  CONSTRAINT expo_budget_lines_type_fkey FOREIGN KEY (organizer_id, category_id, expense_type_id)
    REFERENCES expense_types (organizer_id, category_id, id),
  CONSTRAINT expo_budget_lines_amount_check CHECK (amount_eur >= 0)
);
-- Revizyon içinde aynı kategori-düzeyi / aynı tip satırı tek (PG14 uyumlu: iki partial index).
CREATE UNIQUE INDEX uq_expo_budget_lines_category ON expo_budget_lines (budget_id, category_id)
  WHERE expense_type_id IS NULL;
CREATE UNIQUE INDEX uq_expo_budget_lines_type ON expo_budget_lines (budget_id, expense_type_id)
  WHERE expense_type_id IS NOT NULL;

-- Başlık: silinmez; yalnız NULL→dolu damga geçişleri.
CREATE FUNCTION ell_guard_expo_budgets() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_ledger_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LED-09: expo_budgets silinmez (revizyon gecmisi)';
  END IF;
  IF NEW.organizer_id      IS DISTINCT FROM OLD.organizer_id
     OR NEW.expo_id           IS DISTINCT FROM OLD.expo_id
     OR NEW.revision          IS DISTINCT FROM OLD.revision
     OR NEW.income_target_eur IS DISTINCT FROM OLD.income_target_eur
     OR NEW.notes             IS DISTINCT FROM OLD.notes
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
     OR (OLD.locked_at     IS NOT NULL AND NEW.locked_at     IS DISTINCT FROM OLD.locked_at)
     OR (OLD.locked_by     IS NOT NULL AND NEW.locked_by     IS DISTINCT FROM OLD.locked_by) THEN
    RAISE EXCEPTION 'LED-09: butce revizyonu degistirilemez — degisiklik yeni revizyondur';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expo_budgets_guard
  BEFORE UPDATE OR DELETE ON expo_budgets
  FOR EACH ROW EXECUTE FUNCTION ell_guard_expo_budgets();
CREATE TRIGGER trg_expo_budgets_no_truncate
  BEFORE TRUNCATE ON expo_budgets
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();
CREATE TRIGGER trg_expo_budget_lines_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON expo_budget_lines
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();
