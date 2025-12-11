-- Create contracts table for the Contract Generation feature
-- Contracts are generated from approved proposals/estimates and wrap them in legal agreement structure
CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
  total_price NUMERIC(12,2) NOT NULL,
  down_payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_date DATE,
  completion_date DATE,
  payment_schedule JSONB DEFAULT '[]'::jsonb,
  legal_text JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_contracts_project_id ON public.contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_proposal_id ON public.contracts(proposal_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON public.contracts(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_contracts_updated_at();

-- Enable RLS
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for contracts
CREATE POLICY "Users can view contracts for their projects" ON public.contracts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = contracts.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create contracts for their projects" ON public.contracts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = contracts.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update contracts for their projects" ON public.contracts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = contracts.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete contracts for their projects" ON public.contracts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = contracts.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Add comments for documentation
COMMENT ON TABLE public.contracts IS 'Legal contracts generated from approved proposals/estimates. Wraps proposals in legal agreement structure matching Alliant Builders examples.';
COMMENT ON COLUMN public.contracts.proposal_id IS 'Optional link to the source proposal that was approved';
COMMENT ON COLUMN public.contracts.total_price IS 'Snapshot of the total contract price at creation time';
COMMENT ON COLUMN public.contracts.down_payment IS 'Initial down payment amount required';
COMMENT ON COLUMN public.contracts.payment_schedule IS 'JSON array of payment milestones: [{ "milestone": "string", "amount": number }]';
COMMENT ON COLUMN public.contracts.legal_text IS 'JSON object storing custom overrides for legal clauses (e.g., "Warranty", "Termination", "Right to Cancel")';
COMMENT ON COLUMN public.contracts.status IS 'Contract status: draft, sent, or signed';
COMMENT ON COLUMN public.contracts.start_date IS 'Project start date as specified in the contract';
COMMENT ON COLUMN public.contracts.completion_date IS 'Expected project completion date as specified in the contract';

