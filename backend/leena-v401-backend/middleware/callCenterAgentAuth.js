/**
 * Call-Center Agent Authentication Middleware
 * Leena EMS — call-center dialer module (Stage 2, 7 Sep 2026)
 *
 * Header:   x-callcenter-key   must match process.env.CALLCENTER_KEY
 * Query:    ?agent=<Name>      captured into req.agent (trimmed)
 *
 * Modelled 1:1 on middleware/terminalAuth.js — same auth shape (401 on
 * missing / invalid, 500 on error), single-purpose, no framework, no DB
 * lookup (the shared secret comes from env, not from a per-agent table).
 *
 * Isolated: reads process.env only. No cross-imports from other modules.
 */

async function callCenterAgentAuth(req, res, next) {
  try {
    const configured = process.env.CALLCENTER_KEY;
    if (!configured) {
      // Fail closed — refuse every request if the env var is unset,
      // so a mis-configured deploy never accidentally opens the endpoint.
      console.error('[callCenterAgentAuth] CALLCENTER_KEY env var not set — refusing all requests');
      return res.status(503).json({
        success: false,
        error: 'Call-center not configured on this server',
        code: 'CALLCENTER_KEY_NOT_SET'
      });
    }

    const key = req.headers['x-callcenter-key'];
    if (!key) {
      return res.status(401).json({
        success: false,
        error: 'Call-center key required',
        code: 'MISSING_CALLCENTER_KEY'
      });
    }

    if (key !== configured) {
      return res.status(401).json({
        success: false,
        error: 'Invalid call-center key',
        code: 'INVALID_CALLCENTER_KEY'
      });
    }

    // Agent name from query (?agent=Name). Trimmed, length-capped.
    // Character allow-list matches the design's R-1 mitigation.
    const rawAgent = String(req.query.agent || '').trim();
    if (!rawAgent) {
      return res.status(400).json({
        success: false,
        error: 'agent query param required (e.g. ?agent=Nihat)',
        code: 'MISSING_AGENT'
      });
    }
    if (rawAgent.length > 40 || !/^[A-Za-z][A-Za-z0-9 _-]{0,40}$/.test(rawAgent)) {
      return res.status(400).json({
        success: false,
        error: 'agent must match /^[A-Za-z][A-Za-z0-9 _-]{0,40}$/',
        code: 'INVALID_AGENT'
      });
    }

    req.agent = rawAgent;
    next();
  } catch (err) {
    console.error('[callCenterAgentAuth] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Call-center agent authentication failed',
      code: 'CALLCENTER_AGENT_AUTH_ERROR'
    });
  }
}

module.exports = callCenterAgentAuth;
