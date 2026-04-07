-- ============================================================================
-- 018: Add document_name, page_start, page_end to match_child_chunks RPC
-- ============================================================================
-- Problem: match_child_chunks RPC ไม่ return document_name, page_start, page_end
--          ทำให้ vector_search.py ได้รับค่า None เสมอ (ทั้งที่ข้อมูลมีอยู่ใน DB)
-- Fix:     JOIN กับ documents table เพื่อ return document_name
--          และเพิ่ม page_start, page_end ใน RETURNS TABLE + SELECT
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
        d.name AS document_name,
        dcc.chunk_index,
        dcc.text,
        dcc.page_start,
        dcc.page_end,
        1 - (dcc.embedding <=> query_embedding) AS similarity
    FROM document_child_chunks dcc
    LEFT JOIN documents d
        ON d.id = dcc.document_id
        AND d.organization_id = target_org_id
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
