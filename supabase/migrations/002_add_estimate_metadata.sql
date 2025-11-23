-- Add metadata columns to estimates table
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS project_address TEXT,
  ADD COLUMN IF NOT EXISTS project_name TEXT,
  ADD COLUMN IF NOT EXISTS project_description TEXT,
  ADD COLUMN IF NOT EXISTS proposal_url TEXT,
  ADD COLUMN IF NOT EXISTS spec_sections JSONB;

