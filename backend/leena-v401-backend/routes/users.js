// ----------------------------------------------------------------------------
// routes/users.js — KULLANICI YÖNETİMİ + YETKİ MATRİSİ (Paket 2 P2-1 / P2-2). Mount: /api/users
//   GET    /options                  → şablonlar (+ satırları) · ofisler · bağlanabilir internal temsilciler · kayıt defteri
//   GET    /                         → kullanıcı listesi (kapsamla süzülür)
//   GET    /:id                      → detay + yetki matrisi (şablon · kişi ezmesi · etkin) [+ Owner'a son olaylar]
//   POST   /invite                   → davet: users satırı (şifre NULL) + tek kullanımlık token + e-posta
//   POST   /:id/invite               → yeniden davet (açık davet iptal edilir)
//   PUT    /:id                      → profil: display_name · sales_agent_id · office_id
//   POST   /:id/deactivate           → pasif (sebep ZORUNLU, B12) · /:id/activate → aktif
//   PUT    /:id/role                 → şablon ata (permissions.write)
//   PUT    /:id/permissions/:code    → kişi başı ezme (grant + kapsam | revoke) · DELETE → ezmeyi kaldır
//
// ── HÜKÜMLER ──
// - Kapı: requirePermission(kod) (utils/permissions.js, tek çözümleme yeri); rol adı kontrol EDİLMEZ (B9).
// - B32: kimse kendi şablonunu / yetkisini / ofisini değiştiremez (Owner dahil); kendini pasifleştiremez.
// - B10: Owner hedefinin şablonu/yetkisi değişmez (kısa devre); Owner'ı yalnız Owner pasifleştirir;
//   son aktif Owner pasifleştirilemez (032 trigger'ı + burada önden anlamlı 409). is_owner verme YOK (B24).
// - Yetki verme sınırı (🔶): Owner olmayan, sahip olmadığı yetkiyi / kendi kapsamından genişini veremez.
// - B12: pasifleştirme sebep ister; denetim kaydına yazılır (045).
// - Davet token'ı düz metin saklanmaz (utils/invites.js); hatalar tek tip.
// - Ret kodları 409 (PERMISSION_REQUIRED / OUT_OF_SCOPE / SELF_EDIT / OWNER_FIXED / OWNER_REQUIRED) —
//   403 DEĞİL (G45: leena-fetch 401/403'te oturumu siler).
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
const perms = require('../utils/permissions');
const { writeAudit } = require('../utils/audit');
const inv = require('../utils/invites');
const { trimOrNull, isIntLike } = require('../utils/ledger');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RANK = { own: 1, team: 2, office: 3, all: 4 };

const USER_SELECT = `
  SELECT u.id::text AS id, u.email, u.display_name, u.is_active, u.is_owner, u.password_must_change,
         (u.password_hash IS NOT NULL) AS has_password, u.created_at,
         u.office_id, o.name AS office_name, u.role_id, r.name AS role_name, COALESCE(r.owner_template, false) AS role_is_owner_template,
         sa.id AS sales_agent_id, sa.name AS sales_agent_name,
         iv.invite_state, iv.invite_expires_at, iv.invite_sent_at
    FROM users u
    LEFT JOIN offices o       ON o.id = u.office_id
    LEFT JOIN roles r         ON r.id = u.role_id
    LEFT JOIN sales_agents sa ON sa.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN i.used_at IS NOT NULL THEN 'accepted'
                  WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN i.expires_at <= now() THEN 'expired' ELSE 'pending' END AS invite_state,
             i.expires_at AS invite_expires_at, i.created_at AS invite_sent_at
        FROM user_invites i WHERE i.user_id = u.id ORDER BY i.created_at DESC, i.id DESC LIMIT 1
    ) iv ON TRUE
   WHERE u.organizer_id = $1`;

// Liste/detay satırına türetilmiş durum (saklanmaz): inactive · invited (açık davet) · invite_expired
// (son davet süresi geçmiş / iptal) · no_password (hiç davet yok — ör. tohumlanan ilk Owner) · active.
function withStatus(u) {
  let status = 'active';
  if (!u.is_active) status = 'inactive';
  else if (!u.has_password) {
    status = u.invite_state === 'pending' ? 'invited' : (u.invite_state ? 'invite_expired' : 'no_password');
  }
  return { ...u, status };
}

function mapError(err) {
  if (err.code === '23505') {
    if (err.constraint === 'users_email_key') return { status: 409, body: { error: 'A user with this email already exists.' } };
    if (err.constraint === 'sales_agents_user_id_key') return { status: 409, body: { error: 'This sales agent is already linked to another user.' } };
    return { status: 409, body: { error: 'Duplicate value violates a unique constraint.' } };
  }
  if (err.code === '23503') return { status: 400, body: { error: 'Referenced record does not exist.' } };
  if (err.code === '23514') return { status: 400, body: { error: 'A value violates a database check constraint.' } };
  if (err.code === 'P0001' && /B10/.test(err.message || '')) {
    return { status: 409, body: { error: 'The last active Owner cannot be deactivated (B10).', code: 'LAST_OWNER' } };
  }
  return null;
}
function fail(res, err, what) {
  const m = mapError(err);
  if (m) return res.status(m.status).json(m.body);
  console.error(`Users ${what} failed:`, err);
  return res.status(500).json({ error: `Failed to ${what}.` });
}

const SELF_EDIT = { error: 'No one can change their own role, permissions or office (B32).', code: 'SELF_EDIT' };
const OWNER_FIXED = { error: 'The Owner has full access by definition — role and permissions cannot be changed.', code: 'OWNER_FIXED' };

async function targetUser(db, req, id, lock = false) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const r = await db.query(
    `SELECT id::text AS id, organizer_id, email, display_name, is_owner, is_active, office_id, role_id,
            (password_hash IS NOT NULL) AS has_password
       FROM users WHERE id = $1 AND organizer_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, req.organizer_id]);
  return r.rows[0] || null;
}
const userTarget = (u) => ({ office_id: u.office_id, created_by: u.id });
const actorId = (req) => req.user_id || null;

// Owner olmayan, elinde olmayan yetkiyi / kendi kapsamından genişini veremez.
function canGrant(req, code, scope) {
  if (!req.access || req.access.owner) return true;
  const mine = req.access.eff.perms[code];
  return !!mine && SCOPE_RANK[scope] <= SCOPE_RANK[mine.scope];
}
async function roleGrantable(db, req, roleId) {
  if (!req.access || req.access.owner) return true;
  const rows = (await db.query('SELECT permission_code, scope FROM role_permissions WHERE role_id = $1', [roleId])).rows;
  return rows.every(r => canGrant(req, r.permission_code, r.scope));
}
const BEYOND_OWN = { error: 'You cannot grant a permission (or a wider scope) that you do not have yourself.', code: 'GRANT_EXCEEDS_OWN' };

async function assignableRole(db, req, roleId) {
  if (!isIntLike(roleId)) return { error: 'invalid role' };
  const r = await db.query('SELECT id, name, owner_template FROM roles WHERE id = $1 AND organizer_id = $2', [roleId, req.organizer_id]);
  if (!r.rows.length) return { error: 'invalid role' };
  if (r.rows[0].owner_template) return { error: 'The Owner template is assigned only together with Owner status.' };
  return { role: r.rows[0] };
}

async function linkableAgent(db, req, agentId, userId = null) {
  if (!isIntLike(agentId)) return { error: 'invalid sales agent' };
  const a = await db.query(
    `SELECT id, name, agent_type, user_id::text AS user_id FROM sales_agents WHERE id = $1 AND organizer_id = $2`,
    [agentId, req.organizer_id]);
  if (!a.rows.length) return { error: 'invalid sales agent' };
  if (a.rows[0].agent_type !== 'internal') return { error: 'Only an internal sales agent can be linked to a user.' };
  if (a.rows[0].user_id && a.rows[0].user_id !== userId) return { error: 'This sales agent is already linked to another user.' };
  return { agent: a.rows[0] };
}

// ── Kapılar ────────────────────────────────────────────────────────────────
router.use(authMiddleware);
router.use(async (req, res, next) => {
  try {
    if (await perms.permissionsReady(pool)) return next();
    return res.status(503).json({ error: 'User management is not migrated yet (run scripts/migrate.js).' });
  } catch (err) { return next(err); }
});
const canRead = perms.requirePermission('users.read');
const canWrite = perms.requirePermission('users.write');
const canMatrix = perms.requirePermission('permissions.write');

// ── Okuma ──────────────────────────────────────────────────────────────────
router.get('/options', canRead, async (req, res) => {
  try {
    const org = req.organizer_id;
    const roles = (await pool.query(
      `SELECT id, name, is_system, owner_template, description FROM roles WHERE organizer_id = $1
        ORDER BY owner_template DESC, is_system DESC, id`, [org])).rows;
    const rp = (await pool.query('SELECT role_id, permission_code, scope FROM role_permissions WHERE organizer_id = $1', [org])).rows;
    for (const r of roles) r.permissions = rp.filter(x => x.role_id === r.id).map(x => ({ code: x.permission_code, scope: x.scope }));
    const offices = (await pool.query('SELECT id, name FROM offices WHERE is_active ORDER BY name')).rows;
    const agents = (await pool.query(
      `SELECT id, name, email, is_active FROM sales_agents
        WHERE organizer_id = $1 AND agent_type = 'internal' AND user_id IS NULL
        ORDER BY is_active DESC, lower(name)`, [org])).rows;
    const registry = (await pool.query('SELECT code, area, module, action, description FROM permissions ORDER BY area, module, action')).rows;
    res.json({ roles, offices, agents, registry, scopes: perms.SCOPES, invite_ttl_hours: inv.INVITE_TTL_HOURS,
               actor: { user_id: actorId(req), owner: !!(req.access && req.access.owner),
                        can_write: perms.hasPermission(req, 'users.write'), can_matrix: perms.hasPermission(req, 'permissions.write') } });
  } catch (err) { return fail(res, err, 'load options'); }
});

router.get('/', canRead, async (req, res) => {
  try {
    const r = await pool.query(`${USER_SELECT} ORDER BY u.is_active DESC, u.is_owner DESC, lower(COALESCE(u.display_name, u.email))`, [req.organizer_id]);
    res.json(r.rows.filter(u => perms.checkScope(req, userTarget(u))).map(withStatus));
  } catch (err) { return fail(res, err, 'list users'); }
});

router.get('/:id', canRead, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'User not found' });
  try {
    const r = await pool.query(`${USER_SELECT} AND u.id = $2`, [req.organizer_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    const u = r.rows[0];
    if (!perms.checkScope(req, userTarget(u))) return res.status(409).json(perms.OUT_OF_SCOPE);
    const role_permissions = u.role_id == null ? [] : (await pool.query(
      'SELECT permission_code AS code, scope FROM role_permissions WHERE role_id = $1 ORDER BY permission_code', [u.role_id])).rows;
    const overrides = (await pool.query(
      `SELECT permission_code AS code, effect, scope, reason, created_at FROM user_permissions
        WHERE user_id = $1 ORDER BY permission_code`, [u.id])).rows;
    const effective = await perms.permissionSummary(pool, { id: u.id, organizer_id: req.organizer_id, is_owner: u.is_owner, role_id: u.role_id });
    let history = null;
    if (req.access && req.access.owner) {   // "View Audit Log — Owner by default" (REQ §3.1)
      history = (await pool.query(
        `SELECT a.action, a.reason, a.diff, a.created_at, COALESCE(x.display_name, x.email) AS actor_name
           FROM audit_log a LEFT JOIN users x ON x.id = a.actor_user_id
          WHERE a.organizer_id = $1 AND a.target_type = 'user' AND a.target_id = $2
          ORDER BY a.created_at DESC, a.id DESC LIMIT 30`, [req.organizer_id, u.id])).rows;
    }
    res.json({ user: withStatus(u), role_permissions, overrides, effective, history,
               is_self: u.id === actorId(req) });
  } catch (err) { return fail(res, err, 'load user'); }
});

// ── Davet ──────────────────────────────────────────────────────────────────
async function createInvite(client, req, user) {
  await client.query(
    `UPDATE user_invites SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [user.id]);
  const t = inv.newInviteToken();
  const i = await client.query(
    `INSERT INTO user_invites (organizer_id, user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval, $5) RETURNING id, expires_at`,
    [req.organizer_id, user.id, t.hash, String(inv.INVITE_TTL_HOURS), actorId(req)]);
  const url = inv.inviteUrl(req, t.token);
  const actor = req.access && req.access.user;
  const inviter = actor ? (await client.query('SELECT COALESCE(display_name, email) AS n FROM users WHERE id = $1', [actor.id])).rows[0].n : null;
  const queueId = await inv.enqueueInviteEmail(client, { organizerId: req.organizer_id, email: user.email, url, inviterName: inviter });
  return { invite: i.rows[0], url, queueId };
}
function echoOut(user, url) {
  if (!inv.echoEnabled()) return undefined;
  console.log(`[invite] INVITE_ECHO=1 — invite link for ${user.email}: ${url}`);
  return url;
}

router.post('/invite', canWrite, async (req, res) => {
  const b = req.body || {};
  const email = (trimOrNull(b.email) || '').toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
  const display_name = trimOrNull(b.display_name);
  const has = (k) => b[k] != null && b[k] !== '';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let role = null;
    if (has('role_id')) {
      if (!perms.hasPermission(req, 'permissions.write')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Choosing a role needs the permissions.write permission.', code: 'PERMISSION_REQUIRED', permission: 'permissions.write' });
      }
      const ar = await assignableRole(client, req, b.role_id);
      if (ar.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: ar.error }); }
      if (!(await roleGrantable(client, req, ar.role.id))) { await client.query('ROLLBACK'); return res.status(409).json(BEYOND_OWN); }
      role = ar.role;
    }
    let office_id = null;
    if (has('office_id')) {
      const o = isIntLike(b.office_id) ? await client.query('SELECT id FROM offices WHERE id = $1 AND is_active', [b.office_id]) : { rows: [] };
      if (!o.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid office' }); }
      office_id = o.rows[0].id;
    }
    if (!perms.checkScope(req, { office_id, created_by: null })) { await client.query('ROLLBACK'); return res.status(409).json(perms.OUT_OF_SCOPE); }
    let agent = null;
    if (has('sales_agent_id')) {
      const la = await linkableAgent(client, req, b.sales_agent_id);
      if (la.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: la.error }); }
      agent = la.agent;
    }
    const dup = await client.query('SELECT id::text AS id, is_active, (password_hash IS NOT NULL) AS has_password FROM users WHERE lower(email) = $1', [email]);
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      const d = dup.rows[0];
      return res.status(409).json({ error: d.has_password || !d.is_active
        ? 'A user with this email already exists.'
        : 'This person is already invited — resend the invitation from their user page.', user_id: d.id });
    }
    const u = await client.query(
      `INSERT INTO users (organizer_id, email, display_name, password_hash, is_owner, password_must_change, is_active, office_id, role_id)
       VALUES ($1, $2, $3, NULL, false, true, true, $4, $5) RETURNING id::text AS id, email`,
      [req.organizer_id, email, display_name, office_id, role ? role.id : null]);
    const user = u.rows[0];
    if (agent) await client.query('UPDATE sales_agents SET user_id = $1, updated_at = now() WHERE id = $2', [user.id, agent.id]);
    const c = await createInvite(client, req, user);
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.invite', targetType: 'user',
      targetId: user.id, diff: { email, display_name, role: role ? role.name : null, office_id, sales_agent_id: agent ? agent.id : null } });
    await client.query('COMMIT');
    const row = await pool.query(`${USER_SELECT} AND u.id = $2`, [req.organizer_id, user.id]);
    res.status(201).json({ user: withStatus(row.rows[0]), invite: { expires_at: c.invite.expires_at }, email_queued: true,
                           invite_url: echoOut(user, c.url) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'invite user');
  } finally { client.release(); }
});

router.post('/:id/invite', canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await targetUser(client, req, req.params.id, true);
    if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (!perms.checkScope(req, userTarget(t))) { await client.query('ROLLBACK'); return res.status(409).json(perms.OUT_OF_SCOPE); }
    if (!t.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'The user is inactive — activate them first.' }); }
    if (t.has_password) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This user has already set a password.' }); }
    const c = await createInvite(client, req, t);
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.invite_resend', targetType: 'user', targetId: t.id });
    await client.query('COMMIT');
    res.status(201).json({ invite: { expires_at: c.invite.expires_at }, email_queued: true, invite_url: echoOut(t, c.url) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'resend invitation');
  } finally { client.release(); }
});

// ── Profil ─────────────────────────────────────────────────────────────────
router.put('/:id', canWrite, async (req, res) => {
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await targetUser(client, req, req.params.id, true);
    if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (!perms.checkScope(req, userTarget(t))) { await client.query('ROLLBACK'); return res.status(409).json(perms.OUT_OF_SCOPE); }
    const diff = {};
    if (has('display_name')) {
      const dn = trimOrNull(b.display_name);
      if (dn !== t.display_name) { await client.query('UPDATE users SET display_name = $2 WHERE id = $1', [t.id, dn]); diff.display_name = { from: t.display_name, to: dn }; }
    }
    if (has('office_id')) {
      const next = (b.office_id == null || b.office_id === '') ? null : b.office_id;
      if (String(next) !== String(t.office_id)) {
        // Ofis = kapsam girdisi → yetki değişikliği sayılır (B32 + permissions.write).
        if (t.id === actorId(req)) { await client.query('ROLLBACK'); return res.status(409).json(SELF_EDIT); }
        if (!perms.hasPermission(req, 'permissions.write')) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Changing the office needs the permissions.write permission.', code: 'PERMISSION_REQUIRED', permission: 'permissions.write' });
        }
        let office_id = null;
        if (next != null) {
          const o = isIntLike(next) ? await client.query('SELECT id FROM offices WHERE id = $1 AND is_active', [next]) : { rows: [] };
          if (!o.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'invalid office' }); }
          office_id = o.rows[0].id;
        }
        if (!perms.checkScope(req, { office_id, created_by: t.id })) { await client.query('ROLLBACK'); return res.status(409).json(perms.OUT_OF_SCOPE); }
        await client.query('UPDATE users SET office_id = $2 WHERE id = $1', [t.id, office_id]);
        diff.office_id = { from: t.office_id, to: office_id };
      }
    }
    if (has('sales_agent_id')) {
      const cur = (await client.query('SELECT id FROM sales_agents WHERE user_id = $1', [t.id])).rows[0] || null;
      const want = (b.sales_agent_id == null || b.sales_agent_id === '') ? null : b.sales_agent_id;
      if (String(want) !== String(cur ? cur.id : null)) {
        if (want != null) {
          const la = await linkableAgent(client, req, want, t.id);
          if (la.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: la.error }); }
        }
        if (cur) await client.query('UPDATE sales_agents SET user_id = NULL, updated_at = now() WHERE id = $1', [cur.id]);
        if (want != null) await client.query('UPDATE sales_agents SET user_id = $1, updated_at = now() WHERE id = $2', [t.id, want]);
        diff.sales_agent_id = { from: cur ? cur.id : null, to: want == null ? null : Number(want) };
      }
    }
    if (Object.keys(diff).length) {
      await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.update', targetType: 'user', targetId: t.id, diff });
    }
    await client.query('COMMIT');
    const row = await pool.query(`${USER_SELECT} AND u.id = $2`, [req.organizer_id, t.id]);
    res.json({ user: withStatus(row.rows[0]), changed: Object.keys(diff) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'update user');
  } finally { client.release(); }
});

// ── Aktif / pasif ──────────────────────────────────────────────────────────
async function setActive(req, res, active) {
  const reason = trimOrNull(req.body && req.body.reason);
  if (!active && !reason) return res.status(400).json({ error: 'A reason is required to deactivate a user (B12).' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await targetUser(client, req, req.params.id, true);
    if (!t) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    if (t.id === actorId(req)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You cannot change your own active status.', code: 'SELF_EDIT' }); }
    if (t.is_owner && !(req.access && req.access.owner)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only an Owner can change an Owner\'s status.', code: 'OWNER_REQUIRED' });
    }
    if (!perms.checkScope(req, userTarget(t))) { await client.query('ROLLBACK'); return res.status(409).json(perms.OUT_OF_SCOPE); }
    if (t.is_active === active) { await client.query('ROLLBACK'); return res.status(409).json({ error: `The user is already ${active ? 'active' : 'inactive'}.` }); }
    await client.query('UPDATE users SET is_active = $2 WHERE id = $1', [t.id, active]);   // B10 trigger: son Owner → P0001
    let revoked = 0;
    if (!active) {
      const rv = await client.query(
        'UPDATE user_invites SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [t.id]);
      revoked = rv.rowCount;
    }
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: active ? 'user.activate' : 'user.deactivate',
      targetType: 'user', targetId: t.id, reason, diff: { is_active: { from: !active, to: active }, invites_revoked: revoked } });
    await client.query('COMMIT');
    const row = await pool.query(`${USER_SELECT} AND u.id = $2`, [req.organizer_id, t.id]);
    res.json({ user: withStatus(row.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, active ? 'activate user' : 'deactivate user');
  } finally { client.release(); }
}
router.post('/:id/deactivate', canWrite, (req, res) => setActive(req, res, false));
router.post('/:id/activate', canWrite, (req, res) => setActive(req, res, true));

// ── Şablon + kişi başı yetki (permissions.write) ───────────────────────────
async function matrixTarget(client, req, res) {
  const t = await targetUser(client, req, req.params.id, true);
  if (!t) { res.status(404).json({ error: 'User not found' }); return null; }
  if (t.id === actorId(req)) { res.status(409).json(SELF_EDIT); return null; }
  if (t.is_owner) { res.status(409).json(OWNER_FIXED); return null; }
  if (!perms.checkScope(req, userTarget(t))) { res.status(409).json(perms.OUT_OF_SCOPE); return null; }
  return t;
}

router.put('/:id/role', canMatrix, async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await matrixTarget(client, req, res);
    if (!t) { await client.query('ROLLBACK'); return; }
    let role = null;
    if (b.role_id != null && b.role_id !== '') {
      const ar = await assignableRole(client, req, b.role_id);
      if (ar.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: ar.error }); }
      if (!(await roleGrantable(client, req, ar.role.id))) { await client.query('ROLLBACK'); return res.status(409).json(BEYOND_OWN); }
      role = ar.role;
    }
    const prev = t.role_id == null ? null : (await client.query('SELECT name FROM roles WHERE id = $1', [t.role_id])).rows[0].name;
    if ((role ? role.id : null) === t.role_id) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'The user already has this role.' }); }
    await client.query('UPDATE users SET role_id = $2 WHERE id = $1', [t.id, role ? role.id : null]);
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.role_change', targetType: 'user',
      targetId: t.id, reason: trimOrNull(b.reason), diff: { role: { from: prev, to: role ? role.name : null } } });
    await client.query('COMMIT');
    const row = await pool.query(`${USER_SELECT} AND u.id = $2`, [req.organizer_id, t.id]);
    res.json({ user: withStatus(row.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'change role');
  } finally { client.release(); }
});

router.put('/:id/permissions/:code', canMatrix, async (req, res) => {
  const b = req.body || {};
  const effect = b.effect;
  if (effect !== 'grant' && effect !== 'revoke') return res.status(400).json({ error: 'effect must be grant or revoke.' });
  const scope = effect === 'grant' ? b.scope : null;
  if (effect === 'grant' && !perms.SCOPES.includes(scope)) return res.status(400).json({ error: `scope must be one of: ${perms.SCOPES.join(', ')}` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reg = await client.query('SELECT code FROM permissions WHERE code = $1', [req.params.code]);
    if (!reg.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unknown permission.' }); }
    const t = await matrixTarget(client, req, res);
    if (!t) { await client.query('ROLLBACK'); return; }
    if (effect === 'grant' && !canGrant(req, req.params.code, scope)) { await client.query('ROLLBACK'); return res.status(409).json(BEYOND_OWN); }
    const prev = (await client.query('SELECT effect, scope FROM user_permissions WHERE user_id = $1 AND permission_code = $2', [t.id, req.params.code])).rows[0] || null;
    const reason = trimOrNull(b.reason);
    await client.query(
      `INSERT INTO user_permissions (organizer_id, user_id, permission_code, effect, scope, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, permission_code) DO UPDATE
         SET effect = EXCLUDED.effect, scope = EXCLUDED.scope, reason = EXCLUDED.reason,
             created_by = EXCLUDED.created_by, created_at = now()`,
      [req.organizer_id, t.id, req.params.code, effect, scope, reason, actorId(req)]);
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.permission_set', targetType: 'user',
      targetId: t.id, reason, diff: { code: req.params.code, from: prev, to: { effect, scope } } });
    await client.query('COMMIT');
    const effective = await perms.permissionSummary(pool, { id: t.id, organizer_id: req.organizer_id, is_owner: false, role_id: t.role_id });
    res.json({ code: req.params.code, override: { effect, scope }, effective });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'set permission');
  } finally { client.release(); }
});

router.delete('/:id/permissions/:code', canMatrix, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await matrixTarget(client, req, res);
    if (!t) { await client.query('ROLLBACK'); return; }
    const d = await client.query(
      'DELETE FROM user_permissions WHERE user_id = $1 AND permission_code = $2 RETURNING effect, scope', [t.id, req.params.code]);
    if (!d.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No per-user override for this permission.' }); }
    await writeAudit(client, { organizerId: req.organizer_id, actor: actorId(req), action: 'user.permission_clear', targetType: 'user',
      targetId: t.id, reason: trimOrNull(req.body && req.body.reason), diff: { code: req.params.code, from: d.rows[0], to: null } });
    await client.query('COMMIT');
    const effective = await perms.permissionSummary(pool, { id: t.id, organizer_id: req.organizer_id, is_owner: false, role_id: t.role_id });
    res.json({ code: req.params.code, override: null, effective });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, err, 'clear permission');
  } finally { client.release(); }
});

module.exports = router;
