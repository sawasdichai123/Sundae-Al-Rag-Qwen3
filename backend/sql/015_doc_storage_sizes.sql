-- ============================================================================
-- Migration 015: Function to calculate actual DB storage per document
--
-- Returns (document_id, storage_bytes) for all documents in an org.
-- storage_bytes = parent chunk text + child chunk text + embeddings (1024 × 4 bytes each)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_doc_storage_sizes(p_org_id UUID)
RETURNS TABLE(document_id UUID, storage_bytes BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH parent_sizes AS (
        SELECT pc.document_id,
               SUM(octet_length(pc.text))::BIGINT AS size_bytes
        FROM document_parent_chunks pc
        WHERE pc.organization_id = p_org_id
        GROUP BY pc.document_id
    ),
    child_sizes AS (
        SELECT cc.document_id,
               (SUM(octet_length(cc.text)) + COUNT(*) * 4096)::BIGINT AS size_bytes
        FROM document_child_chunks cc
        WHERE cc.organization_id = p_org_id
        GROUP BY cc.document_id
    )
    SELECT
        COALESCE(p.document_id, c.document_id) AS document_id,
        (COALESCE(p.size_bytes, 0) + COALESCE(c.size_bytes, 0))::BIGINT AS storage_bytes
    FROM parent_sizes p
    FULL OUTER JOIN child_sizes c ON p.document_id = c.document_id;
$$;
