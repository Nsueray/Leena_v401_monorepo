// ----------------------------------------------------------------------------
// utils/permissions.js — YETKİ ÇÖZÜMLEMESİ, TEK YER (Paket 2 P2-2 / P2-3).
//   effectivePermissions(db, user) → etkin yetki = şablon (role_permissions) + kişi ezmesi
//                                    (user_permissions: grant kapsamıyla ekler/değiştirir,
//                                    revoke kaldırır). Owner (users.is_owner) kısa devre.
//   resolveScope(user, scope)      → own | team | office | all → somut süzgeç
//   scopeAllows(resolved, target)  → hedef kayıt ({ office_id, created_by }) süzgece giriyor mu
//   requirePermission(code)        → Express middleware (authMiddleware'den SONRA)
//   regionFilter(user, resolved)   → SAT-04 yuvası (bölge yasağı tablosu Paket 3'te) — bugün boş
//
// ── HÜKÜMLER ──
// - B9: rol ADI hiçbir yerde kontrol edilmez; yalnız satırlar okunur. Route'lar kod sorar.
// - B21 sırası: eylem sınıfı (kod) → [kendi matrisini düzenleme: routes/users.js] → Owner kısa
//   devresi → matris → kapsam (hedef kayıt bilinince handler'da: checkScope) → sebep → denetim.
// - B25: Owner kısa devresi YALNIZ yetkiyi atlar; iş doğrulaması (para birimi, kilit, tekil
//   kurallar) Owner için de koşar — handler'lar değişmez.
// - Ret 409 + kod (PERMISSION_REQUIRED / OUT_OF_SCOPE / NOT_USER_SESSION) — 403 DEĞİL: leena-fetch
//   401/403'te oturumu siler (G45, LED-15 emsali).
// - Eski token (user_id YOK) kapılı uçta 409 NOT_USER_SESSION köprüsü; kapısız uçlar değişmez.
// - Deploy → migration arası (043–045 yoksa) kapı ESKİ davranışa düşer (next) — 42703 kuralı.
// - team: users.reports_to bu pakette YOK → takım = kişinin kendisi (hiyerarşi gelince genişler).
// ----------------------------------------------------------------------------
const pool = require('./db');

const SCOPES = ['own', 'team', 'office', 'all'];

// 043–045 uygulandı mı? Yalnız OLUMLU sonuç önbelleğe alınır (utils/ledger.js deseni).
let readyCache = false;
async function permissionsReady(db) {
  if (readyCache) return true;
  const r = await db.query(
    `SELECT to_regclass('public.user_permissions') IS NOT NULL
        AND to_regclass('public.user_invites') IS NOT NULL
        AND to_regclass('public.audit_log') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role_id') AS ok`);
  readyCache = r.rows[0].ok === true;
  return readyCache;
}

async function loadUser(db, organizerId, userId) {
  const r = await db.query(
    `SELECT id::text, organizer_id, email, is_owner, is_active, office_id, role_id
       FROM users WHERE id = $1 AND organizer_id = $2`, [userId, organizerId]);
  return r.rows[0] || null;
}

// Döner: { owner: bool, perms: { code: { scope, source: 'role' | 'user' } } }
async function effectivePermissions(db, user) {
  if (user.is_owner) return { owner: true, perms: {} };
  const perms = {};
  if (user.role_id != null) {
    const rp = await db.query(
      'SELECT permission_code, scope FROM role_permissions WHERE role_id = $1 AND organizer_id = $2',
      [user.role_id, user.organizer_id]);
    for (const r of rp.rows) perms[r.permission_code] = { scope: r.scope, source: 'role' };
  }
  const up = await db.query(
    'SELECT permission_code, effect, scope FROM user_permissions WHERE user_id = $1 AND organizer_id = $2',
    [user.id, user.organizer_id]);
  for (const o of up.rows) {
    if (o.effect === 'revoke') delete perms[o.permission_code];
    else perms[o.permission_code] = { scope: o.scope, source: 'user' };
  }
  return { owner: false, perms };
}

// SAT-04 yuvası: ofis/takım kapsamı çözülürken çağrılır. Bölge yasağı tablosu (ofis/kullanıcı →
// satabileceği ülkeler) Paket 3'te gelir; bugün süzgeci DEĞİŞTİRMEDEN döner.
function regionFilter(user, resolved) {
  return resolved;
}

function resolveScope(user, scope) {
  switch (scope) {
    case 'all': return { kind: 'all' };
    case 'office':
      return regionFilter(user, { kind: 'office', officeIds: user.office_id != null ? [Number(user.office_id)] : [] });
    case 'team':
      return regionFilter(user, { kind: 'team', userIds: [String(user.id)] });
    case 'own': return { kind: 'own', userIds: [String(user.id)] };
    default: return { kind: 'none' };
  }
}

// target: { office_id, created_by } — ofis boyutu olmayan kayıt (bütçe, referans) office_id: null
// verir → yalnız 'all' geçer.
function scopeAllows(resolved, target) {
  if (!resolved || !target) return false;
  if (resolved.kind === 'all') return true;
  if (resolved.kind === 'office') return target.office_id != null && resolved.officeIds.includes(Number(target.office_id));
  if (resolved.kind === 'own' || resolved.kind === 'team') {
    return target.created_by != null && resolved.userIds.includes(String(target.created_by));
  }
  return false;
}

const NOT_USER_SESSION = { error: 'Sign in with your user account (ELIZA sign-in at /ui2/login.html) to do this.', code: 'NOT_USER_SESSION' };

function requirePermission(code) {
  return async function permissionGate(req, res, next) {
    try {
      if (!(await permissionsReady(pool))) return next();
      if (!req.user_id) return res.status(409).json(NOT_USER_SESSION);
      const user = await loadUser(pool, req.organizer_id, req.user_id);
      if (!user || !user.is_active) return res.sendStatus(401);
      const eff = await effectivePermissions(pool, user);
      if (eff.owner) {
        req.access = { code, owner: true, user, eff, scope: 'all', resolved: { kind: 'all' } };
        return next();
      }
      const p = eff.perms[code];
      if (!p) {
        return res.status(409).json({ error: `You do not have permission for this action (${code}).`, code: 'PERMISSION_REQUIRED', permission: code });
      }
      req.access = { code, owner: false, user, eff, scope: p.scope, resolved: resolveScope(user, p.scope) };
      return next();
    } catch (err) { return next(err); }
  };
}

// Handler'da hedef kayıt bilinince: tüm hedefler kapsamda mı? Kapı eski davranıştaysa
// (migration öncesi, req.access yok) → true (eski davranış birebir).
function checkScope(req, ...targets) {
  if (!req.access) return true;
  return targets.every(t => scopeAllows(req.access.resolved, t));
}
const OUT_OF_SCOPE = { error: 'This record is outside your permission scope.', code: 'OUT_OF_SCOPE' };

// Aynı istekte ikinci bir kod (ör. davette rol seçimi): kapıdan geçmiş kullanıcının etkin yetkisinden.
function hasPermission(req, code) {
  if (!req.access) return true;
  return req.access.owner || !!req.access.eff.perms[code];
}

// /me ve ekranlar için düz özet.
async function permissionSummary(db, user) {
  const eff = await effectivePermissions(db, user);
  const reg = await db.query('SELECT code, area FROM permissions');
  const areaOf = Object.fromEntries(reg.rows.map(r => [r.code, r.area]));
  const codes = {};
  if (eff.owner) for (const r of reg.rows) codes[r.code] = 'all';
  else for (const [c, p] of Object.entries(eff.perms)) codes[c] = p.scope;
  const areas = [...new Set(Object.keys(codes).map(c => areaOf[c]).filter(Boolean))].sort();
  return { owner: eff.owner, codes, areas };
}

module.exports = {
  SCOPES, permissionsReady, loadUser, effectivePermissions, regionFilter, resolveScope, scopeAllows,
  requirePermission, checkScope, hasPermission, permissionSummary, OUT_OF_SCOPE, NOT_USER_SESSION,
};
