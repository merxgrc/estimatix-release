-- Migration: Increase file size limit to 100MB for uploads bucket
-- Phase 1: Support large blueprint/plan PDFs (30-100MB)

-- Update the uploads bucket to allow 100MB files
UPDATE storage.buckets 
SET file_size_limit = 104857600  -- 100MB in bytes
WHERE id = 'uploads';

-- Also update audio-uploads bucket (if needed for large recordings)
UPDATE storage.buckets 
SET file_size_limit = 100000000  -- 100MB in bytes
WHERE id = 'audio-uploads';

-- If uploads bucket doesn't exist yet, create it with the correct limit
INSERT INTO storage.buckets (id, name, public, file_size_limit) 
VALUES ('uploads', 'uploads', true, 104857600)
ON CONFLICT (id) DO UPDATE SET file_size_limit = 104857600;

COMMENT ON TABLE storage.buckets IS 'Storage buckets. uploads bucket supports files up to 100MB for blueprints/plans.';
