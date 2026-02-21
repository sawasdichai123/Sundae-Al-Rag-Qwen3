-- ============================================================================
-- SUNDAE — Database Schema Migration 001
-- 
-- Initialises the core tables for the SUNDAE multi-tenant RAG platform.
-- Run against your self-hosted Supabase (PostgreSQL) instance.
--
-- IMPORTANT: This migration assumes PostgreSQL 15+ with pgvector installed.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector for embedding storage
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()


-- ============================================================================
-- IDENTITY ZONE
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           TEXT UNIQUE NOT NULL,
    full_name       TEXT,
    role            TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users (organization_id);


-- ============================================================================
-- BOT MANAGEMENT ZONE
-- ============================================================================

CREATE TABLE IF NOT EXISTS bots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    system_prompt   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bots_org_id ON bots (organization_id);


-- ============================================================================
-- KNOWLEDGE BASE ZONE
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_id          UUID REFERENCES bots(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    file_path       TEXT,                       -- path in Supabase Storage
    file_size_bytes BIGINT,
    mime_type       TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'ready', 'error')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_org_id ON documents (organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_bot_id ON documents (bot_id);


-- ── Parent Chunks (large context for LLM) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS document_parent_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    char_count      INTEGER GENERATED ALWAYS AS (char_length(text)) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_chunks_org_id
    ON document_parent_chunks (organization_id);
CREATE INDEX IF NOT EXISTS idx_parent_chunks_doc_id
    ON document_parent_chunks (document_id);


-- ── Child Chunks (small vectors for similarity search) ─────────────────────

CREATE TABLE IF NOT EXISTS document_child_chunks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id       UUID NOT NULL REFERENCES document_parent_chunks(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    embedding       VECTOR(1024),               -- BAAI/bge-m3 output dimension
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_child_chunks_org_id
    ON document_child_chunks (organization_id);
CREATE INDEX IF NOT EXISTS idx_child_chunks_parent_id
    ON document_child_chunks (parent_id);
CREATE INDEX IF NOT EXISTS idx_child_chunks_doc_id
    ON document_child_chunks (document_id);

-- HNSW index for fast approximate cosine similarity search.
-- vector_cosine_ops triggers the <=> (cosine distance) operator.
CREATE INDEX IF NOT EXISTS idx_child_chunks_embedding
    ON document_child_chunks
    USING hnsw (embedding vector_cosine_ops);


-- ============================================================================
-- UNIFIED INBOX ZONE
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_id          UUID REFERENCES bots(id) ON DELETE SET NULL,
    channel         TEXT NOT NULL DEFAULT 'web'
                    CHECK (channel IN ('web', 'line', 'api')),
    external_user_id TEXT,                      -- e.g. LINE User ID
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_org_id
    ON chat_sessions (organization_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',         -- sources, confidence, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
    ON chat_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_org_id
    ON chat_messages (organization_id);


-- ============================================================================
-- RPC FUNCTION: Vector Similarity Search (with mandatory org filter)
-- ============================================================================
--
-- Called via: supabase.rpc("match_child_chunks", { ... })
--
-- Returns: Top-K child chunks ordered by cosine similarity, filtered by
-- organization_id. The caller then maps child → parent for context retrieval.
-- ============================================================================

CREATE OR REPLACE FUNCTION match_child_chunks(
    query_embedding     VECTOR(1024),
    target_org_id       UUID,
    match_count         INTEGER DEFAULT 20
)
RETURNS TABLE (
    id              UUID,
    parent_id       UUID,
    document_id     UUID,
    chunk_index     INTEGER,
    text            TEXT,
    similarity      FLOAT
)
LANGUAGE plpgsql
STABLE                -- read-only, safe for parallel execution
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dcc.id,
        dcc.parent_id,
        dcc.document_id,
        dcc.chunk_index,
        dcc.text,
        -- Cosine similarity = 1 - cosine distance
        1 - (dcc.embedding <=> query_embedding) AS similarity
    FROM document_child_chunks dcc
    WHERE dcc.organization_id = target_org_id
    ORDER BY dcc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- ============================================================================
-- ROW LEVEL SECURITY (for Frontend JWT access)
-- ============================================================================
-- NOTE: The FastAPI backend uses the Service Role Key which BYPASSES RLS.
-- These policies protect data when accessed through the Supabase JS client
-- (React frontend) using user JWTs.
-- ============================================================================

ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_parent_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_child_chunks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages          ENABLE ROW LEVEL SECURITY;

-- Example RLS policy: users can only see rows belonging to their organization.
-- The JWT must contain a claim: `organization_id`.
-- Expand / customise these policies based on your auth setup.

CREATE POLICY "org_isolation" ON organizations
    FOR ALL USING (id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON users
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON bots
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON documents
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON document_parent_chunks
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON document_child_chunks
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON chat_sessions
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);

CREATE POLICY "org_isolation" ON chat_messages
    FOR ALL USING (organization_id = (auth.jwt() ->> 'organization_id')::UUID);
