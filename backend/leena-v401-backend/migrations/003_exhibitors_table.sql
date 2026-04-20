-- Migration 003: Exhibitor Management Table
-- Date: 2026-04-20
-- Purpose: Basic exhibitor registry per expo, linked to floor plan stands
-- Note: company_id nullable, no FK constraint — will link to LiFFY companies table in Phase 2 (ADR-014)

CREATE TABLE IF NOT EXISTS expo_exhibitors (
  id SERIAL PRIMARY KEY,
  expo_id INTEGER NOT NULL REFERENCES expos(id) ON DELETE CASCADE,
  organizer_id INTEGER NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  country VARCHAR(100),
  sector VARCHAR(100),
  company_id INTEGER,              -- LiFFY FK (nullable, no constraint — ADR-014)
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expo_exhibitors_expo ON expo_exhibitors(expo_id);
CREATE INDEX idx_expo_exhibitors_organizer ON expo_exhibitors(organizer_id);
CREATE INDEX idx_expo_exhibitors_name ON expo_exhibitors(name);
CREATE INDEX idx_expo_exhibitors_email ON expo_exhibitors(email);

-- Add exhibitor_id to expo_stands (nullable FK)
ALTER TABLE expo_stands ADD COLUMN IF NOT EXISTS exhibitor_id INTEGER REFERENCES expo_exhibitors(id);
CREATE INDEX IF NOT EXISTS idx_expo_stands_exhibitor ON expo_stands(exhibitor_id);
