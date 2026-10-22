// routes/userAuth.js — Faz 4 dilim 2: users tablosu üzerinden giriş.
// Mount: /api/user-auth (index.js). Eski /api/auth/login + /register DOKUNULMADI —
// ikisi yan yana çalışır.
//
// ── HÜKÜMLER (Sentez K-A, 2026-10-08) ──
// - Token = mevcut JWT + user_id (SEM-05): AYNI secret (JWT_SECRET), AYNI süre (30d,
//   routes/auth.js:54), AYNI middleware (authMiddleware req.organizer_id okur).
//   Payload: organizer_id (users.organizer_id) + email + user_id (users.id) + name.
//   → Mevcut korumalı route'lar yeni token'la değişmeden çalışır.
// - `name` (Sentez K-F, 19 Eki): users.display_name doluysa o, boşsa e-posta.
//   Kolon 035 ile gelir; okuma `to_jsonb(u)->>'display_name'` → 035 UYGULANMADAN da
//   sorgu çalışır (NULL döner, e-postaya düşülür). Deploy migration'dan önce yapılabilir.
// - Giriş hataları TEK TİP: kullanıcı yok / pasif / password_hash NULL / yanlış
//   şifre → hepsi aynı 401 + aynı mesaj (hangi e-postanın var olduğu sızmaz).
//   Kullanıcı yokken de bcrypt.compare koşulur (zamanlama farkı kapanır).
// - /me ve /change-password yalnız USER oturumu kabul eder (token'da user_id).
//   Eski organizer token'ı → 409 NOT_USER_SESSION. 401/403 DEĞİL: leena-fetch
//   401/403'te oturumu siler (leena-fetch.js:63-71); eski oturum korunur.
// - Şifre uzunluk kuralı: register ile AYNI (routes/auth.js:88, en az 6).
// - bcrypt maliyeti register ile AYNI (routes/auth.js:98, 10).
// - Paket 2: /me etkin yetki özetini de döner (043–045 uygulandıysa; değilse eski şekil) —
//   ui2 menüsü (ui2CanSee) bunu okur; güvenlik sınırı sunucudadır (requirePermission).
// - Paket 2 davet kabulü (kimlik doğrulamasız, token POST gövdesinde — URL'de değil):
//   POST /invite/check · POST /invite/accept. Geçersiz / kullanılmış / iptal / süresi geçmiş /
//   pasif kullanıcı / şifresi zaten olan → hepsi AYNI 400 + aynı mesaj (hangisi olduğu sızmaz).
//   Kabul: şifre yazılır, password_must_change=false, davet used_at (tek kullanım, FOR UPDATE).
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
const perms = require('../utils/permissions');
const inv = require('../utils/invites');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

const BCRYPT_COST = 10;          // routes/auth.js:98
const TOKEN_EXPIRES_IN = '30d';  // routes/auth.js:54
const MIN_PASSWORD_LENGTH = 6;   // routes/auth.js:88
const LOGIN_FAILED = { error: 'Invalid email or password' };

// Görünen ad (K-F): ad doluysa ad, değilse e-posta. Tek nokta — token ve /me aynı kuralı kullanır.
function displayNameOf(u) {
  return (u.display_name && u.display_name.trim()) ? u.display_name.trim() : u.email;
}

// Kullanıcı yokken karşılaştırılacak sabit hash — zamanlama eşitliği için.
const DUMMY_HASH = bcrypt.hashSync('no-such-user-' + Date.now(), BCRYPT_COST);

// USER oturumu middleware'i — authMiddleware'e DOKUNMADAN, decode edilmiş
// token'ı req.userSession'a koyar. authMiddleware ile aynı 401/403 sözleşmesi.
function requireUserSession(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403);
    if (!decoded || !decoded.user_id) {
      return res.status(409).json({ error: 'Not a user session', code: 'NOT_USER_SESSION' });
    }
    req.userSession = decoded;
    req.organizer_id = decoded.organizer_id;
    next();
  });
}

// POST /api/user-auth/login
router.post('/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET not defined in environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const result = await pool.query(
      `SELECT id, organizer_id, email, password_hash, is_owner, display_role,
              password_must_change, is_active, to_jsonb(u) ->> 'display_name' AS display_name
         FROM users u WHERE email = $1`,
      [email]
    );
    const u = result.rows[0];
    const usable = u && u.is_active && u.password_hash;
    // Her yolda TEK bcrypt.compare — kullanıcı yok/pasif/NULL'da dummy hash'e karşı.
    const match = await bcrypt.compare(password, usable ? u.password_hash : DUMMY_HASH);
    if (!usable || !match) return res.status(401).json(LOGIN_FAILED);

    const token = jwt.sign(
      { organizer_id: u.organizer_id, email: u.email, user_id: u.id, name: displayNameOf(u) },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );
    return res.json({
      token,
      name: displayNameOf(u),
      display_role: u.display_role,
      is_owner: u.is_owner,
      password_must_change: u.password_must_change,
    });
  } catch (err) {
    console.error('User login failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/user-auth/me — yalnız oturumdaki kullanıcı.
router.get('/me', requireUserSession, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, display_role, is_owner, password_must_change, is_active,
              to_jsonb(u) ->> 'display_name' AS display_name
         FROM users u WHERE id = $1`,
      [req.userSession.user_id]
    );
    const u = result.rows[0];
    if (!u || !u.is_active) return res.sendStatus(401);
    const out = {
      user_id: u.id,
      name: displayNameOf(u),
      display_name: u.display_name,
      email: u.email,
      display_role: u.display_role,
      is_owner: u.is_owner,
      password_must_change: u.password_must_change,
      session: 'user',
    };
    if (await perms.permissionsReady(pool)) {
      const x = (await pool.query(
        `SELECT u.organizer_id, u.office_id, o.name AS office_name, u.role_id, r.name AS role_name
           FROM users u LEFT JOIN offices o ON o.id = u.office_id LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.id = $1`, [u.id])).rows[0];
      out.office = x.office_id == null ? null : { id: x.office_id, name: x.office_name };
      out.role = x.role_id == null ? null : { id: x.role_id, name: x.role_name };
      out.permissions = await perms.permissionSummary(pool, { id: u.id, organizer_id: x.organizer_id, is_owner: u.is_owner, role_id: x.role_id });
    }
    return res.json(out);
  } catch (err) {
    console.error('User me failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/user-auth/change-password — mevcut + yeni şifre.
router.post('/change-password', requireUserSession, async (req, res) => {
  const current = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const next = typeof req.body.new_password === 'string' ? req.body.new_password : '';
  if (!current || !next) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash, is_active FROM users WHERE id = $1',
      [req.userSession.user_id]
    );
    const u = result.rows[0];
    if (!u || !u.is_active) return res.sendStatus(401);
    const match = u.password_hash ? await bcrypt.compare(current, u.password_hash) : false;
    if (!match) {
      return res.status(400).json({ error: 'Current password is incorrect', code: 'INVALID_CURRENT_PASSWORD' });
    }

    const hash = await bcrypt.hash(next, BCRYPT_COST);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_must_change = false WHERE id = $2',
      [hash, u.id]
    );
    return res.json({ success: true, password_must_change: false });
  } catch (err) {
    console.error('Change password failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Davet kabulü (Paket 2 P2-1) ─────────────────────────────────────────────
// Tek sorgu: token özeti → açık + süresi geçmemiş davet + aktif + şifresiz kullanıcı.
const OPEN_INVITE_SQL = `
  SELECT i.id, i.organizer_id, i.user_id::text AS user_id, u.email, u.display_name
    FROM user_invites i JOIN users u ON u.id = i.user_id
   WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
     AND u.is_active AND u.password_hash IS NULL`;

async function invitesReady() {
  return perms.permissionsReady(pool);
}
function tokenOf(req) {
  const t = req.body && req.body.token;
  return typeof t === 'string' && t.length >= 20 && t.length <= 200 ? t : null;
}

router.post('/invite/check', async (req, res) => {
  try {
    if (!(await invitesReady())) return res.status(503).json({ error: 'Invitations are not available yet.' });
    const tok = tokenOf(req);
    if (!tok) return res.status(400).json(inv.INVALID_INVITE);
    const r = await pool.query(OPEN_INVITE_SQL, [inv.hashToken(tok)]);
    if (!r.rows.length) return res.status(400).json(inv.INVALID_INVITE);
    return res.json({ email: r.rows[0].email, display_name: r.rows[0].display_name, min_password_length: MIN_PASSWORD_LENGTH });
  } catch (err) {
    console.error('Invite check failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/invite/accept', async (req, res) => {
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const nameIn = typeof (req.body && req.body.display_name) === 'string' ? req.body.display_name.trim() : '';
  let client = null;
  try {
    if (!(await invitesReady())) return res.status(503).json({ error: 'Invitations are not available yet.' });
    const tok = tokenOf(req);
    if (!tok) return res.status(400).json(inv.INVALID_INVITE);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    client = await pool.connect();
    await client.query('BEGIN');
    const r = await client.query(`${OPEN_INVITE_SQL} FOR UPDATE OF i`, [inv.hashToken(tok)]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(400).json(inv.INVALID_INVITE); }
    const i = r.rows[0];
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const upd = await client.query(
      `UPDATE users SET password_hash = $2, password_must_change = false,
              display_name = COALESCE($3, display_name)
        WHERE id = $1 AND password_hash IS NULL AND is_active`,
      [i.user_id, hash, nameIn === '' ? null : nameIn]);
    if (upd.rowCount !== 1) { await client.query('ROLLBACK'); return res.status(400).json(inv.INVALID_INVITE); }
    await client.query('UPDATE user_invites SET used_at = now() WHERE id = $1', [i.id]);
    await writeAudit(client, { organizerId: i.organizer_id, actor: i.user_id, action: 'user.invite_accept',
      targetType: 'user', targetId: i.user_id, diff: { invite_id: i.id } });
    await client.query('COMMIT');
    return res.json({ success: true, email: i.email });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Invite accept failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
module.exports.requireUserSession = requireUserSession;
