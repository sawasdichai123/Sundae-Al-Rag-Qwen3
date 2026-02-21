-- ============================================================================
-- SUNDAE — Database Schema Migration 003
--
-- user_profiles table + RLS policies + get_my_role() function + Admin seed
--
-- ⚠️  Already applied to Supabase on 2026-02-28
--     This file is kept for documentation / fresh-install reference only.
-- ============================================================================


-- ── user_profiles table ──────────────────────────────────────────────────────
-- เชื่อมกับ auth.users — เก็บ role, is_approved, email, full_name
-- organization_id nullable เพราะ user สมัครก่อน org จะถูก assign ทีหลัง

CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    email           TEXT NOT NULL,
    full_name       TEXT,
    role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'support', 'admin')),
    is_approved     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_org_id ON user_profiles (organization_id);


-- ── get_my_role() helper function ────────────────────────────────────────────
-- SECURITY DEFINER = bypass RLS เพื่อป้องกัน infinite recursion ใน policies
-- ใช้ใน RLS policy แทนการ subquery user_profiles ตรง ๆ

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid();
$$;


-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: ตัวเอง หรือ Support/Admin ดูทุกคนได้
CREATE POLICY "Users can read own profile, support/admin read all"
ON user_profiles FOR SELECT
USING (id = auth.uid() OR get_my_role() IN ('support', 'admin'));

-- UPDATE: เฉพาะ Support/Admin เท่านั้น (ป้องกัน privilege escalation)
CREATE POLICY "Only support/admin can update profiles"
ON user_profiles FOR UPDATE
USING (get_my_role() IN ('support', 'admin'));

-- INSERT: user สมัครได้เฉพาะ profile ของตัวเอง (id ต้อง = auth.uid())
CREATE POLICY "Users can insert own profile on signup"
ON user_profiles FOR INSERT
WITH CHECK (id = auth.uid());


-- ── Admin seed account ───────────────────────────────────────────────────────
-- ⚠️  UUID ด้านล่างตรงกับ Supabase auth.users ที่สร้างด้วย email admin@sundae.local
-- ถ้าใช้ instance ใหม่ต้องเปลี่ยน UUID ให้ตรงกับ auth.users จริง

INSERT INTO user_profiles (id, email, full_name, role, is_approved)
VALUES (
    '80b82640-50be-43c0-a549-733c1e9a1972',
    'admin@sundae.local',
    'Admin SUNDAE',
    'admin',
    true
)
ON CONFLICT (id) DO NOTHING;
