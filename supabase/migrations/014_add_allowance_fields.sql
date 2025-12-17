-- Add allowance fields to estimate_line_items table
-- This migration adds support for allowance line items that bypass the pricing engine

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS is_allowance BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS allowance_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS subcontractor TEXT,
  ADD COLUMN IF NOT EXISTS allowance_notes TEXT;

-- Create index for is_allowance to speed up queries that filter allowance items
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_is_allowance 
  ON public.estimate_line_items(is_allowance) 
  WHERE is_allowance = true;

-- Add comment to document the allowance fields
COMMENT ON COLUMN public.estimate_line_items.is_allowance IS 'If true, this line item is an allowance and bypasses the pricing engine. client_price = allowance_amount automatically.';
COMMENT ON COLUMN public.estimate_line_items.allowance_amount IS 'The allowance amount for this line item. Used when is_allowance = true.';
COMMENT ON COLUMN public.estimate_line_items.subcontractor IS 'Subcontractor name for allowance items (e.g., "Pacific Hearth & Home").';
COMMENT ON COLUMN public.estimate_line_items.allowance_notes IS 'Additional notes or context about the allowance.';



