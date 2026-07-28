// ----------------------------------------------------------------------------
// routes/offices.js — LEENA-master ofis referansı (PS1). Mount: /api/offices
//   GET /api/offices → aktif ofisler (dropdown beslemesi; S-16r: liste tablodan gelir).
// Ofis YÖNETİMİ (POST/PUT/DELETE) PS2 — bu dilimde YAZMA endpoint'i YOK.
// ----------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/offices — aktif ofisler, ada göre.
router.get('/', authMiddleware, async (req, res) => {
  // TODO Faz 4: role gate (B21-B42)
  try {
    const result = await pool.query(
      'SELECT id, name, country_code FROM offices WHERE is_active = true ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching offices:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
