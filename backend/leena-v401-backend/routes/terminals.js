// routes/terminals.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
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

// GET /api/terminals/all - Get all terminals for organizer with expo names
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const organizer_id = req.organizer_id;

    const result = await pool.query(
      `SELECT t.*, e.name as expo_name
       FROM terminals t
       LEFT JOIN expos e ON e.id = t.expo_id
       WHERE t.organizer_id = $1
       ORDER BY t.id DESC`,
      [organizer_id]
    );

    res.json({ success: true, terminals: result.rows });
  } catch (err) {
    console.error('Error fetching all terminals:', err);
    res.status(500).json({ success: false, message: 'Failed to load terminals' });
  }
});

// POST /api/terminals/clone/:id - Clone terminal to a different expo
router.post('/clone/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const organizer_id = req.organizer_id;
    const { expo_id } = req.body;

    const sourceResult = await pool.query(
      `SELECT * FROM terminals WHERE id = $1 AND organizer_id = $2`,
      [id, organizer_id]
    );

    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    const source = sourceResult.rows[0];
    const terminalKey = uuidv4();

    const result = await pool.query(
      `INSERT INTO terminals (
        organizer_id, expo_id, hall, terminal_no, auto_checkin, is_active, terminal_key, badge_template_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        organizer_id,
        expo_id || source.expo_id,
        source.hall,
        source.terminal_no,
        source.auto_checkin ?? true,
        false,
        terminalKey,
        source.badge_template_id || null
      ]
    );

    res.status(201).json({ success: true, message: 'Terminal cloned successfully', terminal: result.rows[0] });
  } catch (err) {
    console.error('Error cloning terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to clone terminal' });
  }
});

// ✅ POST /api/terminals
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { hall, terminal_no, auto_checkin, is_active, badge_template_id } = req.body;
    const expo_id = req.body.expo_id;
    const organizer_id = req.organizer_id;

    if (!expo_id || !hall || !terminal_no) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const terminalKey = uuidv4();

    const result = await pool.query(
      `INSERT INTO terminals (
        organizer_id, expo_id, hall, terminal_no, auto_checkin, is_active, terminal_key, badge_template_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        organizer_id, 
        expo_id, 
        hall, 
        terminal_no, 
        auto_checkin ?? true, 
        is_active ?? true,
        terminalKey,
        badge_template_id || null
      ]
    );

    res.status(201).json({ success: true, terminal: result.rows[0] });
  } catch (err) {
    console.error('❌ Error creating terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to create terminal' });
  }
});

// ✅ PUT /api/terminals/:id - Update terminal
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const terminalId = req.params.id;
    const organizer_id = req.organizer_id;
    const { hall, terminal_no, auto_checkin, is_active, badge_template_id } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (hall !== undefined) {
      updates.push(`hall = $${paramIndex++}`);
      values.push(hall);
    }
    if (terminal_no !== undefined) {
      updates.push(`terminal_no = $${paramIndex++}`);
      values.push(terminal_no);
    }
    if (auto_checkin !== undefined) {
      updates.push(`auto_checkin = $${paramIndex++}`);
      values.push(auto_checkin);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    if (badge_template_id !== undefined) {
      updates.push(`badge_template_id = $${paramIndex++}`);
      values.push(badge_template_id || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(terminalId, organizer_id);

    const result = await pool.query(
      `UPDATE terminals SET ${updates.join(', ')} 
       WHERE id = $${paramIndex++} AND organizer_id = $${paramIndex} 
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    res.json({ success: true, terminal: result.rows[0] });
  } catch (err) {
    console.error('❌ Error updating terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to update terminal' });
  }
});

// ✅ PATCH /api/terminals/:id/toggle - Toggle terminal active status
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const terminalId = req.params.id;
    const organizer_id = req.organizer_id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_active must be a boolean' });
    }

    const result = await pool.query(
      `UPDATE terminals SET is_active = $1 WHERE id = $2 AND organizer_id = $3 RETURNING *`,
      [is_active, terminalId, organizer_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    res.json({ success: true, terminal: result.rows[0] });
  } catch (err) {
    console.error('❌ Error toggling terminal:', err);
    res.status(500).json({ success: false, message: 'Failed to update terminal' });
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
