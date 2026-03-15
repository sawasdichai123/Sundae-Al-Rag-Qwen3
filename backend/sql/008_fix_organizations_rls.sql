-- 008: Fix organizations RLS policy
-- The original policy uses (auth.jwt() ->> 'organization_id')::UUID
-- but Supabase JWTs don't include organization_id as a custom claim.
-- This causes 406 errors when querying organizations table.
-- Fix: allow users to read their own organization via user_profiles lookup.

DROP POLICY IF EXISTS "org_isolation" ON organizations;

-- Allow authenticated users to read their own organization
CREATE POLICY "org_read_own" ON organizations
    FOR SELECT USING (
        id IN (
            SELECT organization_id
            FROM user_profiles
            WHERE id = auth.uid()
        )
    );

-- Allow service_role full access (for backend operations)
CREATE POLICY "org_service_role" ON organizations
    FOR ALL USING (
        auth.role() = 'service_role'
    );
