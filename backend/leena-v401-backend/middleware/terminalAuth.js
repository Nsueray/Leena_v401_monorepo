/**
 * Terminal Authentication Middleware
 * Leena EMS v402 Mini
 * 
 * Authenticates terminals using terminal_key (tokenless auth)
 * Completely separate from JWT-based admin authentication
 */

const pool = require('../utils/db');

/**
 * Middleware to authenticate terminal requests
 * Expects header: x-terminal-key
 * 
 * On success, attaches terminal info to req.terminal
 * On failure, returns 401 or 403
 */
async function terminalAuth(req, res, next) {
  try {
    const terminalKey = req.headers['x-terminal-key'];

    // Check if terminal key header is provided
    if (!terminalKey) {
      return res.status(401).json({
        success: false,
        error: 'Terminal key required',
        code: 'MISSING_TERMINAL_KEY'
      });
    }

    // Look up terminal by key
    const result = await pool.query(
      `SELECT id, organizer_id, expo_id, hall, terminal_no, auto_checkin, is_active
       FROM terminals
       WHERE terminal_key = $1`,
      [terminalKey]
    );

    // Terminal not found
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid terminal key',
        code: 'INVALID_TERMINAL_KEY'
      });
    }

    const terminal = result.rows[0];

    // Check if terminal is active
    if (!terminal.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Terminal is deactivated',
        code: 'TERMINAL_INACTIVE'
      });
    }

    // Attach terminal info to request object
    // Using exact column names from confirmed schema
    req.terminal = {
      id: terminal.id,
      organizerId: terminal.organizer_id,
      expoId: terminal.expo_id,
      hall: terminal.hall,
      terminalNo: terminal.terminal_no,
      autoCheckin: terminal.auto_checkin
    };

    next();
  } catch (err) {
    console.error('[terminalAuth] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Terminal authentication failed',
      code: 'TERMINAL_AUTH_ERROR'
    });
  }
}

module.exports = terminalAuth;
