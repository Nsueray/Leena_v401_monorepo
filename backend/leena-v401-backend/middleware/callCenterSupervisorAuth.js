/**
 * Call-Center Supervisor Authentication Middleware
 * Leena EMS — call-center dialer module (Stage 2, 7 Sep 2026)
 *
 * Header: x-callcenter-supervisor-key   must match process.env.CALLCENTER_SUPERVISOR_KEY
 *
 * Read-only surface — supervisor sees per-agent stats and lead activity;
 * no writes are guarded by this middleware in Stage 2 or beyond. No
 * ?agent= param (supervisor is a role, not an individual). Modelled on
 * middleware/callCenterAgentAuth.js with the agent bits removed.
 *
 * Isolated: reads process.env only.
 */

async function callCenterSupervisorAuth(req, res, next) {
  try {
    const configured = process.env.CALLCENTER_SUPERVISOR_KEY;
    if (!configured) {
      console.error('[callCenterSupervisorAuth] CALLCENTER_SUPERVISOR_KEY env var not set — refusing all requests');
      return res.status(503).json({
        success: false,
        error: 'Call-center supervisor not configured on this server',
        code: 'CALLCENTER_SUPERVISOR_KEY_NOT_SET'
      });
    }

    const key = req.headers['x-callcenter-supervisor-key'];
    if (!key) {
      return res.status(401).json({
        success: false,
        error: 'Supervisor key required',
        code: 'MISSING_SUPERVISOR_KEY'
      });
    }

    if (key !== configured) {
      return res.status(401).json({
        success: false,
        error: 'Invalid supervisor key',
        code: 'INVALID_SUPERVISOR_KEY'
      });
    }

    next();
  } catch (err) {
    console.error('[callCenterSupervisorAuth] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Call-center supervisor authentication failed',
      code: 'CALLCENTER_SUPERVISOR_AUTH_ERROR'
    });
  }
}

module.exports = callCenterSupervisorAuth;
