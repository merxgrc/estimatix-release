-- Migration: Add 'entered' as valid user_action for pricing_events
-- =============================================================================
-- 
-- Phase 1 of Estimatix has NO pricing suggestions. All prices are manually
-- entered by contractors. The existing user_action values assume a suggestion:
--   - 'accepted': user accepted a suggested price
--   - 'edited': user modified a suggested price
--   - 'rejected': user rejected a suggestion entirely
-- 
-- In Phase 1, none of these apply because there's no suggestion to accept/edit/reject.
-- We need a fourth value:
--   - 'entered': user entered a price without any suggestion
-- 
-- This distinction is critical for Phase 2 analytics:
--   - 'entered' events = manual pricing (Phase 1 baseline data)
--   - 'accepted'/'edited'/'rejected' events = suggestion feedback (Phase 2+)
-- 
-- =============================================================================

-- Drop the existing CHECK constraint
ALTER TABLE public.pricing_events
  DROP CONSTRAINT IF EXISTS pricing_events_user_action_check;

-- Add new CHECK constraint with 'entered' option
ALTER TABLE public.pricing_events
  ADD CONSTRAINT pricing_events_user_action_check
  CHECK (user_action IN ('accepted', 'edited', 'rejected', 'entered'));

-- Update comment to reflect new semantics
COMMENT ON COLUMN public.pricing_events.user_action IS 
  'User action: entered (manual entry, no suggestion), accepted (used suggestion as-is), edited (modified suggestion), rejected (explicit reject)';
