-- ============================================================================
-- 019_transfer_guards.sql — contract transfer (devir) guard'ları
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yalnız iki partial UNIQUE index; kolon/constraint eklenmez,
-- mevcut veriye dokunulmaz. Hiçbir kod bu index'leri okumaz — deploy etkisiz.
--
-- uq_contracts_transferred_from — "bir contract'ın EN FAZLA BİR devamı olur":
--   çifte-transfer engeli DB seviyesinde tutulur, uygulama katmanında değil
--   (ELIZA 027 dersi: idempotency/teklik unique index'te; race-proof). Transfer
--   endpoint'i 409'u bu constraint'ten, mapWriteError üzerinden üretecek —
--   payments'taki uq_payments_reverses_payment_id ile aynı desen.
--
-- uq_contracts_af_number — transfer edilen contract'ın af_number'ını SERVER
--   üretecek (sonek kuralı -T / -T2 / -T3). 012'de af_number kısıtsız
--   bırakılmıştı (ölçüm 2026-07-22: 012:69 düz `af_number text`, üzerinde
--   UNIQUE yok, 013-018 de dokunmamış). Üretilen sonek çakışırsa sessizce
--   ikinci bir aynı numara oluşmasın diye emniyet burada kuruluyor.
--   Partial: af_number NULL olan kayıtlar (convert öncesi/eksik) kısıtlanmaz.
--
-- A→B→A DÖNGÜSÜ AYRICA KORUNMAZ (tasarım kararı 3a-5): transfer yaratım
--   temellidir — her devir YENİ bir contract satırı doğurur ve yalnız kendinden
--   önceki satıra işaret eder. Zincir append-only olduğu için döngü yapısal
--   olarak imkânsızdır; 016'daki contracts_no_self_transfer_check (A→A) zaten
--   yerinde. Ek bir trigger/CHECK over-engineering olurdu.
--
-- YENİ KOLON YOK:
--   - transfer tarihi = yeni contract'ın created_at'i (ayrı kolon gereksiz).
--   - transfer SEBEBİ saklanmıyor — ihtiyaç doğarsa sonraki dilim adayı.
--
-- MEVCUT VERİ: canlıdaki tek contract satırı (af_number 'A-2026-001',
--   transferred_from_contract_id NULL) iki index'i de trivially geçer.
--   ⚠️ UNIQUE index mevcut veriyi DOĞRULAR — "could not create unique index"
--   hatası çıkarsa DUR, uygulama (beklenmeyen mükerrer kayıt var demektir).
--
-- Bağımlılık: 012_finance_foundation.sql (af_number),
--             016_contract_operational_columns.sql (transferred_from_contract_id)
-- ============================================================================

CREATE UNIQUE INDEX uq_contracts_transferred_from
  ON contracts (transferred_from_contract_id)
  WHERE transferred_from_contract_id IS NOT NULL;

CREATE UNIQUE INDEX uq_contracts_af_number
  ON contracts (af_number)
  WHERE af_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('019_transfer_guards', now())
ON CONFLICT (version) DO NOTHING;
