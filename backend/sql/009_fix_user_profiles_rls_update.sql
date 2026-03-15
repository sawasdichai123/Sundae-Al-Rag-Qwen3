-- ============================================================================
-- SUNDAE — Migration 009: Fix user_profiles UPDATE RLS + approve user
--
-- Problem: The UPDATE policy only has USING but no WITH CHECK.
-- Supabase may silently block updates if the policy doesn't fully match.
-- Also adds explicit WITH CHECK clause for safety.
--
-- Run this in Supabase SQL Editor.
-- ============================================================================

-- ── 1. Fix the UPDATE policy — add WITH CHECK ──────────────────────────────

DROP POLICY IF EXISTS "Only support/admin can update profiles" ON user_profiles;

CREATE POLICY "Only support/admin can update profiles"
ON user_profiles FOR UPDATE
USING (get_my_role() IN ('support', 'admin'))
WITH CHECK (get_my_role() IN ('support', 'admin'));

-- ── 2. Approve the specific user (sawasdichai.amor@bumail.net) ─────────────

UPDATE user_profiles
SET is_approved = true
WHERE email = 'sawasdichai.amor@bumail.net'
  AND is_approved = false;

-- ── 3. Verify ──────────────────────────────────────────────────────────────

SELECT id, email, role, is_approved, organization_id
FROM user_profiles
ORDER BY created_at DESC;
