-- Extend projects table with richer metadata fields
-- This migration adds fields for project details, property info, and job scheduling

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_type TEXT,
  ADD COLUMN IF NOT EXISTS year_built INT,
  ADD COLUMN IF NOT EXISTS home_size_sqft INT,
  ADD COLUMN IF NOT EXISTS lot_size_sqft INT,
  ADD COLUMN IF NOT EXISTS bedrooms INT,
  ADD COLUMN IF NOT EXISTS bathrooms INT,
  ADD COLUMN IF NOT EXISTS job_start_target DATE,
  ADD COLUMN IF NOT EXISTS job_deadline DATE,
  ADD COLUMN IF NOT EXISTS missing_data_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_summary_update TIMESTAMPTZ DEFAULT NOW();

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON public.projects(project_type);
CREATE INDEX IF NOT EXISTS idx_projects_job_start_target ON public.projects(job_start_target);
CREATE INDEX IF NOT EXISTS idx_projects_job_deadline ON public.projects(job_deadline);


