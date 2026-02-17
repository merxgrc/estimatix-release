-- ============================================================================
-- Migration 033: Phase 1 – Complete schema upgrade (SINGLE MIGRATION)
-- ============================================================================
-- Run this ONE migration. It handles everything:
--   1. Adds all missing columns to rooms table
--   2. Backfills rooms.project_id from estimates
--   3. Creates estimate_line_items table
--   4. Adds triggers, indexes, RLS policies
--   5. Backfills rooms.level from room name suffix
--   6. Cleans room names (strips level suffix)
--
-- SAFE TO RE-RUN: All statements use IF NOT EXISTS / IF EXISTS guards.
-- ============================================================================


-- ==========================================================================
-- PART A: ADD MISSING COLUMNS TO ROOMS TABLE
-- ==========================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS type TEXT;

-- level: NULL means unknown (UI shows "Unknown level")
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS level TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS notes TEXT;

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

-- New: provenance tracking for level
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS sheet_label TEXT;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS level_source TEXT;

COMMENT ON COLUMN public.rooms.level IS
  'Building level: "Level 1", "Level 2", "Basement", etc. NULL = unknown.';
COMMENT ON COLUMN public.rooms.sheet_label IS
  'Original blueprint sheet label this room was detected on, e.g. "A1.2 - SECOND FLOOR PLAN".';
COMMENT ON COLUMN public.rooms.level_source IS
  'How level was determined: ''parsed'' (from blueprint), ''manual'' (user set), ''backfilled'' (extracted from name).';


-- ==========================================================================
-- PART B: BACKFILL rooms.project_id FROM estimates
-- ==========================================================================

-- Rooms originally linked to estimates via estimate_id; code needs project_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'estimate_id'
  ) THEN
    EXECUTE '
      UPDATE public.rooms r
      SET project_id = e.project_id
      FROM public.estimates e
      WHERE r.estimate_id = e.id
        AND r.project_id IS NULL
    ';
  END IF;
END $$;

-- Backfill is_active from existing removed_at if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'removed_at'
  ) THEN
    EXECUTE '
      UPDATE public.rooms
      SET is_active = (removed_at IS NULL)
      WHERE is_active = true AND removed_at IS NOT NULL
    ';
  END IF;
END $$;


-- ==========================================================================
-- PART C: BACKFILL rooms.level FROM room name suffix
-- ==========================================================================
-- Rooms like "Office – Level 2" → level = "Level 2", name = "Office"

-- Extract "Level N" from name
UPDATE public.rooms
SET
  level = regexp_replace(name, '^.*\s*[–—-]\s*(Level\s*\d+)\s*$', '\1', 'i'),
  name  = trim(regexp_replace(name, '\s*[–—-]\s*Level\s*\d+\s*$', '', 'i')),
  level_source = 'backfilled'
WHERE name ~* '\s*[–—-]\s*Level\s*\d+\s*$';

-- Extract "Basement"
UPDATE public.rooms
SET level = 'Basement',
    name  = trim(regexp_replace(name, '\s*[–—-]\s*Basement\s*$', '', 'i')),
    level_source = 'backfilled'
WHERE name ~* '\s*[–—-]\s*Basement\s*$';

-- Extract "Garage"
UPDATE public.rooms
SET level = 'Garage',
    name  = trim(regexp_replace(name, '\s*[–—-]\s*Garage\s*$', '', 'i')),
    level_source = 'backfilled'
WHERE name ~* '\s*[–—-]\s*Garage\s*$';

-- Extract "Attic"
UPDATE public.rooms
SET level = 'Attic',
    name  = trim(regexp_replace(name, '\s*[–—-]\s*Attic\s*$', '', 'i')),
    level_source = 'backfilled'
WHERE name ~* '\s*[–—-]\s*Attic\s*$';

-- Extract "Roof"
UPDATE public.rooms
SET level = 'Roof',
    name  = trim(regexp_replace(name, '\s*[–—-]\s*Roof\s*$', '', 'i')),
    level_source = 'backfilled'
WHERE name ~* '\s*[–—-]\s*Roof\s*$';


-- ==========================================================================
-- PART D: CREATE estimate_line_items TABLE
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.estimate_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE,
  room_name TEXT,
  level TEXT,
  scope_group TEXT,

  description TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT 'Other',
  cost_code TEXT,

  quantity NUMERIC,
  unit TEXT DEFAULT 'EA',

  labor_cost NUMERIC,
  material_cost NUMERIC,
  overhead_cost NUMERIC,
  direct_cost NUMERIC,
  margin_percent NUMERIC DEFAULT 0,
  client_price NUMERIC,
  total_cost NUMERIC(12,2) DEFAULT 0,

  unit_labor_cost NUMERIC,
  unit_material_cost NUMERIC,
  unit_total_cost NUMERIC,
  total_direct_cost NUMERIC,

  pricing_source TEXT,
  price_source TEXT,
  task_library_id UUID,
  confidence NUMERIC,

  notes TEXT,
  is_allowance BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  calc_source TEXT NOT NULL DEFAULT 'manual',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT chk_line_item_calc_source
    CHECK (calc_source IN ('manual', 'room_dimensions'))
);


-- ==========================================================================
-- PART E: TRIGGERS
-- ==========================================================================

-- E1: Auto-compute room areas from dimensions
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

-- E2: Auto-compute line item total_cost
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

-- E3: Auto-update updated_at on estimate_line_items
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_line_items_updated_at ON public.estimate_line_items;
CREATE TRIGGER update_line_items_updated_at
  BEFORE UPDATE ON public.estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ==========================================================================
-- PART F: INDEXES
-- ==========================================================================

CREATE INDEX IF NOT EXISTS idx_rooms_project_id ON public.rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_rooms_level ON public.rooms(level);
CREATE INDEX IF NOT EXISTS idx_rooms_project_level ON public.rooms(project_id, level);
CREATE INDEX IF NOT EXISTS idx_rooms_is_in_scope ON public.rooms(is_in_scope) WHERE is_in_scope = false;
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON public.rooms(is_active);

CREATE INDEX IF NOT EXISTS idx_eli_estimate_id ON public.estimate_line_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_eli_project_id ON public.estimate_line_items(project_id);
CREATE INDEX IF NOT EXISTS idx_eli_room_id ON public.estimate_line_items(room_id);
CREATE INDEX IF NOT EXISTS idx_eli_is_active ON public.estimate_line_items(is_active);
CREATE INDEX IF NOT EXISTS idx_eli_level ON public.estimate_line_items(level);
CREATE INDEX IF NOT EXISTS idx_eli_calc_source ON public.estimate_line_items(calc_source) WHERE calc_source = 'room_dimensions';


-- ==========================================================================
-- PART G: ROW LEVEL SECURITY
-- ==========================================================================

ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Line items RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'estimate_line_items' AND policyname = 'Users can view their line items') THEN
    CREATE POLICY "Users can view their line items" ON public.estimate_line_items FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = estimate_line_items.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'estimate_line_items' AND policyname = 'Users can insert line items') THEN
    CREATE POLICY "Users can insert line items" ON public.estimate_line_items FOR INSERT
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = estimate_line_items.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'estimate_line_items' AND policyname = 'Users can update their line items') THEN
    CREATE POLICY "Users can update their line items" ON public.estimate_line_items FOR UPDATE
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = estimate_line_items.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'estimate_line_items' AND policyname = 'Users can delete their line items') THEN
    CREATE POLICY "Users can delete their line items" ON public.estimate_line_items FOR DELETE
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = estimate_line_items.project_id AND projects.user_id = auth.uid()));
  END IF;

  -- Rooms RLS via project_id
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Users can view rooms via project_id') THEN
    CREATE POLICY "Users can view rooms via project_id" ON public.rooms FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = rooms.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Users can insert rooms via project_id') THEN
    CREATE POLICY "Users can insert rooms via project_id" ON public.rooms FOR INSERT
      WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = rooms.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Users can update rooms via project_id') THEN
    CREATE POLICY "Users can update rooms via project_id" ON public.rooms FOR UPDATE
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = rooms.project_id AND projects.user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rooms' AND policyname = 'Users can delete rooms via project_id') THEN
    CREATE POLICY "Users can delete rooms via project_id" ON public.rooms FOR DELETE
      USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = rooms.project_id AND projects.user_id = auth.uid()));
  END IF;
END $$;


-- ==========================================================================
-- PART H: ESTIMATES TABLE — add missing columns
-- ==========================================================================

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS json_data JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS ai_summary TEXT;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    