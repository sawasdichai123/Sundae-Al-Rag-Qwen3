-- Migration 017: Multi-Admin + Access Control
-- 1) Allow multiple admins per org (drop single-owner constraint)
-- 2) Rename org_role 'owner' → 'admin'
-- 3) Create RPC for org overview (platform support/admin use)

-- ============================================================
-- 1) Drop single-owner unique index
-- ============================================================
DROP INDEX IF EXISTS idx_org_single_owner;

-- ============================================================
-- 2) Rename org_role: 'owner' → 'admin'
-- ============================================================
-- Drop old CHECK constraint FIRST (it only allows 'owner'/'member')
ALTER TABLE org_members DROP CONSTRAINT IF EXISTS org_members_org_role_check;

-- Now safe to update existing rows
UPDATE org_members SET org_role = 'admin' WHERE org_role = 'owner';

-- Add new CHECK constraint
ALTER TABLE org_members ADD CONSTRAINT org_members_org_role_check
    CHECK (org_role IN ('admin', 'member'));

-- ============================================================
-- 3) RPC: get_org_overview — returns stats for platform admin/support
-- ============================================================
CREATE OR REPLACE FUNCTION get_org_overview(target_org_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'bot_count',
      (SELECT count(*) FROM bots WHERE organization_id = target_org_id),
    'document_count',
      (SELECT count(*) FROM documents WHERE organization_id = target_org_id),
    'total_document_size_bytes',
      (SELECT coalesce(sum(file_size_bytes), 0) FROM documents WHERE organization_id = target_org_id),
    'member_count',
      (SELECT count(*) FROM org_members WHERE organization_id = target_org_id),
    'session_count',
      (SELECT count(*) FROM chat_sessions WHERE organization_id = target_org_id)
  );
$$ LANGUAGE sql SECURITY DEFINER;
