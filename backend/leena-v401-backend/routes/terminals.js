// routes/terminals.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// ✅ GET /api/terminals?expo_id=...
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { expo_id } = req.query;
    const organizer_id = req.organizer_id;

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    const result = await pool.query(
      `SELECT * FROM terminals WHERE organizer_id = $1 AND expo_id = $2 ORDER BY id DESC`,
      [organizer_id, expo_id]
    );

    res.json({ success: true, terminals: result.rows });
  } catch (err) {
    console.error('❌ Error fetching terminals:', err);
    res.status(500).json({ success: false, message: 'Failed to load terminals' });
  }
});

// ✅ POST /api/terminals
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { hall, terminal_no, auto_checkin } = req.body;
    const expo_id = req.body.expo_id;
    const organizer_id = req.organizer_id;

    if (!expo_id || !hall || !terminal_no) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO terminals (
        organizer_id, expo_id, hall, terminal_no, auto_checkin
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [organizer_id, expo_id, hall, terminal_no, auto_checkin ?? true]
    );

    res.status(201).json({ success: true, terminal: result.rows[0] });
  } catch (err) {
    console.error('❌ Error creating terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to create terminal' });
  }
});

// ✅ DELETE /api/terminals/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const terminalId = req.params.id;
    const organizer_id = req.organizer_id;

    const result = await pool.query(
      `DELETE FROM terminals WHERE id = $1 AND organizer_id = $2 RETURNING *`,
      [terminalId, organizer_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    res.json({ success: true, message: 'Terminal deleted' });
  } catch (err) {
    console.error('❌ Error deleting terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to delete terminal' });
  }
});

module.exports = router;
