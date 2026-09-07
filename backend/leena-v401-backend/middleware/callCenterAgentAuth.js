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

    // Agent name from query (?agent=Name). Normalisation (Stage 4d, 7 Sep):
    // trim → collapse internal whitespace → uppercase (locale-independent
    // .toUpperCase(), NOT toLocaleUpperCase — Turkish dotted-i must NOT
    // fire here since the accepted-charset regex below is ASCII-only).
    // Every downstream write (callcenter_leads.claimed_by) and every read
    // (per-agent stats) uses the normalised value; the client mirrors the
    // same normalisation on the splash input so what agents see == what
    // the DB stores.
    const rawAgent = String(req.query.agent || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!rawAgent) {
      return res.status(400).json({
        success: false,
        error: 'agent query param required (e.g. ?agent=Nihat)',
        code: 'MISSING_AGENT'
      });
    }
    if (rawAgent.length > 40 || !/^[A-Z][A-Z0-9 _-]{0,40}$/.test(rawAgent)) {
      return res.status(400).json({
        success: false,
        error: 'agent must match /^[A-Z][A-Z0-9 _-]{0,40}$/ after normalisation',
        code: 'INVALID_AGENT'
      });
    }

    // Optional allowlist via CALLCENTER_AGENTS env var (comma-separated).
    // Compared after the same trim/collapse/uppercase normalisation so
    // "nihat" in the env matches "Nihat" from the URL. When the env var
    // is unset OR empty-after-trim, any valid name passes (same as the
    // pre-4d shape). When set, unknown names 400 AGENT_NOT_ALLOWED — the
    // client's splash renders a specific EN/FR/TR toast for this code.
    const allowRaw = String(process.env.CALLCENTER_AGENTS || '').trim();
    if (allowRaw) {
      const allowed = new Set(
        allowRaw.split(',')
          .map(s => s.trim().replace(/\s+/g, ' ').toUpperCase())
          .filter(Boolean)
      );
      if (!allowed.has(rawAgent)) {
        return res.status(400).json({
          success: false,
          error: 'agent name is not on the CALLCENTER_AGENTS list',
          code: 'AGENT_NOT_ALLOWED'
        });
      }
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
