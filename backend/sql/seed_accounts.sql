-- ============================================================================
-- SUNDAE — Seed Accounts
--
-- สร้าง account เริ่มต้นสำหรับระบบ:
--   1. admin@sundae.local   (role=admin)
--   2. support@sundae.local (role=support)
--
-- SECURITY: อย่าใส่ password ใน SQL file — ตั้งรหัสผ่านผ่าน Supabase Dashboard เท่านั้น
--
-- วิธีใช้:
--   ขั้นตอนที่ 1: สร้าง auth users ผ่าน Supabase Dashboard
--     → Authentication → Users → Add User → Email + Password
--     → สร้าง 2 users ตาม email/password ด้านบน (ติ๊ก Auto Confirm)
--
--   ขั้นตอนที่ 2: รัน SQL นี้ใน Supabase SQL Editor
--     → จะอัพเดท role + is_approved ให้ถูกต้อง
--
-- หมายเหตุ: ไม่สามารถ INSERT เข้า auth.users ผ่าน SQL ตรงๆ ได้อย่างปลอดภัย
--           ต้องใช้ Supabase Dashboard หรือ Admin API สร้าง auth user ก่อน
-- ============================================================================

-- ── Step 2: สร้าง Organization "SUNDAE" ──────────────────────────────────────

INSERT INTO organizations (name, slug, status)
VALUES ('SUNDAE', 'sundae', 'active')
ON CONFLICT (slug) DO NOTHING;

-- ── Step 3: อัพเดท user_profiles (หลังสร้าง auth users แล้ว) ─────────────────

-- Admin account
UPDATE user_profiles
SET
    role = 'admin',
    is_approved = true,
    first_name = 'Admin',
    last_name = 'SUNDAE',
    organization_id = (SELECT id FROM organizations WHERE slug = 'sundae')
WHERE email = 'admin@sundae.local';

-- Support account
UPDATE user_profiles
SET
    role = 'support',
    is_approved = true,
    first_name = 'Support',
    last_name = 'SUNDAE',
    organization_id = (SELECT id FROM organizations WHERE slug = 'sundae')
WHERE email = 'support@sundae.local';

-- ── Step 4: Assign admin เป็น owner ของ org SUNDAE ──────────────────────────

INSERT INTO org_members (user_id, organization_id, org_role)
SELECT
    up.id,
    o.id,
    'admin'
FROM user_profiles up
CROSS JOIN organizations o
WHERE up.email = 'admin@sundae.local'
  AND o.slug = 'sundae'
ON CONFLICT (user_id, organization_id) DO UPDATE SET org_role = 'admin';

-- Assign support เป็น member ของ org SUNDAE
INSERT INTO org_members (user_id, organization_id, org_role)
SELECT
    up.id,
    o.id,
    'member'
FROM user_profiles up
CROSS JOIN organizations o
WHERE up.email = 'support@sundae.local'
  AND o.slug = 'sundae'
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- ── ตรวจสอบผลลัพธ์ ──────────────────────────────────────────────────────────

SELECT up.email, up.first_name, up.last_name, up.role, up.is_approved,
       o.name AS org_name, om.org_role
FROM user_profiles up
LEFT JOIN org_members om ON om.user_id = up.id
LEFT JOIN organizations o ON o.id = om.organization_id
WHERE up.email IN ('admin@sundae.local', 'support@sundae.local');
