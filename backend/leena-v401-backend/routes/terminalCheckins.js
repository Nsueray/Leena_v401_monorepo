/**
 * Terminal Check-in Routes
 * Leena EMS v402 Mini
 * 
 * Tokenless terminal-only endpoints
 * Uses terminalAuth middleware (NOT JWT)
 * 
 * Endpoints:
 *   GET  /api/terminal/visitor-by-qr
 *   POST /api/terminal/checkin
 *   GET  /api/terminal/status
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const terminalAuth = require('../middleware/terminalAuth');

// Apply terminal authentication to all routes in this file
router.use(terminalAuth);

/**
 * GET /api/terminal/visitor-by-qr
 * 
 * Look up visitor by QR code for the terminal's expo
 * 
 * Query params:
 *   qr - The QR code string
 * 
 * Returns visitor info + current event status
 */
router.get('/visitor-by-qr', async (req, res) => {
  try {
    const { qr } = req.query;
    const { expoId, organizerId } = req.terminal;

    if (!qr) {
      return res.status(400).json({
        success: false,
        error: 'QR code is required',
        code: 'MISSING_QR'
      });
    }

    // Look up visitor by qr_code within the terminal's expo scope
    // Join with visitor_event_status for current status
    const visitorResult = await pool.query(
      `SELECT 
         v.id,
         v.name,
         v.last_name,
         v.email,
         v.phone,
         v.company,
         v.country,
         v.job_title,
         v.qr_code,
         v.badge_id,
         v.badge_url,
         v.source,
         v.origin,
         v.custom_fields,
         ves.status AS event_status,
         ves.updated_at AS status_updated_at
       FROM visitors v
       LEFT JOIN visitor_event_status ves 
         ON ves.visitor_id = v.id AND ves.expo_id = v.expo_id
       WHERE v.qr_code = $1 
         AND v.expo_id = $2 
         AND v.organizer_id = $3`,
      [qr, expoId, organizerId]
    );

    if (visitorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found',
        code: 'VISITOR_NOT_FOUND'
      });
    }

    const visitor = visitorResult.rows[0];

    // Get check-in count for this visitor at this expo
    const checkinCountResult = await pool.query(
      `SELECT COUNT(*) AS checkin_count
       FROM checkins
       WHERE visitor_id = $1 AND expo_id = $2`,
      [visitor.id, expoId]
    );

    const checkinCount = parseInt(checkinCountResult.rows[0].checkin_count, 10);

    return res.json({
      success: true,
      visitor: {
        id: visitor.id,
        name: visitor.name,
        lastName: visitor.last_name,
        email: visitor.email,
        phone: visitor.phone,
        company: visitor.company,
        country: visitor.country,
        jobTitle: visitor.job_title,
        qrCode: visitor.qr_code,
        badgeId: visitor.badge_id,
        badgeUrl: visitor.badge_url,
        source: visitor.source,
        origin: visitor.origin,
        customFields: visitor.custom_fields,
        eventStatus: visitor.event_status || 'registered',
        statusUpdatedAt: visitor.status_updated_at,
        checkinCount: checkinCount,
        isRevisit: checkinCount > 0
      }
    });
  } catch (err) {
    console.error('[terminal/visitor-by-qr] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to look up visitor',
      code: 'LOOKUP_ERROR'
    });
  }
});

/**
 * POST /api/terminal/checkin
 * 
 * Record a check-in from a terminal
 * 
 * Body:
 *   visitor_id - The visitor's ID (required)
 *   notes - Optional notes for this check-in
 * 
 * Actions:
 *   1. Insert into checkins table
 *   2. Upsert visitor_event_status to 'checked_in'
 */
router.post('/checkin', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { visitor_id, notes } = req.body;
    const { expoId, organizerId, hall, terminalNo } = req.terminal;

    if (!visitor_id) {
      return res.status(400).json({
        success: false,
        error: 'visitor_id is required',
        code: 'MISSING_VISITOR_ID'
      });
    }

    // Verify visitor exists and belongs to this expo/organizer
    const visitorCheck = await client.query(
      `SELECT id, name, last_name, email, company
       FROM visitors
       WHERE id = $1 AND expo_id = $2 AND organizer_id = $3`,
      [visitor_id, expoId, organizerId]
    );

    if (visitorCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Visitor not found or does not belong to this expo',
        code: 'VISITOR_NOT_FOUND'
      });
    }

    const visitor = visitorCheck.rows[0];

    // Begin transaction
    await client.query('BEGIN');

    // 1. Insert check-in record
    // Using confirmed schema columns:
    // - terminal = terminal_no (TEXT, not terminal_id)
    // - checkin_type = 'entry'
    // - staff_id = organizer_id
    // - checkin_time = NOW()
    const checkinResult = await client.query(
      `INSERT INTO checkins (
         visitor_id, 
         expo_id, 
         terminal, 
         hall, 
         notes, 
         checkin_type, 
         staff_id, 
         source,
         checkin_time
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, checkin_time`,
      [
        visitor_id,
        expoId,
        terminalNo,      // terminal column = terminal_no (TEXT)
        hall,
        notes || null,
        'entry',         // checkin_type
        organizerId,     // staff_id = organizer_id
        'terminal'       // source to identify terminal check-ins
      ]
    );

    const checkin = checkinResult.rows[0];

    // 2. Upsert visitor_event_status to 'checked_in'
    await client.query(
      `INSERT INTO visitor_event_status (visitor_id, expo_id, status, created_at, updated_at)
       VALUES ($1, $2, 'checked_in', NOW(), NOW())
       ON CONFLICT (visitor_id, expo_id)
       DO UPDATE SET 
         status = 'checked_in',
         updated_at = NOW()`,
      [visitor_id, expoId]
    );

    // Get updated check-in count
    const countResult = await client.query(
      `SELECT COUNT(*) AS checkin_count
       FROM checkins
       WHERE visitor_id = $1 AND expo_id = $2`,
      [visitor_id, expoId]
    );

    const checkinCount = parseInt(countResult.rows[0].checkin_count, 10);

    // Commit transaction
    await client.query('COMMIT');

    return res.json({
      success: true,
      checkin: {
        id: checkin.id,
        visitorId: visitor_id,
        visitorName: visitor.name,
        visitorLastName: visitor.last_name,
        visitorEmail: visitor.email,
        visitorCompany: visitor.company,
        expoId: expoId,
        terminal: terminalNo,
        hall: hall,
        checkinType: 'entry',
        checkinTime: checkin.checkin_time,
        checkinCount: checkinCount,
        isRevisit: checkinCount > 1
      }
    });
  } catch (err) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('[terminal/checkin] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to record check-in',
      code: 'CHECKIN_ERROR'
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/terminal/status
 * 
 * Health check / terminal info endpoint
 * Returns terminal configuration
 * Useful for terminal app startup validation
 */
router.get('/status', async (req, res) => {
  try {
    const terminal = req.terminal;

    return res.json({
      success: true,
      terminal: {
        id: terminal.id,
        hall: terminal.hall,
        terminalNo: terminal.terminalNo,
        expoId: terminal.expoId,
        autoCheckin: terminal.autoCheckin
      }
    });
  } catch (err) {
    console.error('[terminal/status] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to get terminal status',
      code: 'STATUS_ERROR'
    });
  }
});

module.exports = router;
