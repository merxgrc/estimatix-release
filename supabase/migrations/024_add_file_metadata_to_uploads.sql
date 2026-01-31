-- Migration: Add file_type and tag columns to uploads table for unified Files tab
-- This migration enhances the uploads table to support the new unified Files feature

-- Step 1: Add file_type column (auto-detected: 'pdf', 'image', 'audio', 'other')
ALTER TABLE uploads 
ADD COLUMN IF NOT EXISTS file_type TEXT;

-- Step 2: Add tag column (user-selectable: 'blueprint', 'spec', 'photo', 'other')
-- Default to mapping existing 'kind' values to new 'tag' values
ALTER TABLE uploads 
ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'other';

-- Step 3: Migrate existing data
-- Map existing 'kind' values to 'tag' values
UPDATE uploads 
SET tag = CASE 
  WHEN kind = 'photo' THEN 'photo'
  WHEN kind = 'blueprint' THEN 'blueprint'
  WHEN kind = 'audio' THEN 'other'
  ELSE 'other'
END
WHERE tag IS NULL;

-- Step 4: Infer file_type from file_url for existing records
-- Extract extension from file_url and map to file_type
UPDATE uploads
SET file_type = CASE
  WHEN file_url ILIKE '%.pdf' THEN 'pdf'
  WHEN file_url ILIKE '%.jpg' OR file_url ILIKE '%.jpeg' OR file_url ILIKE '%.png' OR file_url ILIKE '%.gif' OR file_url ILIKE '%.webp' THEN 'image'
  WHEN file_url ILIKE '%.mp3' OR file_url ILIKE '%.wav' OR file_url ILIKE '%.webm' OR file_url ILIKE '%.m4a' THEN 'audio'
  WHEN file_url ILIKE '%.mp4' OR file_url ILIKE '%.mov' OR file_url ILIKE '%.avi' THEN 'video'
  ELSE 'other'
END
WHERE file_type IS NULL;

-- Step 5: Set default for tag column
ALTER TABLE uploads 
ALTER COLUMN tag SET DEFAULT 'other';

-- Step 6: Add constraint to ensure tag is one of the valid values
ALTER TABLE uploads 
ADD CONSTRAINT uploads_tag_check 
CHECK (tag IN ('blueprint', 'spec', 'photo', 'other'));

-- Step 7: Add constraint to ensure file_type is one of the valid values
ALTER TABLE uploads 
ADD CONSTRAINT uploads_file_type_check 
CHECK (file_type IN ('pdf', 'image', 'audio', 'video', 'other') OR file_type IS NULL);

-- Step 8: Create index for tag for faster filtering
CREATE INDEX IF NOT EXISTS idx_uploads_tag ON uploads(tag);

-- Step 9: Create index for file_type for faster filtering
CREATE INDEX IF NOT EXISTS idx_uploads_file_type ON uploads(file_type);

-- Note: The 'kind' column is kept for backward compatibility but 'tag' should be used going forward
-- The 'kind' column can be deprecated in a future migration if needed





