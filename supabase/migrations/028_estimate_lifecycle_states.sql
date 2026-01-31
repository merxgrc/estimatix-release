-- Migration: Estimate Lifecycle States
-- Introduces formal estimate states to track pricing data maturity
--
-- Per PRODUCT_CONTEXT.md:
-- - Estimates progress: draft → bid_final → contract_signed → completed
-- - PRICING TRUTH is captured ONLY at:
--   * bid_final: User has finalized their bid pricing
--   * contract_signed: Contract generated and accepted by client
-- - draft prices are NOT treated as truth (still being edited)
-- - completed stage captures actuals for future learning

-- =============================================================================
-- STEP 1: Add status column to estimates table
-- =============================================================================

ALTER TABLE public.estimates 
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

-- Add CHECK constraint for allowed values
ALTER TABLE public.estimates
ADD CONSTRAINT estimates_status_check 
CHECK (status IN ('draft', 'bid_final', 'contract_signed', 'completed'));

-- Add index for status queries
CREATE INDEX IF NOT EXISTS idx_estimates_status ON public.estimates(status);

-- =============================================================================
-- STEP 2: Add status_changed_at for audit trail
-- =============================================================================

ALTER TABLE public.estimates
ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ DEFAULT NOW();

-- =============================================================================
-- STEP 3: Create function to validate state transitions
-- This enforces the allowed transitions at the database level
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_estimate_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- If status hasn't changed, allow the update
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  
  -- Validate allowed transitions:
  -- draft → bid_final
  -- bid_final → contract_signed
  -- contract_signed → completed
  
  IF OLD.status = 'draft' AND NEW.status = 'bid_final' THEN
    NEW.status_changed_at = NOW();
    RETURN NEW;
  ELSIF OLD.status = 'bid_final' AND NEW.status = 'contract_signed' THEN
    NEW.status_changed_at = NOW();
    RETURN NEW;
  ELSIF OLD.status = 'contract_signed' AND NEW.status = 'completed' THEN
    NEW.status_changed_at = NOW();
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid estimate status transition: % → %', OLD.status, NEW.status;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce transitions
DROP TRIGGER IF EXISTS estimate_status_transition_trigger ON public.estimates;
CREATE TRIGGER estimate_status_transition_trigger
  BEFORE UPDATE OF status ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION validate_estimate_status_transition();

-- =============================================================================
-- COMMENTS: Document the lifecycle and pricing truth rules
-- =============================================================================

COMMENT ON COLUMN public.estimates.status IS 
'Estimate lifecycle state: draft → bid_final → contract_signed → completed.
PRICING TRUTH is captured at bid_final and contract_signed stages ONLY.
draft prices are working values, not truth.
completed stage is for capturing actuals post-job.';

COMMENT ON COLUMN public.estimates.status_changed_at IS 
'Timestamp of last status transition for audit purposes.';

COMMENT ON FUNCTION validate_estimate_status_transition() IS
'Enforces allowed estimate status transitions:
- draft → bid_final (user finalizes bid)
- bid_final → contract_signed (contract generated/accepted)
- contract_signed → completed (job finished, actuals collected)
Illegal transitions are rejected with an exception.';
