-- ============================================================================
-- 039_ledger_core.sql — LEDGER L-1/L-2/L-3: hareket defteri + transfer + gider (Paket 1)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablolar + view + trigger'lar; mevcut tablolara DOKUNMAZ
-- (payments/commission_payouts'a yalnız FK ile BAĞLANIR; payments kolonları 038'de).
-- Bağımlılık: 017/018 (payments), 025 (commission_payouts), 012 (contracts),
-- 032 (users), 036 (accounts, currencies, expense_types), 038 (payments.account_id/payer).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - ledger_entries = hesap hareketi akışı. Her satır TAM BİR kaynağa bağlıdır
--   (payment / payout / expense / transfer — CHECK), tür kaynağı belirler.
-- - LED-04 tek kaynak: payment / payout / expense hareketinde TUTAR SAKLANMAZ — tutar,
--   kur, EUR kaynak satırdan okunur (ledger_lines view'i, TEK türetme yeri). Tutar
--   kolonları YALNIZ transfer bacağında doludur (transferin tutarının başka evi yok).
-- - Kur girişte donar (LED-05, RAP-01): transfer bacağı kendi kurunu + EUR'sunu taşır;
--   kaynaklı hareket kaynağın donmuş kurunu kullanır.
-- - BAKİYE KOLONU YOK (D2, R13): bakiye = Σ ledger_lines.signed_amount.
-- - Değişmezlik (034 deseni): ledger_entries / transfers / expenses UPDATE, DELETE,
--   TRUNCATE REDDEDİLİR; düzeltme ters kayıttır (reverses_*; partial UNIQUE = tek kez).
-- - LED-06: transfer = tek olay satırı + iki bağlı bacak (bir 'out' + bir 'in', farklı
--   hesap), TEK transaction; DEFERRABLE constraint trigger commit anında doğrular.
-- - LED-08: gider onayı YOK (statü kolonu yok). Belge: document_url nullable (boşluk 4).
-- - Hareket ↔ hesap tutarlılığı DB'de (trg_ledger_entries_guard): kaynak aynı kiracıda,
--   para birimi = hesabın para birimi (LED-11 önerisi), yön kaynağın işaretiyle uyumlu,
--   ödeme/gider satırındaki hesap = hareketin hesabı, ters kayıt aynı hesap + zıt yön.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '039: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- transfers — LED-06 olay satırı (tutar bacaklarda)
-- ----------------------------------------------------------------------------
CREATE TABLE transfers (
  id                   serial      PRIMARY KEY,
  organizer_id         integer     NOT NULL REFERENCES organizers(id),
  transfer_date        date        NOT NULL,
  notes                text,
  reverses_transfer_id integer,
  created_by           uuid        REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfers_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT transfers_reverses_fkey FOREIGN KEY (organizer_id, reverses_transfer_id)
    REFERENCES transfers (organizer_id, id)
);
CREATE UNIQUE INDEX uq_transfers_reverses ON transfers (reverses_transfer_id)
  WHERE reverses_transfer_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- expenses — LED-08 (onaysız, değişmez olay; düzeltme = negatif ters satır, 018 deseni)
-- ----------------------------------------------------------------------------
CREATE TABLE expenses (
  id                  serial        PRIMARY KEY,
  organizer_id        integer       NOT NULL REFERENCES organizers(id),
  expense_type_id     integer       NOT NULL,
  amount              numeric(14,2) NOT NULL,
  currency            text          NOT NULL,
  exchange_rate       numeric(18,8) NOT NULL,
  amount_eur          numeric(14,2) NOT NULL,
  account_id          integer       NOT NULL,
  expo_id             integer       REFERENCES expos(id),
  counterparty        text,
  expense_date        date          NOT NULL,
  payment_method      text          NOT NULL,
  notes               text,
  document_url        text,
  reverses_expense_id integer,
  created_by          uuid          REFERENCES users(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT expenses_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT expenses_type_fkey FOREIGN KEY (organizer_id, expense_type_id)
    REFERENCES expense_types (organizer_id, id),
  CONSTRAINT expenses_account_fkey FOREIGN KEY (organizer_id, account_id)
    REFERENCES accounts (organizer_id, id),
  CONSTRAINT expenses_currency_fkey FOREIGN KEY (organizer_id, currency)
    REFERENCES currencies (organizer_id, code),
  CONSTRAINT expenses_reverses_fkey FOREIGN KEY (organizer_id, reverses_expense_id)
    REFERENCES expenses (organizer_id, id),
  CONSTRAINT expenses_amount_check
    CHECK ((reverses_expense_id IS NULL AND amount > 0)
        OR (reverses_expense_id IS NOT NULL AND amount < 0)),
  CONSTRAINT expenses_exchange_rate_check CHECK (exchange_rate > 0),
  -- SEM-01 / LED-01: tek sözlük, beş değer.
  CONSTRAINT expenses_payment_method_check CHECK (payment_method IN
    ('bank_transfer', 'cash', 'cheque', 'credit_card', 'other')),
  CONSTRAINT expenses_document_url_check CHECK (document_url IS NULL OR document_url ~* '^https?://')
);
CREATE UNIQUE INDEX uq_expenses_reverses ON expenses (reverses_expense_id)
  WHERE reverses_expense_id IS NOT NULL;
CREATE INDEX ix_expenses_expo ON expenses (organizer_id, expo_id, expense_date);

-- ----------------------------------------------------------------------------
-- ledger_entries — hareket akışı
-- ----------------------------------------------------------------------------
CREATE TABLE ledger_entries (
  id                serial        PRIMARY KEY,
  organizer_id      integer       NOT NULL REFERENCES organizers(id),
  account_id        integer       NOT NULL,
  direction         text          NOT NULL,
  entry_type        text          NOT NULL,
  entry_date        date          NOT NULL,
  -- Yalnız transfer bacağında dolu (LED-04 — aşağıdaki CHECK'ler).
  amount            numeric(14,2),
  currency          text,
  exchange_rate     numeric(18,8),
  amount_eur        numeric(14,2),
  expo_id           integer       REFERENCES expos(id),
  payment_id        integer       REFERENCES payments(id),
  payout_id         integer       REFERENCES commission_payouts(id),
  expense_id        integer,
  transfer_id       integer,
  reverses_entry_id integer,
  created_by        uuid          REFERENCES users(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT ledger_entries_account_fkey FOREIGN KEY (organizer_id, account_id)
    REFERENCES accounts (organizer_id, id),
  CONSTRAINT ledger_entries_expense_fkey FOREIGN KEY (organizer_id, expense_id)
    REFERENCES expenses (organizer_id, id),
  CONSTRAINT ledger_entries_transfer_fkey FOREIGN KEY (organizer_id, transfer_id)
    REFERENCES transfers (organizer_id, id),
  CONSTRAINT ledger_entries_currency_fkey FOREIGN KEY (organizer_id, currency)
    REFERENCES currencies (organizer_id, code),
  CONSTRAINT ledger_entries_reverses_fkey FOREIGN KEY (organizer_id, reverses_entry_id)
    REFERENCES ledger_entries (organizer_id, id),
  CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('in', 'out')),
  CONSTRAINT ledger_entries_type_check
    CHECK (entry_type IN ('transfer', 'expense', 'income', 'payout', 'refund')),
  -- TAM BİRİ dolu.
  CONSTRAINT ledger_entries_one_source_check
    CHECK (num_nonnulls(payment_id, payout_id, expense_id, transfer_id) = 1),
  -- Tür ↔ kaynak.
  CONSTRAINT ledger_entries_type_source_check CHECK (
        (entry_type = 'transfer')                = (transfer_id IS NOT NULL)
    AND (entry_type = 'expense')                 = (expense_id  IS NOT NULL)
    AND (entry_type IN ('income', 'refund'))     = (payment_id  IS NOT NULL)
    AND (entry_type = 'payout')                  = (payout_id   IS NOT NULL)),
  -- LED-04: tutar dörtlüsü transfer bacağında TAM dolu, diğerlerinde TAM boş.
  CONSTRAINT ledger_entries_amount_home_check CHECK (
    CASE WHEN transfer_id IS NOT NULL
         THEN num_nonnulls(amount, currency, exchange_rate, amount_eur) = 4
         ELSE num_nulls(amount, currency, exchange_rate, amount_eur) = 4 AND expo_id IS NULL
    END),
  CONSTRAINT ledger_entries_amount_check CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT ledger_entries_amount_eur_check CHECK (amount_eur IS NULL OR amount_eur >= 0),
  CONSTRAINT ledger_entries_exchange_rate_check CHECK (exchange_rate IS NULL OR exchange_rate > 0)
);

-- Kaynak başına tek hareket; transfer başına bacak yönü tek; ters kayıt tek kez.
CREATE UNIQUE INDEX uq_ledger_entries_payment  ON ledger_entries (payment_id)  WHERE payment_id  IS NOT NULL;
CREATE UNIQUE INDEX uq_ledger_entries_payout   ON ledger_entries (payout_id)   WHERE payout_id   IS NOT NULL;
CREATE UNIQUE INDEX uq_ledger_entries_expense  ON ledger_entries (expense_id)  WHERE expense_id  IS NOT NULL;
CREATE UNIQUE INDEX uq_ledger_entries_transfer_leg ON ledger_entries (transfer_id, direction)
  WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ledger_entries_reverses ON ledger_entries (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX ix_ledger_entries_account ON ledger_entries (organizer_id, account_id, entry_date, id);

-- ----------------------------------------------------------------------------
-- Hareket ↔ hesap ↔ kaynak tutarlılığı (BEFORE INSERT, satır)
-- ----------------------------------------------------------------------------
CREATE FUNCTION ell_guard_ledger_entry() RETURNS trigger AS $$
DECLARE
  acc_cur  text;
  src_cur  text;
  src_amt  numeric;
  src_org  integer;
  src_acc  integer;
  want     text;
  o        record;
BEGIN
  SELECT currency INTO acc_cur FROM accounts WHERE id = NEW.account_id;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT upper(btrim(currency)), amount, organizer_id, account_id
      INTO src_cur, src_amt, src_org, src_acc FROM payments WHERE id = NEW.payment_id;
    want := CASE WHEN src_amt > 0 THEN 'in' ELSE 'out' END;       -- tahsilat girer, ters kayıt çıkar
    IF src_acc IS DISTINCT FROM NEW.account_id THEN
      RAISE EXCEPTION 'LED: payments.account_id (%) <> hareketin hesabi (%)', src_acc, NEW.account_id;
    END IF;
  ELSIF NEW.payout_id IS NOT NULL THEN
    SELECT upper(btrim(currency)), amount, organizer_id
      INTO src_cur, src_amt, src_org FROM commission_payouts WHERE id = NEW.payout_id;
    want := CASE WHEN src_amt > 0 THEN 'out' ELSE 'in' END;       -- komisyon çıkar, ters kayıt girer
  ELSIF NEW.expense_id IS NOT NULL THEN
    SELECT currency, amount, organizer_id, account_id
      INTO src_cur, src_amt, src_org, src_acc FROM expenses WHERE id = NEW.expense_id;
    want := CASE WHEN src_amt > 0 THEN 'out' ELSE 'in' END;
    IF src_acc IS DISTINCT FROM NEW.account_id THEN
      RAISE EXCEPTION 'LED: expenses.account_id (%) <> hareketin hesabi (%)', src_acc, NEW.account_id;
    END IF;
  ELSE
    src_cur := NEW.currency; src_org := NEW.organizer_id; want := NEW.direction;
  END IF;

  IF src_org IS DISTINCT FROM NEW.organizer_id THEN
    RAISE EXCEPTION 'LED: kaynak satir baska organizer''a ait';
  END IF;
  IF src_cur IS DISTINCT FROM acc_cur THEN
    RAISE EXCEPTION 'LED-11: hesap para birimi (%) <> hareket para birimi (%)', acc_cur, src_cur;
  END IF;
  IF want IS DISTINCT FROM NEW.direction THEN
    RAISE EXCEPTION 'LED: yon (%) kaynagin isaretiyle uyusmuyor (beklenen %)', NEW.direction, want;
  END IF;

  IF NEW.reverses_entry_id IS NOT NULL THEN
    SELECT * INTO o FROM ledger_entries WHERE id = NEW.reverses_entry_id;
    IF o.reverses_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'LED: ters kaydin tersi yazilamaz';
    END IF;
    IF o.account_id <> NEW.account_id OR o.direction = NEW.direction OR o.entry_type <> NEW.entry_type THEN
      RAISE EXCEPTION 'LED: ters kayit ayni hesap + ayni tur + zit yon olmali';
    END IF;
    IF NEW.transfer_id IS NOT NULL AND (o.amount <> NEW.amount OR o.currency <> NEW.currency
        OR o.exchange_rate <> NEW.exchange_rate OR o.amount_eur <> NEW.amount_eur) THEN
      RAISE EXCEPTION 'LED-05: ters transfer bacagi orijinalin tutar/kur/EUR degerini aynen tasir';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_entries_guard
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ell_guard_ledger_entry();

-- ----------------------------------------------------------------------------
-- LED-06: transfer iki bacaklı — commit anında doğrulanır (DEFERRABLE)
-- ----------------------------------------------------------------------------
CREATE FUNCTION ell_check_transfer_legs() RETURNS trigger AS $$
DECLARE
  tid integer;
  r   record;
BEGIN
  -- IF (CASE değil): her dal yalnız kendi tablosunda derlenir (transfers'ta transfer_id yok).
  IF TG_TABLE_NAME = 'transfers' THEN
    tid := NEW.id;
  ELSE
    tid := NEW.transfer_id;
  END IF;
  SELECT count(*) FILTER (WHERE direction = 'in')            AS n_in,
         count(*) FILTER (WHERE direction = 'out')           AS n_out,
         max(account_id) FILTER (WHERE direction = 'in')     AS acc_in,
         max(account_id) FILTER (WHERE direction = 'out')    AS acc_out,
         max(currency) FILTER (WHERE direction = 'in')       AS cur_in,
         max(currency) FILTER (WHERE direction = 'out')      AS cur_out,
         max(amount) FILTER (WHERE direction = 'in')         AS amt_in,
         max(amount) FILTER (WHERE direction = 'out')        AS amt_out,
         max(entry_date) - min(entry_date)                   AS date_span
    INTO r FROM ledger_entries WHERE transfer_id = tid;
  IF r.n_in <> 1 OR r.n_out <> 1 THEN
    RAISE EXCEPTION 'LED-06: transfer % iki bacakli degil (in=%, out=%)', tid, r.n_in, r.n_out;
  END IF;
  IF r.acc_in = r.acc_out THEN
    RAISE EXCEPTION 'LED-06: transfer % ayni hesaba yapilamaz', tid;
  END IF;
  IF r.date_span <> 0 THEN
    RAISE EXCEPTION 'LED-06: transfer % bacaklari ayni tarihte olmali', tid;
  END IF;
  IF r.cur_in = r.cur_out AND r.amt_in <> r.amt_out THEN
    RAISE EXCEPTION 'LED-11: ayni para biriminde transfer bacaklari esit olmali (% <> %) — masraf ayri gider', r.amt_out, r.amt_in;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_transfers_two_legs
  AFTER INSERT ON transfers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ell_check_transfer_legs();
CREATE CONSTRAINT TRIGGER trg_ledger_entries_transfer_legs
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.transfer_id IS NOT NULL)
  EXECUTE FUNCTION ell_check_transfer_legs();

-- ----------------------------------------------------------------------------
-- Değişmezlik — 036 ell_reject_ledger_change (034 deseni, kaçış anahtarı yalnız testte)
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();
CREATE TRIGGER trg_transfers_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON transfers
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();
CREATE TRIGGER trg_expenses_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON expenses
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_ledger_change();

-- ----------------------------------------------------------------------------
-- ledger_lines — TEK türetme yeri (MOT-01 tek-kaynak emsali)
-- ----------------------------------------------------------------------------
-- Tutar/kur/EUR: transfer bacağından ya da kaynak satırdan; mutlak değer + yön işareti.
-- expo: transfer bacağı → kendi expo_id'si · gider → expenses.expo_id · gelir → kontratın expo'su.
CREATE VIEW ledger_lines AS
SELECT
  le.id, le.organizer_id, le.account_id, le.direction, le.entry_type, le.entry_date,
  le.payment_id, le.payout_id, le.expense_id, le.transfer_id, le.reverses_entry_id,
  le.created_by, le.created_at,
  COALESCE(le.currency, upper(btrim(p.currency)), upper(btrim(cp.currency)), e.currency) AS currency,
  COALESCE(le.exchange_rate, p.exchange_rate, cp.exchange_rate, e.exchange_rate)        AS exchange_rate,
  abs(COALESCE(le.amount, p.amount, cp.amount, e.amount))                                AS amount,
  abs(COALESCE(le.amount_eur, p.amount_eur, cp.amount_eur, e.amount_eur))                AS amount_eur,
  CASE le.direction WHEN 'in' THEN 1 ELSE -1 END
    * abs(COALESCE(le.amount, p.amount, cp.amount, e.amount))                            AS signed_amount,
  CASE le.direction WHEN 'in' THEN 1 ELSE -1 END
    * abs(COALESCE(le.amount_eur, p.amount_eur, cp.amount_eur, e.amount_eur))            AS signed_amount_eur,
  COALESCE(le.expo_id, e.expo_id, c.expo_id)                                             AS expo_id,
  p.contract_id, c.af_number, c.company_name, p.payer,
  cp.sales_agent_id,
  e.expense_type_id, e.counterparty,
  COALESCE(t.notes, p.notes, cp.notes, e.notes)                                          AS notes
FROM ledger_entries le
LEFT JOIN payments           p  ON p.id  = le.payment_id
LEFT JOIN contracts          c  ON c.id  = p.contract_id
LEFT JOIN commission_payouts cp ON cp.id = le.payout_id
LEFT JOIN expenses           e  ON e.id  = le.expense_id
LEFT JOIN transfers          t  ON t.id  = le.transfer_id;
