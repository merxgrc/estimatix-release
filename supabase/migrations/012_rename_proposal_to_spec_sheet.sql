-- Migration: Rename proposal-related database identifiers to spec-sheet equivalents
-- This migration renames the proposal_url column to spec_sheet_url in the estimates table

-- 1. Rename proposal_url column to spec_sheet_url in estimates table
ALTER TABLE estimates 
  RENAME COLUMN proposal_url TO spec_sheet_url;

-- 2. Create or ensure spec-sheets storage bucket exists
-- Note: Storage buckets cannot be renamed in Supabase, so we create a new one
-- The old "proposals" bucket can be kept for backward compatibility or manually migrated
INSERT INTO storage.buckets (id, name, public) 
VALUES ('spec-sheets', 'spec-sheets', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Create storage policies for spec-sheets bucket
-- Drop existing policies if they exist (in case of re-running migration)
DROP POLICY IF EXISTS "Users can upload spec sheets" ON storage.objects;
DROP POLICY IF EXISTS "Users can view spec sheets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete spec sheets" ON storage.objects;

-- Create storage policies for spec-sheets bucket
-- Allow users to upload spec sheets (PDFs) for their projects
CREATE POLICY "Users can upload spec sheets" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'spec-sheets' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow users to view spec sheets they've uploaded
CREATE POLICY "Users can view spec sheets" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'spec-sheets' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow users to delete spec sheets they've uploaded
CREATE POLICY "Users can delete spec sheets" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'spec-sheets' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- Note: The old "proposals" bucket and its policies are left intact for backward compatibility
-- You may want to manually migrate existing files from "proposals" to "spec-sheets" bucket
-- and then remove the old bucket if desired.






