// routes/checkinReports.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

router.get('/', authenticateToken, async (req, res) => {
  const { expo_id, startDate, endDate } = req.query;

  if (!expo_id) {
    return res.status(400).json({ error: 'expo_id is required' });
  }

  try {
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

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
          c.*,
          v.source as visitor_source,
          v.origin as visitor_origin,
          v.custom_fields,
          v.country as direct_country,
          LAG(c.checkin_time) OVER (
            PARTITION BY c.visitor_id 
            ORDER BY c.checkin_time
          ) as prev_checkin_time
        FROM checkins c
        JOIN visitors v ON v.id = c.visitor_id
        WHERE c.expo_id = $1
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
        visitor_source,
        visitor_origin,
        custom_fields,
        direct_country,
        COALESCE(custom_fields->>'country', direct_country) as country,
        custom_fields->>'sector' as sector,
        custom_fields->>'job_title' as job_title
      FROM valid_checkins
    `;

    const validCheckinsResult = await pool.query(validCheckinsQuery, queryParams);
    const validCheckins = validCheckinsResult.rows;

    const uniqueVisitors = new Set(validCheckins.map(c => c.visitor_id));

    // Grouping
    const groupByField = (list, field) => {
      return list.reduce((acc, item) => {
        const key = item[field] || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    };

    const byDate = validCheckins.reduce((acc, item) => {
      const date = new Date(item.checkin_time).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});

    const sortDesc = obj =>
      Object.fromEntries(Object.entries(obj).sort(([, a], [, b]) => b - a));
    const sortDateAsc = obj =>
      Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

    res.json({
      summary: {
        total_valid_checkins: validCheckins.length,
        unique_visitors: uniqueVisitors.size
      },
      by_date: sortDateAsc(byDate),
      by_source: sortDesc(groupByField(validCheckins, 'visitor_source')),
      by_origin: sortDesc(groupByField(validCheckins, 'visitor_origin')),
      by_country: sortDesc(groupByField(validCheckins, 'country')),
      by_sector: sortDesc(groupByField(validCheckins, 'sector')),
      by_job_title: sortDesc(groupByField(validCheckins, 'job_title'))
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
