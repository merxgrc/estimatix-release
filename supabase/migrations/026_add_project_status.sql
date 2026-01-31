-- Migration: Add project status field for job lifecycle management
-- Enables tracking projects through draft -> active -> completed states

-- Step 1: Add status column to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed'));

-- Step 2: Update existing projects to 'active' (assuming they're in progress)
-- You may want to adjust this logic based on your business rules
UPDATE public.projects
SET status = 'active'
WHERE status IS NULL OR status = 'draft';

-- Step 3: Set default for status column
ALTER TABLE public.projects
  ALTER COLUMN status SET DEFAULT 'draft';

-- Step 4: Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

-- Step 5: Add comment for documentation
COMMENT ON COLUMN public.projects.status IS 'Project lifecycle status: draft (planning), active (in progress), completed (finished)';




