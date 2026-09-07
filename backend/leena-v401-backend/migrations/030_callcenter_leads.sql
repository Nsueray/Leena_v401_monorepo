-- Migration 030: call-center dialer module — new isolated table
-- Stage 2 per docs/sessions/CALLCENTER_DESIGN_20260907.md
--
-- Zero FKs to existing tables (email + expo_id are the soft join keys —
-- matches the wizard's excel-lead pattern where visitor_id is deliberately
-- NULL for cold contacts). Isolated table means a future DROP or a lead
-- INSERT/DELETE never blocks or touches visitors/reactivation_tokens/etc.
--
-- CHECK constraint on `outcome` is the UNION across all segments. Segment-
-- specific restriction is enforced at the app layer (agent card shows a
-- shorter list per segment) — Suer 7 Sep for segment B: will_come /
-- wont_come / callback / no_answer / wrong_number. "will_come" and
-- "wont_come" reuse mail_will_come / mail_wont_come codes so the outcome
-- catalog stays one flat list; label differs per segment in the UI only.
--
-- Idempotent (IF NOT EXISTS) — safe to re-run in Render Shell.

CREATE TABLE IF NOT EXISTS callcenter_leads (
  id                   SERIAL PRIMARY KEY,

  -- Segment: 'A' = campaign 78 activate (has token), 'B' = already-registered
  -- warm-call, 'C' = campaign 79 cold register. Set by the import script.
  segment              VARCHAR(1) NOT NULL CHECK (segment IN ('A','B','C')),

  -- Import provenance (R4 forward-compat with a future admin build action)
  source               VARCHAR(50) NOT NULL DEFAULT 'xlsx_20260907',
  list_id              INTEGER,       -- reserved for future admin build action; NULL for xlsx imports
  expo_id              INTEGER NOT NULL,

  -- Contact
  email                TEXT NOT NULL,
  phone                TEXT NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  company              TEXT,
  country              TEXT,

  -- Segment-A only: reactivation token for the URL + resend
  reactivation_token   TEXT,          -- NULL for B, C; populated for A at import from reactivation_tokens.token

  -- Lifecycle
  status               VARCHAR(20) NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','claimed','done','callback','skipped')),
  claimed_by           TEXT,          -- ?agent=<Name> value
  claimed_at           TIMESTAMPTZ,
  done_at              TIMESTAMPTZ,
  outcome              VARCHAR(30)
                       CHECK (outcome IS NULL OR outcome IN (
                         'mail_will_come','mail_wont_come','no_mail_whatsapp_sent',
                         'callback','no_answer','wrong_number','not_interested',
                         'registered_meanwhile'
                       )),
  note                 TEXT,
  callback_at          TIMESTAMPTZ,   -- when 'callback' outcome + snooze; row re-eligible after this

  -- Audit
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast claim query (R7 — atomic pick from pool)
CREATE INDEX IF NOT EXISTS idx_callcenter_leads_pool
  ON callcenter_leads (status, segment)
  WHERE status IN ('new','callback');

-- Callback due-time filter
CREATE INDEX IF NOT EXISTS idx_callcenter_leads_callback
  ON callcenter_leads (callback_at)
  WHERE status = 'callback';

-- Registration reconciliation (R5 — auto-close on /next if email now has a visitor row)
CREATE INDEX IF NOT EXISTS idx_callcenter_leads_email_expo
  ON callcenter_leads (expo_id, lower(email));

-- Per-agent stats
CREATE INDEX IF NOT EXISTS idx_callcenter_leads_agent
  ON callcenter_leads (claimed_by, done_at)
  WHERE done_at IS NOT NULL;

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'callcenter_leads'
ORDER BY ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'callcenter_leads'
ORDER BY indexname;

-- Expect: 18 columns, 5 indexes (pkey + 4 named above)
