-- ============================================================================
-- SUNDAE — Database Schema Migration 004
--
-- Auth Trigger: Auto-create user_profiles on new Supabase auth user
--
-- แก้ Bug B6: Register ติด RLS เพราะ auth.uid() = null ตอน signUp()
-- (Supabase email confirmation mode ทำให้ session ไม่ถูก set ทันที)
--
-- วิธีแก้: ใช้ AFTER INSERT trigger บน auth.users
-- SECURITY DEFINER = bypass RLS → ไม่ต้องพึ่ง session ของ user
--
-- Auto-assign: ทุก user ใหม่จะถูก assign เข้า SUNDAE Demo Org อัตโนมัติ
-- (เพราะระบบมี org เดียว ไม่มีหน้า UI ให้ admin assign)
--
-- Run in: Supabase SQL Editor
-- ============================================================================

-- ── Trigger Function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    default_org_id UUID;
BEGIN
    -- ใช้ org แรกที่มีในระบบ (SUNDAE Demo Org)
    SELECT id INTO default_org_id FROM public.organizations LIMIT 1;

    INSERT INTO public.user_profiles (id, email, full_name, role, is_approved, organization_id)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        'user',
        false,
        default_org_id
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;


-- ── Trigger on auth.users ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_auth_user();
