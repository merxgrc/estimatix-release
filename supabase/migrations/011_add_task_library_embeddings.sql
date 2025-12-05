-- Add embedding column to task_library for semantic search
-- Uses pgvector extension for vector similarity search

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE task_library
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS task_library_embedding_idx
ON task_library
USING hnsw (embedding vector_cosine_ops)
WITH (m=16, ef_construction=64);

-- Add comment
COMMENT ON COLUMN task_library.embedding IS 'OpenAI text-embedding-3-large embedding vector (1536 dimensions)';




