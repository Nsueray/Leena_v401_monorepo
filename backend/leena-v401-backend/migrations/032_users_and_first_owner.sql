-- Migration 032: users tablosu + ilk Owner + sales_agents.user_id FK (Faz 4, dilim 1)
-- Kimlik altyapısı. Bu dilim YALNIZ şema + ilk Owner satırı — login akışı
-- (routes/auth.js) users'ı OKUMAZ (o dilim 2). JWT payload DEĞİŞMEZ (dilim 2).
--
-- ── users.id = UUID (Sentez, 13 Eyl — LEENA'nın KENDİ ihtiyacı) ──────────────
--   1. Sıralı ID sayım sızdırır (users/47 → kaç kullanıcı; users/46 denenebilir).
--   2. ID kayıt atmadan üretilebilir (toplu import, kuyruk, çevrimdışı).
--   3. İçe aktarma/birleştirmede çakışmaz.
--   ("LIFFY UUID olduğu için" gerekçesi DEĞİL — LEENA çekirdek, taviz vermez.)
--
-- ── organizers.id SERIAL KALIYOR (dokunulmadı) ──────────────────────────────
--   users.organizer_id → organizers(id) FK'si integer. Bu tabloda İKİ tip
--   (uuid PK + integer FK) KASITLI: organizers'a 26 dosya + JWT bağlı.
--
-- ⚠️ gen_random_uuid() PostgreSQL 13+ ÇEKİRDEĞİNDE (pgcrypto gerekmez). LEENA
--   migration'larında UUID üretimi HİÇ kullanılmamış (emsal yok) → PG sürümü
--   blok 1 (SELECT version()) ile DOĞRULANIR. PG<13 çıkarsa: bu dosyanın başına
--   `CREATE EXTENSION IF NOT EXISTS pgcrypto;` eklenir + Render CREATE EXTENSION
--   yetkisi doğrulanır (belirsizse DUR). Bu migration PG13+ varsayar.
--
-- ⚠️ BEGIN/COMMIT YOK (030/031 deseni): dosya dışarıdan sarılır — dry-run
--   `BEGIN; \i 032...; ROLLBACK;`, gerçek koşum `BEGIN; \i 032...; COMMIT;`.
--   Tek psql oturumu, `\set ON_ERROR_STOP on`. Ayrı `psql -c` çağrıları YASAK.
--
-- Idempotent: IF NOT EXISTS + ON CONFLICT. Bağımlılık: 012 (sales_agents,
-- organizers), 014 (sales_agents_user_id_key UNIQUE).

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id         integer NOT NULL REFERENCES organizers(id),
  email                text NOT NULL UNIQUE,
  -- NULL = "henüz şifre yok" (ilk Owner cutover; şifre dilim 2 akışıyla verilir).
  -- ⚠️ NOT NULL DEĞİL, sentinel DEĞİL: hash kolonuna hash-olmayan değer yazmak
  -- veride yalandır — bu kolonu okuyan her kod yolu için kalıcı mayın. NULL dürüst.
  password_hash        text,
  -- B10: Owner statüsü flag'i (aktif Owner < 1 olamaz — aşağıda trigger).
  is_owner             boolean NOT NULL DEFAULT false,
  -- B9: SALT GÖSTERİM. Authorization'da KULLANILMAZ (yetki = permission matrix
  -- + scope + is_owner, dilim 4). Hiçbir kod buna göre yetki vermez.
  display_role         text,
  -- B7: ilk girişte şifre değişmeli.
  password_must_change boolean NOT NULL DEFAULT true,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. B10 — "aktif Owner sayısı 1'in ALTINA inemez" (kütük: LOCKED_KARARLAR B10)
-- ============================================================================
-- ⚠️ Bu "EN AZ 1"dir, "en fazla 1" DEĞİL → partial unique index YANLIŞ araç
-- (o en-fazla-1 verir). En-az-1 tablo-geneli sayım gerektirir → statement-level
-- trigger. UPDATE/DELETE sonrası aktif Owner 0 olursa reddedilir. INSERT'te
-- tetiklenmez (Owner EKLEMEK invariant'ı ihlal etmez).
-- B10'un ikinci yarısı (self-grant yasak) uygulama katmanıdır (permission
-- matrix, dilim 4) — SQL kimin yaptığını bilmez, burada zorlanamaz.
CREATE OR REPLACE FUNCTION enforce_min_one_active_owner() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM users WHERE is_owner AND is_active) = 0 THEN
    RAISE EXCEPTION 'B10: en az bir aktif Owner bulunmalidir (son Owner korunur)';
  END IF;
  RETURN NULL;  -- AFTER STATEMENT: dönüş yok sayılır
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_min_one_active_owner ON users;
CREATE TRIGGER trg_min_one_active_owner
  AFTER UPDATE OR DELETE ON users
  FOR EACH STATEMENT EXECUTE FUNCTION enforce_min_one_active_owner();

-- ============================================================================
-- 3. sales_agents.user_id: integer → uuid + FK → users(id)
-- ============================================================================
-- Kolon + UNIQUE(user_id) (sales_agents_user_id_key) ZATEN var (012/014).
-- UNIQUE bir CONSTRAINT'tir (index değil); ALTER COLUMN TYPE onu otomatik
-- yeniden kurar. Ön koşul (blok 2): user_id dolu satır = 0 → USING hiçbir
-- satıra dokunmaz (NULL::text::uuid = NULL). ⚠️ dolu>0 ise migration PATLAR
-- ("5"::uuid geçersiz) — bu İSTENEN güvenlik (Ö3 dolu=0 doğrular).
ALTER TABLE sales_agents
  ALTER COLUMN user_id TYPE uuid USING user_id::text::uuid;

-- FK. Nullable UNIQUE korunur (external agent'lar user_id NULL, çok NULL serbest).
ALTER TABLE sales_agents
  ADD CONSTRAINT sales_agents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id);

-- ============================================================================
-- 4. İLK OWNER = SUER (B7: is_owner + password_must_change)
-- ============================================================================
-- ⚠️ ŞİFRE DEĞERİ GÖMÜLMEZ. password_hash = NULL ("henüz şifre yok"). Gerçek
-- şifre dilim 2 şifre-belirleme akışıyla (login users'ı orada okur) verilir.
-- ⚠️ password_hash NULL → auth.js bcrypt.compare'i bugün users'ı OKUMUYOR
-- (dilim 2); NULL-şifre giriş yolu dilim 2'nin sorumluluğu (ölçüldü, bkz. defter).
-- organizer_id subquery ile çözülür; organizers'ta e-posta YOKSA açıkça patlar
-- (sessiz 0-satır yerine). ⚠️ E-posta blok 3 ile DOĞRULANIR; farklıysa güncellenir.
DO $$
DECLARE oid integer;
BEGIN
  SELECT id INTO oid FROM organizers WHERE email = 'suer@elan-expo.com';
  IF oid IS NULL THEN
    RAISE EXCEPTION 'B7 ilk Owner: organizers''ta suer@elan-expo.com YOK — blok 3 ile e-postayi dogrula, migration''daki e-postayi guncelle';
  END IF;
  INSERT INTO users
    (organizer_id, email, password_hash, is_owner, display_role, password_must_change, is_active)
  VALUES
    (oid, 'suer@elan-expo.com', NULL, true, 'Owner', true, true)
  ON CONFLICT (email) DO NOTHING;
END $$;

-- ============================================================================
-- Verify (koşum sonrası; dry-run'da da görülebilir)
-- ============================================================================
-- users: 1 satır, Owner, must_change=true beklenir.
SELECT id, organizer_id, email, is_owner, display_role, password_must_change, is_active
FROM users;
-- sales_agents.user_id artık uuid + FK:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sales_agents' AND column_name = 'user_id';
