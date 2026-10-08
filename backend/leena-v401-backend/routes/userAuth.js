// routes/userAuth.js — Faz 4 dilim 2: users tablosu üzerinden giriş.
// Mount: /api/user-auth (index.js). Eski /api/auth/login + /register DOKUNULMADI —
// ikisi yan yana çalışır.
//
// ── HÜKÜMLER (Sentez K-A, 2026-10-08) ──
// - Token = mevcut JWT + uid: AYNI secret (JWT_SECRET), AYNI süre (30d,
//   routes/auth.js:54), AYNI middleware (authMiddleware req.organizer_id okur).
//   Payload: organizer_id (users.organizer_id) + email + uid (users.id).
//   → Mevcut korumalı route'lar yeni token'la değişmeden çalışır.
// - Giriş hataları TEK TİP: kullanıcı yok / pasif / password_hash NULL / yanlış
//   şifre → hepsi aynı 401 + aynı mesaj (hangi e-postanın var olduğu sızmaz).
//   Kullanıcı yokken de bcrypt.compare koşulur (zamanlama farkı kapanır).
// - /me ve /change-password yalnız USER oturumu kabul eder (token'da uid).
//   Eski organizer token'ı → 409 NOT_USER_SESSION. 401/403 DEĞİL: leena-fetch
//   401/403'te oturumu siler (leena-fetch.js:63-71); eski oturum korunur.
// - Şifre uzunluk kuralı: register ile AYNI (routes/auth.js:88, en az 6).
// - bcrypt maliyeti register ile AYNI (routes/auth.js:98, 10).
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');

const router = express.Router();

const BCRYPT_COST = 10;          // routes/auth.js:98
const TOKEN_EXPIRES_IN = '30d';  // routes/auth.js:54
const MIN_PASSWORD_LENGTH = 6;   // routes/auth.js:88
const LOGIN_FAILED = { error: 'Invalid email or password' };

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
    if (!decoded || !decoded.uid) {
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
              password_must_change, is_active
         FROM users WHERE email = $1`,
      [email]
    );
    const u = result.rows[0];
    const usable = u && u.is_active && u.password_hash;
    // Her yolda TEK bcrypt.compare — kullanıcı yok/pasif/NULL'da dummy hash'e karşı.
    const match = await bcrypt.compare(password, usable ? u.password_hash : DUMMY_HASH);
    if (!usable || !match) return res.status(401).json(LOGIN_FAILED);

    const token = jwt.sign(
      { organizer_id: u.organizer_id, email: u.email, uid: u.id },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );
    return res.json({
      token,
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
      `SELECT id, email, display_role, is_owner, password_must_change, is_active
         FROM users WHERE id = $1`,
      [req.userSession.uid]
    );
    const u = result.rows[0];
    if (!u || !u.is_active) return res.sendStatus(401);
    return res.json({
      uid: u.id,
      email: u.email,
      display_role: u.display_role,
      is_owner: u.is_owner,
      password_must_change: u.password_must_change,
      session: 'user',
    });
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
      [req.userSession.uid]
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

module.exports = router;
module.exports.requireUserSession = requireUserSession;
