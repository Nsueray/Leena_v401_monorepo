-- =====================================================
-- Migration: 004_sequence_campaigns.sql
-- Purpose: Email Sequence Campaign module tables
-- Date: 2026-04-24
-- Module: v403 Email Campaigns
--
-- Tables: email_campaigns, campaign_steps, campaign_recipients,
--         email_events, email_unsubscribes
-- Extensions: email_queue gets 4 nullable campaign columns
--
-- Run: psql $DATABASE_INTERNAL_URL -f migrations/004_sequence_campaigns.sql
-- Rollback: migrations/004_sequence_campaigns_rollback.sql
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- Table: email_campaigns
-- Purpose: Campaign definitions
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_campaigns (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES organizers(id),
  expo_id INTEGER REFERENCES expos(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft',
    -- draft: being edited
    -- active: sending
    -- paused: user paused
    -- completed: all steps done for all recipients
    -- archived: hidden from default list
  total_recipients INTEGER DEFAULT 0,
  total_sent INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON email_campaigns(organizer_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_expo ON email_campaigns(expo_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns(status);

-- -----------------------------------------------------
-- Table: campaign_steps
-- Purpose: Individual steps in a campaign sequence
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_steps (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  template_id INTEGER REFERENCES email_templates(id),
  delay_hours INTEGER DEFAULT 0,
    -- Hours to wait after PREVIOUS step was sent to THIS recipient
    -- Step 1 always delay_hours=0 (sent immediately on campaign start)
  condition VARCHAR(30) DEFAULT 'all',
    -- 'all': send to everyone regardless of prior behavior
    -- 'not_opened': send only if recipient didn't open the previous step
    -- 'opened': send only if recipient opened the previous step
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_steps_campaign ON campaign_steps(campaign_id);

-- -----------------------------------------------------
-- Table: campaign_recipients
-- Purpose: Per-recipient tracking within a campaign
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  company VARCHAR(255),
  visitor_id INTEGER REFERENCES visitors(id),
    -- NULL if recipient came from CSV and isn't in visitors table
  current_step INTEGER DEFAULT 0,
    -- 0 = not started
    -- N = step N has been sent (or skipped due to condition)
  status VARCHAR(30) DEFAULT 'active',
    -- active: campaign is running for this recipient
    -- completed: all applicable steps processed
    -- unsubscribed: recipient opted out mid-campaign
    -- bounced: email hard-bounced (Phase 2 when webhook ready)
  last_step_sent_at TIMESTAMPTZ,
    -- Used to calculate when next step becomes eligible
  next_step_due_at TIMESTAMPTZ,
    -- Pre-computed: when should the next step be evaluated
  extra_fields JSONB DEFAULT '{}',
    -- Any additional fields from CSV for template placeholders
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_email ON campaign_recipients(email);
CREATE INDEX IF NOT EXISTS idx_recipients_status ON campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_recipients_due ON campaign_recipients(next_step_due_at)
  WHERE status = 'active';

-- -----------------------------------------------------
-- Table: email_events
-- Purpose: Track opens, clicks (phase 2), sends for campaign emails
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER REFERENCES email_campaigns(id) ON DELETE CASCADE,
  recipient_id INTEGER REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES campaign_steps(id),
  email VARCHAR(255) NOT NULL,
  event_type VARCHAR(20) NOT NULL,
    -- 'sent': email handed to SendGrid
    -- 'opened': tracking pixel loaded
    -- 'clicked': (phase 2, link clicked)
    -- 'bounced': (phase 2, SendGrid webhook)
    -- 'unsubscribed': recipient opted out
  user_agent TEXT,
  ip_address VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_campaign ON email_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_events_recipient ON email_events(recipient_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_email_type ON email_events(email, event_type);

-- -----------------------------------------------------
-- Table: email_unsubscribes
-- Purpose: Unsubscribe list for campaign emails only
-- Does NOT affect transactional emails (badge, registration, certificates)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  organizer_id INTEGER REFERENCES organizers(id),
  expo_id INTEGER REFERENCES expos(id),
  campaign_id INTEGER REFERENCES email_campaigns(id),
    -- Which campaign triggered the unsubscribe (for analytics)
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, organizer_id)
);

CREATE INDEX IF NOT EXISTS idx_unsub_email ON email_unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_unsub_org ON email_unsubscribes(organizer_id);

-- -----------------------------------------------------
-- Extend email_queue with campaign references
-- All new columns are nullable — existing rows unaffected
-- Worker ignores these when NULL (backward compatible)
-- -----------------------------------------------------
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES email_campaigns(id);
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS campaign_step_id INTEGER REFERENCES campaign_steps(id);
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS campaign_recipient_id INTEGER REFERENCES campaign_recipients(id);
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS email_event_id INTEGER;
  -- Points to the 'sent' event in email_events
  -- Used for tracking pixel URL construction

CREATE INDEX IF NOT EXISTS idx_queue_campaign ON email_queue(campaign_id)
  WHERE campaign_id IS NOT NULL;

COMMIT;
