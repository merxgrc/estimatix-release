-- Add pricing_source column to estimate_line_items table
-- This column tracks the source of pricing data for each line item

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS pricing_source TEXT 
  DEFAULT 'ai'
  CHECK (pricing_source IN ('ai', 'manual', 'library', 'task_library', 'user_library'));

-- Add comment to document the column
COMMENT ON COLUMN public.estimate_line_items.pricing_source IS 'Source of pricing data: ai (AI-generated), manual (user-entered), library (from library), task_library (from task library), user_library (from user library)';

-- Create index for better query performance when filtering by pricing source
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_pricing_source 
  ON public.estimate_line_items(pricing_source);

