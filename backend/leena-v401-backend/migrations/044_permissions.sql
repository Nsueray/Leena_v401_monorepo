-- ============================================================================
-- 044_permissions.sql — PAKET 2 P2-2: yetki matrisi çekirdeği (2026-10-22)
-- ----------------------------------------------------------------------------
-- Yeni tablolar: permissions (kayıt defteri) · roles (şablonlar) · role_permissions ·
-- user_permissions (kişi başı ezme) + users.role_id. Tohum: 5 sistem şablonu, aktif Owner'ı
-- olan her kiracıya (LED-17 deseni); is_owner kullanıcılar Owner şablonuna atanır.
-- Bağımlılık: 032 (users), 043 (users_org_id_key). YALNIZ scripts/migrate.js ile uygulanır.
--
-- ── HÜKÜMLER ──
-- - B22: tek anahtar biçimi `<module>.<action>`; eylem read | write | approve (Sentez EK: "field"
--   eylemi YOK — alan gizleme bu pakette yok; tablo genişletilebilir kalır).
-- - Kayıt defteri SİSTEM GENELİDİR (organizer_id YOK): kod `requirePermission('ledger.write')`
--   ile bu kodlara bağlıdır; kiracıya göre değişen bir şey değildir. Kiracı verisi taşıyan
--   tablolar (roles, role_permissions, user_permissions) organizer_id + bileşik FK taşır.
-- - B9: rol adı yetkide KULLANILMAZ — çözümleme yalnız role_permissions + user_permissions
--   satırlarını okur (utils/permissions.js, tek yer).
-- - B10/B25: Owner = users.is_owner; çözümlemede kısa devre; Owner şablonunun satırı YOK.
--   is_owner kullanıcı için kişi başı ezme yazılamaz (aşağıda trigger).
-- - B27/B28: sistem şablonları değişmez + silinmez; satırları yalnız runner'lı migration
--   (ell.migration_runner) değiştirir. Özel şablon (is_system = false) bu pakette yazılmaz.
-- - Kapsam own | team | office | all — satırda; çözümleme uygulamada.
-- - Varsayılan şablon içerikleri REQ §3.1'in "yapılandırılabilir varsayılan" ilkesiyle seçildi
--   (🔶 Sentez teyidi): "Edit Reference Data — Owner by default" → reference.write hiçbir
--   şablonda yok; "Edit Permission Matrix of Other Users — Owner only" → permissions.write yok.
-- ============================================================================

DO $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') <> 'on' THEN
    RAISE EXCEPTION '044: yalniz scripts/migrate.js ile uygulanir (psql -f ile kosulamaz)';
  END IF;
END $$;

-- ── 1) Kayıt defteri ────────────────────────────────────────────────────────
CREATE TABLE permissions (
  code        text PRIMARY KEY,
  area        text NOT NULL,
  module      text NOT NULL,
  action      text NOT NULL,
  description text NOT NULL,
  CONSTRAINT permissions_area_check   CHECK (area IN ('finance', 'operations', 'sales', 'admin')),
  CONSTRAINT permissions_action_check CHECK (action IN ('read', 'write', 'approve')),
  CONSTRAINT permissions_module_check CHECK (module ~ '^[a-z][a-z_]*$'),
  CONSTRAINT permissions_code_check   CHECK (code = module || '.' || action)
);

INSERT INTO permissions (code, area, module, action, description) VALUES
  ('contracts.read',         'finance',    'contracts',      'read',    'See contracts (Finance > Contracts). Menu only in this release.'),
  ('commissions.read',       'finance',    'commissions',    'read',    'See commission reports and agent statements. Menu only in this release.'),
  ('payouts.write',          'finance',    'payouts',        'write',   'Record and reverse commission payouts.'),
  ('ledger.read',            'finance',    'ledger',         'read',    'See accounts, statements, transfers, expenses and the finance summary.'),
  ('ledger.write',           'finance',    'ledger',         'write',   'Open and edit accounts; record and reverse transfers and expenses.'),
  ('suppliers.read',         'finance',    'suppliers',      'read',    'See suppliers and their payment history.'),
  ('suppliers.write',        'finance',    'suppliers',      'write',   'Add, edit and deactivate suppliers.'),
  ('expense_drafts.read',    'finance',    'expense_drafts', 'read',    'See expense drafts.'),
  ('expense_drafts.write',   'finance',    'expense_drafts', 'write',   'Create expense drafts (AI, import or manual).'),
  ('expense_drafts.approve', 'finance',    'expense_drafts', 'approve', 'Accept (creates the expense) or reject expense drafts.'),
  ('budget.read',            'finance',    'budget',         'read',    'See expo budgets.'),
  ('budget.write',           'finance',    'budget',         'write',   'Create expo budget revisions (locking stays Owner-only).'),
  ('reference.write',        'finance',    'reference',      'write',   'Add or rename currencies, expense categories/types and income categories.'),
  ('operations.read',        'operations', 'operations',     'read',    'See the Operations area. Menu only in this release.'),
  ('sales.read',             'sales',      'sales',          'read',    'See the Sales area. Menu only in this release.'),
  ('users.read',             'admin',      'users',          'read',    'See users.'),
  ('users.write',            'admin',      'users',          'write',   'Invite, edit, activate and deactivate users.'),
  ('permissions.write',      'admin',      'permissions',    'write',   'Change other users'' role, office and per-user permissions.');

-- ── 2) Şablonlar ────────────────────────────────────────────────────────────
CREATE TABLE roles (
  id            serial      PRIMARY KEY,
  organizer_id  integer     NOT NULL REFERENCES organizers(id),
  name          text        NOT NULL,
  is_system     boolean     NOT NULL DEFAULT false,
  owner_template boolean    NOT NULL DEFAULT false,
  description   text,
  created_by    uuid        REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_org_id_key UNIQUE (organizer_id, id),
  CONSTRAINT roles_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT roles_owner_template_check CHECK (NOT owner_template OR is_system)
);
CREATE UNIQUE INDEX uq_roles_org_name ON roles (organizer_id, lower(btrim(name)));
-- Owner şablonu kiracı başına TEK; ad değil bu bayrak tanır (B9) — atama API'si bunu reddeder.
CREATE UNIQUE INDEX uq_roles_owner_template ON roles (organizer_id) WHERE owner_template;

CREATE TABLE role_permissions (
  organizer_id    integer NOT NULL,
  role_id         integer NOT NULL,
  permission_code text    NOT NULL REFERENCES permissions(code),
  scope           text    NOT NULL,
  PRIMARY KEY (role_id, permission_code),
  CONSTRAINT role_permissions_role_fkey FOREIGN KEY (organizer_id, role_id) REFERENCES roles (organizer_id, id),
  CONSTRAINT role_permissions_scope_check CHECK (scope IN ('own', 'team', 'office', 'all'))
);

ALTER TABLE users ADD COLUMN role_id integer,
  ADD CONSTRAINT users_role_fkey FOREIGN KEY (organizer_id, role_id) REFERENCES roles (organizer_id, id);

-- ── 3) Kişi başı ezme (B30/B42) ─────────────────────────────────────────────
-- grant → kapsamıyla verilir (şablonda yoksa ekler, varsa kapsamını değiştirir); revoke → şablondakini kaldırır.
CREATE TABLE user_permissions (
  organizer_id    integer     NOT NULL,
  user_id         uuid        NOT NULL,
  permission_code text        NOT NULL REFERENCES permissions(code),
  effect          text        NOT NULL,
  scope           text,
  reason          text,
  created_by      uuid        REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_code),
  CONSTRAINT user_permissions_user_fkey FOREIGN KEY (organizer_id, user_id) REFERENCES users (organizer_id, id),
  CONSTRAINT user_permissions_effect_check CHECK (effect IN ('grant', 'revoke')),
  CONSTRAINT user_permissions_scope_check CHECK (
    (effect = 'grant' AND scope IN ('own', 'team', 'office', 'all')) OR (effect = 'revoke' AND scope IS NULL)),
  CONSTRAINT user_permissions_reason_check CHECK (reason IS NULL OR btrim(reason) <> '')
);

-- ── 4) Tohum: 5 sistem şablonu (aktif Owner'ı olan kiracı) ─────────────────
INSERT INTO roles (organizer_id, name, is_system, owner_template, description)
SELECT o.id, r.name, true, r.name = 'Owner', r.description
  FROM organizers o
 CROSS JOIN (VALUES
   ('Owner',          'Full access (users.is_owner). No permission rows — resolved by short-circuit.'),
   ('Finance',        'Financial modules in full: ledger, suppliers, drafts, budgets, payouts.'),
   ('Project',        'Operations area plus expo budgets.'),
   ('Office Manager', 'Ledger, suppliers, drafts and payouts limited to their own office.'),
   ('Sales',          'Own sales records and own commission view.')
 ) AS r(name, description)
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.organizer_id = o.id AND u.is_owner AND u.is_active);

INSERT INTO role_permissions (organizer_id, role_id, permission_code, scope)
SELECT ro.organizer_id, ro.id, g.code, g.scope
  FROM roles ro
  JOIN (VALUES
    ('Finance', 'contracts.read', 'all'), ('Finance', 'commissions.read', 'all'), ('Finance', 'payouts.write', 'all'),
    ('Finance', 'ledger.read', 'all'), ('Finance', 'ledger.write', 'all'),
    ('Finance', 'suppliers.read', 'all'), ('Finance', 'suppliers.write', 'all'),
    ('Finance', 'expense_drafts.read', 'all'), ('Finance', 'expense_drafts.write', 'all'), ('Finance', 'expense_drafts.approve', 'all'),
    ('Finance', 'budget.read', 'all'), ('Finance', 'budget.write', 'all'),
    ('Project', 'operations.read', 'all'), ('Project', 'budget.read', 'all'), ('Project', 'budget.write', 'all'),
    ('Office Manager', 'contracts.read', 'office'), ('Office Manager', 'commissions.read', 'office'),
    ('Office Manager', 'payouts.write', 'office'),
    ('Office Manager', 'ledger.read', 'office'), ('Office Manager', 'ledger.write', 'office'),
    ('Office Manager', 'suppliers.read', 'all'), ('Office Manager', 'suppliers.write', 'office'),
    ('Office Manager', 'expense_drafts.read', 'office'), ('Office Manager', 'expense_drafts.write', 'office'),
    ('Office Manager', 'expense_drafts.approve', 'office'),
    ('Office Manager', 'operations.read', 'office'), ('Office Manager', 'sales.read', 'office'),
    ('Sales', 'sales.read', 'own'), ('Sales', 'contracts.read', 'own'), ('Sales', 'commissions.read', 'own')
  ) AS g(role_name, code, scope) ON g.role_name = ro.name
 WHERE ro.is_system;

UPDATE users u SET role_id = ro.id
  FROM roles ro
 WHERE ro.organizer_id = u.organizer_id AND ro.owner_template AND u.is_owner AND u.role_id IS NULL;

-- ── 5) Korumalar ────────────────────────────────────────────────────────────
-- Sistem şablonu: ad / is_system / kiracı değişmez, silinmez (B27/B28). Özel şablon serbest.
CREATE FUNCTION ell_guard_roles() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') = 'on'
     OR COALESCE(current_setting('ell.allow_user_admin_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN RAISE EXCEPTION 'YET: sistem sablonu silinmez (B27/B28)'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.is_system IS DISTINCT FROM OLD.is_system
                        OR NEW.owner_template IS DISTINCT FROM OLD.owner_template
                        OR NEW.organizer_id IS DISTINCT FROM OLD.organizer_id) THEN
    RAISE EXCEPTION 'YET: sistem sablonu degistirilemez (B27/B28)';
  END IF;
  IF NOT OLD.is_system AND NEW.is_system THEN
    RAISE EXCEPTION 'YET: ozel sablon sistem sablonuna cevrilemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_roles_guard
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION ell_guard_roles();

-- Sistem şablonunun satırları yalnız migration'la değişir.
CREATE FUNCTION ell_guard_role_permissions() RETURNS trigger AS $$
DECLARE sys boolean;
BEGIN
  IF COALESCE(current_setting('ell.migration_runner', true), '') = 'on'
     OR COALESCE(current_setting('ell.allow_user_admin_reset', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT is_system INTO sys FROM roles WHERE id = COALESCE(NEW.role_id, OLD.role_id);
  IF sys THEN
    RAISE EXCEPTION 'YET: sistem sablonunun yetkileri degistirilemez (B27/B28) — kisi basi ezme kullanilir';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT is_system INTO sys FROM roles WHERE id = OLD.role_id;
    IF sys THEN RAISE EXCEPTION 'YET: sistem sablonunun yetkileri degistirilemez (B27/B28)'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_permissions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION ell_guard_role_permissions();

-- Owner kısa devresi değiştirilemez: is_owner kullanıcıya kişi başı ezme yazılamaz.
CREATE FUNCTION ell_guard_user_permissions() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND is_owner) THEN
    RAISE EXCEPTION 'YET: Owner yetkisi kisa devredir — kisi basi ezme yazilamaz (B10/B25)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_permissions_owner
  BEFORE INSERT OR UPDATE ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION ell_guard_user_permissions();

CREATE TRIGGER trg_roles_no_truncate
  BEFORE TRUNCATE ON roles
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_user_admin_truncate();
CREATE TRIGGER trg_role_permissions_no_truncate
  BEFORE TRUNCATE ON role_permissions
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_user_admin_truncate();
CREATE TRIGGER trg_permissions_no_truncate
  BEFORE TRUNCATE ON permissions
  FOR EACH STATEMENT EXECUTE FUNCTION ell_reject_user_admin_truncate();

DO $$
DECLARE n_roles int; n_rp int; n_owner int;
BEGIN
  SELECT count(*) INTO n_roles FROM roles;
  SELECT count(*) INTO n_rp FROM role_permissions;
  SELECT count(*) INTO n_owner FROM users WHERE role_id IS NOT NULL;
  RAISE NOTICE '044: permissions 18, roles %, role_permissions %, users with role % (owners → Owner template)',
    n_roles, n_rp, n_owner;
END $$;
