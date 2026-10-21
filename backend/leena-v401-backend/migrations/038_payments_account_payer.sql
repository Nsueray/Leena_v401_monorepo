-- ============================================================================
-- 038_payments_account_payer.sql — LEDGER L-4: payments'a hesap + ödeyen (Paket 1)
-- ----------------------------------------------------------------------------
-- ⚠️ KAPI-2 (YON-11: mevcut para tablosuna kolon). Sentez kabulü Paket 1 P1-4 şartıyla:
--    eski contract-detail.html ödeme formu hesap alanı olmadan 400 ALMAZ (API varsayılan
--    hesaba düşer, yoksa NULL + uyarı — routes/contracts.js, utils/ledger.js).
-- ADDITIVE: iki NULLABLE kolon + iki constraint. Mevcut 15 satır NULL kalır; geriye
-- dönük hesap/ledger kaydı YAZILMAZ (Paket 1 P1-4; sayaç RAP-02 ile görünür).
-- 017:21 notunun ("account_id, payer → ledger fazı, additive eklenecek") karşılığı.
-- Bağımlılık: 017 (payments), 036 (accounts). YALNIZ scripts/migrate.js ile uygulanır.
--
-- ── HÜKÜMLER ──
-- - account_id: paranın girdiği hesap. Bileşik FK (organizer_id, account_id) → başka
--   kiracının hesabına bağlanamaz. Hesap ↔ hareket eşitliği 039 trigger'ında.
-- - payer: kontrat şirketinden bağımsız gerçek ödeyen (REQ R7, Ç9). NULL = belirtilmedi;
--   boş metin YASAK ("yok" yalnız NULL ile söylenir — SEM-04 ilkesi).
-- - Mevcut CHECK / trigger / davranışa DOKUNULMAZ; trigger EKLENMEZ.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '038: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

ALTER TABLE payments
  ADD COLUMN account_id integer,
  ADD COLUMN payer      text,
  ADD CONSTRAINT payments_account_fkey FOREIGN KEY (organizer_id, account_id)
    REFERENCES accounts (organizer_id, id),
  ADD CONSTRAINT payments_payer_not_blank CHECK (payer IS NULL OR btrim(payer) <> '');

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM payments;
  RAISE NOTICE '038: payments % rows — account_id / payer NULL on all (pre-ledger, no backfill)', n;
END $$;
