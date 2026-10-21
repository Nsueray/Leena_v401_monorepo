-- ============================================================================
-- 042_expense_drafts.sql — PAKET 1b P1b-3: gider TASLAĞI (bot-yazılabilir giriş, 2026-10-21)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablo; mevcut hiçbir tabloya/satıra dokunmaz.
-- Bağımlılık: 036 (accounts, currencies, expense_types), 039 (expenses), 041 (suppliers).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - LED-08 DEĞİŞMEZ: gider (expenses) onay statüsü taşımaz. Onay akışı GİDERDE değil, bu
--   ayrı tabloda: taslak → insan kabulü → gider doğar (mevcut gider yolu, aynı doğrulama).
-- - YZ-01 + LED-19: çalışma anındaki yapay zeka iş verisi YAZMAZ, yalnız TASLAK yazar.
--   Taslak ledger'a HİÇ yazmaz; hareket yalnız kabulde, gider satırıyla doğar.
-- - Taslak içeriği DEĞİŞMEZ (yapay zekanın ne önerdiği denetim için olduğu gibi kalır);
--   insanın düzelttiği değerler doğan gider satırındadır (expense_id ile bağlı).
--   Tek geçiş: pending → accepted | rejected (bir kez). Ret silmez.
-- - Tedarikçi eşleşmesi ÖNERİDİR (OFS-05 deseni: öneri kilit değildir): supplier_match_*
--   sunucunun ad benzerliği önerisi; giderin tedarikçisini kabulde İNSAN seçer.
-- - missing_fields: gider için zorunlu olup taslakta boş olan alanlar (sunucu yazar).
--   Taslak içeriği değişmediği için liste içerikle tutarlı kalır.
-- - Çok-kiracı (YON-07): tüm referanslar (organizer_id, id) bileşik FK.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '042: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

CREATE TABLE expense_drafts (
  id                   serial        PRIMARY KEY,
  organizer_id         integer       NOT NULL REFERENCES organizers(id),
  source               text          NOT NULL,
  -- Önerilen gider alanları (expenses ile aynı; hepsi boş olabilir)
  expense_type_id      integer,
  account_id           integer,
  amount               numeric(14,2),
  currency             text,
  exchange_rate        numeric(18,8),
  expo_id              integer       REFERENCES expos(id),
  expense_date         date,
  payment_method       text,
  notes                text,
  document_url         text,
  -- Tedarikçi: kaynağın yazdığı ad + sunucunun önerisi
  supplier_name        text,
  supplier_match_id    integer,
  supplier_match_score numeric(4,3),
  confidence_note      text,
  missing_fields       jsonb         NOT NULL DEFAULT '[]'::jsonb,
  -- Karar
  status               text          NOT NULL DEFAULT 'pending',
  expense_id           integer,
  reviewed_by          uuid          REFERENCES users(id),
  reviewed_at          timestamptz,
  created_by           uuid          REFERENCES users(id),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT expense_drafts_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT expense_drafts_type_fkey FOREIGN KEY (organizer_id, expense_type_id)
    REFERENCES expense_types (organizer_id, id),
  CONSTRAINT expense_drafts_account_fkey FOREIGN KEY (organizer_id, account_id)
    REFERENCES accounts (organizer_id, id),
  CONSTRAINT expense_drafts_currency_fkey FOREIGN KEY (organizer_id, currency)
    REFERENCES currencies (organizer_id, code),
  CONSTRAINT expense_drafts_supplier_match_fkey FOREIGN KEY (organizer_id, supplier_match_id)
    REFERENCES suppliers (organizer_id, id),
  CONSTRAINT expense_drafts_expense_fkey FOREIGN KEY (organizer_id, expense_id)
    REFERENCES expenses (organizer_id, id),
  CONSTRAINT expense_drafts_source_check CHECK (source IN ('ai', 'import', 'manual')),
  CONSTRAINT expense_drafts_amount_check CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT expense_drafts_exchange_rate_check CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  -- SEM-01 / LED-01: tek sözlük, beş değer.
  CONSTRAINT expense_drafts_payment_method_check CHECK (payment_method IS NULL OR payment_method IN
    ('bank_transfer', 'cash', 'cheque', 'credit_card', 'other')),
  CONSTRAINT expense_drafts_document_url_check CHECK (document_url IS NULL OR document_url ~* '^https?://'),
  CONSTRAINT expense_drafts_match_check CHECK ((supplier_match_id IS NULL) = (supplier_match_score IS NULL)
    AND (supplier_match_score IS NULL OR (supplier_match_score > 0 AND supplier_match_score <= 1))),
  CONSTRAINT expense_drafts_missing_check CHECK (jsonb_typeof(missing_fields) = 'array'),
  CONSTRAINT expense_drafts_status_check CHECK (
       (status = 'pending'  AND expense_id IS NULL     AND reviewed_at IS NULL)
    OR (status = 'accepted' AND expense_id IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (status = 'rejected' AND expense_id IS NULL     AND reviewed_at IS NOT NULL))
);

-- Bir gider en çok bir taslaktan doğar.
CREATE UNIQUE INDEX uq_expense_drafts_expense ON expense_drafts (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX ix_expense_drafts_pending ON expense_drafts (organizer_id, created_at) WHERE status = 'pending';

-- Silinmez · içerik değişmez · karar bir kez verilir (pending → accepted | rejected).
CREATE FUNCTION ell_guard_expense_drafts() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_ledger_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LED-19: expense_drafts silinmez (ret = rejected)';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'LED-19: karar verilmis taslak degistirilemez (%)', OLD.status;
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'LED-19: taslak icerigi degistirilemez — yalniz kabul / ret';
  END IF;
  IF (NEW.organizer_id, NEW.source, NEW.expense_type_id, NEW.account_id, NEW.amount, NEW.currency,
      NEW.exchange_rate, NEW.expo_id, NEW.expense_date, NEW.payment_method, NEW.notes, NEW.document_url,
      NEW.supplier_name, NEW.supplier_match_id, NEW.supplier_match_score, NEW.confidence_note,
      NEW.missing_fields, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.organizer_id, OLD.source, OLD.expense_type_id, OLD.account_id, OLD.amount, OLD.currency,
      OLD.exchange_rate, OLD.expo_id, OLD.expense_date, OLD.payment_method, OLD.notes, OLD.document_url,
      OLD.supplier_name, OLD.supplier_match_id, OLD.supplier_match_score, OLD.confidence_note,
      OLD.missing_fields, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LED-19: taslak icerigi degistirilemez — yalniz kabul / ret';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_drafts_guard
  BEFORE UPDATE OR DELETE ON expense_drafts
  FOR EACH ROW EXECUTE FUNCTION ell_guard_expense_drafts();
CREATE TRIGGER trg_expense_drafts_no_truncate
  BEFORE TRUNCATE ON expense_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();
