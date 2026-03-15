-- ============================================================
-- 005_create_support_account.sql
-- สร้าง Support Role Account (ใช้ Supabase Admin API + SQL)
-- ============================================================
--
-- ⚠️  ห้าม INSERT ตรงเข้า auth.users เพราะจะทำให้ schema เสีย!
--     ต้องใช้ Admin API เท่านั้น
--
-- Login ด้วย:
--   Email:    support@sundae.local
--   Password: Sundae@2025
--
-- ============================================================
-- ขั้นตอน:
--
-- STEP 1: รัน curl ใน Terminal เพื่อสร้าง auth user ผ่าน Admin API
--
--   curl -X POST "https://rcslrctohmbyejwjzoqs.supabase.co/auth/v1/admin/users" \
--     -H "apikey: <SUPABASE_ANON_KEY>" \
--     -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"email":"support@sundae.local","password":"Sundae@2025","email_confirm":true,"user_metadata":{"full_name":"Support User"}}'
--
-- STEP 2: รัน SQL ด้านล่างใน Supabase SQL Editor
-- ============================================================

-- อัพเดท role เป็น support + approve + ผูก org
UPDATE user_profiles
SET
    role = 'support',
    is_approved = true,
    organization_id = '7659c888-53d7-485d-b0e8-8c0586e26a36'  -- SUNDAE Demo Org
WHERE email = 'support@sundae.local';

-- ตรวจสอบผลลัพธ์
SELECT id, email, full_name, role, is_approved, organization_id
FROM user_profiles
WHERE email = 'support@sundae.local';
