-- Create proposals table for the Proposals feature
-- Proposals are generated from estimates and track proposal lifecycle

CREATE TABLE IF NOT EXISTS public.proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estimate_id UUID REFERENCES public.estimates(id),
  version INT DEFAULT 1,
  title TEXT DEFAULT 'Construction Proposal',
  total_price NUMERIC(12,2),  -- Snapshot of the total at creation time
  body_json JSONB,            -- Stores { allowances: [], inclusions: [], exclusions: [], basis_of_estimate: "", notes: "" }
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Create proposal_events table for tracking proposal lifecycle events
CREATE TABLE IF NOT EXISTS public.proposal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'sent', 'approved', 'revised')),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_proposals_project_id 
  ON public.proposals(project_id);

CREATE INDEX IF NOT EXISTS idx_proposals_estimate_id 
  ON public.proposals(estimate_id);

CREATE INDEX IF NOT EXISTS idx_proposals_status 
  ON public.proposals(status);

CREATE INDEX IF NOT EXISTS idx_proposals_created_at 
  ON public.proposals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proposal_events_proposal_id 
  ON public.proposal_events(proposal_id);

CREATE INDEX IF NOT EXISTS idx_proposal_events_event_type 
  ON public.proposal_events(event_type);

CREATE INDEX IF NOT EXISTS idx_proposal_events_created_at 
  ON public.proposal_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for proposals
-- Users can only view proposals for projects they own
CREATE POLICY "Users can view proposals for their projects"
  ON public.proposals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can insert proposals for projects they own
CREATE POLICY "Users can insert proposals for their projects"
  ON public.proposals
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can update proposals for projects they own
CREATE POLICY "Users can update proposals for their projects"
  ON public.proposals
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can delete proposals for projects they own
CREATE POLICY "Users can delete proposals for their projects"
  ON public.proposals
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for proposal_events
-- Users can only view events for proposals they own (through projects)
CREATE POLICY "Users can view proposal events for their proposals"
  ON public.proposal_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals
      JOIN public.projects ON projects.id = proposals.project_id
      WHERE proposals.id = proposal_events.proposal_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can insert events for proposals they own
CREATE POLICY "Users can insert proposal events for their proposals"
  ON public.proposal_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.proposals
      JOIN public.projects ON projects.id = proposals.project_id
      WHERE proposals.id = proposal_events.proposal_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can update events for proposals they own
CREATE POLICY "Users can update proposal events for their proposals"
  ON public.proposal_events
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals
      JOIN public.projects ON projects.id = proposals.project_id
      WHERE proposals.id = proposal_events.proposal_id
      AND projects.user_id = auth.uid()
    )
  );

-- Users can delete events for proposals they own
CREATE POLICY "Users can delete proposal events for their proposals"
  ON public.proposal_events
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.proposals
      JOIN public.projects ON projects.id = proposals.project_id
      WHERE proposals.id = proposal_events.proposal_id
      AND projects.user_id = auth.uid()
    )
  );

-- Add comments for documentation
COMMENT ON TABLE public.proposals IS 'Construction proposals generated from estimates. Tracks proposal versions, status, and pricing snapshots.';
COMMENT ON COLUMN public.proposals.body_json IS 'JSON structure: { allowances: [], inclusions: [], exclusions: [], basis_of_estimate: "", notes: "" }';
COMMENT ON COLUMN public.proposals.status IS 'Proposal status: draft, sent, approved, or rejected';
COMMENT ON COLUMN public.proposals.total_price IS 'Snapshot of the total proposal price at creation time';
COMMENT ON COLUMN public.proposals.version IS 'Proposal version number, incremented when revised';

COMMENT ON TABLE public.proposal_events IS 'Audit trail of proposal lifecycle events (created, sent, approved, revised).';
COMMENT ON COLUMN public.proposal_events.event_type IS 'Type of event: created, sent, approved, or revised';
COMMENT ON COLUMN public.proposal_events.metadata IS 'Additional event metadata stored as JSON';

