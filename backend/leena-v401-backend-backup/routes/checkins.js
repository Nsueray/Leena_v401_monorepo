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
    qr_code,  // Alternative to visitor_id
    terminal = 'main',
    hall = 'general',
    notes,
    checkin_type = 'entry',  // entry, exit, re-entry
    staff_id
  } = req.body;

  // Validate input - must have either visitor_id or qr_code
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
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    let visitorId = visitor_id;
    
    // If QR code provided, find visitor
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

    // Verify visitor belongs to expo
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

    // Check for duplicate check-in (prevent double scanning)
    if (visitor.last_checkin) {
      const timeSinceLastCheckin = Date.now() - new Date(visitor.last_checkin).getTime();
      const minimumInterval = 60000; // 1 minute in milliseconds

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

    // Create check-in record
    const checkinResult = await pool.query(
      `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, notes, checkin_type, staff_id, checkin_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [visitorId, expo_id, terminal, hall, notes, checkin_type, staff_id || req.organizer_id]
    );

    const checkin = checkinResult.rows[0];

    // Get visitor details for response
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
  const { 
    expoId, 
    visitorId, 
    terminal, 
    hall,
    checkinType,
    date,  // Format: YYYY-MM-DD
    startDate,
    endDate,
    limit = 100, 
    offset = 0,
    includeVisitorDetails = 'true'
  } = req.query;

  if (!expoId && !visitorId) {
    return res.status(400).json({ 
      error: 'Either expoId or visitorId is required' 
    });
  }

  try {
    // Build dynamic query
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
        c.staff_id
    `;

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
        e.name as expo_name
      `;
    }

    query += `
      FROM checkins c
      JOIN visitors v ON v.id = c.visitor_id
      JOIN expos e ON e.id = c.expo_id
      WHERE e.organizer_id = $1
    `;

    const queryParams = [req.organizer_id];
    let paramCount = 2;

    // Add filters
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

    // Date filters
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

    // Add ordering and pagination
    query += ` ORDER BY c.checkin_time DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM checkins c
      JOIN visitors v ON v.id = c.visitor_id
      JOIN expos e ON e.id = c.expo_id
      WHERE e.organizer_id = $1
    `;

    const countParams = [req.organizer_id];
    let countParamCount = 2;

    if (expoId) {
      countQuery += ` AND c.expo_id = $${countParamCount}`;
      countParams.push(expoId);
      countParamCount++;
    }

    if (visitorId) {
      countQuery += ` AND c.visitor_id = $${countParamCount}`;
      countParams.push(visitorId);
      countParamCount++;
    }

    if (terminal) {
      countQuery += ` AND c.terminal = $${countParamCount}`;
      countParams.push(terminal);
      countParamCount++;
    }

    if (hall) {
      countQuery += ` AND c.hall = $${countParamCount}`;
      countParams.push(hall);
      countParamCount++;
    }

    if (checkinType) {
      countQuery += ` AND c.checkin_type = $${countParamCount}`;
      countParams.push(checkinType);
      countParamCount++;
    }

    if (date) {
      countQuery += ` AND DATE(c.checkin_time) = $${countParamCount}`;
      countParams.push(date);
    } else {
      if (startDate) {
        countQuery += ` AND c.checkin_time >= $${countParamCount}`;
        countParams.push(startDate);
        countParamCount++;
      }
      if (endDate) {
        countQuery += ` AND c.checkin_time <= $${countParamCount}`;
        countParams.push(endDate);
      }
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      checkins: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: parseInt(offset) + result.rows.length < parseInt(countResult.rows[0].total)
      }
    });
  } catch (err) {
    console.error('Error fetching check-ins:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/checkins/scan
 * Quick scan endpoint for QR code check-ins
 */
router.post('/scan', authenticateToken, async (req, res) => {
  const { qr_code, terminal = 'mobile', hall = 'general' } = req.body;

  if (!qr_code) {
    return res.status(400).json({ error: 'QR code is required' });
  }

  try {
    // Find visitor by QR code
    const visitorResult = await pool.query(
      `SELECT 
        v.id, 
        v.expo_id,
        v.custom_fields,
        v.qr_code,
        e.name as expo_name,
        e.organizer_id,
        (SELECT COUNT(*) FROM checkins WHERE visitor_id = v.id) as total_checkins,
        (SELECT checkin_time FROM checkins WHERE visitor_id = v.id ORDER BY checkin_time DESC LIMIT 1) as last_checkin
       FROM visitors v
       JOIN expos e ON v.expo_id = e.id
       WHERE v.qr_code = $1`,
      [qr_code]
    );

    if (visitorResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Invalid QR code',
        qr_code: qr_code 
      });
    }

    const visitor = visitorResult.rows[0];

    // Verify organizer owns this expo
    if (visitor.organizer_id !== req.organizer_id) {
      return res.status(403).json({ error: 'Access denied to this visitor' });
    }

    // Check for recent check-in
    if (visitor.last_checkin) {
      const timeSinceLastCheckin = Date.now() - new Date(visitor.last_checkin).getTime();
      const minimumInterval = 60000; // 1 minute

      if (timeSinceLastCheckin < minimumInterval) {
        return res.status(409).json({ 
          error: 'Already checked in',
          message: 'This visitor was checked in recently',
          last_checkin: visitor.last_checkin,
          visitor_info: {
            name: `${visitor.custom_fields?.name || ''} ${visitor.custom_fields?.last_name || ''}`.trim(),
            company: visitor.custom_fields?.company,
            email: visitor.custom_fields?.email
          }
        });
      }
    }

    // Create check-in
    const checkinResult = await pool.query(
      `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, checkin_type, staff_id, checkin_time)
       VALUES ($1, $2, $3, $4, 'entry', $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [visitor.id, visitor.expo_id, terminal, hall, req.organizer_id]
    );

    res.status(201).json({
      success: true,
      message: 'Check-in successful',
      checkin: checkinResult.rows[0],
      visitor: {
        id: visitor.id,
        name: visitor.custom_fields?.name,
        last_name: visitor.custom_fields?.last_name,
        email: visitor.custom_fields?.email,
        company: visitor.custom_fields?.company,
        country: visitor.custom_fields?.country,
        total_checkins: parseInt(visitor.total_checkins) + 1
      },
      expo: {
        id: visitor.expo_id,
        name: visitor.expo_name
      }
    });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Failed to process scan' });
  }
});

/**
 * GET /api/checkins/:id
 * Get specific check-in details
 */
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        c.*,
        v.qr_code,
        v.custom_fields,
        e.name as expo_name,
        e.location as expo_location,
        e.start_date,
        e.end_date
       FROM checkins c
       JOIN visitors v ON c.visitor_id = v.id
       JOIN expos e ON c.expo_id = e.id
       WHERE c.id = $1 AND e.organizer_id = $2`,
      [id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching check-in:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/checkins/:id
 * Update check-in details (for corrections)
 */
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { terminal, hall, notes, checkin_type } = req.body;

  if (!terminal && !hall && !notes && !checkin_type) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    // Verify ownership
    const ownershipCheck = await pool.query(
      `SELECT c.id 
       FROM checkins c
       JOIN expos e ON c.expo_id = e.id
       WHERE c.id = $1 AND e.organizer_id = $2`,
      [id, req.organizer_id]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (terminal !== undefined) {
      updates.push(`terminal = $${paramCount}`);
      values.push(terminal);
      paramCount++;
    }

    if (hall !== undefined) {
      updates.push(`hall = $${paramCount}`);
      values.push(hall);
      paramCount++;
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      values.push(notes);
      paramCount++;
    }

    if (checkin_type !== undefined) {
      updates.push(`checkin_type = $${paramCount}`);
      values.push(checkin_type);
      paramCount++;
    }

    values.push(id);

    const query = `
      UPDATE checkins 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    res.json({
      message: 'Check-in updated successfully',
      checkin: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating check-in:', err);
    res.status(500).json({ error: 'Failed to update check-in' });
  }
});

/**
 * DELETE /api/checkins/:id
 * Delete a check-in record (soft delete recommended in production)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verify ownership and delete
    const result = await pool.query(
      `DELETE FROM checkins 
       WHERE id = $1 
       AND expo_id IN (SELECT id FROM expos WHERE organizer_id = $2)
       RETURNING id, visitor_id, checkin_time`,
      [id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json({
      message: 'Check-in deleted successfully',
      deleted: result.rows[0]
    });
  } catch (err) {
    console.error('Error deleting check-in:', err);
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

/**
 * GET /api/checkins/stats
 * Get check-in statistics
 */
router.get('/stats/summary', authenticateToken, async (req, res) => {
  const { expoId, date, startDate, endDate } = req.query;

  if (!expoId) {
    return res.status(400).json({ error: 'expoId is required' });
  }

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id, name FROM expos WHERE id = $1 AND organizer_id = $2',
      [expoId, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this expo' });
    }

    // Build date filter
    let dateFilter = '';
    const queryParams = [expoId];
    let paramCount = 2;

    if (date) {
      dateFilter = ` AND DATE(c.checkin_time) = $${paramCount}`;
      queryParams.push(date);
    } else if (startDate && endDate) {
      dateFilter = ` AND c.checkin_time >= $${paramCount} AND c.checkin_time <= $${paramCount + 1}`;
      queryParams.push(startDate, endDate);
    }

    // Get comprehensive statistics
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_checkins,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        COUNT(CASE WHEN checkin_type = 'entry' THEN 1 END) as entries,
        COUNT(CASE WHEN checkin_type = 'exit' THEN 1 END) as exits,
        COUNT(CASE WHEN checkin_type = 're-entry' THEN 1 END) as reentries,
        COUNT(CASE WHEN DATE(checkin_time) = CURRENT_DATE THEN 1 END) as today_checkins,
        COUNT(CASE WHEN checkin_time >= CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 1 END) as last_hour,
        
        -- Terminal distribution
        (SELECT json_object_agg(terminal, count) 
         FROM (SELECT terminal, COUNT(*) 
               FROM checkins 
               WHERE expo_id = $1 ${dateFilter}
               GROUP BY terminal) t) as by_terminal,
        
        -- Hall distribution
        (SELECT json_object_agg(hall, count) 
         FROM (SELECT hall, COUNT(*) 
               FROM checkins 
               WHERE expo_id = $1 ${dateFilter}
               GROUP BY hall) h) as by_hall,
        
        -- Hourly distribution (last 24 hours)
        (SELECT json_agg(json_build_object('hour', hour, 'count', count) ORDER BY hour)
         FROM (SELECT DATE_TRUNC('hour', checkin_time) as hour, COUNT(*)
               FROM checkins
               WHERE expo_id = $1 
               AND checkin_time >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
               GROUP BY DATE_TRUNC('hour', checkin_time)) h) as hourly_distribution,
        
        -- Peak times
        (SELECT json_build_object(
          'hour', EXTRACT(HOUR FROM checkin_time),
          'count', COUNT(*)
         )
         FROM checkins
         WHERE expo_id = $1 ${dateFilter}
         GROUP BY EXTRACT(HOUR FROM checkin_time)
         ORDER BY COUNT(*) DESC
         LIMIT 1) as peak_hour,
         
        -- Average check-ins per visitor
        (SELECT AVG(checkin_count)::numeric(10,2)
         FROM (SELECT visitor_id, COUNT(*) as checkin_count
               FROM checkins
               WHERE expo_id = $1 ${dateFilter}
               GROUP BY visitor_id) vc) as avg_checkins_per_visitor
        
      FROM checkins c
      WHERE c.expo_id = $1 ${dateFilter}
    `, queryParams);

    // Get recent check-ins
    const recentCheckins = await pool.query(`
      SELECT 
        c.id,
        c.checkin_time,
        c.terminal,
        c.hall,
        v.custom_fields->>'name' as visitor_name,
        v.custom_fields->>'company' as visitor_company
      FROM checkins c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE c.expo_id = $1
      ORDER BY c.checkin_time DESC
      LIMIT 10
    `, [expoId]);

    res.json({
      expo: {
        id: expoCheck.rows[0].id,
        name: expoCheck.rows[0].name
      },
      period: {
        date: date || null,
        start: startDate || null,
        end: endDate || null
      },
      statistics: stats.rows[0],
      recent_checkins: recentCheckins.rows,
      generated_at: new Date()
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to generate statistics' });
  }
});

/**
 * POST /api/checkins/bulk
 * Bulk check-in for group registrations
 */
router.post('/bulk', authenticateToken, async (req, res) => {
  const { expo_id, visitor_ids, qr_codes, terminal = 'main', hall = 'general' } = req.body;

  if (!expo_id || (!visitor_ids && !qr_codes)) {
    return res.status(400).json({ 
      error: 'expo_id and either visitor_ids or qr_codes array required' 
    });
  }

  const identifiers = visitor_ids || qr_codes;
  if (!Array.isArray(identifiers) || identifiers.length === 0) {
    return res.status(400).json({ error: 'Invalid or empty array provided' });
  }

  if (identifiers.length > 100) {
    return res.status(400).json({ 
      error: 'Too many check-ins',
      message: 'Maximum 100 check-ins per bulk operation' 
    });
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

    const results = {
      successful: [],
      failed: [],
      duplicates: []
    };

    await pool.query('BEGIN');

    try {
      for (const identifier of identifiers) {
        // Find visitor
        let visitorQuery;
        if (visitor_ids) {
          visitorQuery = await pool.query(
            'SELECT id, custom_fields, qr_code FROM visitors WHERE id = $1 AND expo_id = $2',
            [identifier, expo_id]
          );
        } else {
          visitorQuery = await pool.query(
            'SELECT id, custom_fields, qr_code FROM visitors WHERE qr_code = $1 AND expo_id = $2',
            [identifier, expo_id]
          );
        }

        if (visitorQuery.rows.length === 0) {
          results.failed.push({
            identifier,
            reason: 'Visitor not found'
          });
          continue;
        }

        const visitor = visitorQuery.rows[0];

        // Check for recent check-in
        const recentCheck = await pool.query(
          `SELECT checkin_time FROM checkins 
           WHERE visitor_id = $1 AND expo_id = $2 
           AND checkin_time > CURRENT_TIMESTAMP - INTERVAL '1 minute'`,
          [visitor.id, expo_id]
        );

        if (recentCheck.rows.length > 0) {
          results.duplicates.push({
            identifier,
            visitor_id: visitor.id,
            name: visitor.custom_fields?.name,
            last_checkin: recentCheck.rows[0].checkin_time
          });
          continue;
        }

        // Create check-in
        const checkin = await pool.query(
          `INSERT INTO checkins (visitor_id, expo_id, terminal, hall, checkin_type, staff_id, checkin_time)
           VALUES ($1, $2, $3, $4, 'entry', $5, CURRENT_TIMESTAMP)
           RETURNING id, checkin_time`,
          [visitor.id, expo_id, terminal, hall, req.organizer_id]
        );

        results.successful.push({
          identifier,
          visitor_id: visitor.id,
          checkin_id: checkin.rows[0].id,
          name: visitor.custom_fields?.name,
          company: visitor.custom_fields?.company
        });
      }

      await pool.query('COMMIT');

      res.json({
        message: 'Bulk check-in completed',
        summary: {
          total: identifiers.length,
          successful: results.successful.length,
          failed: results.failed.length,
          duplicates: results.duplicates.length
        },
        details: results
      });
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('Bulk check-in error:', err);
    res.status(500).json({ error: 'Failed to process bulk check-in' });
  }
});

module.exports = router;
