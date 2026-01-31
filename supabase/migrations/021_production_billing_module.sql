-- Production Billing Module
-- Creates project_tasks, invoices, and invoice_items tables for Scope Tracking and Invoicing

-- Create project_tasks table (The "Real" work - snapshot of job scope from estimate_line_items)
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  original_line_item_id UUID REFERENCES public.estimate_line_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed')),
  completion_date TIMESTAMPTZ,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  billed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date DATE,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Create invoice_items table (Linking Invoices to Work)
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.project_tasks(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON public.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON public.project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_original_line_item_id ON public.project_tasks(original_line_item_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_completion_date ON public.project_tasks(completion_date);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON public.invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON public.invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_date ON public.invoices(issued_date);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_task_id ON public.invoice_items(task_id);

-- Create function to generate invoice numbers (e.g., "INV-1001")
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  invoice_num TEXT;
BEGIN
  -- Get the next sequential number
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 'INV-(\d+)') AS INTEGER)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number ~ '^INV-\d+$';
  
  -- Format as INV-XXXX
  invoice_num := 'INV-' || LPAD(next_num::TEXT, 4, '0');
  
  RETURN invoice_num;
END;
$$ LANGUAGE plpgsql;

-- Create function to update updated_at timestamp for project_tasks
CREATE OR REPLACE FUNCTION update_project_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at for project_tasks
CREATE TRIGGER update_project_tasks_updated_at
  BEFORE UPDATE ON public.project_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_project_tasks_updated_at();

-- Create function to update updated_at timestamp for invoices
CREATE OR REPLACE FUNCTION update_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at for invoices
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_invoices_updated_at();

-- Enable RLS
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for project_tasks
CREATE POLICY "Users can view tasks for their projects" ON public.project_tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_tasks.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tasks for their projects" ON public.project_tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_tasks.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tasks for their projects" ON public.project_tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_tasks.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tasks for their projects" ON public.project_tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_tasks.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for invoices
CREATE POLICY "Users can view invoices for their projects" ON public.invoices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = invoices.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create invoices for their projects" ON public.invoices
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = invoices.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoices for their projects" ON public.invoices
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = invoices.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete invoices for their projects" ON public.invoices
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = invoices.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for invoice_items
CREATE POLICY "Users can view invoice items for their projects" ON public.invoice_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      JOIN public.projects ON projects.id = invoices.project_id
      WHERE invoices.id = invoice_items.invoice_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create invoice items for their projects" ON public.invoice_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices
      JOIN public.projects ON projects.id = invoices.project_id
      WHERE invoices.id = invoice_items.invoice_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoice items for their projects" ON public.invoice_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      JOIN public.projects ON projects.id = invoices.project_id
      WHERE invoices.id = invoice_items.invoice_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete invoice items for their projects" ON public.invoice_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      JOIN public.projects ON projects.id = invoices.project_id
      WHERE invoices.id = invoice_items.invoice_id
      AND projects.user_id = auth.uid()
    )
  );

-- Add comments for documentation
COMMENT ON TABLE public.project_tasks IS 'The "Real" work - tracks actual scope items from estimates. Each task represents a piece of work to be completed.';
COMMENT ON COLUMN public.project_tasks.original_line_item_id IS 'Optional link to the original estimate line item this task was created from';
COMMENT ON COLUMN public.project_tasks.description IS 'The scope name/description of the work to be performed';
COMMENT ON COLUMN public.project_tasks.status IS 'Task status: pending (not started), scheduled (work scheduled), completed (work finished)';
COMMENT ON COLUMN public.project_tasks.price IS 'The client price for this scope item';
COMMENT ON COLUMN public.project_tasks.billed_amount IS 'How much has been invoiced so far for this task';

COMMENT ON TABLE public.invoices IS 'Invoices for projects. Tracks billing status and payment information.';
COMMENT ON COLUMN public.invoices.invoice_number IS 'Unique invoice number (e.g., "INV-1001"). Use generate_invoice_number() function to create.';
COMMENT ON COLUMN public.invoices.status IS 'Invoice status: draft, sent, paid, or overdue';
COMMENT ON COLUMN public.invoices.total_amount IS 'Total amount of the invoice';
COMMENT ON COLUMN public.invoices.due_date IS 'Date when payment is due';
COMMENT ON COLUMN public.invoices.issued_date IS 'Date when invoice was issued/sent';

COMMENT ON TABLE public.invoice_items IS 'Linking table connecting invoices to project tasks. Each item represents a line item on an invoice.';
COMMENT ON COLUMN public.invoice_items.task_id IS 'Link to the project task being billed';
COMMENT ON COLUMN public.invoice_items.amount IS 'Amount being billed in this specific invoice for this task';
COMMENT ON COLUMN public.invoice_items.description IS 'Description of the work/item being billed';

