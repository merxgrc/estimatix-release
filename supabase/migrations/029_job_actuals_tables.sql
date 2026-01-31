-- Migration: Job Actuals Tables
-- Creates tables to store actual costs after job completion
--
-- Per PRODUCT_CONTEXT.md Phase 1.5:
-- - Actuals are stored SEPARATELY from estimates (never overwrite)
-- - Actuals can only be entered when estimate.status = 'contract_signed'
-- - Once project is completed, actuals become read-only
-- - This data will later feed pricing intelligence and accuracy tracking

-- =============================================================================
-- STEP 1: Create project_actuals table
-- Stores overall project actuals (summary level)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_id UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  
  -- Cost actuals
  total_actual_cost NUMERIC,
  total_actual_labor_cost NUMERIC,
  total_actual_material_cost NUMERIC,
  
  -- Time actuals
  actual_labor_hours NUMERIC,
  
  -- Variance tracking (computed or entered)
  variance_amount NUMERIC, -- actual - estimated
  variance_percent NUMERIC, -- ((actual - estimated) / estimated) * 100
  
  -- Metadata
  notes TEXT,
  closed_at TIMESTAMPTZ, -- When the project was closed out
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one actuals record per project
  CONSTRAINT project_actuals_project_unique UNIQUE (project_id)
);

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_project_actuals_project_id ON public.project_actuals(project_id);
CREATE INDEX IF NOT EXISTS idx_project_actuals_estimate_id ON public.project_actuals(estimate_id);

-- =============================================================================
-- STEP 2: Create line_item_actuals table
-- Stores per-line-item actuals for detailed tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.line_item_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_actuals_id UUID NOT NULL REFERENCES public.project_actuals(id) ON DELETE CASCADE,
  line_item_id UUID NOT NULL REFERENCES public.estimate_line_items(id) ON DELETE CASCADE,
  
  -- Cost actuals
  actual_unit_cost NUMERIC,
  actual_quantity NUMERIC,
  actual_direct_cost NUMERIC, -- actual_unit_cost * actual_quantity
  actual_labor_cost NUMERIC,
  actual_material_cost NUMERIC,
  
  -- Time actuals
  actual_labor_hours NUMERIC,
  
  -- Variance tracking
  variance_amount NUMERIC,
  variance_percent NUMERIC,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one actuals record per line item
  CONSTRAINT line_item_actuals_line_item_unique UNIQUE (line_item_id)
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_line_item_actuals_project_actuals_id ON public.line_item_actuals(project_actuals_id);
CREATE INDEX IF NOT EXISTS idx_line_item_actuals_line_item_id ON public.line_item_actuals(line_item_id);

-- =============================================================================
-- STEP 3: Enable RLS and create policies
-- =============================================================================

ALTER TABLE public.project_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_item_actuals ENABLE ROW LEVEL SECURITY;

-- project_actuals RLS: SELECT/INSERT/UPDATE only for project owner, NO DELETE
CREATE POLICY "Users can view actuals for their projects"
  ON public.project_actuals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_actuals.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert actuals for their projects"
  ON public.project_actuals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_actuals.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update actuals for their projects"
  ON public.project_actuals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_actuals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- No DELETE policy = actuals cannot be deleted

-- line_item_actuals RLS: SELECT/INSERT/UPDATE only for project owner, NO DELETE
CREATE POLICY "Users can view line item actuals for their projects"
  ON public.line_item_actuals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_actuals pa
      JOIN public.projects p ON p.id = pa.project_id
      WHERE pa.id = line_item_actuals.project_actuals_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert line item actuals for their projects"
  ON public.line_item_actuals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_actuals pa
      JOIN public.projects p ON p.id = pa.project_id
      WHERE pa.id = line_item_actuals.project_actuals_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update line item actuals for their projects"
  ON public.line_item_actuals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_actuals pa
      JOIN public.projects p ON p.id = pa.project_id
      WHERE pa.id = line_item_actuals.project_actuals_id
      AND p.user_id = auth.uid()
    )
  );

-- No DELETE policy = line item actuals cannot be deleted

-- =============================================================================
-- STEP 4: Add updated_at trigger
-- =============================================================================

-- Reuse existing function if available, otherwise create
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_actuals_updated_at
  BEFORE UPDATE ON public.project_actuals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER line_item_actuals_updated_at
  BEFORE UPDATE ON public.line_item_actuals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- COMMENTS: Document the data model for future reference
-- =============================================================================

COMMENT ON TABLE public.project_actuals IS 
'Stores actual costs after job completion.
Actuals are SEPARATE from estimates (never overwrite).
Used for:
- Tracking estimation accuracy
- Building pricing intelligence (future)
- Variance analysis (future)';

COMMENT ON TABLE public.line_item_actuals IS
'Per-line-item actuals for detailed cost tracking.
Links to project_actuals and original line_item.
Enables granular accuracy tracking.';

COMMENT ON COLUMN public.project_actuals.variance_amount IS
'Calculated: total_actual_cost - estimated_total. Can be positive (over budget) or negative (under budget).';

COMMENT ON COLUMN public.project_actuals.variance_percent IS
'Calculated: ((actual - estimated) / estimated) * 100. Shows percentage over/under budget.';
