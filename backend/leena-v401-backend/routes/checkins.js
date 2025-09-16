// routes/checkins.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * POST /api/checkins
 * Create a new check-in record
 */
router.post('/', authenticateToken, async (req, res) => {
  const { 
    visitor_id, 
    expo_id, 
    qr_code,
    terminal = 'main',
    hall = 'general',
    notes,
    checkin_type = 'entry',
    staff_id
  } = req.body;

  if (!expo_id || (!visitor_id && !qr_code)) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: {
        expo_id: 'number',
        identification: 'visitor_id OR qr_code required'
      }
    });
  }

  try {
    const expoCheck = await pool.query(
      'SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    let visitorId = visitor_id;

    if (qr_code && !visitor_id) {
      const visitorResult = await pool.query(
        'SELECT id, custom_fields, source, origin FROM visitors WHERE qr_code = $1 AND expo_id = $2',
        [qr_code, expo_id]
      );

      if (visitorResult.rows.length === 0) {
        return res.status(404).json({ 
          error: 'Visitor not found',
          qr_code: qr_code 
        });
      }

      visitorId = visitorResult.rows[0].id;
    }

    const visitorCheck = await pool.query(
      `SELECT 
        v.id, 
        v.custom_fields,
        v.qr_code,
        v.source,
        v.origin,
        (SELECT COUNT(*) FROM checkins WHERE visitor_id = v.id AND expo_id = $2) as checkin_count,
        (SELECT checkin_time FROM checkins WHERE visitor_id = v.id AND expo_id = $2 ORDER BY checkin_time DESC LIMIT 1) as last_checkin
       FROM visitors v
       WHERE v.id = $1 AND v.expo_id = $2`,
      [visitorId, expo_id]
    );

    if (visitorCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Visitor not found in this expo' });
    }

    const visitor = visitorCheck.rows[0];

    if (visitor.last_checkin) {
      const timeSinceLastCheckin = Date.now() - new Date(visitor.last_checkin).getTime();
      const minimumInterval = 60000;

      if (timeSinceLastCheckin < minimumInterval && checkin_type === 'entry') {
        // Parse custom_fields if it's a string
        let customFields = visitor.custom_fields;
        if (typeof customFields === 'string') {
          try {
            customFields = JSON.parse(customFields);
          } catch (e) {
            customFields = {};
          }
        }
        
        return res.status(409).json({ 
          error: 'Duplicate check-in detected',
          message: 'This visitor was checked in less than a minute ago',
          last_checkin: visitor.last_checkin,
          visitor: {
            id: visitor.id,
            name: customFields?.name,
            last_name: customFields?.last_name,
            company: customFields?.company
          }
        });
      }
    }

    const checkinResult = await pool.query(
      `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, notes, checkin_type, staff_id, checkin_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [visitorId, expo_id, terminal, hall, notes, checkin_type, staff_id || req.organizer_id]
    );

    const checkin = checkinResult.rows[0];

    // Parse custom_fields if it's a string
    let customFields = visitor.custom_fields;
    if (typeof customFields === 'string') {
      try {
        customFields = JSON.parse(customFields);
      } catch (e) {
        customFields = {};
      }
    }

    // Build comprehensive name field
    let visitorName = '';
    if (customFields?.full_name) {
      visitorName = customFields.full_name;
    } else if (customFields?.name || customFields?.last_name) {
      visitorName = `${customFields?.name || ''} ${customFields?.last_name || ''}`.trim();
    }

    const response = {
      message: 'Check-in successful',
      checkin: {
        id: checkin.id,
        checkin_time: checkin.checkin_time,
        terminal: checkin.terminal,
        hall: checkin.hall,
        checkin_type: checkin.checkin_type
      },
      visitor: {
        id: visitor.id,
        qr_code: visitor.qr_code,
        name: visitorName,
        last_name: customFields?.last_name,
        email: customFields?.email,
        company: customFields?.company || '',
        country: customFields?.country || '',
        origin: visitor.origin || '',
        source: visitor.source || '',
        terminal: checkin.terminal,
        hall: checkin.hall,
        checkin_time: checkin.checkin_time,
        total_checkins: parseInt(visitor.checkin_count) + 1
      },
      expo: {
        id: expoCheck.rows[0].id,
        name: expoCheck.rows[0].name
      }
    };

    res.status(201).json(response);
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Failed to create check-in' });
  }
});

/**
 * GET /api/checkins
 * List check-ins with filtering options
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
    source,
    origin
  } = req.query;

  // Accept alternate casing from query string
  expoId = expoId || req.query.expo_id;
  
  // Calculate offset from page if provided
  if (page && page > 1) {
    offset = (page - 1) * limit;
  }

  if (!expoId && !visitorId) {
    return res.status(400).json({ error: 'Either expoId or visitorId is required' });
  }

  try {
    // First get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM checkins c
      JOIN visitors v ON v.id = c.visitor_id
      JOIN expos e ON e.id = c.expo_id
      WHERE e.organizer_id = $1`;

    const countParams = [req.organizer_id];
    let countParamIndex = 2;

    if (expoId) {
      countQuery += ` AND c.expo_id = $${countParamIndex}`;
      countParams.push(expoId);
      countParamIndex++;
    }

    if (visitorId) {
      countQuery += ` AND c.visitor_id = $${countParamIndex}`;
      countParams.push(visitorId);
      countParamIndex++;
    }

    if (terminal) {
      countQuery += ` AND c.terminal = $${countParamIndex}`;
      countParams.push(terminal);
      countParamIndex++;
    }

    if (hall) {
      countQuery += ` AND c.hall = $${countParamIndex}`;
      countParams.push(hall);
      countParamIndex++;
    }

    if (checkinType) {
      countQuery += ` AND c.checkin_type = $${countParamIndex}`;
      countParams.push(checkinType);
      countParamIndex++;
    }

    if (source) {
      countQuery += ` AND v.source = $${countParamIndex}`;
      countParams.push(source);
      countParamIndex++;
    }

    if (origin) {
      countQuery += ` AND v.origin = $${countParamIndex}`;
      countParams.push(origin);
      countParamIndex++;
    }

    if (date) {
      countQuery += ` AND DATE(c.checkin_time) = $${countParamIndex}`;
      countParams.push(date);
      countParamIndex++;
    } else {
      if (startDate) {
        countQuery += ` AND c.checkin_time >= $${countParamIndex}`;
        countParams.push(startDate);
        countParamIndex++;
      }
      if (endDate) {
        countQuery += ` AND c.checkin_time <= $${countParamIndex}`;
        countParams.push(endDate);
        countParamIndex++;
      }
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalRecords = parseInt(countResult.rows[0].total);

    // Now get the actual data with IMPROVED visitor field extraction
    let query = `
      SELECT 
        c.id,
        c.visitor_id,
        c.expo_id,
        c.terminal,
        c.hall,
        c.notes,
        c.checkin_type,
        c.checkin_time,
        c.staff_id`;

    if (includeVisitorDetails === 'true') {
      query += `,
        v.qr_code,
        v.badge_id,
        v.source,
        v.origin,
        v.custom_fields,
        -- Get name from multiple possible sources
        COALESCE(
          v.custom_fields->>'full_name',
          v.custom_fields->>'name',
          v.name,
          ''
        ) as visitor_name,
        -- Get last name
        COALESCE(
          v.custom_fields->>'last_name',
          v.last_name,
          ''
        ) as visitor_last_name,
        -- Get full name (prioritize full_name field, then concatenate)
        COALESCE(
          v.custom_fields->>'full_name',
          CASE 
            WHEN v.name IS NOT NULL OR v.last_name IS NOT NULL 
            THEN TRIM(CONCAT(COALESCE(v.name, ''), ' ', COALESCE(v.last_name, '')))
            WHEN v.custom_fields->>'name' IS NOT NULL OR v.custom_fields->>'last_name' IS NOT NULL
            THEN TRIM(CONCAT(COALESCE(v.custom_fields->>'name', ''), ' ', COALESCE(v.custom_fields->>'last_name', '')))
            ELSE ''
          END
        ) as visitor_full_name,
        -- Get email from multiple sources
        COALESCE(
          v.custom_fields->>'email',
          v.email,
          ''
        ) as visitor_email,
        -- Get company from multiple sources
        COALESCE(
          v.custom_fields->>'company',
          v.company,
          ''
        ) as visitor_company,
        -- Get country from multiple sources
        COALESCE(
          v.custom_fields->>'country',
          v.country,
          ''
        ) as visitor_country,
        -- Get job title
        COALESCE(
          v.custom_fields->>'job_title',
          v.job_title,
          ''
        ) as visitor_job_title,
        -- Add direct fields as backup
        v.name as name,
        v.last_name as last_name,
        v.email as email,
        v.company as company,
        v.country as country,
        v.phone as phone,
        e.name as expo_name`;
    }

    query += `
      FROM checkins c
      JOIN visitors v ON v.id = c.visitor_id
      JOIN expos e ON e.id = c.expo_id
      WHERE e.organizer_id = $1`;

    const queryParams = [req.organizer_id];
    let paramCount = 2;

    if (expoId) {
      query += ` AND c.expo_id = $${paramCount}`;
      queryParams.push(expoId);
      paramCount++;
    }

    if (visitorId) {
      query += ` AND c.visitor_id = $${paramCount}`;
      queryParams.push(visitorId);
      paramCount++;
    }

    if (terminal) {
      query += ` AND c.terminal = $${paramCount}`;
      queryParams.push(terminal);
      paramCount++;
    }

    if (hall) {
      query += ` AND c.hall = $${paramCount}`;
      queryParams.push(hall);
      paramCount++;
    }

    if (checkinType) {
      query += ` AND c.checkin_type = $${paramCount}`;
      queryParams.push(checkinType);
      paramCount++;
    }

    if (source) {
      query += ` AND v.source = $${paramCount}`;
      queryParams.push(source);
      paramCount++;
    }

    if (origin) {
      query += ` AND v.origin = $${paramCount}`;
      queryParams.push(origin);
      paramCount++;
    }

    if (date) {
      query += ` AND DATE(c.checkin_time) = $${paramCount}`;
      queryParams.push(date);
      paramCount++;
    } else {
      if (startDate) {
        query += ` AND c.checkin_time >= $${paramCount}`;
        queryParams.push(startDate);
        paramCount++;
      }
      if (endDate) {
        query += ` AND c.checkin_time <= $${paramCount}`;
        queryParams.push(endDate);
        paramCount++;
      }
    }

    query += ` ORDER BY c.checkin_time DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

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

/**
 * GET /api/checkins/stats/summary
 * Get check-in statistics for an expo
 */
router.get('/stats/summary', authenticateToken, async (req, res) => {
  let { expoId } = req.query;
  
  // Accept alternate casing
  expoId = expoId || req.query.expo_id;

  if (!expoId) {
    return res.status(400).json({ error: 'expoId is required' });
  }

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    // Get total check-ins
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM checkins WHERE expo_id = $1',
      [expoId]
    );

    // Get unique visitors
    const uniqueResult = await pool.query(
      'SELECT COUNT(DISTINCT visitor_id) as unique_count FROM checkins WHERE expo_id = $1',
      [expoId]
    );

    // Get today's check-ins
    const todayResult = await pool.query(
      `SELECT COUNT(*) as today_count 
       FROM checkins 
       WHERE expo_id = $1 AND DATE(checkin_time) = CURRENT_DATE`,
      [expoId]
    );

    // Get hall distribution
    const hallResult = await pool.query(
      `SELECT hall, COUNT(*) as count 
       FROM checkins 
       WHERE expo_id = $1 
       GROUP BY hall 
       ORDER BY count DESC`,
      [expoId]
    );

    // Build hall distribution object
    const hallDistribution = {};
    hallResult.rows.forEach(row => {
      hallDistribution[row.hall || 'Unknown'] = parseInt(row.count);
    });

    // Get source distribution (from visitors table)
    const sourceResult = await pool.query(
      `SELECT v.source, COUNT(DISTINCT c.id) as count
       FROM checkins c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.expo_id = $1
       GROUP BY v.source
       ORDER BY count DESC`,
      [expoId]
    );

    const sourceDistribution = {};
    sourceResult.rows.forEach(row => {
      sourceDistribution[row.source || 'Unknown'] = parseInt(row.count);
    });

    res.json({
      statistics: {
        total_checkins: parseInt(totalResult.rows[0].total),
        unique_visitors: parseInt(uniqueResult.rows[0].unique_count),
        today_checkins: parseInt(todayResult.rows[0].today_count),
        by_hall: hallDistribution,
        by_source: sourceDistribution
      }
    });
  } catch (err) {
    console.error('Error fetching check-in stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Legacy support: allow /stats?expo_id=1 by internally redirecting to /stats/summary
router.get('/stats', authenticateToken, async (req, res) => {
  // Pass through to the new endpoint
  if (req.query.expo_id) {
    req.query.expoId = req.query.expo_id;
  }
  
  // Get stats using the summary endpoint logic
  let { expoId } = req.query;
  
  if (!expoId) {
    return res.status(400).json({ error: 'expoId is required' });
  }

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    // Get total check-ins
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM checkins WHERE expo_id = $1',
      [expoId]
    );

    // Get unique visitors
    const uniqueResult = await pool.query(
      'SELECT COUNT(DISTINCT visitor_id) as unique_count FROM checkins WHERE expo_id = $1',
      [expoId]
    );

    // Get today's check-ins
    const todayResult = await pool.query(
      `SELECT COUNT(*) as today_count 
       FROM checkins 
       WHERE expo_id = $1 AND DATE(checkin_time) = CURRENT_DATE`,
      [expoId]
    );

    // Get hall distribution
    const hallResult = await pool.query(
      `SELECT hall, COUNT(*) as count 
       FROM checkins 
       WHERE expo_id = $1 
       GROUP BY hall 
       ORDER BY count DESC`,
      [expoId]
    );

    // Build hall distribution object
    const hallDistribution = {};
    hallResult.rows.forEach(row => {
      hallDistribution[row.hall || 'Unknown'] = parseInt(row.count);
    });

    res.json({
      statistics: {
        total_checkins: parseInt(totalResult.rows[0].total),
        unique_visitors: parseInt(uniqueResult.rows[0].unique_count),
        today_checkins: parseInt(todayResult.rows[0].today_count),
        by_hall: hallDistribution
      }
    });
  } catch (err) {
    console.error('Error fetching check-in stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
