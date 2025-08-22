// routes/visitors.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');
const { v4: uuidv4 } = require('uuid');

console.log('Loading visitors routes...');

// GET all visitors for an expo
router.get('/', authenticateToken, async (req, res) => {
    console.log('GET /api/visitors called');
    const { expo_id } = req.query;
    
    try {
        if (!expo_id) {
            return res.status(400).json({ error: 'expo_id is required' });
        }

        // Verify the expo belongs to this organizer
        const expoCheck = await pool.query(
            'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
            [expo_id, req.organizer_id]
        );

        if (expoCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied to this expo' });
        }

        // Get visitors for this expo
        const result = await pool.query(
            `SELECT id, expo_id, organizer_id, badge_id, source, origin, 
                    custom_fields, qr_code, created_at, updated_at
             FROM visitors
             WHERE expo_id = $1 AND organizer_id = $2
             ORDER BY created_at DESC`,
            [expo_id, req.organizer_id]
        );

        res.json({
            success: true,
            count: result.rows.length,
            visitors: result.rows
        });
    } catch (err) {
        console.error('Error fetching visitors:', err);
        res.status(500).json({ error: 'Failed to fetch visitors' });
    }
});

// POST - Create a new visitor
router.post('/', authenticateToken, async (req, res) => {
    console.log('POST /api/visitors called');
    const { expo_id, custom_fields, source, origin } = req.body;
    
    try {
        if (!expo_id || !custom_fields) {
            return res.status(400).json({ error: 'expo_id and custom_fields are required' });
        }

        // Generate unique badge_id and qr_code
        const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const qr_code = uuidv4();

        const result = await pool.query(
            `INSERT INTO visitors (expo_id, organizer_id, badge_id, source, origin, custom_fields, qr_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [expo_id, req.organizer_id, badge_id, source || 'manual', origin || 'backend', custom_fields, qr_code]
        );

        res.status(201).json({
            success: true,
            visitor: result.rows[0]
        });
    } catch (err) {
        console.error('Error creating visitor:', err);
        res.status(500).json({ error: 'Failed to create visitor' });
    }
});

// GET single visitor by ID
router.get('/:id', authenticateToken, async (req, res) => {
    console.log(`GET /api/visitors/${req.params.id} called`);
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM visitors
             WHERE id = $1 AND organizer_id = $2`,
            [id, req.organizer_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        res.json({
            success: true,
            visitor: result.rows[0]
        });
    } catch (err) {
        console.error('Error fetching visitor:', err);
        res.status(500).json({ error: 'Failed to fetch visitor' });
    }
});

// PUT - Update visitor
router.put('/:id', authenticateToken, async (req, res) => {
    console.log(`PUT /api/visitors/${req.params.id} called`);
    const { id } = req.params;
    const { custom_fields, source, origin } = req.body;
    
    try {
        // Verify ownership
        const ownerCheck = await pool.query(
            `SELECT id FROM visitors
             WHERE id = $1 AND organizer_id = $2`,
            [id, req.organizer_id]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            `UPDATE visitors 
             SET custom_fields = $1, source = $2, origin = $3, updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [custom_fields, source, origin, id]
        );

        res.json({
            success: true,
            visitor: result.rows[0]
        });
    } catch (err) {
        console.error('Error updating visitor:', err);
        res.status(500).json({ error: 'Failed to update visitor' });
    }
});

// DELETE visitor
router.delete('/:id', authenticateToken, async (req, res) => {
    console.log(`DELETE /api/visitors/${req.params.id} called`);
    const { id } = req.params;
    
    try {
        // Verify ownership
        const ownerCheck = await pool.query(
            `SELECT id FROM visitors
             WHERE id = $1 AND organizer_id = $2`,
            [id, req.organizer_id]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await pool.query('DELETE FROM visitors WHERE id = $1', [id]);

        res.json({
            success: true,
            message: 'Visitor deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting visitor:', err);
        res.status(500).json({ error: 'Failed to delete visitor' });
    }
});

module.exports = router;
