-- Migration 002: Add form_id to reactivation_tokens for design inheritance
-- Date: 2026-04-17

ALTER TABLE reactivation_tokens ADD COLUMN IF NOT EXISTS form_id INTEGER REFERENCES forms(id);
