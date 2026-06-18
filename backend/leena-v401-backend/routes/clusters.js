/**
 * Expo Clusters Routes — Leena EMS / Expo Operations (Dilim 4)
 *
 * CRUD for expo_clusters (equal-expo model, not parent/child). Clusters are a
 * single-tenant reference (no organizer_id column); the bind/unbind action and the
 * sibling listing stay organizer-scoped through the expos table.
 *
 * Bind/unbind itself lives on the expos router (PUT /api/expos/:id/cluster) since it
 * mutates an organizer-owned expo row.
 */
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/clusters — all clusters + this organizer's expo count per cluster
router.get('/', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM expos e WHERE e.cluster_id = c.id AND e.organizer_id = $1) AS expo_count
       FROM expo_clusters c
       ORDER BY c.start_date DESC NULLS LAST, c.name`,
      [req.organizer_id]
    );
    res.json({ clusters: r.rows });
  } catch (err) {
    console.error('[clusters] list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/clusters — create
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  try {
    const r = await pool.query(
      `INSERT INTO expo_clusters (name, city, country, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.name, b.city || null, b.country || null, b.start_date || null, b.end_date || null]
    );
    res.status(201).json({ cluster: r.rows[0] });
  } catch (err) {
    console.error('[clusters] create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/clusters/:id — update
router.put('/:id', authMiddleware, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await pool.query(
      `UPDATE expo_clusters SET
         name = COALESCE(NULLIF($1, ''), name),
         city = $2, country = $3, start_date = $4, end_date = $5
       WHERE id = $6 RETURNING *`,
      [b.name || '', b.city ?? null, b.country ?? null, b.start_date || null, b.end_date || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Cluster not found' });
    res.json({ cluster: r.rows[0] });
  } catch (err) {
    console.error('[clusters] update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/clusters/:id — unbind this organizer's expos, then delete (transaction)
router.delete('/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE expos SET cluster_id = NULL WHERE cluster_id = $1 AND organizer_id = $2',
      [req.params.id, req.organizer_id]);
    const r = await client.query('DELETE FROM expo_clusters WHERE id = $1 RETURNING id', [req.params.id]);
    await client.query('COMMIT');
    if (r.rows.length === 0) return res.status(404).json({ error: 'Cluster not found' });
    res.json({ message: 'Cluster deleted' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23503') return res.status(409).json({ error: 'Cluster still has linked expos' });
    console.error('[clusters] delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/clusters/:id/expos — sibling expos in this cluster (organizer-scoped)
router.get('/:id/expos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, start_date, end_date, status, country_code
       FROM expos WHERE cluster_id = $1 AND organizer_id = $2
       ORDER BY start_date NULLS LAST, name`,
      [req.params.id, req.organizer_id]
    );
    res.json({ expos: r.rows });
  } catch (err) {
    console.error('[clusters] siblings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
