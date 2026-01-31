-- Update estimate_line_items table structure
-- Add new columns for labor_cost, margin_percent, client_price
-- Remove old columns: unit_cost, total

-- Add new columns
ALTER TABLE public.estimate_line_items
    ADD COLUMN IF NOT EXISTS labor_cost NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS margin_percent NUMERIC DEFAULT 30,
    ADD COLUMN IF NOT EXISTS client_price NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS category TEXT;

-- Backfill client_price from existing data if possible
-- Calculate client_price = labor_cost * (1 + margin_percent/100)
UPDATE public.estimate_line_items
SET client_price = labor_cost * (1 + margin_percent/100)
WHERE client_price = 0 AND labor_cost > 0;

-- Note: We'll remove unit_cost and total columns after confirming the UI migration works
-- Uncomment these lines once you've verified the new structure works:
-- ALTER TABLE public.estimate_line_items
--     DROP COLUMN IF EXISTS unit_cost,
--     DROP COLUMN IF EXISTS total;

