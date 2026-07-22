-- ============================================================================
-- 018_payment_reversal.sql — ödeme düzeltme (reversal/storno) desteği
-- ----------------------------------------------------------------------------
-- GEREKÇE: İhtiyaç ilk gerçek kullanımda doğrulandı — contract id=1'e ters
-- yönde kur girilerek (500 TRY × 51) hatalı bir ödeme kaydedildi. Kilitli
-- "payments = immutable event" kararı KORUNUR: düzeltme sessiz UPDATE/DELETE
-- ile değil, REVERSAL ile yapılır (req :1525 "açık edit + audit" ilkesi).
--
-- MODEL — reversal = storno:
--   - Orijinal satır IMMUTABLE kalır; hiçbir kolonu güncellenmez.
--   - Ters kayıt, orijinalin currency / exchange_rate / payment_method /
--     amount_eur değerlerini AYNEN kopyalar — yeniden HESAP YAPILMAZ.
--     Gerekçe: round2(-x) ile -round2(x) her zaman aynı değildir; yeniden
--     hesap negatif tarafta yuvarlama asimetrisi riski taşır. Kopyalama,
--     ters kaydın orijinali tam olarak sıfırlamasını garanti eder.
--   - Tutarlar NEGATİF (amount, amount_eur).
--   - payment_date = reversal'ın yapıldığı gün (orijinalin tarihi değil).
--   - notes otomatik: "Reversal of payment #N (tutar CUR)".
--
-- PARTIAL UNIQUE = çifte-reversal engeli: bir ödeme yalnız bir kez
-- terslenebilir. DB seviyesinde olduğu için race-proof (ELIZA 027 dersi:
-- idempotency uygulama katmanında değil, unique index'te tutulur).
--
-- BİLİNÇLİ OLARAK YOK (eklemeyin):
--   - trigger: reversal-of-reversal engeli uygulama katmanında (400).
--     Endpoint bu dilimin değil, Faz sahibinin işi.
--   - amount_eur CHECK'e KATILMADI: işaret tutarlılığı server garantisi
--     (ters kayıt amount_eur'u da negatif kopyalar). DB'de ikinci bir
--     kural, kopyalama mantığıyla çakışma riski yaratırdı.
--   - UPDATE / DELETE endpoint'i hâlâ YOK.
--   - updated_at YOK (payments hâlâ immutable event).
--
-- MEVCUT VERİ: canlıdaki 2 satır (reverses_payment_id NULL + amount > 0)
-- yeni CHECK'i geçer. ADD CONSTRAINT mevcut satırları da DOĞRULAR —
-- hata verirse DUR, uygulama.
--
-- Bağımlılık: 017_payments.sql
-- ============================================================================

ALTER TABLE payments
  ADD COLUMN reverses_payment_id integer REFERENCES payments(id);

-- 017:39'daki CHECK satır içi ve İSİMSİZ yazılmıştı; Postgres otomatik ad
-- üretti: payments_amount_check. DROP bu adla yapılır.
ALTER TABLE payments
  DROP CONSTRAINT payments_amount_check;

-- Normal kayıt kuralı DEĞİŞMEDİ (reverses NULL → amount > 0), bu yüzden
-- mevcut POST davranışı bozulmaz. Yeni kural yalnız ters kayıtları kapsar.
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_check
  CHECK ((reverses_payment_id IS NULL AND amount > 0)
      OR (reverses_payment_id IS NOT NULL AND amount < 0));

CREATE UNIQUE INDEX uq_payments_reverses_payment_id
  ON payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('018_payment_reversal', now())
ON CONFLICT (version) DO NOTHING;
