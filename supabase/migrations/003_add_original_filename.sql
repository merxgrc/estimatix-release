-- Add original_filename column to uploads table
-- This stores the original filename that the user uploaded

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS original_filename TEXT;

-- Add index for better performance when querying by filename
CREATE INDEX IF NOT EXISTS idx_uploads_original_filename ON uploads(original_filename);


