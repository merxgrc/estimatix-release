-- Migration: Fix Hallucinated Cost Codes
-- This script merges invalid cost codes (e.g., "520.001") back to their parent codes (e.g., "520")
-- Run this in Supabase SQL Editor to clean up existing bad data

-- Step 1: Identify and fix cost codes with decimals (e.g., "520.001" -> "520")
UPDATE estimate_line_items
SET cost_code = SPLIT_PART(cost_code, '.', 1)
WHERE cost_code LIKE '%.%'
  AND SPLIT_PART(cost_code, '.', 1) ~ '^[0-9]+$'  -- Ensure parent is numeric
  AND LENGTH(SPLIT_PART(cost_code, '.', 1)) <= 3;  -- Valid code length

-- Step 2: For any remaining invalid codes (not in task_library), set to "999" (Unclassified)
-- First, let's see what invalid codes exist
-- (This is a query to check, not an update - run this first to see what will be changed)

-- Check for codes that don't exist in task_library
SELECT DISTINCT 
  eli.cost_code,
  COUNT(*) as item_count
FROM estimate_line_items eli
LEFT JOIN task_library tl ON eli.cost_code = tl.cost_code
WHERE eli.cost_code IS NOT NULL
  AND tl.cost_code IS NULL
  AND eli.cost_code != '999'  -- Don't count 999 as invalid
GROUP BY eli.cost_code
ORDER BY item_count DESC;

-- Step 3: Update invalid codes to "999" (Unclassified)
-- Only run this AFTER reviewing the results from Step 2
UPDATE estimate_line_items eli
SET cost_code = '999'
WHERE eli.cost_code IS NOT NULL
  AND eli.cost_code != '999'
  AND NOT EXISTS (
    SELECT 1 
    FROM task_library tl 
    WHERE tl.cost_code = eli.cost_code
  );

-- Step 4: Verify the cleanup
-- Check remaining cost codes and their counts
SELECT 
  eli.cost_code,
  COUNT(*) as item_count,
  CASE 
    WHEN tl.cost_code IS NOT NULL THEN 'Valid'
    WHEN eli.cost_code = '999' THEN 'Unclassified (OK)'
    ELSE 'Invalid'
  END as status
FROM estimate_line_items eli
LEFT JOIN task_library tl ON eli.cost_code = tl.cost_code
WHERE eli.cost_code IS NOT NULL
GROUP BY eli.cost_code, tl.cost_code
ORDER BY item_count DESC;

-- Summary: This migration will:
-- 1. Strip decimals from cost codes (520.001 -> 520)
-- 2. Set invalid codes to "999" (Unclassified)
-- 3. Preserve valid codes as-is
