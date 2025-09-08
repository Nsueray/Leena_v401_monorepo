
-- Add password_hash column
ALTER TABLE organizers ADD COLUMN password_hash TEXT;

-- Insert a test organizer
INSERT INTO organizers (name, email, logo_url, password_hash)
VALUES (
  'Test Organizer',
  'organizer@example.com',
  'https://example.com/logo.png',
  '$2b$12$IcRZBwX23w9j.JaLCU.OdeH0xl/LBCdZTMd0jAOczmox2OMUsM94a'
);
