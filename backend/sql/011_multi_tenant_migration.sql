-- Migration 011: Multi-tenant migration (org_members as source of truth)
-- Pre-condition: old 011 already ran (org_role, desired_org_name, invite_org_id in user_profiles)

-- ============================================================
-- 1. Create org_members table + Indexes + RLS
-- ============================================================
CREATE TABLE IF NOT EXISTS org_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    org_role TEXT NOT NULL DEFAULT 'member' CHECK (org_role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add status + deletion_requested_by to organizations if missing
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_deletion'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON org_members(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_user_org ON org_members(user_id, organization_id);
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- RLS: users can read their own memberships
DROP POLICY IF EXISTS "Users read own memberships" ON org_members;
CREATE POLICY "Users read own memberships" ON org_members
    FOR SELECT USING (user_id = auth.uid());

-- RLS: service_role bypasses automatically (backend uses service key)

-- ============================================================
-- 2. Migrate existing data: user_profiles → org_members
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_profiles'
          AND column_name = 'org_role'
    ) THEN
        INSERT INTO org_members (user_id, organization_id, org_role)
        SELECT id, organization_id, COALESCE(org_role, 'member')
        FROM user_profiles
        WHERE organization_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    ELSE
        INSERT INTO org_members (user_id, organization_id, org_role)
        SELECT id, organization_id, 'member'
        FROM user_profiles
        WHERE organization_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ============================================================
-- 3. Adapt org_invitations for new schema
-- ============================================================
-- Rename email → invited_email
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'org_invitations'
          AND column_name = 'email'
    ) THEN
        ALTER TABLE org_invitations RENAME COLUMN email TO invited_email;
    END IF;
END $$;

-- Update status constraint: remove 'expired', add 'revoked'
ALTER TABLE org_invitations DROP CONSTRAINT IF EXISTS org_invitations_status_check;
ALTER TABLE org_invitations ADD CONSTRAINT org_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked'));

-- Update any 'expired' rows to 'revoked'
UPDATE org_invitations SET status = 'revoked' WHERE status = 'expired';

-- Fix unique constraint for renamed column
ALTER TABLE org_invitations DROP CONSTRAINT IF EXISTS org_invitations_organization_id_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invitations_org_email
    ON org_invitations(organization_id, invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON org_invitations(invited_email);

-- ============================================================
-- 4. Drop deprecated columns from user_profiles
-- ============================================================
ALTER TABLE user_profiles DROP COLUMN IF EXISTS org_role;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS desired_org_name;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS invite_org_id;
