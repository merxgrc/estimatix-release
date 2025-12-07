-- Create selections table for selections + allowances concept
-- Selections are linked to estimates and can be referenced by estimate_line_items

CREATE TABLE IF NOT EXISTS public.selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  cost_code VARCHAR(20),
  room TEXT,
  category TEXT,
  title TEXT NOT NULL,
  description TEXT,
  allowance NUMERIC(12,2),
  suggested_allowance NUMERIC(12,2),
  subcontractor TEXT,
  source TEXT CHECK (source IN ('manual', 'voice', 'ai_text', 'file')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.selections ENABLE ROW LEVEL SECURITY;

-- RLS Policies for selections
-- Users can only see selections for estimates on projects they own
-- Following the same pattern as estimate_line_items (through estimates → projects.user_id)
CREATE POLICY "Users can view selections for their projects"
  ON public.selections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.estimates
      JOIN public.projects ON projects.id = estimates.project_id
      WHERE estimates.id = selections.estimate_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert selections for their projects"
  ON public.selections
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.estimates
      JOIN public.projects ON projects.id = estimates.project_id
      WHERE estimates.id = selections.estimate_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update selections for their projects"
  ON public.selections
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.estimates
      JOIN public.projects ON projects.id = estimates.project_id
      WHERE estimates.id = selections.estimate_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete selections for their projects"
  ON public.selections
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.estimates
      JOIN public.projects ON projects.id = estimates.project_id
      WHERE estimates.id = selections.estimate_id
      AND projects.user_id = auth.uid()
    )
  );

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_selections_estimate_id ON public.selections(estimate_id);
CREATE INDEX IF NOT EXISTS idx_selections_cost_code ON public.selections(cost_code);
CREATE INDEX IF NOT EXISTS idx_selections_room ON public.selections(room);

-- Create trigger to update updated_at timestamp
-- First check if the function exists, create it if not
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_selections_updated_at ON public.selections;
CREATE TRIGGER update_selections_updated_at
  BEFORE UPDATE ON public.selections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update estimate_line_items table to add selection_id and is_allowance columns
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS selection_id UUID REFERENCES public.selections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_allowance BOOLEAN DEFAULT FALSE;

-- Create index for selection_id foreign key lookups
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_selection_id ON public.estimate_line_items(selection_id);

