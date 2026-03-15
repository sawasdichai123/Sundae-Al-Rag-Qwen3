-- ============================================================================
-- 006: Add bot_id filter to match_child_chunks RPC
-- ============================================================================
-- Problem: Vector search returns ALL documents in the organization,
--          ignoring which bot the document is linked to.
-- Fix:     Add optional target_bot_id parameter. When provided,
--          only return chunks from documents linked to that bot.
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
