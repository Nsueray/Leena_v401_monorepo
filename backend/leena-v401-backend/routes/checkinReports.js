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
    return res.status(400).json({ 
      error: 'expo_id is required' 
    });
  }

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ 
        error: 'Access denied to this expo' 
      });
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

    // Get valid checkins (badge-print terminal only, excluding duplicates within 2 minutes)
    const validCheckinsQuery = `
      WITH ranked_checkins AS (
        SELECT 
          c.*,
          v.source,
          v.origin,
          v.custom_fields,
          v.country as direct_country,
          LAG(c.checkin_time) OVER (
            PARTITION BY c.visitor_id 
            ORDER BY c.checkin_time
          ) as prev_checkin_time
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
        COALESCE(custom_fields->>'country', direct_country) as country,
        custom_fields->>'sector' as sector,
        custom_fields->>'job_title' as job_title
      FROM valid_checkins
    `;

    const validCheckinsResult = await pool.query(validCheckinsQuery, queryParams);
    const validCheckins = validCheckinsResult.rows;

    // Calculate summary
    const uniqueVisitors = new Set(validCheckins.map(c => c.visitor_id));
    
    // Group by date
    const byDate = {};
    validCheckins.forEach(checkin => {
      const date = new Date(checkin.checkin_time).toISOString().split('T')[0];
      byDate[date] = (byDate[date] || 0) + 1;
    });

    // Group by source
    const bySource = {};
    validCheckins.forEach(checkin => {
      const source = checkin.source || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;
    });

    // Group by origin
    const byOrigin = {};
    validCheckins.forEach(checkin => {
      const origin = checkin.origin || 'unknown';
      byOrigin[origin] = (byOrigin[origin] || 0) + 1;
    });

    // Group by country
    const byCountry = {};
    validCheckins.forEach(checkin => {
      const country = checkin.country || 'unknown';
      byCountry[country] = (byCountry[country] || 0) + 1;
    });

    // Group by sector
    const bySector = {};
    validCheckins.forEach(checkin => {
      const sector = checkin.sector || 'unknown';
      bySector[sector] = (bySector[sector] || 0) + 1;
    });

    // Group by job title
    const byJobTitle = {};
    validCheckins.forEach(checkin => {
      const jobTitle = checkin.job_title || 'unknown';
      byJobTitle[jobTitle] = (byJobTitle[jobTitle] || 0) + 1;
    });

    // Sort objects by value (descending)
    const sortByValue = (obj) => {
      return Object.fromEntries(
        Object.entries(obj).sort(([,a], [,b]) => b - a)
      );
    };

    // Sort date object by key (ascending)
    const sortByDateKey = (obj) => {
      return Object.fromEntries(
        Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
      );
    };

    res.json({
      summary: {
        total_valid_checkins: validCheckins.length,
        unique_visitors: uniqueVisitors.size
      },
      by_date: sortByDateKey(byDate),
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
