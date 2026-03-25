-- 016: Ensure only ONE owner per organization (prevent race condition)
--
-- Without this, concurrent accept_invitation calls could both assign "owner".
-- This partial unique index enforces at most one row with org_role='owner'
-- per organization_id.

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_single_owner
    ON org_members (organization_id)
    WHERE org_role = 'owner';
