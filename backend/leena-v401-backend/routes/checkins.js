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
        'SELECT id, custom_fields FROM visitors WHERE qr_code = $1 AND expo_id = $2',
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
        return res.status(409).json({ 
          error: 'Duplicate check-in detected',
          message: 'This visitor was checked in less than a minute ago',
          last_checkin: visitor.last_checkin,
          visitor: {
            id: visitor.id,
            name: visitor.custom_fields?.name,
            last_name: visitor.custom_fields?.last_name,
            company: visitor.custom_fields?.company
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
        name: visitor.custom_fields?.name,
        last_name: visitor.custom_fields?.last_name,
        email: visitor.custom_fields?.email,
        company: visitor.custom_fields?.company,
        country: visitor.custom_fields?.country,
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
    includeVisitorDetails = 'true'
  } = req.query;

  // 🔁 Accept alternate casing from query string
  expoId = expoId || req.query.expo_id;

  if (!expoId && !visitorId) {
    return res.status(400).json({ error: 'Either expoId or visitorId is required' });
  }

  try {
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
        v.source,
        v.origin,
        v.custom_fields,
        v.custom_fields->>'name' as visitor_name,
        v.custom_fields->>'last_name' as visitor_last_name,
        v.custom_fields->>'email' as visitor_email,
        v.custom_fields->>'company' as visitor_company,
        v.custom_fields->>'country' as visitor_country,
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
        total: result.rows.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: false
      }
    });
  } catch (err) {
    console.error('Error fetching check-ins:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Legacy support: allow /stats?expo_id=1 by internally redirecting to /stats/summary
router.get('/stats', (req, res, next) => {
  if (req.query.expo_id) {
    req.query.expoId = req.query.expo_id;
    delete req.query.expo_id;
  }
  req.url = '/stats/summary';
  next();
});

module.exports = router;
