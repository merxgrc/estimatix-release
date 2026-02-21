-- Migration 035: Add display_name column to uploads table
-- Allows users to rename files in the UI without touching the storage path
-- or the original_filename (which preserves the real uploaded filename).
-- The UI shows display_name when present, otherwise falls back to original_filename.

ALTER TABLE public.uploads
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Index for faster lookups when sorting/filtering by display name
CREATE INDEX IF NOT EXISTS idx_uploads_display_name ON public.uploads(display_name);

-- RLS: allow authenticated users to update display_name on their own uploads
-- (existing UPDATE policy should already cover this if one exists)
