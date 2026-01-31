-- Migration: Pricing Feedback System (Milestone A)
-- Creates tables for capturing pricing events and user-specific pricing library
-- Supports the waterfall: Manual → User Library → Task Library → AI

-- =============================================================================
-- STEP 1: Create pricing_events table
-- Captures all pricing feedback events for analytics and learning
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pricing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  estimate_id UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  line_item_id UUID REFERENCES public.estimate_line_items(id) ON DELETE SET NULL,
  region TEXT,
  unit TEXT,
  quantity NUMERIC,
  source TEXT NOT NULL CHECK (source IN ('manual', 'user_library', 'task_library', 'ai')),
  matched_task_id UUID REFERENCES public.task_library(id) ON DELETE SET NULL,
  match_confidence NUMERIC,
  suggested_unit_cost NUMERIC,
  final_unit_cost NUMERIC NOT NULL,
  user_action TEXT NOT NULL CHECK (user_action IN ('accepted', 'edited', 'rejected')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes for pricing_events
CREATE INDEX IF NOT EXISTS idx_pricing_events_user_id ON public.pricing_events(user_id);
CREATE INDEX IF NOT EXISTS idx_pricing_events_project_id ON public.pricing_events(project_id);
CREATE INDEX IF NOT EXISTS idx_pricing_events_created_at ON public.pricing_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_events_source ON public.pricing_events(source);
CREATE INDEX IF NOT EXISTS idx_pricing_events_user_action ON public.pricing_events(user_action);

-- Enable RLS for pricing_events
ALTER TABLE public.pricing_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pricing_events
-- Users can only SELECT their own events
CREATE POLICY "Users can view their own pricing events"
  ON public.pricing_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only INSERT their own events
CREATE POLICY "Users can insert their own pricing events"
  ON public.pricing_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE/DELETE from client roles (events are immutable audit log)

-- =============================================================================
-- STEP 2: Add task_key columns to user_cost_library for the new lookup approach
-- This allows lookup by normalized task key instead of just task_library_id
-- =============================================================================

-- Add task_key column if not exists
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS task_key TEXT;

-- Add region column if not exists (for regional pricing)
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS region TEXT;

-- Add usage_count column if not exists
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

-- Add last_used_at column if not exists
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Add notes column if not exists
ALTER TABLE public.user_cost_library
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create unique constraint on (user_id, region, task_key) for upsert
-- Using COALESCE to handle NULL region (treat NULL as empty string for uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_cost_library_user_region_task_key
  ON public.user_cost_library(user_id, COALESCE(region, ''), task_key)
  WHERE task_key IS NOT NULL;

-- Index for task_key lookups
CREATE INDEX IF NOT EXISTS idx_user_cost_library_task_key 
  ON public.user_cost_library(task_key) 
  WHERE task_key IS NOT NULL;

-- Index for region lookups
CREATE INDEX IF NOT EXISTS idx_user_cost_library_region 
  ON public.user_cost_library(region) 
  WHERE region IS NOT NULL;

-- =============================================================================
-- STEP 3: Comments for documentation
-- =============================================================================

COMMENT ON TABLE public.pricing_events IS 'Captures pricing feedback events for analytics. Records when users accept, edit, or reject suggested prices. Used for learning and improving pricing accuracy.';

COMMENT ON COLUMN public.pricing_events.source IS 'Source of the suggested price: manual (user override), user_library (from user saved prices), task_library (from master library), ai (AI guess)';
COMMENT ON COLUMN public.pricing_events.user_action IS 'What the user did: accepted (used as-is), edited (changed the value), rejected (explicit reject)';
COMMENT ON COLUMN public.pricing_events.suggested_unit_cost IS 'The unit cost originally suggested by the pricing engine';
COMMENT ON COLUMN public.pricing_events.final_unit_cost IS 'The unit cost after user action (may be same as suggested if accepted)';
COMMENT ON COLUMN public.pricing_events.meta IS 'Additional metadata as JSON (cost_code, description, etc.)';

COMMENT ON COLUMN public.user_cost_library.task_key IS 'Normalized task key for lookup: costCode|description|unit (lowercased, trimmed)';
COMMENT ON COLUMN public.user_cost_library.region IS 'Optional regional identifier for region-specific pricing';
COMMENT ON COLUMN public.user_cost_library.usage_count IS 'Number of times this price has been used/applied';
COMMENT ON COLUMN public.user_cost_library.last_used_at IS 'Timestamp of last usage';
COMMENT ON COLUMN public.user_cost_library.notes IS 'Optional user notes about this price';
