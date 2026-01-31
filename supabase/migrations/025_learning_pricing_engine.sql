-- Migration: Learning Pricing Engine
-- Creates tables and updates for the "Always-On" pricing engine that learns from historical data

-- Step 1: Create user_cost_library table (stores historical pricing data)
-- Drop table if it exists to avoid conflicts (only in development - comment out in production)
-- DROP TABLE IF EXISTS public.user_cost_library CASCADE;

CREATE TABLE IF NOT EXISTS public.user_cost_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_library_id UUID REFERENCES public.task_library(id) ON DELETE SET NULL,
  unit_cost NUMERIC NOT NULL,
  is_actual BOOLEAN DEFAULT false, -- true for actual project costs, false for estimates
  source TEXT NOT NULL CHECK (source IN ('estimate', 'actual', 'copilot', 'manual')),
  cost_code TEXT, -- Store for quick lookup even if task_library_id is null
  description TEXT, -- Store for reference
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure cost_code column exists (in case table was created without it)
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS cost_code TEXT;

ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Step 2: Create user_margin_rules table (stores markup preferences)
-- Drop table if it exists to avoid conflicts (only in development - comment out in production)
-- DROP TABLE IF EXISTS public.user_margin_rules CASCADE;

CREATE TABLE IF NOT EXISTS public.user_margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, -- 'all', 'trade:404', 'trade:520', etc.
  margin_percent NUMERIC NOT NULL CHECK (margin_percent >= 0 AND margin_percent <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure one rule per user per scope
  UNIQUE(user_id, scope)
);

-- Ensure scope column exists (in case table was created without it)
ALTER TABLE public.user_margin_rules
  ADD COLUMN IF NOT EXISTS scope TEXT;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_margin_rules_user_id_scope_key'
  ) THEN
    ALTER TABLE public.user_margin_rules
      ADD CONSTRAINT user_margin_rules_user_id_scope_key UNIQUE(user_id, scope);
  END IF;
END $$;

-- Step 3: Update profiles table (add region_factor and quality_tier)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS region_factor NUMERIC DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS quality_tier TEXT DEFAULT 'standard' CHECK (quality_tier IN ('budget', 'standard', 'premium'));

-- Step 4: Update estimate_line_items table (add price_source, ensure margin_percent)
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS price_source TEXT;

-- Add check constraint for price_source if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'estimate_line_items_price_source_check'
  ) THEN
    ALTER TABLE public.estimate_line_items
      ADD CONSTRAINT estimate_line_items_price_source_check 
      CHECK (price_source IN ('manual', 'history', 'seed', 'ai', 'task_library', 'user_library') OR price_source IS NULL);
  END IF;
END $$;

-- Add margin_percent if it doesn't exist
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS margin_percent NUMERIC DEFAULT 30;

-- Add check constraint for margin_percent if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'estimate_line_items_margin_percent_check'
  ) THEN
    ALTER TABLE public.estimate_line_items
      ADD CONSTRAINT estimate_line_items_margin_percent_check 
      CHECK (margin_percent >= 0 AND margin_percent <= 100);
  END IF;
END $$;

-- Step 5: Create indexes for performance
-- Only create indexes if the columns exist
CREATE INDEX IF NOT EXISTS idx_user_cost_library_user_id ON public.user_cost_library(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cost_library_task_library_id ON public.user_cost_library(task_library_id);
-- Create cost_code index only if column exists (check via DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_cost_library' 
    AND column_name = 'cost_code'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_cost_library_cost_code ON public.user_cost_library(cost_code);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_user_cost_library_is_actual ON public.user_cost_library(is_actual);
CREATE INDEX IF NOT EXISTS idx_user_margin_rules_user_id ON public.user_margin_rules(user_id);
-- Create scope index only if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_margin_rules' 
    AND column_name = 'scope'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_margin_rules_scope ON public.user_margin_rules(scope);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_price_source ON public.estimate_line_items(price_source);

-- Step 6: Enable Row Level Security
ALTER TABLE public.user_cost_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_margin_rules ENABLE ROW LEVEL SECURITY;

-- Step 7: RLS Policies for user_cost_library
CREATE POLICY "Users can view their own cost library" ON public.user_cost_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own cost library" ON public.user_cost_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own cost library" ON public.user_cost_library
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cost library" ON public.user_cost_library
  FOR DELETE USING (auth.uid() = user_id);

-- Step 8: RLS Policies for user_margin_rules
CREATE POLICY "Users can view their own margin rules" ON public.user_margin_rules
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own margin rules" ON public.user_margin_rules
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own margin rules" ON public.user_margin_rules
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own margin rules" ON public.user_margin_rules
  FOR DELETE USING (auth.uid() = user_id);

-- Step 9: Create function to update updated_at timestamp (if it doesn't exist)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 10: Create triggers for updated_at
CREATE TRIGGER update_user_cost_library_updated_at
  BEFORE UPDATE ON public.user_cost_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_margin_rules_updated_at
  BEFORE UPDATE ON public.user_margin_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 11: Create function to calculate median unit_cost for a task_library_id
-- This will be used by the pricing service
CREATE OR REPLACE FUNCTION get_median_unit_cost(
  p_user_id UUID,
  p_task_library_id UUID,
  p_is_actual BOOLEAN DEFAULT true
)
RETURNS NUMERIC AS $$
DECLARE
  v_median NUMERIC;
BEGIN
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_cost)
  INTO v_median
  FROM public.user_cost_library
  WHERE user_id = p_user_id
    AND task_library_id = p_task_library_id
    AND is_actual = p_is_actual;
  
  RETURN v_median;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 12: Add comments for documentation
COMMENT ON TABLE public.user_cost_library IS 'Historical pricing data for learning pricing engine. Stores actual costs and estimates to calculate median pricing.';
COMMENT ON TABLE public.user_margin_rules IS 'User-defined markup rules. Scope can be "all" for default, or "trade:CODE" for trade-specific margins.';
COMMENT ON COLUMN public.profiles.region_factor IS 'Regional cost multiplier (e.g., 1.2 for high-cost areas, 0.9 for low-cost areas). Default 1.0.';
COMMENT ON COLUMN public.profiles.quality_tier IS 'Quality tier multiplier: budget (0.9x), standard (1.0x), premium (1.2x).';
COMMENT ON COLUMN public.estimate_line_items.price_source IS 'Source of pricing: manual (user-set), history (from user_cost_library), seed (from task_library), ai (AI-generated).';
COMMENT ON COLUMN public.estimate_line_items.margin_percent IS 'Markup percentage applied to direct_cost to calculate client_price. Default 30%.';




