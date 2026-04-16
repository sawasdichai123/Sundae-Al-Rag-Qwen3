-- ============================================================================
-- 019: Change documents.bot_id (single FK) → bot_ids (UUID[] array)
-- ============================================================================
-- Problem: ปัจจุบัน 1 document = 1 bot (FK) → เอกสารเชื่อมได้ bot เดียว
-- Fix:     เปลี่ยนเป็น UUID[] array → 1 เอกสารเชื่อมหลาย bot ได้
--          พร้อมอัปเดต match_child_chunks RPC ให้ใช้ array contains check
-- ============================================================================

-- 1) Add new array column (default empty)
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS bot_ids UUID[] NOT NULL DEFAULT '{}';

-- 2) Migrate existing single bot_id → array
UPDATE documents
SET bot_ids = ARRAY[bot_id]
WHERE bot_id IS NOT NULL
  AND NOT (bot_id = ANY(bot_ids));

-- 3) GIN index for fast array membership checks
CREATE INDEX IF NOT EXISTS idx_documents_bot_ids
    ON documents USING GIN(bot_ids);

-- 4) Drop old single-FK column + its index
DROP INDEX IF EXISTS idx_documents_bot_id;
ALTER TABLE documents DROP COLUMN IF EXISTS bot_id;

-- 5) Update match_child_chunks RPC: bot_id = target_bot_id → target_bot_id = ANY(bot_ids)
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
          OR target_bot_id = ANY(d.bot_ids)
      )
    ORDER BY dcc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
