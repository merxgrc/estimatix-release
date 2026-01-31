-- Add cost breakdown fields to estimate_line_items
-- Adds material_cost, overhead_cost, direct_cost, and task_library_id columns
-- Note: labor_cost, margin_percent, and client_price already exist from migration 007

ALTER TABLE public.estimate_line_items
    ADD COLUMN IF NOT EXISTS material_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS overhead_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS direct_cost DECIMAL(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS task_library_id UUID REFERENCES task_library(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS matched_via VARCHAR(20);

-- Update existing columns to use DECIMAL(12,2) for consistency
-- (These may already exist, but ensure they have the right precision)
ALTER TABLE public.estimate_line_items
    ALTER COLUMN labor_cost TYPE DECIMAL(12,2) USING labor_cost::DECIMAL(12,2),
    ALTER COLUMN margin_percent TYPE DECIMAL(5,2) USING margin_percent::DECIMAL(5,2),
    ALTER COLUMN client_price TYPE DECIMAL(12,2) USING client_price::DECIMAL(12,2);

-- Backfill direct_cost for existing rows if possible
UPDATE public.estimate_line_items
SET direct_cost = COALESCE(labor_cost, 0) + COALESCE(material_cost, 0) + COALESCE(overhead_cost, 0)
WHERE direct_cost = 0 OR direct_cost IS NULL;

