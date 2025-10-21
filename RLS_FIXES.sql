-- RLS Fixes for Supabase Storage and Database
-- Run this in your Supabase SQL Editor

-- 1. Add user_id column to uploads table
ALTER TABLE uploads ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Update existing uploads to have user_id (if any exist)
-- This will set user_id based on the project's user_id
UPDATE uploads 
SET user_id = projects.user_id 
FROM projects 
WHERE uploads.project_id = projects.id;

-- 3. Make user_id NOT NULL after setting existing records
ALTER TABLE uploads ALTER COLUMN user_id SET NOT NULL;

-- 4. Create index for better performance
CREATE INDEX idx_uploads_user_id ON uploads(user_id);

-- 5. Drop and recreate storage policies for audio-uploads bucket
DROP POLICY IF EXISTS "Users can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own audio files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own audio files" ON storage.objects;

-- 6. Create correct storage policies for audio-uploads bucket
CREATE POLICY "Users can upload audio files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view their own audio files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own audio files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

-- 7. Update uploads table RLS policies to include user_id checks
DROP POLICY IF EXISTS "Users can view uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can insert uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can update uploads for their projects" ON uploads;
DROP POLICY IF EXISTS "Users can delete uploads for their projects" ON uploads;

-- 8. Create new uploads policies with user_id checks
CREATE POLICY "Users can view their own uploads" ON uploads
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own uploads" ON uploads
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own uploads" ON uploads
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploads" ON uploads
    FOR DELETE USING (auth.uid() = user_id);

-- 9. Create additional storage bucket for general uploads (photos, blueprints)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- 10. Create storage policies for general uploads bucket
CREATE POLICY "Users can upload files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view their own files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
