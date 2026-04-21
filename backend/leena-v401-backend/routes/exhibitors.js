/**
 * Exhibitor Management Routes
 * Leena EMS — ELL Extension
 *
 * CRUD for expo_exhibitors table.
 * Linked to floor plan stands via expo_stands.exhibitor_id.
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/exhibitors?expo_id=X
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { expo_id } = req.query;
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id required' });

    const result = await pool.query(
      `SELECT * FROM expo_exhibitors WHERE expo_id = $1 AND organizer_id = $2 ORDER BY name ASC`,
      [expo_id, req.organizer_id]
    );
    res.json({ success: true, exhibitors: result.rows });
  } catch (err) {
    console.error('[exhibitors] List error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch exhibitors' });
  }
});

// POST /api/exhibitors
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { expo_id, name, contact_person, email, phone, country, sector, notes } = req.body;
    if (!expo_id || !name) return res.status(400).json({ success: false, message: 'expo_id and name required' });

    const result = await pool.query(
      `INSERT INTO expo_exhibitors (expo_id, organizer_id, name, contact_person, email, phone, country, sector, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [expo_id, req.organizer_id, name, contact_person || null, email || null, phone || null, country || null, sector || null, notes || null]
    );
    res.status(201).json({ success: true, exhibitor: result.rows[0] });
  } catch (err) {
    console.error('[exhibitors] Create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create exhibitor' });
  }
});

// PUT /api/exhibitors/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, contact_person, email, phone, country, sector, notes } = req.body;
    const result = await pool.query(
      `UPDATE expo_exhibitors SET
        name = COALESCE(NULLIF($1, ''), name), contact_person = $2, email = $3, phone = $4,
        country = $5, sector = $6, notes = $7, updated_at = NOW()
       WHERE id = $8 AND organizer_id = $9 RETURNING *`,
      [name, contact_person, email, phone, country, sector, notes, req.params.id, req.organizer_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Exhibitor not found' });
    res.json({ success: true, exhibitor: result.rows[0] });
  } catch (err) {
    console.error('[exhibitors] Update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update exhibitor' });
  }
});

// DELETE /api/exhibitors/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Clear exhibitor_id from linked stands
    await pool.query(
      'UPDATE expo_stands SET exhibitor_id = NULL WHERE exhibitor_id = $1', [req.params.id]
    );
    const result = await pool.query(
      'DELETE FROM expo_exhibitors WHERE id = $1 AND organizer_id = $2 RETURNING id',
      [req.params.id, req.organizer_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Exhibitor not found' });
    res.json({ success: true, message: 'Exhibitor deleted' });
  } catch (err) {
    console.error('[exhibitors] Delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete exhibitor' });
  }
});

module.exports = router;
