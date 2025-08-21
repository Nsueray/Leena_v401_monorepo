// routes/visitors.js - TEMPLATE FOR ALL ROUTE FILES
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

// Debug log to confirm this file is loaded
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
            `SELECT v.*, 
                    f.name as form_name,
                    v.created_at,
                    v.updated_at
             FROM visitors v
             LEFT JOIN forms f ON v.form_id = f.id
             WHERE v.expo_id = $1
             ORDER BY v.created_at DESC`,
            [expo_id]
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
router.post('/', async (req, res) => {
    console.log('POST /api/visitors called');
    const { expo_id, form_id, form_data, email, name, phone } = req.body;
    
    try {
        if (!expo_id || !form_id) {
            return res.status(400).json({ error: 'expo_id and form_id are required' });
        }

        const result = await pool.query(
            `INSERT INTO visitors (expo_id, form_id, form_data, email, name, phone, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING *`,
            [expo_id, form_id, JSON.stringify(form_data || {}), email, name, phone]
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
            `SELECT v.*, e.organizer_id
             FROM visitors v
             JOIN expos e ON v.expo_id = e.id
             WHERE v.id = $1 AND e.organizer_id = $2`,
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
    const { form_data, email, name, phone } = req.body;
    
    try {
        // Verify ownership
        const ownerCheck = await pool.query(
            `SELECT v.id
             FROM visitors v
             JOIN expos e ON v.expo_id = e.id
             WHERE v.id = $1 AND e.organizer_id = $2`,
            [id, req.organizer_id]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            `UPDATE visitors 
             SET form_data = $1, email = $2, name = $3, phone = $4, updated_at = NOW()
             WHERE id = $5
             RETURNING *`,
            [JSON.stringify(form_data || {}), email, name, phone, id]
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
            `SELECT v.id
             FROM visitors v
             JOIN expos e ON v.expo_id = e.id
             WHERE v.id = $1 AND e.organizer_id = $2`,
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

// IMPORTANT: Export the router!
module.exports = router;
