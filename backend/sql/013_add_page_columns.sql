-- ============================================================================
-- 013: Add page tracking columns to chunk tables
-- ============================================================================
-- Problem: When the bot answers a question, users cannot see which document
--          page(s) the answer came from.
-- Fix:     Add page_start/page_end columns to chunk tables, and update the
--          match_child_chunks RPC to return document name + page info.
-- Note:    Columns are nullable for backward compatibility with existing data.
-- ============================================================================

-- ── Add page columns to parent chunks ──────────────────────────────────────
ALTER TABLE document_parent_chunks
    ADD COLUMN IF NOT EXISTS page_start INTEGER,
    ADD COLUMN IF NOT EXISTS page_end   INTEGER;

-- ── Add page columns to child chunks ───────────────────────────────────────
ALTER TABLE document_child_chunks
    ADD COLUMN IF NOT EXISTS page_start INTEGER,
    ADD COLUMN IF NOT EXISTS page_end   INTEGER;

-- ── Update match_child_chunks RPC to include document name + page info ─────
-- Must DROP first because the return type changed (added columns).
DROP FUNCTION IF EXISTS match_child_chunks(VECTOR, UUID, INTEGER, UUID);

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
    document_name   TEXT,
    chunk_index     INTEGER,
    text            TEXT,
    page_start      INTEGER,
    page_end        INTEGER,
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
        d.name          AS document_name,
        dcc.chunk_index,
        dcc.text,
        dcc.page_start,
        dcc.page_end,
        1 - (dcc.embedding <=> query_embedding) AS similarity
    FROM document_child_chunks dcc
    JOIN documents d ON d.id = dcc.document_id
    WHERE dcc.organization_id = target_org_id
      AND (
          target_bot_id IS NULL
          OR dcc.document_id IN (
              SELECT d2.id FROM documents d2
              WHERE d2.bot_id = target_bot_id
          )
      )
    ORDER BY dcc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ── Fix organizations.status CHECK constraint ────────────────────────────────
-- Migration 011 created CHECK (status IN ('active', 'pending_deletion')) but
-- confirm_deletion needs to set status = 'deleted'.  Add 'deleted' to allowed values.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_status_check
    CHECK (status IN ('active', 'pending_deletion', 'deleted'));
