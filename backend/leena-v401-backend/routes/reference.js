// routes/reference.js
// Read-only reference data for dropdowns (closed sets). Global — no organizer scope.
// Always reads whatever rows exist in the table (no hardcoded counts/limits).
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * GET /api/reference/countries
 * ISO country reference for country dropdowns.
 */
router.get('/countries', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT code, name FROM core_countries ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching countries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reference/sectors
 * Sector reference for sector multi-select (used in detail/form, not the list).
 */
router.get('/sectors', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, slug, name FROM core_sectors ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sectors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
