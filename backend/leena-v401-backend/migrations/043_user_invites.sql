-- ============================================================================
-- 043_user_invites.sql — PAKET 2 P2-1: kullanıcı ofisi + davet + satış temsilcisi bağı (2026-10-22)
-- ----------------------------------------------------------------------------
-- Yeni tablo (user_invites) + users'a nullable kolon + bileşik anahtar.
-- ⚠️ VERİ DEĞİŞTİRİR (YON-11 KAPI-2): sales_agents.user_id geriye dönük doldurulur — yalnız
--    e-postası TEK bir internal temsilciyle eşleşen kullanıcı için (aşağıda §3). Canlı ölçüm
--    (22 Eki, salt-okunur): users 1 · internal temsilci 128 (e-postalı 126) · Suer'in e-postası
--    tam 1 internal temsilciyle eşleşir → beklenen bağ 1. Aynı e-postayı taşıyan internal
--    temsilci grubu 11 → o e-postalara sahip kullanıcı olursa bağ BOŞ kalır (çoklu = belirsiz).
-- Bağımlılık: 012/014/032 (sales_agents.user_id uuid + UNIQUE + FK), 026 (offices).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - users.office_id: kapsam çözümlemesinin (scope = office) girdisi; nullable (Owner/HQ boş olabilir).
-- - Davet token'ı DÜZ METİN SAKLANMAZ: yalnız SHA-256 özeti (64 hex). Tek kullanımlık (used_at),
--   süreli (expires_at; uygulama 72 saat yazar), iptal edilebilir (revoked_at: yeniden davet /
--   pasifleme). Kullanıcı başına en fazla bir AÇIK davet (kullanılmamış + iptal edilmemiş).
-- - Davet satırı silinmez; kimlik alanları değişmez; used_at / revoked_at tek yönlüdür.
-- - Çok-kiracı (YON-07): user_invites → users bileşik FK (organizer_id, id).
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '043: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

-- ── 1) users: ofis + kiracı-bileşik anahtar ─────────────────────────────────
ALTER TABLE users ADD COLUMN office_id integer REFERENCES offices(id);
ALTER TABLE users ADD CONSTRAINT users_org_id_key UNIQUE (organizer_id, id);

-- ── 2) user_invites ─────────────────────────────────────────────────────────
CREATE TABLE user_invites (
  id            serial      PRIMARY KEY,
  organizer_id  integer     NOT NULL REFERENCES organizers(id),
  user_id       uuid        NOT NULL,
  token_hash    text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_by    uuid        REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_user_fkey FOREIGN KEY (organizer_id, user_id) REFERENCES users (organizer_id, id),
  CONSTRAINT user_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_invites_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_invites_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT user_invites_state_check CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX uq_user_invites_open ON user_invites (user_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION ell_guard_user_invites() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_user_admin_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'YET: user_invites silinmez (DELETE reddedildi) — iptal = revoked_at';
  END IF;
  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'YET: user_invites kimlik alanlari degistirilemez';
  END IF;
  IF (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'YET: davet karari (used_at / revoked_at) geri alinmaz';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_invites_guard
  BEFORE UPDATE OR DELETE ON user_invites
  FOR EACH ROW EXECUTE FUNCTION ell_guard_user_invites();

CREATE FUNCTION ell_reject_user_admin_truncate() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_user_admin_reset', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'YET: % TRUNCATE reddedildi', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_invites_no_truncate
  BEFORE TRUNCATE ON user_invites
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_user_admin_truncate();

-- ── 3) sales_agents.user_id — internal temsilci bağı, e-posta eşleşmesiyle ──
-- Kural: kullanıcının e-postası (lower+btrim) aynı kiracıda TAM BİR internal temsilciyle
-- eşleşiyorsa ve o temsilci boşsa ve kullanıcı başka temsilciye bağlı değilse → bağlanır.
-- Çoklu eşleşme → boş (belirsiz; insan seçer). External temsilciye bağ YOK (CHECK zaten reddeder).
DO $$
DECLARE
  n_users int; n_linked int; n_ambiguous int; n_nomatch int;
BEGIN
  SELECT count(*) INTO n_users FROM users;
  WITH cand AS (
    SELECT u.id AS user_id, min(sa.id) AS agent_id, count(sa.id) AS n
      FROM users u
      LEFT JOIN sales_agents sa
        ON sa.organizer_id = u.organizer_id AND sa.agent_type = 'internal'
       AND sa.email IS NOT NULL AND lower(btrim(sa.email)) = lower(btrim(u.email))
     GROUP BY u.id
  ), upd AS (
    UPDATE sales_agents sa SET user_id = c.user_id, updated_at = now()
      FROM cand c
     WHERE c.n = 1 AND sa.id = c.agent_id AND sa.user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM sales_agents x WHERE x.user_id = c.user_id)
    RETURNING sa.id
  )
  SELECT (SELECT count(*) FROM upd),
         (SELECT count(*) FROM cand WHERE n > 1),
         (SELECT count(*) FROM cand WHERE n = 0)
    INTO n_linked, n_ambiguous, n_nomatch;
  RAISE NOTICE '043: sales_agents backfill — users %, linked %, ambiguous (>1 internal agent, left empty) %, no match %',
    n_users, n_linked, n_ambiguous, n_nomatch;
END $$;
