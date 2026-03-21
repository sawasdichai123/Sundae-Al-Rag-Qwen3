-- ============================================================================
-- Migration 012: Split full_name → first_name + last_name
--
-- เพิ่ม columns ใหม่, migrate data จาก full_name, แล้วลบ column เก่า
-- ============================================================================

-- 1. เพิ่ม columns ใหม่
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT;

-- 2. Migrate data: แยก full_name ด้วย space ตัวแรก
--    "สมชาย ใจดี"  → first_name="สมชาย", last_name="ใจดี"
--    "John"        → first_name="John",  last_name=NULL
--    "John A. Doe" → first_name="John",  last_name="A. Doe"
UPDATE user_profiles
SET
    first_name = CASE
        WHEN full_name IS NOT NULL AND position(' ' IN full_name) > 0
            THEN left(full_name, position(' ' IN full_name) - 1)
        ELSE full_name
    END,
    last_name = CASE
        WHEN full_name IS NOT NULL AND position(' ' IN full_name) > 0
            THEN substring(full_name FROM position(' ' IN full_name) + 1)
        ELSE NULL
    END
WHERE full_name IS NOT NULL;

-- 3. ลบ column เก่า
ALTER TABLE user_profiles DROP COLUMN IF EXISTS full_name;
