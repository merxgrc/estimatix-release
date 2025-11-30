-- Add owner_name and project_address fields to projects table
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS project_address TEXT;


