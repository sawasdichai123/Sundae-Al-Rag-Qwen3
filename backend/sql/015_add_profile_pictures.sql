-- ============================================================================
-- Migration 015: Add Profile Pictures & Org Logos
--
-- 1. เพิ่มคอลัมน์ avatar_url และ logo_url
-- 2. สร้าง Supabase Storage Buckets ('avatars', 'org_logos') แบบอัตโนมัติ
-- 3. เขียน Storage RLS Policies
-- ============================================================================

-- 1. เพิ่มคอลัมน์ในตาราง
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. รันคำสั่งสร้าง Storage Buckets (ต้องใช้ Role supabase_admin หรือ service_role)
--    ถ้าไม่มี Schema 'storage' ให้ข้าม (เผื่อรันใน env ที่ไม่ใช่ Supabase จริง)
DO $$
BEGIN
    IF EXISTS (
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name = 'storage'
    ) THEN
        -- สร้าง Bucket 'avatars' (รูปโปรไฟล์ User) แบบ Public
        INSERT INTO storage.buckets (id, name, public) 
        VALUES ('avatars', 'avatars', true)
        ON CONFLICT (id) DO NOTHING;

        -- สร้าง Bucket 'org_logos' (โลโก้องค์กร) แบบ Public
        INSERT INTO storage.buckets (id, name, public) 
        VALUES ('org_logos', 'org_logos', true)
        ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Created storage buckets: avatars, org_logos';
    ELSE
        RAISE NOTICE 'Schema "storage" does not exist, skipping bucket creation.';
    END IF;
END $$;

-- 3. ลบ Policies เก่า (ถ้ามี) เพื่อสร้างใหม่
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        DROP POLICY IF EXISTS "Avatars are publicly accessible." ON storage.objects;
        DROP POLICY IF EXISTS "Anyone can upload an avatar." ON storage.objects;
        DROP POLICY IF EXISTS "Users can update their own avatar." ON storage.objects;
        DROP POLICY IF EXISTS "Users can delete their own avatar." ON storage.objects;

        DROP POLICY IF EXISTS "Org logos are publicly accessible." ON storage.objects;
        DROP POLICY IF EXISTS "Authenticated users can upload org logos." ON storage.objects;
        DROP POLICY IF EXISTS "Users can update org logos." ON storage.objects;
        DROP POLICY IF EXISTS "Users can delete org logos." ON storage.objects;
    END IF;
END $$;

-- 4. สร้าง RLS Policies สำหรับ Storage Objects
DO $$
BEGIN
    IF EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        
        -- ======== Avatars Policies ========
        -- ใครๆ ก็ดูรูปได้ (Public)
        CREATE POLICY "Avatars are publicly accessible."
            ON storage.objects FOR SELECT
            USING ( bucket_id = 'avatars' );

        -- คนล็อกอินแล้วอัปโหลดได้
        CREATE POLICY "Anyone can upload an avatar."
            ON storage.objects FOR INSERT
            WITH CHECK ( bucket_id = 'avatars' AND auth.role() = 'authenticated' );

        -- อัปเดตและลบได้เฉพาะคนที่เป็นเจ้าของไฟล์ (เจ้าของไฟล์ = auth.uid() ของคนอัปโหลด)
        CREATE POLICY "Users can update their own avatar."
            ON storage.objects FOR UPDATE
            USING ( bucket_id = 'avatars' AND auth.uid() = owner )
            WITH CHECK ( bucket_id = 'avatars' AND auth.uid() = owner );

        CREATE POLICY "Users can delete their own avatar."
            ON storage.objects FOR DELETE
            USING ( bucket_id = 'avatars' AND auth.uid() = owner );

        -- ======== Org Logos Policies ========
        -- ใครๆ ก็ดูโลโก้ได้ (Public)
        CREATE POLICY "Org logos are publicly accessible."
            ON storage.objects FOR SELECT
            USING ( bucket_id = 'org_logos' );

        -- คนล็อกอินแล้วอัปโหลดโลโก้ได้
        CREATE POLICY "Authenticated users can upload org logos."
            ON storage.objects FOR INSERT
            WITH CHECK ( bucket_id = 'org_logos' AND auth.role() = 'authenticated' );

        -- *หมายเหตุ: สำหรับลบอัปเดตโลโก้องค์กร ให้ยึดจาก owner ก่อน 
        -- การทำ Policy เช็ค Member Role (M2M) ใน Storage จะซับซ้อนเกินไป 
        -- ควร Validate ที่ Frontend/API ว่าคนลบเป็น Owner ก่อนส่งคำสั่งลบมา
        CREATE POLICY "Users can update org logos."
            ON storage.objects FOR UPDATE
            USING ( bucket_id = 'org_logos' AND auth.uid() = owner )
            WITH CHECK ( bucket_id = 'org_logos' AND auth.uid() = owner );

        CREATE POLICY "Users can delete org logos."
            ON storage.objects FOR DELETE
            USING ( bucket_id = 'org_logos' AND auth.uid() = owner );

        RAISE NOTICE 'Created storage RLS policies successfully.';
    END IF;
END $$;
