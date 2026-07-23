-- ============================================================================
-- 021_sales_agents_import_prep.sql — Zoho Sales Agents import hazırlığı
--                                    + S7 v1.2 amendment
-- ----------------------------------------------------------------------------
-- ADDITIVE (bir DROP CONSTRAINT hariç). Yeni kolon + CHECK gevşetme + partial
-- UNIQUE. Hiçbir kod yeni kolonları okumaz; CHECK gevşemesi mevcut davranışı
-- bozmaz (external_* kuralı korunuyor) → deploy etkisiz.
--
-- ── S7 v1.2 AMENDMENT (Sentez onaylı — BELGELİ BORÇ) ────────────────────────
-- 014'teki invariant "internal → user_id NOT NULL" ASKIYA ALINDI.
-- Gerekçe: bu kural bir `users` tablosunun varlığına dayanıyordu; LEENA'da
-- `users` tablosu YOK (kimlik Faz 4), dolayısıyla internal agent'a verilebilecek
-- geçerli bir user_id de yok — kural uygulanabilir değildi (internal agent hiç
-- girilemiyordu). Yeni CHECK yalnız KORUNAN yönü tutar:
--     external_agency / external_freelance → user_id NULL.
-- (internal → user_id serbest; Faz 4'te users doğunca internal'lara user_id
--  backfill edilip eski sıkı kural — internal → NOT NULL + UNIQUE — geri gelir.)
-- 014'teki UNIQUE(user_id) constraint'i (sales_agents_user_id_key) KORUNUYOR;
-- bu amendment yalnız type↔user_id link CHECK'ini gevşetir.
--
-- ── YENİ KOLONLAR — Zoho Sales Agents import eşlemesi (Sentez onaylı) ────────
-- email             : Zoho Email. UNIQUE BİLEREK YOK (Zoho'da mükerrer olabilir;
--                     probe gösterecek).
-- sales_group       : Zoho Sales Group. CHECK'siz serbest text — değer listesi
--                     import sonrası netleşince CHECK adayı.
-- agent_company     : Zoho Agent Company (dış acentenin firma adı).
-- commission_currency char(3): komisyon para birimi. TAŞINIR ama motor dilimine
--                     kadar KULLANILMAZ (önceki ölçümdeki "komisyon currency"
--                     açığının taşıyıcısı).
-- is_active         : D1 — deaktivasyon taşıyıcısı; B6 dropdown filtresi bunu
--                     okuyacak. DEFAULT true. Faz 4'te internal'lar user.is_active
--                     ile senkronlanır.
-- zoho_record_id    : D4 — import idempotency anahtarı. Partial UNIQUE (aşağıda);
--                     script tekrar koşarsa ON CONFLICT (zoho_record_id) DO NOTHING.
--
-- ── MEVCUT VERİ ──────────────────────────────────────────────────────────────
-- Tablo bugün satırsız/az satırlı; is_active NOT NULL DEFAULT true mevcut
-- satırlara güvenle uygulanır, gevşetilen CHECK mevcut satırları da doğrular.
-- ⚠️ "violated by some row" çıkarsa DUR (beklenmeyen internal+NULL yok sayımı).
--
-- Bağımlılık: 012 (sales_agents) · 014 (düşürülen CHECK burada tanımlı)
-- ============================================================================

-- ── S7 v1.2: type↔user_id link CHECK'ini gevşet ─────────────────────────────
-- 014:42'de açık adla tanımlıydı — DROP güvenli (020'nin isimsiz-CHECK riski yok).
ALTER TABLE sales_agents
  DROP CONSTRAINT sales_agents_type_user_link_check;

ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_external_user_null_check
  CHECK (agent_type = 'internal' OR user_id IS NULL);

-- ── Zoho import kolonları ────────────────────────────────────────────────────
ALTER TABLE sales_agents
  ADD COLUMN email text,
  ADD COLUMN sales_group text,
  ADD COLUMN agent_company text,
  ADD COLUMN commission_currency char(3),
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN zoho_record_id text;

-- Import idempotency: aynı Zoho kaydı iki kez yazılamaz (partial — elle girilen
-- agent'lar zoho_record_id NULL kalır, kısıtlanmaz).
CREATE UNIQUE INDEX uq_sales_agents_zoho_record_id
  ON sales_agents (zoho_record_id)
  WHERE zoho_record_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- version kaydı uzantısız — 015 normalizasyonu ve mevcut kayıtlarla uyumlu
INSERT INTO schema_migrations (version, applied_at)
VALUES ('021_sales_agents_import_prep', now())
ON CONFLICT (version) DO NOTHING;
