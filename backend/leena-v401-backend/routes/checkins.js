// routes/checkins.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * GET /api/checkins
 * List deduplicated check-ins for badge-print only
 */
router.get('/', authenticateToken, async (req, res) => {
  let {
    expoId,
    visitorId,
    terminal,
    hall,
    checkinType,
    date,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
    page = 1,
    includeVisitorDetails = 'true',
    source = 'badge-print',
    origin
  } = req.query;

  expoId = expoId || req.query.expo_id;
  if (page && page > 1) offset = (page - 1) * limit;
  if (!expoId && !visitorId) return res.status(400).json({ error: 'Either expoId or visitorId is required' });

  try {
    let baseWhere = `WHERE e.organizer_id = $1 AND c.source = 'badge-print'`;
    const baseParams = [req.organizer_id];
    let paramCount = 2;

    const filters = [
      { value: expoId, clause: ` AND c.expo_id = $${paramCount++}` },
      { value: visitorId, clause: ` AND c.visitor_id = $${paramCount++}` },
      { value: terminal, clause: ` AND c.terminal = $${paramCount++}` },
      { value: hall, clause: ` AND c.hall = $${paramCount++}` },
      { value: checkinType, clause: ` AND c.checkin_type = $${paramCount++}` },
      { value: source, clause: ` AND v.source = $${paramCount++}` },
      { value: origin, clause: ` AND v.origin = $${paramCount++}` }
    ];

    filters.forEach(f => {
      if (f.value) {
        baseWhere += f.clause;
        baseParams.push(f.value);
      }
    });

    if (date) {
      baseWhere += ` AND DATE(c.checkin_time) = $${paramCount}`;
      baseParams.push(date);
      paramCount++;
    } else {
      if (startDate) {
        baseWhere += ` AND c.checkin_time >= $${paramCount}`;
        baseParams.push(startDate);
        paramCount++;
      }
      if (endDate) {
        baseWhere += ` AND c.checkin_time <= $${paramCount}`;
        baseParams.push(endDate);
        paramCount++;
      }
    }

    // Count query with 2-minute deduplication window
    const countQuery = `
      SELECT COUNT(*) as total FROM (
        SELECT *,
          LAG(checkin_time) OVER (PARTITION BY c.visitor_id ORDER BY c.checkin_time) as previous_checkin
        FROM checkins c
        JOIN visitors v ON v.id = c.visitor_id
        JOIN expos e ON e.id = c.expo_id
        ${baseWhere}
      ) sub
      WHERE previous_checkin IS NULL OR checkin_time - previous_checkin > interval '2 minutes'`;

    const countResult = await pool.query(countQuery, baseParams);
    const totalRecords = parseInt(countResult.rows[0].total);

    // Main query
    let query = `
      SELECT * FROM (
        SELECT 
          c.id,
          c.visitor_id,
          c.expo_id,
          c.terminal,
          c.hall,
          c.notes,
          c.checkin_type,
          c.checkin_time,
          c.staff_id,
          v.source,
          v.origin,
          v.custom_fields,
          v.qr_code,
          v.badge_id,
          COALESCE(
            v.custom_fields->>'full_name',
            v.custom_fields->>'name',
            v.name, ''
          ) as visitor_name,
          COALESCE(v.custom_fields->>'last_name', v.last_name, '') as visitor_last_name,
          COALESCE(
            v.custom_fields->>'full_name',
            CASE WHEN v.name IS NOT NULL OR v.last_name IS NOT NULL THEN TRIM(CONCAT(COALESCE(v.name, ''), ' ', COALESCE(v.last_name, '')))
            WHEN v.custom_fields->>'name' IS NOT NULL OR v.custom_fields->>'last_name' IS NOT NULL THEN TRIM(CONCAT(COALESCE(v.custom_fields->>'name', ''), ' ', COALESCE(v.custom_fields->>'last_name', '')))
            ELSE '' END
          ) as visitor_full_name,
          COALESCE(v.custom_fields->>'email', v.email, '') as visitor_email,
          COALESCE(v.custom_fields->>'company', v.company, '') as visitor_company,
          COALESCE(v.custom_fields->>'country', v.country, '') as visitor_country,
          COALESCE(v.custom_fields->>'job_title', v.job_title, '') as visitor_job_title,
          v.name, v.last_name, v.email, v.company, v.country, v.phone,
          e.name as expo_name,
          LAG(c.checkin_time) OVER (PARTITION BY c.visitor_id ORDER BY c.checkin_time) as previous_checkin
        FROM checkins c
        JOIN visitors v ON v.id = c.visitor_id
        JOIN expos e ON e.id = c.expo_id
        ${baseWhere}
      ) sub
      WHERE previous_checkin IS NULL OR checkin_time - previous_checkin > interval '2 minutes'
      ORDER BY checkin_time DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`;

    baseParams.push(limit, offset);
    const result = await pool.query(query, baseParams);

    res.json({
      checkins: result.rows,
      pagination: {
        total: totalRecords,
        limit: parseInt(limit),
        offset: parseInt(offset),
        page: parseInt(page),
        totalPages: Math.ceil(totalRecords / limit),
        has_more: offset + result.rows.length < totalRecords
      }
    });
  } catch (err) {
    console.error('Error fetching check-ins:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
