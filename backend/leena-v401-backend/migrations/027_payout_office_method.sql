-- ============================================================================
-- 027_payout_office_method.sql — commission_payouts: çıkış ofisi + ödeme şekli
-- ----------------------------------------------------------------------------
-- ADDITIVE. commission_payouts'a iki nullable kolon (tek ALTER). Mevcut veriye
-- dokunmaz. Bağımlılık: 025 (commission_payouts), 026 (offices).
--
-- ── HÜKÜMLER ──
-- - Çıkış yönü: `payments.received_office_id` = para GİRDİ; `paid_office_id` =
--   para ÇIKTI. Adlar bilinçli farklı — karıştırma.
-- - İkisi de NULLABLE: canlı payout satırları var, geriye dönük doldurulamaz.
-- - Sözlük TEK (H7): `payout_method` CHECK'i `payments.payment_method` ile AYNI
--   beş değer ('bank_transfer','cash','cheque','credit_card','other').
-- - Reversal ofis/method'u SUNUCUDA orijinal satırdan devralır; kullanıcıya
--   sorulmaz, istemciden gelen değer reversal'da yok sayılır (W-3).
-- - Ofis ↔ para birimi kısıtı YOK (W-4).
-- - Yeni index YOK: bu kolonlar üstünden sorgu yok (nakit öngörü raporu PS3).
-- ============================================================================

ALTER TABLE commission_payouts
  ADD COLUMN paid_office_id integer
    CONSTRAINT commission_payouts_paid_office_id_fkey REFERENCES offices(id),
  ADD COLUMN payout_method  text;

ALTER TABLE commission_payouts
  ADD CONSTRAINT commission_payouts_payout_method_check
  CHECK (payout_method IS NULL OR payout_method IN
         ('bank_transfer', 'cash', 'cheque', 'credit_card', 'other'));

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('027_payout_office_method', now())
ON CONFLICT (version) DO NOTHING;
