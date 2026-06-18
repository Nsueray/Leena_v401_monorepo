/**
 * Expo Partners Routes — Leena EMS / Expo Operations (Dilim 4)
 *
 * CRUD for expo_partners. Mirrors the exhibitors.js flat pattern (GET /?expo_id=X).
 * expo_partners has NO organizer_id column, so scope is enforced THROUGH the expo:
 * every query joins expos and checks expos.organizer_id = req.organizer_id.
 *
 * Operation team contacts (istanbul_hq / local_onsite) are just two of the 11 roles —
 * no separate field or screen, they are entered here like any other partner.
 */
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

const PARTNER_ROLES = [
  'stand_contractor', 'travel', 'visa', 'forwarder', 'hostess', 'catering',
  'security', 'venue_authority', 'istanbul_hq', 'local_onsite', 'other'
];

// req 727: only these venue-shared operational roles copy to cluster siblings.
// venue_authority is deliberately excluded (it's the venue owner, not a shared supplier);
// istanbul_hq / local_onsite are expo-specific contacts.
const COPYABLE_ROLES = ['stand_contractor', 'hostess', 'catering', 'security'];

function mapErr(err, res, op) {
  if (err.code === '23514') return res.status(400).json({ error: 'Invalid partner_role' });
  if (err.code === '23503') return res.status(400).json({ error: 'Invalid expo reference' });
  console.error('[partners] ' + op + ' error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

// GET /api/partners?expo_id=X — partners for one expo (scope: expo must belong to organizer)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { expo_id } = req.query;
    if (!expo_id) return res.status(400).json({ error: 'expo_id required' });
    const result = await pool.query(
      `SELECT p.* FROM expo_partners p
       JOIN expos e ON e.id = p.expo_id
       WHERE p.expo_id = $1 AND e.organizer_id = $2
       ORDER BY p.is_primary DESC, p.partner_role, p.company_name`,
      [expo_id, req.organizer_id]
    );
    res.json({ partners: result.rows });
  } catch (err) {
    console.error('[partners] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/partners — create (verify expo ownership first).
// Optional copy_to_siblings (req 727): when true AND the expo is in a cluster AND the role
// is one of the 4 venue-shared roles, copy the partner to each sibling expo that does NOT
// already have that role. Add + copies are one atomic transaction. Copies start is_primary=false.
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body || {};
  if (!b.expo_id || !b.partner_role) return res.status(400).json({ error: 'expo_id and partner_role required' });
  if (!PARTNER_ROLES.includes(b.partner_role)) return res.status(400).json({ error: 'Invalid partner_role' });

  const client = await pool.connect();
  try {
    const own = await client.query('SELECT id, cluster_id FROM expos WHERE id = $1 AND organizer_id = $2', [b.expo_id, req.organizer_id]);
    if (own.rows.length === 0) return res.status(404).json({ error: 'Expo not found' }); // finally releases
    const expo = own.rows[0];

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO expo_partners (expo_id, partner_role, company_name, contact_name, phone, email, notes, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.expo_id, b.partner_role, b.company_name || null, b.contact_name || null,
       b.phone || null, b.email || null, b.notes || null, b.is_primary === true]
    );
    const partner = r.rows[0];

    let copiedTo = 0;
    if (b.copy_to_siblings === true && expo.cluster_id && COPYABLE_ROLES.includes(b.partner_role)) {
      const sibs = await client.query(
        'SELECT id FROM expos WHERE cluster_id = $1 AND id <> $2 AND organizer_id = $3',
        [expo.cluster_id, b.expo_id, req.organizer_id]
      );
      for (const s of sibs.rows) {
        const exists = await client.query(
          'SELECT 1 FROM expo_partners WHERE expo_id = $1 AND partner_role = $2 LIMIT 1',
          [s.id, b.partner_role]
        );
        if (exists.rows.length === 0) {
          await client.query(
            `INSERT INTO expo_partners (expo_id, partner_role, company_name, contact_name, phone, email, notes, is_primary)
             VALUES ($1,$2,$3,$4,$5,$6,$7,false)`,
            [s.id, b.partner_role, b.company_name || null, b.contact_name || null, b.phone || null, b.email || null, b.notes || null]
          );
          copiedTo++;
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ partner, copied_to_siblings: copiedTo });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return mapErr(err, res, 'create');
  } finally {
    client.release();
  }
});

// PUT /api/partners/:id — update (scope via expo join)
router.put('/:id', authMiddleware, async (req, res) => {
  const b = req.body || {};
  if (b.partner_role && !PARTNER_ROLES.includes(b.partner_role)) return res.status(400).json({ error: 'Invalid partner_role' });
  try {
    const r = await pool.query(
      `UPDATE expo_partners p SET
         partner_role = COALESCE($1, p.partner_role),
         company_name = $2, contact_name = $3, phone = $4, email = $5, notes = $6,
         is_primary = COALESCE($7, p.is_primary)
       FROM expos e
       WHERE p.id = $8 AND p.expo_id = e.id AND e.organizer_id = $9
       RETURNING p.*`,
      [b.partner_role || null, b.company_name ?? null, b.contact_name ?? null, b.phone ?? null,
       b.email ?? null, b.notes ?? null, (typeof b.is_primary === 'boolean' ? b.is_primary : null),
       req.params.id, req.organizer_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
    res.json({ partner: r.rows[0] });
  } catch (err) { return mapErr(err, res, 'update'); }
});

// DELETE /api/partners/:id — delete (scope via expo join)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM expo_partners p USING expos e
       WHERE p.id = $1 AND p.expo_id = e.id AND e.organizer_id = $2
       RETURNING p.id`,
      [req.params.id, req.organizer_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
    res.json({ message: 'Partner deleted' });
  } catch (err) {
    console.error('[partners] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
