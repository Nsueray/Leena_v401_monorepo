-- ============================================================================
-- 045_audit_log.sql — PAKET 2 P2-4: denetim kaydı çekirdeği (2026-10-22)
-- ----------------------------------------------------------------------------
-- ADDITIVE. Yeni tablo; mevcut satır değişmez. Bağımlılık: 032 (users).
-- YALNIZ scripts/migrate.js ile uygulanır. Kaydı runner yazar.
--
-- ── HÜKÜMLER ──
-- - Genel şema gün-1 (REQ §3.6, B15/B16): kim (actor_user_id) · ne (action `<alan>.<olay>`) ·
--   ne zaman · hedef (target_type + target_id metin — uuid ve integer hedefler aynı kolonda) ·
--   sebep (B12: kritik aksiyonda uygulama zorunlu tutar) · diff özeti (jsonb nesne).
-- - YALNIZ EKLENİR: UPDATE / DELETE / TRUNCATE reddedilir (geçmiş yeniden yazılmaz).
-- - Bu pakette yazılan olaylar: davet · davet kabulü · aktif/pasif · profil (ofis) · rol ·
--   kişi başı yetki · bütçe kilidi (LED-15). Genel denetim (her modül) KAPSAM DIŞI.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '045: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

CREATE TABLE audit_log (
  id             bigserial   PRIMARY KEY,
  organizer_id   integer     NOT NULL REFERENCES organizers(id),
  actor_user_id  uuid        REFERENCES users(id),
  action         text        NOT NULL,
  target_type    text        NOT NULL,
  target_id      text        NOT NULL,
  reason         text,
  diff           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_check CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT audit_log_target_check CHECK (btrim(target_type) <> '' AND btrim(target_id) <> ''),
  CONSTRAINT audit_log_reason_check CHECK (reason IS NULL OR btrim(reason) <> ''),
  CONSTRAINT audit_log_diff_check   CHECK (jsonb_typeof(diff) = 'object')
);

CREATE INDEX ix_audit_log_target ON audit_log (organizer_id, target_type, target_id, created_at DESC);
CREATE INDEX ix_audit_log_actor  ON audit_log (actor_user_id, created_at DESC);

CREATE FUNCTION ell_reject_audit_change() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.allow_user_admin_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'YET: audit_log yalniz eklenir (% reddedildi)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION ell_reject_audit_change();
CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_audit_change();
