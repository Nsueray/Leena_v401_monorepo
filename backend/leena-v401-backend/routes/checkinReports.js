// routes/checkinReports.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * GET /api/checkins/reports
 * Generate comprehensive check-in reports with various groupings
 */
router.get('/', authenticateToken, async (req, res) => {
  const { expo_id, startDate, endDate } = req.query;

  if (!expo_id) {
    return res.status(400).json({ error: 'expo_id is required' });
  }

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    // Build date filter clause
    let dateFilter = '';
    const queryParams = [expo_id];
    let paramIndex = 2;

    if (startDate) {
      dateFilter += ` AND c.checkin_time >= $${paramIndex}`;
      queryParams.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      dateFilter += ` AND c.checkin_time <= $${paramIndex}`;
      queryParams.push(endDate + ' 23:59:59');
      paramIndex++;
    }

    const validCheckinsQuery = `
      WITH ranked_checkins AS (
        SELECT 
          c.id,
          c.visitor_id,
          c.checkin_time,
          v.source,
          v.origin,
          v.custom_fields,
          v.country AS direct_country,
          LAG(c.checkin_time) OVER (
            PARTITION BY c.visitor_id 
            ORDER BY c.checkin_time
          ) AS prev_checkin_time
        FROM checkins c
        JOIN visitors v ON v.id = c.visitor_id
        WHERE c.expo_id = $1
          AND c.terminal = 'badge-print'
          ${dateFilter}
      ),
      valid_checkins AS (
        SELECT *
        FROM ranked_checkins
        WHERE prev_checkin_time IS NULL 
          OR EXTRACT(EPOCH FROM (checkin_time - prev_checkin_time)) >= 120
      )
      SELECT 
        id,
        visitor_id,
        checkin_time,
        source,
        origin,
        custom_fields,
        direct_country,
        COALESCE(custom_fields->>'country', direct_country) AS country,
        custom_fields->>'sector' AS sector,
        custom_fields->>'job_title' AS job_title
      FROM valid_checkins
    `;

    const validCheckinsResult = await pool.query(validCheckinsQuery, queryParams);
    const validCheckins = validCheckinsResult.rows;

    // Summary
    const uniqueVisitors = new Set(validCheckins.map(c => c.visitor_id));

    // Group by helpers
    const groupBy = (keyFn) => {
      const map = {};
      validCheckins.forEach(row => {
        const key = keyFn(row) || 'unknown';
        map[key] = (map[key] || 0) + 1;
      });
      return map;
    };

    const byDate = groupBy(row => new Date(row.checkin_time).toISOString().split('T')[0]);
    const bySource = groupBy(row => row.source);
    const byOrigin = groupBy(row => row.origin);
    const byCountry = groupBy(row => row.country);
    const bySector = groupBy(row => row.sector);
    const byJobTitle = groupBy(row => row.job_title);

    // Sorters
    const sortByValue = obj => Object.fromEntries(Object.entries(obj).sort(([, a], [, b]) => b - a));
    const sortByKey = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

    res.json({
      summary: {
        total_valid_checkins: validCheckins.length,
        unique_visitors: uniqueVisitors.size
      },
      by_date: sortByKey(byDate),
      by_source: sortByValue(bySource),
      by_origin: sortByValue(byOrigin),
      by_country: sortByValue(byCountry),
      by_sector: sortByValue(bySector),
      by_job_title: sortByValue(byJobTitle)
    });
  } catch (err) {
    console.error('Check-in reports error:', err);
    res.status(500).json({
      error: 'Failed to generate check-in reports',
      details: err.message
    });
  }
});

module.exports = router;
