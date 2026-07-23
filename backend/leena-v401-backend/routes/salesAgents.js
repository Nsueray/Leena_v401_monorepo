// ============================================================================
// routes/salesAgents.js — sales agent listesi (komisyon atama dropdown'ı için)
// ----------------------------------------------------------------------------
// Minimal read-only liste. Agent oluşturma/güncelleme bu dilimde YOK —
// sales_agents kayıtları seed ile (psql) girilir. Ölçek 25 kullanıcı:
// filtre/sayfalama gereksiz.
// ============================================================================
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/sales-agents — organizer scope'lu liste, name ASC.
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, agent_type, default_commission_pct
         FROM sales_agents
        WHERE organizer_id = $1
        ORDER BY name ASC`,
      [req.organizer_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales agents:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
