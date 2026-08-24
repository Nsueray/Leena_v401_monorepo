// middleware/dualAuth.js
//
// Dual authentication for the bulk badge print endpoints (Request #1).
//   - Authorization: Bearer <jwt>  → JWT path, IDENTICAL to middleware/authMiddleware.js
//                                     (no behavior change for existing admin callers)
//   - x-terminal-key <key>         → terminal token path, gated on terminal KIND
//
// The default export keeps the original behaviour exactly: kind must be 'bulk_print'.
// dualAuth.forKinds([...]) builds the same middleware for a different kind allowlist —
// used by the manual-registration route, which is a scanner-desk operation.
//
// terminalAuth.js is intentionally NOT reused here — it stays unchanged for all
// existing scanner / conference-cert / lead routes (zero regression). This
// middleware runs its own terminal lookup.
//
// Terminal path forces expo scope via req.scopedExpoId (handlers must honor it,
// ignoring any client-supplied expo_id). organizer_id is intentionally NOT set
// in terminal mode — existing handler behavior (req.organizer_id || 1) is
// preserved per the single-org simplification (multi-tenant forcing deferred).

const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
require('dotenv').config({ path: '../.env' });

function makeDualAuth(allowedKinds, wrongKindMessage) {
  return async function dualAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const bearer = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // --- JWT path (admin) — byte-identical to authMiddleware ---
    if (bearer) {
      jwt.verify(bearer, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.sendStatus(403); // Forbidden
        }
        req.organizer_id = decoded.organizer_id;
        req.authMode = 'jwt';
        // req.scopedExpoId left undefined → handlers use client expo_id (unchanged)
        next();
      });
      return;
    }

    // --- Terminal token path (bulk_print only) ---
    const terminalKey = req.headers['x-terminal-key'];
    if (terminalKey) {
      try {
        const result = await pool.query(
          `SELECT id, organizer_id, expo_id, hall, terminal_no, kind, is_active
           FROM terminals
           WHERE terminal_key = $1`,
          [terminalKey]
        );

        if (result.rows.length === 0) {
          return res.status(401).json({
            success: false,
            error: 'Invalid terminal key',
            code: 'INVALID_TERMINAL_KEY'
          });
        }

        const terminal = result.rows[0];

        if (!terminal.is_active) {
          return res.status(403).json({
            success: false,
            error: 'Terminal is deactivated',
            code: 'TERMINAL_INACTIVE'
          });
        }

        if (!allowedKinds.includes(terminal.kind)) {
          return res.status(403).json({
            success: false,
            error: wrongKindMessage,
            code: 'WRONG_TERMINAL_KIND'
          });
        }

        req.terminal = {
          id: terminal.id,
          organizerId: terminal.organizer_id,
          expoId: terminal.expo_id,
          hall: terminal.hall,
          terminalNo: terminal.terminal_no,
          kind: terminal.kind
        };
        req.authMode = 'terminal';
        req.scopedExpoId = terminal.expo_id; // force expo scope — client expo_id ignored
        // NOTE: req.organizer_id intentionally NOT set here (single-org simplification).

        return next();
      } catch (err) {
        console.error('[dualAuth] Terminal lookup error:', err.message);
        return res.status(500).json({
          success: false,
          error: 'Terminal authentication failed',
          code: 'TERMINAL_AUTH_ERROR'
        });
      }
    }

    // --- No credentials ---
    return res.sendStatus(401);
  };
}

// Default export — unchanged contract for the bulk badge print endpoints.
const dualAuth = makeDualAuth(['bulk_print'], 'Terminal not authorized for bulk print');

// Factory for other kind allowlists (manual registration uses ['scanner']).
dualAuth.forKinds = makeDualAuth;

module.exports = dualAuth;
