-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    client_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create uploads table
CREATE TABLE uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('photo', 'blueprint', 'audio')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create estimates table
CREATE TABLE estimates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    json_data JSONB NOT NULL,
    ai_summary TEXT,
    total NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects table
CREATE POLICY "Users can view their own projects" ON projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own projects" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" ON projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" ON projects
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for uploads table
CREATE POLICY "Users can view uploads for their projects" ON uploads
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = uploads.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert uploads for their projects" ON uploads
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = uploads.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update uploads for their projects" ON uploads
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = uploads.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete uploads for their projects" ON uploads
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = uploads.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- RLS Policies for estimates table
CREATE POLICY "Users can view estimates for their projects" ON estimates
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert estimates for their projects" ON estimates
    FOR INSERT WITH CHECK (
        estimates.project_id IS NULL OR
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update estimates for their projects" ON estimates
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete estimates for their projects" ON estimates
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = estimates.project_id 
            AND projects.user_id = auth.uid()
        )
    );

-- Create indexes for better performance
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_uploads_project_id ON uploads(project_id);
CREATE INDEX idx_estimates_project_id ON estimates(project_id);
CREATE INDEX idx_uploads_kind ON uploads(kind);

-- Create storage bucket for audio uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('audio-uploads', 'audio-uploads', true);

-- Create storage policies for audio-uploads bucket
CREATE POLICY "Users can upload audio files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view their own audio files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own audio files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'audio-uploads' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
