-- Create rooms table for structured room management
-- This migration creates a rooms table and migrates existing room_name text data
-- to the new normalized structure

-- Step 1: Create rooms table
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT, -- e.g., 'bedroom', 'kitchen', 'bathroom', etc.
  area_sqft NUMERIC,
  source TEXT DEFAULT 'manual', -- 'manual', 'migration', 'ai', etc.
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Modify estimate_line_items table
-- Add room_id foreign key (nullable to allow gradual migration)
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL;

-- Add is_active column if it doesn't exist
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Step 3: Data Backfill - Migrate existing room_name text to rooms table
-- This PL/pgSQL block identifies distinct room strings per project and creates room records
DO $$
DECLARE
  room_record RECORD;
  new_room_id UUID;
BEGIN
  -- Loop through each project
  FOR room_record IN
    SELECT DISTINCT
      eli.project_id,
      TRIM(COALESCE(eli.room_name, 'General')) AS room_name
    FROM public.estimate_line_items eli
    WHERE eli.room_name IS NOT NULL
      AND TRIM(eli.room_name) != ''
      AND eli.room_id IS NULL
    GROUP BY eli.project_id, TRIM(COALESCE(eli.room_name, 'General'))
  LOOP
    -- Check if room already exists for this project with this name
    SELECT id INTO new_room_id
    FROM public.rooms
    WHERE project_id = room_record.project_id
      AND name = room_record.room_name
    LIMIT 1;

    -- If room doesn't exist, create it
    IF new_room_id IS NULL THEN
      INSERT INTO public.rooms (project_id, name, source, is_active)
      VALUES (room_record.project_id, room_record.room_name, 'migration', true)
      RETURNING id INTO new_room_id;
    END IF;

    -- Update estimate_line_items to reference the new room
    UPDATE public.estimate_line_items
    SET room_id = new_room_id
    WHERE project_id = room_record.project_id
      AND TRIM(COALESCE(room_name, 'General')) = room_record.room_name
      AND room_id IS NULL;
  END LOOP;

  -- Handle 'General' or NULL room_name cases
  -- Create a 'General' room for each project that has line items without room_name
  FOR room_record IN
    SELECT DISTINCT eli.project_id
    FROM public.estimate_line_items eli
    WHERE (eli.room_name IS NULL OR TRIM(COALESCE(eli.room_name, '')) = '' OR TRIM(eli.room_name) = 'General')
      AND eli.room_id IS NULL
  LOOP
    -- Check if 'General' room already exists for this project
    SELECT id INTO new_room_id
    FROM public.rooms
    WHERE project_id = room_record.project_id
      AND name = 'General'
    LIMIT 1;

    -- If 'General' room doesn't exist, create it
    IF new_room_id IS NULL THEN
      INSERT INTO public.rooms (project_id, name, source, is_active)
      VALUES (room_record.project_id, 'General', 'migration', true)
      RETURNING id INTO new_room_id;
    END IF;

    -- Update estimate_line_items to reference the 'General' room
    UPDATE public.estimate_line_items
    SET room_id = new_room_id
    WHERE project_id = room_record.project_id
      AND (room_name IS NULL OR TRIM(COALESCE(room_name, '')) = '' OR TRIM(room_name) = 'General')
      AND room_id IS NULL;
  END LOOP;
END $$;

-- Step 4: Enable Row Level Security on rooms table
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms table
-- Users can only access rooms for projects they own
CREATE POLICY "Users can view rooms for their projects"
  ON public.rooms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = rooms.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert rooms for their projects"
  ON public.rooms
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = rooms.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update rooms for their projects"
  ON public.rooms
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = rooms.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete rooms for their projects"
  ON public.rooms
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = rooms.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Step 5: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_rooms_project_id ON public.rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON public.rooms(is_active);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_room_id ON public.estimate_line_items(room_id);
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_is_active ON public.estimate_line_items(is_active);

-- Step 6: Create trigger to update updated_at timestamp for rooms
-- First, ensure the update_updated_at_column function exists (it should from previous migrations)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_rooms_updated_at ON public.rooms;
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 7: Add comment for documentation
COMMENT ON TABLE public.rooms IS 'Structured room definitions for projects. Migrated from room_name text field in estimate_line_items.';
COMMENT ON COLUMN public.rooms.source IS 'Origin of room: manual (user-created), migration (from room_name backfill), ai (AI-detected), etc.';




