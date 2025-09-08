// routes/organizers.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

// Get all organizers (for admin purposes, protected)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, logo_url, created_at FROM organizers ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching organizers:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a single organizer by ID (protected)
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT id, name, email, logo_url, created_at FROM organizers WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching organizer:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
