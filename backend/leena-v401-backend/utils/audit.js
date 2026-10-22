// ----------------------------------------------------------------------------
// utils/audit.js — denetim kaydı yazımı (Paket 2 P2-4, 045). Yalnız eklenir.
// Çağıran transaction içindeyse aynı client verilir: olay ile kaydı birlikte commit/rollback olur.
// 045 uygulanmadıysa (deploy → migration arası) sessizce atlanır — iş akışı eski haliyle sürer.
// ----------------------------------------------------------------------------
let readyCache = false;
async function auditReady(db) {
  if (readyCache) return true;
  const r = await db.query(`SELECT to_regclass('public.audit_log') IS NOT NULL AS ok`);
  readyCache = r.rows[0].ok === true;
  return readyCache;
}

async function writeAudit(db, { organizerId, actor = null, action, targetType, targetId, reason = null, diff = {} }) {
  if (!(await auditReady(db))) return null;
  const r = await db.query(
    `INSERT INTO audit_log (organizer_id, actor_user_id, action, target_type, target_id, reason, diff)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
    [organizerId, actor, action, targetType, String(targetId), reason, JSON.stringify(diff || {})]);
  return r.rows[0].id;
}

module.exports = { auditReady, writeAudit };
