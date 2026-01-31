-- Create estimate_line_items table for normalized line item data
-- This table is prepared for future AI/analytics work
-- Currently, estimates store line items in json_data, but this table
-- provides a normalized structure for querying and analysis

CREATE TABLE IF NOT EXISTS public.estimate_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  room_name TEXT,
  scope TEXT,
  description TEXT,
  quantity NUMERIC,
  unit TEXT,
  unit_cost NUMERIC,
  total NUMERIC,
  cost_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for estimate_line_items
-- Users can only see line items for their own projects
CREATE POLICY "Users can view line items for their projects"
  ON public.estimate_line_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = estimate_line_items.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert line items for their projects"
  ON public.estimate_line_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = estimate_line_items.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update line items for their projects"
  ON public.estimate_line_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = estimate_line_items.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete line items for their projects"
  ON public.estimate_line_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = estimate_line_items.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate_id ON public.estimate_line_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_project_id ON public.estimate_line_items(project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_cost_code ON public.estimate_line_items(cost_code);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_room_name ON public.estimate_line_items(room_name);

-- Create trigger to update updated_at timestamp
DROP TRIGGER IF EXISTS update_estimate_line_items_updated_at ON public.estimate_line_items;
CREATE TRIGGER update_estimate_line_items_updated_at
  BEFORE UPDATE ON public.estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


