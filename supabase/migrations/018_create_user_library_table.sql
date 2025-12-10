-- Create user_library table for Learning Engine
-- Stores user-specific pricing data learned from their usage patterns
-- This table allows the system to learn and reuse prices that users have used before

CREATE TABLE IF NOT EXISTS public.user_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cost_code TEXT NOT NULL,
  description TEXT,
  unit_cost NUMERIC NOT NULL,
  unit TEXT,
  times_used INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create unique constraint on (user_id, cost_code) to prevent duplicates per user
-- Each user can have one entry per cost code
CREATE UNIQUE INDEX IF NOT EXISTS user_library_user_cost_code_unique 
  ON public.user_library(user_id, cost_code);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_library_user_id 
  ON public.user_library(user_id);

CREATE INDEX IF NOT EXISTS idx_user_library_cost_code 
  ON public.user_library(cost_code);

CREATE INDEX IF NOT EXISTS idx_user_library_last_used_at 
  ON public.user_library(last_used_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_library ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_library
-- Users can only see their own library entries
CREATE POLICY "Users can view their own library entries"
  ON public.user_library
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own library entries
CREATE POLICY "Users can insert their own library entries"
  ON public.user_library
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own library entries
CREATE POLICY "Users can update their own library entries"
  ON public.user_library
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own library entries
CREATE POLICY "Users can delete their own library entries"
  ON public.user_library
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add table and column comments for documentation
COMMENT ON TABLE public.user_library IS 'User-specific pricing library for the Learning Engine. Stores prices that users have used, allowing the system to learn and reuse these prices for similar items.';
COMMENT ON COLUMN public.user_library.id IS 'Primary key, UUID';
COMMENT ON COLUMN public.user_library.user_id IS 'Reference to auth.users. Each entry belongs to a specific user.';
COMMENT ON COLUMN public.user_library.cost_code IS 'Cost code used for matching (e.g., "520" for Windows, "406" for Fireplaces). Part of unique constraint with user_id.';
COMMENT ON COLUMN public.user_library.description IS 'User preferred description for this cost code entry.';
COMMENT ON COLUMN public.user_library.unit_cost IS 'The learned/used price per unit. This is the price the user has used for this cost code.';
COMMENT ON COLUMN public.user_library.unit IS 'Unit of measurement (e.g., "SF", "EA", "LF", "SQ", "ROOM")';
COMMENT ON COLUMN public.user_library.times_used IS 'Counter tracking how often this price has been used. Increments each time the price is reused.';
COMMENT ON COLUMN public.user_library.last_used_at IS 'Timestamp of when this price was last used. Updated each time the price is reused.';
COMMENT ON COLUMN public.user_library.created_at IS 'Timestamp of when this library entry was first created.';
COMMENT ON COLUMN public.user_library.updated_at IS 'Timestamp of when this library entry was last updated.';

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at on row updates
CREATE TRIGGER user_library_updated_at
  BEFORE UPDATE ON public.user_library
  FOR EACH ROW
  EXECUTE FUNCTION update_user_library_updated_at();

