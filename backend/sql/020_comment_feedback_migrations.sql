-- ============================================================================
-- Migration 020: แก้ไขตามคอมเม้น (24 เมษายน 2569)
-- ============================================================================
-- รวม 4 ส่วน:
--   1. User Approval Tracking   — approved_by + approved_at
--   2. Documents uploaded_by + tags
--   3. Bot Visibility           — visibility + visible_to
--   4. Auto-approve invited users — แก้ trigger ให้เช็ค invitation ตอนสมัคร
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════
-- 1. User Approval Tracking
-- ═══════════════════════════════════════════════════════════════════
-- เพิ่มข้อมูลว่าใครอนุมัติ เมื่อไหร่ (user เก่าจะเป็น NULL)

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES user_profiles(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_profiles_approved_by ON user_profiles(approved_by)
    WHERE approved_by IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════
-- 2. Documents — uploaded_by + tags
-- ═══════════════════════════════════════════════════════════════════
-- uploaded_by: ใครอัปโหลด (เอกสารเก่าจะเป็น NULL)
-- tags: ระบบแท็กจัดกลุ่มเอกสาร (free-form text array)

ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES user_profiles(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by)
    WHERE uploaded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN (tags);


-- ═══════════════════════════════════════════════════════════════════
-- 3. Bot Visibility
-- ═══════════════════════════════════════════════════════════════════
-- visibility = 'all'        → ทุกคนใน org เห็น (default, พฤติกรรมเดิม)
-- visibility = 'restricted' → เฉพาะ user_id ใน visible_to[] + Org Admin

ALTER TABLE bots ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'all';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS visible_to UUID[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bots_visibility_check'
    ) THEN
        ALTER TABLE bots ADD CONSTRAINT bots_visibility_check
            CHECK (visibility IN ('all', 'restricted'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bots_visible_to ON bots USING GIN (visible_to)
    WHERE visibility = 'restricted';


-- ═══════════════════════════════════════════════════════════════════
-- 4. Auto-approve invited users
-- ═══════════════════════════════════════════════════════════════════
-- แก้ trigger: ถ้าสมัครด้วย email ที่มี pending invitation
-- → auto-approve + accept invitation + เข้า Org ทันที

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    has_invitation BOOLEAN;
    inv_record   RECORD;
    first_org     UUID;
    admin_exists  BOOLEAN;
    assigned_role TEXT;
BEGIN
    -- Check if this email has any pending invitation
    SELECT EXISTS(
        SELECT 1 FROM org_invitations
        WHERE invited_email = lower(NEW.email)
          AND status = 'pending'
    ) INTO has_invitation;

    -- Create profile — auto-approve if invitation exists
    INSERT INTO public.user_profiles (
        id, email, first_name, last_name, role, is_approved, organization_id
    )
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'first_name',
        NEW.raw_user_meta_data ->> 'last_name',
        'user',
        has_invitation,
        NULL
    )
    ON CONFLICT (id) DO NOTHING;

    -- If invited, auto-accept all pending invitations + join orgs
    IF has_invitation THEN
      BEGIN
        first_org := NULL;

        FOR inv_record IN
            SELECT id, organization_id
            FROM org_invitations
            WHERE invited_email = lower(NEW.email)
              AND status = 'pending'
        LOOP
            SELECT EXISTS(
                SELECT 1 FROM org_members
                WHERE organization_id = inv_record.organization_id
                  AND org_role = 'admin'
            ) INTO admin_exists;

            assigned_role := CASE WHEN admin_exists THEN 'member' ELSE 'admin' END;

            INSERT INTO org_members (user_id, organization_id, org_role, joined_at)
            VALUES (NEW.id, inv_record.organization_id, assigned_role, now())
            ON CONFLICT (user_id, organization_id) DO NOTHING;

            UPDATE org_invitations SET status = 'accepted' WHERE id = inv_record.id;

            IF first_org IS NULL THEN
                first_org := inv_record.organization_id;
            END IF;
        END LOOP;

        IF first_org IS NOT NULL THEN
            UPDATE user_profiles
            SET organization_id = first_org
            WHERE id = NEW.id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Auto-accept invitations failed for %: %', NEW.email, SQLERRM;
      END;
    END IF;

    RETURN NEW;
END;
$$;
