-- ============================================================================
-- Migration 014: Split full_name → first_name + last_name (IDEMPOTENT)
--
-- ⚠️ ต้องรันหลัง 013
-- ⚠️ รองรับทั้ง 2 กรณี:
--    A) DB ยังมี full_name → migrate data แล้วลบ
--    B) DB มี first_name/last_name อยู่แล้ว → ข้ามไป update trigger อย่างเดียว
-- ============================================================================

-- 1. เพิ่ม columns ใหม่ (IF NOT EXISTS — ปลอดภัยถ้ามีอยู่แล้ว)
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT;

-- 2. Migrate data: แยก full_name ด้วย space ตัวแรก (ข้ามถ้า full_name ไม่มี)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_profiles'
          AND column_name = 'full_name'
    ) THEN
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

        ALTER TABLE user_profiles DROP COLUMN full_name;
        RAISE NOTICE 'Migrated full_name → first_name + last_name and dropped full_name column.';
    ELSE
        RAISE NOTICE 'Column full_name not found — already migrated. Skipping data migration.';
    END IF;
END $$;

-- 3. อัพเดท auth trigger ให้อ่าน first_name + last_name จาก signup metadata
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id, email, first_name, last_name, role, is_approved, organization_id
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'first_name', NEW.raw_user_meta_data ->> 'full_name'),
        NEW.raw_user_meta_data ->> 'last_name',
        'user',
        false,
        NULL   -- org assigned later when user creates or joins one
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;
