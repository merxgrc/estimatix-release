-- ============================================================================
-- Migration 034: Fix missing columns on estimate_line_items
-- ============================================================================
-- Migration 033 used CREATE TABLE IF NOT EXISTS for estimate_line_items.
-- Since the table already existed (from migration 006), the CREATE TABLE
-- was skipped entirely, so columns defined ONLY in 033 were never added.
--
-- This migration adds the missing columns using ALTER TABLE ADD COLUMN IF NOT EXISTS
-- which is safe to re-run.
-- ============================================================================

-- ==========================================================================
-- PART A: Add missing columns to estimate_line_items
-- ==========================================================================

-- calc_source: tracks whether quantity is manual or auto-derived from room dimensions
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS calc_source TEXT NOT NULL DEFAULT 'manual';

-- level: building level denormalized from rooms.level
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS level TEXT;

-- scope_group: optional grouping for display
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS scope_group TEXT;

-- total_cost: auto-computed by trigger
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) DEFAULT 0;

-- unit-level pricing columns (reference)
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS unit_labor_cost NUMERIC;

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS unit_material_cost NUMERIC;

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS unit_total_cost NUMERIC;

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS total_direct_cost NUMERIC;

-- price_source: enum for how the price was determined
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS price_source TEXT;

-- confidence: AI match confidence score
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS confidence NUMERIC;

-- notes: freeform notes per line item
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- unit_cost: may have been dropped in a previous migration, ensure it exists for backward compat
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC;

-- Add constraint for calc_source values (skip if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_line_item_calc_source'
    AND conrelid = 'public.estimate_line_items'::regclass
  ) THEN
    ALTER TABLE public.estimate_line_items
      ADD CONSTRAINT chk_line_item_calc_source
      CHECK (calc_source IN ('manual', 'room_dimensions'));
  END IF;
END $$;

-- Index on calc_source for room_dimensions queries
CREATE INDEX IF NOT EXISTS idx_eli_calc_source
  ON public.estimate_line_items(calc_source)
  WHERE calc_source = 'room_dimensions';


-- ==========================================================================
-- PART B: Ensure rooms table columns exist (safety net)
-- ==========================================================================
-- These should already exist from migration 033 (which used ALTER TABLE),
-- but we add them defensively in case 033 partially failed.

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS level TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS level_source TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS sheet_label TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS length_ft NUMERIC(8,2);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS width_ft NUMERIC(8,2);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS ceiling_height_ft NUMERIC(8,2) DEFAULT 8.0;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS floor_area_sqft NUMERIC(10,2);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS wall_area_sqft NUMERIC(10,2);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS ceiling_area_sqft NUMERIC(10,2);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS is_in_scope BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS area_sqft NUMERIC;

-- Make estimate_id nullable if it was originally NOT NULL
-- (the code only provides project_id now, not estimate_id)
DO $$
BEGIN
  -- Check if estimate_id column exists and has a NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms'
    AND column_name = 'estimate_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.rooms ALTER COLUMN estimate_id DROP NOT NULL;
  END IF;

  -- Make user_id nullable if it was originally NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms'
    AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.rooms ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  -- Make status nullable/defaulted if it was required
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms'
    AND column_name = 'status' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.rooms ALTER COLUMN status DROP NOT NULL;
    ALTER TABLE public.rooms ALTER COLUMN status SET DEFAULT 'active';
  END IF;
END $$;


-- ==========================================================================
-- PART C: Ensure triggers exist
-- ==========================================================================

-- Trigger: auto-compute room areas from dimensions
CREATE OR REPLACE FUNCTION compute_room_areas()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.length_ft IS NOT NULL AND NEW.width_ft IS NOT NULL THEN
    NEW.floor_area_sqft   := ROUND(NEW.length_ft * NEW.width_ft, 2);
    NEW.ceiling_area_sqft := ROUND(NEW.length_ft * NEW.width_ft, 2);
    IF NEW.ceiling_height_ft IS NOT NULL THEN
      NEW.wall_area_sqft := ROUND(
        2.0 * (NEW.length_ft + NEW.width_ft) * NEW.ceiling_height_ft, 2
      );
    ELSE
      NEW.wall_area_sqft := NULL;
    END IF;
  ELSE
    NEW.floor_area_sqft   := NULL;
    NEW.wall_area_sqft    := NULL;
    NEW.ceiling_area_sqft := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_room_areas ON public.rooms;
CREATE TRIGGER trg_compute_room_areas
  BEFORE INSERT OR UPDATE OF length_ft, width_ft, ceiling_height_ft
  ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION compute_room_areas();

-- Trigger: auto-compute line item total_cost
CREATE OR REPLACE FUNCTION compute_line_item_total_cost()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_cost := ROUND(
    (COALESCE(NEW.labor_cost, 0) + COALESCE(NEW.material_cost, 0))
    * (1.0 + COALESCE(NEW.margin_percent, 0) / 100.0),
    2
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_line_item_total_cost ON public.estimate_line_items;
CREATE TRIGGER trg_compute_line_item_total_cost
  BEFORE INSERT OR UPDATE OF labor_cost, material_cost, margin_percent
  ON public.estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION compute_line_item_total_cost();


-- ==========================================================================
-- PART D: Ensure estimates table has required columns
-- ==========================================================================

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS json_data JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS spec_sheet_url TEXT;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS spec_sections JSONB;
