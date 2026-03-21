-- ============================================================================
-- SUNDAE — Database Schema Snapshot (Combined 001 to 012)
-- 
-- ⚠️ IMPORTANT: This is a consolidated snapshot of the entire database schema 
-- for fresh installations. It contains all changes from migrations 001 to 012.
-- If your database already has the older tables, DO NOT run this file entirely 
-- as it might conflict. This is primarily for reference and new environments.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector for embedding storage
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()


-- ============================================================================
-- IDENTITY ZONE & MULTI-TENANT ORGANIZATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'pending_deletion', 'deleted')),
    deletion_requested_by UUID,
    deletion_requested_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL, -- Legacy column (used for older migrations)
    email           TEXT NOT NULL,
    first_name      TEXT,
    last_name       TEXT,
    role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'support', 'admin')),
    is_approved     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_org_id ON user_profiles (organization_id);

-- ── The new organization membership (many-to-many) ──────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    org_role        TEXT NOT NULL DEFAULT 'member'
                    CHECK (org_role IN ('owner', 'member')),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(organization_id);

CREATE TABLE IF NOT EXISTS org_invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_email   TEXT NOT NULL,
    invited_by      UUID NOT NULL REFERENCES auth.users(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON org_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON org_invitations(organization_id);


-- ============================================================================
-- BOT MANAGEMENT ZONE
-- ============================================================================

CREATE TABLE IF NOT EXISTS bots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    system_prompt   TEXT,
    line_access_token TEXT,
    is_web_enabled  BOOLEAN NOT NULL DEFAULT true,
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

CREATE INDEX IF NOT EXISTS idx_parent_chunks_org_id ON document_parent_chunks (organization_id);
CREATE INDEX IF NOT EXISTS idx_parent_chunks_doc_id ON document_parent_chunks (document_id);

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

CREATE INDEX IF NOT EXISTS idx_child_chunks_org_id ON document_child_chunks (organization_id);
CREATE INDEX IF NOT EXISTS idx_child_chunks_parent_id ON document_child_chunks (parent_id);
CREATE INDEX IF NOT EXISTS idx_child_chunks_doc_id ON document_child_chunks (document_id);

-- HNSW index for fast approximate cosine similarity search
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
    external_user_id  TEXT,                     -- e.g. LINE User ID
    platform_source   TEXT DEFAULT 'web',
    platform_user_id  TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'human_takeover', 'helped', 'resolved')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_org_id ON chat_sessions (organization_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'admin')),
    content         TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',         -- sources, confidence, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_org_id ON chat_messages (organization_id);


-- ============================================================================
-- RPC FUNCTION: Vector Similarity Search (with Bot Filter)
-- ============================================================================

CREATE OR REPLACE FUNCTION match_child_chunks(
    query_embedding     VECTOR(1024),
    target_org_id       UUID,
    match_count         INTEGER DEFAULT 20,
    target_bot_id       UUID DEFAULT NULL
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
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dcc.id,
        dcc.parent_id,
        dcc.document_id,
        dcc.chunk_index,
        dcc.text,
        1 - (dcc.embedding <=> query_embedding) AS similarity
    FROM document_child_chunks dcc
    WHERE dcc.organization_id = target_org_id
      AND (
          target_bot_id IS NULL
          OR dcc.document_id IN (
              SELECT d.id FROM documents d
              WHERE d.bot_id = target_bot_id
          )
      )
    ORDER BY dcc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- ============================================================================
-- HELPER FUNCTIONS & ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- get_my_role() bypasses RLS to prevent infinite recursion
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invitations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_parent_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_child_chunks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages          ENABLE ROW LEVEL SECURITY;

-- Organizations
CREATE POLICY "org_read_own" ON organizations
    FOR SELECT USING (id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_service_role" ON organizations
    FOR ALL USING (auth.role() = 'service_role');

-- User Profiles
CREATE POLICY "Users can read own profile, support/admin read all"
ON user_profiles FOR SELECT
USING (id = auth.uid() OR get_my_role() IN ('support', 'admin'));

CREATE POLICY "Only support/admin can update profiles"
ON user_profiles FOR UPDATE
USING (get_my_role() IN ('support', 'admin'))
WITH CHECK (get_my_role() IN ('support', 'admin'));

CREATE POLICY "Users can insert own profile on signup"
ON user_profiles FOR INSERT
WITH CHECK (id = auth.uid());

-- Org Members
CREATE POLICY "users_see_own_memberships" ON org_members
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "members_see_org_peers" ON org_members
    FOR SELECT USING (organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "service_role_full_access" ON org_members
    FOR ALL USING (auth.role() = 'service_role');

-- Org Invitations
CREATE POLICY "service_role_invitations" ON org_invitations
    FOR ALL USING (auth.role() = 'service_role');

-- Trigger to safely create a profile when a new user signs up in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, first_name, last_name, role, is_approved)
  VALUES (new.id, new.email, NULL, NULL, 'user', false);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if trigger exists before creating it (Postgres doesn't have CREATE TRIGGER IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
    END IF;
END
$$;
