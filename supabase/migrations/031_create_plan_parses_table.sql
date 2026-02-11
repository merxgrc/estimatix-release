-- Migration: Create plan_parses table for tracking blueprint/plan parsing lifecycle
-- Phase 1: Blueprint parsing must work for real users

-- =============================================================================
-- Plan Parse Status Type
-- =============================================================================
-- uploaded:   File uploaded, not yet parsed
-- processing: Parse job started, AI analyzing
-- parsed:     Parse completed successfully, awaiting review
-- failed:     Parse failed with error
-- applied:    User reviewed and applied results to estimate/rooms

-- =============================================================================
-- Create plan_parses table
-- =============================================================================
CREATE TABLE IF NOT EXISTS plan_parses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links to project/estimate (required)
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
    
    -- Links to source file(s)
    upload_id UUID REFERENCES uploads(id) ON DELETE SET NULL,
    file_urls JSONB NOT NULL DEFAULT '[]', -- Array of storage paths parsed
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'parsed', 'failed', 'applied')),
    
    -- Parse results (populated after successful parse)
    parse_result_json JSONB, -- Full parse result: { rooms, lineItemScaffold, assumptions, warnings }
    pages_of_interest JSONB, -- Page classifications and relevant page numbers
    
    -- Metadata
    source_file_pages INT, -- Total pages in source document(s)
    processing_time_ms INT, -- How long the parse took
    
    -- Error handling
    error_message TEXT, -- Populated if status = 'failed'
    error_code TEXT, -- Error classification code
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ, -- When processing started
    parsed_at TIMESTAMPTZ, -- When parse completed (success or fail)
    applied_at TIMESTAMPTZ, -- When user applied results
    
    -- Applied results tracking
    applied_rooms_count INT, -- How many rooms were created
    applied_line_items_count INT, -- How many line items were created
    excluded_rooms_count INT -- How many rooms were excluded during review
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_plan_parses_project_id ON plan_parses(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_parses_estimate_id ON plan_parses(estimate_id);
CREATE INDEX IF NOT EXISTS idx_plan_parses_upload_id ON plan_parses(upload_id);
CREATE INDEX IF NOT EXISTS idx_plan_parses_status ON plan_parses(status);
CREATE INDEX IF NOT EXISTS idx_plan_parses_created_at ON plan_parses(created_at DESC);

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE plan_parses ENABLE ROW LEVEL SECURITY;

-- Users can view plan_parses for their projects
CREATE POLICY "Users can view plan_parses for their projects" ON plan_parses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = plan_parses.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- Users can insert plan_parses for their projects
CREATE POLICY "Users can insert plan_parses for their projects" ON plan_parses
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = plan_parses.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- Users can update plan_parses for their projects
CREATE POLICY "Users can update plan_parses for their projects" ON plan_parses
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = plan_parses.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- Users can delete plan_parses for their projects
CREATE POLICY "Users can delete plan_parses for their projects" ON plan_parses
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = plan_parses.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON TABLE plan_parses IS 'Tracks blueprint/plan parsing jobs and their results';
COMMENT ON COLUMN plan_parses.status IS 'Lifecycle: uploaded → processing → parsed/failed → applied';
COMMENT ON COLUMN plan_parses.parse_result_json IS 'Full parse output: rooms, line items, assumptions, warnings';
COMMENT ON COLUMN plan_parses.pages_of_interest IS 'Page classifications and relevant page numbers from 2-pass pipeline';
COMMENT ON COLUMN plan_parses.file_urls IS 'Array of storage paths that were parsed together';
