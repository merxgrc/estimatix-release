# Database Setup Guide

## SQL Migration

Run this SQL in your Supabase SQL Editor:

```sql
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
```

## psql Command

If you prefer to run this via psql command line:

```bash
psql -h your-supabase-host -U postgres -d postgres -f supabase/migrations/001_initial_schema.sql
```

## TypeScript Integration

The following files have been created:

### 1. `types/db.ts`
- Complete TypeScript types for all database tables
- Convenience types for easier usage
- Extended types with relationships

### 2. `lib/db.ts`
- Client-side database operations (`db` object)
- Server-side database operations (`serverDb` object)
- Safe wrappers with proper error handling
- Support for relationships (projects with uploads/estimates)

## Usage Examples

### Client-side usage:
```typescript
import { db } from '@/lib/db'

// Get all projects
const projects = await db.getProjects()

// Create a new project
const newProject = await db.createProject({
  user_id: 'user-uuid',
  title: 'Kitchen Renovation',
  client_name: 'John Doe',
  notes: 'Complete kitchen remodel'
})

// Get project with uploads and estimates
const projectWithData = await db.getProjectWithUploadsAndEstimates(projectId)
```

### Server-side usage:
```typescript
import { serverDb } from '@/lib/db'

// In API routes or server components
const projects = await serverDb.getProjects()
```

## Security Features

- **Row Level Security (RLS)** enabled on all tables
- Users can only access their own data
- Proper foreign key relationships with cascade delete
- Type-safe database operations
- Environment variable validation

## Database Schema

```
projects
├── id (UUID, PK)
├── user_id (UUID, FK to auth.users)
├── title (TEXT)
├── client_name (TEXT, nullable)
├── notes (TEXT, nullable)
└── created_at (TIMESTAMPTZ)

uploads
├── id (UUID, PK)
├── project_id (UUID, FK to projects)
├── file_url (TEXT)
├── kind (TEXT, CHECK: 'photo'|'blueprint'|'audio')
└── created_at (TIMESTAMPTZ)

estimates
├── id (UUID, PK)
├── project_id (UUID, FK to projects)
├── json_data (JSONB)
├── ai_summary (TEXT, nullable)
├── total (NUMERIC, nullable)
└── created_at (TIMESTAMPTZ)
```
