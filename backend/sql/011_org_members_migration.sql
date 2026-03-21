-- ============================================================================
-- Migration 011: org_members setup + org_invitations
--
-- Prerequisites: org_members table and organizations.status column already
-- created manually via SQL Editor.
--
-- This migration adds:
--   1. Indexes + RLS for org_members
--   2. Migrate existing user_profiles.organization_id → org_members
--   3. org_invitations table for invite flow
-- ============================================================================

-- ── 1. Indexes for org_members ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(organization_id);

-- ── 2. RLS for org_members ──────────────────────────────────────
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Users can see their own memberships
CREATE POLICY "users_see_own_memberships" ON org_members
    FOR SELECT USING (user_id = auth.uid());

-- Users can see other members in same org
CREATE POLICY "members_see_org_peers" ON org_members
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM org_members WHERE user_id = auth.uid()
        )
    );

-- Service role can do everything
CREATE POLICY "service_role_full_access" ON org_members
    FOR ALL USING (auth.role() = 'service_role');

-- ── 3. Migrate existing data ────────────────────────────────────
-- Move user_profiles.organization_id → org_members (as 'member')
-- Owner will be set via application logic when creating org
INSERT INTO org_members (user_id, organization_id, org_role)
SELECT id, organization_id, 'member'
FROM user_profiles
WHERE organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 4. org_invitations table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_email   TEXT NOT NULL,
    invited_by      UUID NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON org_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON org_invitations(organization_id);

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_invitations" ON org_invitations
    FOR ALL USING (auth.role() = 'service_role');
