# SQL Walkthrough (backend/sql)

โฟลเดอร์นี้เป็นชุด **migration/patch SQL** สำหรับฐานข้อมูล Supabase (PostgreSQL) ของระบบ SUNDAE โดยตั้งชื่อเรียงลำดับ `001_...` → `012_...` เพื่อบอกลำดับการรัน

## ภาพรวมโครงสร้างและการเชื่อมกัน

### โซนข้อมูลหลัก (Tables)
- **organizations**: องค์กร/เทนเนนท์ (tenant) หลัก
- **user_profiles**: โปรไฟล์ผู้ใช้ที่ผูกกับ `auth.users` (Supabase Auth) และเก็บ role/สถานะการ approve/การผูก org
- **bots**: บอทของแต่ละองค์กร
- **documents**: เอกสารความรู้ (ผูก `organization_id` และ optionally ผูก `bot_id`)
- **document_parent_chunks / document_child_chunks**: ชิ้นข้อความสำหรับ RAG
  - parent = chunk ใหญ่สำหรับ context
  - child = chunk เล็ก + vector embedding สำหรับ similarity search
- **chat_sessions / chat_messages**: บันทึกบทสนทนา (inbox)
- **org_invitations**: คำเชิญเข้าร่วมองค์กร (email invite)

### จุดเชื่อมสำคัญ (Functions/Trigger)
- **`match_child_chunks(...)`** (RPC): ค้นหา chunk ด้วย vector similarity
  - นิยามครั้งแรกใน `001_schema.sql`
  - ถูกอัปเดตให้กรองตาม bot ได้ใน `006_match_chunks_bot_filter.sql`
- **`get_my_role()`**: helper สำหรับ RLS policy ของ `user_profiles` (อยู่ใน `003_user_profiles_rls.sql`)
- **Trigger `on_auth_user_created` บน `auth.users`**
  - function `handle_new_auth_user()` สร้างแถวใน `public.user_profiles` อัตโนมัติเมื่อมีผู้ใช้สมัครใหม่
  - เริ่มใน `004_auth_trigger.sql` และปรับพฤติกรรมแบบ multi-tenant ใน `012_update_auth_trigger.sql`

### เรื่องสิทธิ์ (Row Level Security - RLS)
- `001_schema.sql` เปิด RLS หลายตารางและตั้ง policy แบบ “อ่านตาม `organization_id` ใน JWT”
- ต่อมามีการแก้ RLS ที่ใช้งานจริงกับ Supabase JWT:
  - `008_fix_organizations_rls.sql` เปลี่ยน policy ของ `organizations` ให้ lookup ผ่าน `user_profiles` แทน
  - `009_fix_user_profiles_rls_update.sql` ปรับ UPDATE policy ของ `user_profiles` ให้มี `WITH CHECK`

> หมายเหตุ: backend มักใช้ Service Role Key ซึ่ง **bypass RLS** แต่ frontend ที่ใช้ Supabase JS client จะโดน RLS ตาม policy

## ลำดับไฟล์และหน้าที่ (ทีละไฟล์)

### 001_schema.sql
- **สร้าง schema แรกเริ่ม** ของระบบ
- **Extensions**: `vector` (pgvector), `uuid-ossp`
- **Tables**:
  - identity: `organizations`, `users`
  - bot: `bots`
  - knowledge base: `documents`, `document_parent_chunks`, `document_child_chunks`
  - inbox: `chat_sessions`, `chat_messages`
- **Index** สำคัญ:
  - `idx_child_chunks_embedding` เป็น `hnsw` บน `embedding` เพื่อเร่ง similarity search
- **RPC**: สร้าง `match_child_chunks(query_embedding, target_org_id, match_count)`
- **RLS**: enable RLS และตั้ง policy `org_isolation` หลายตาราง โดยอิง claim `organization_id` ใน JWT (ซึ่งภายหลังพบว่าไม่อยู่ใน JWT มาตรฐานของ Supabase)

### 002_add_missing_columns.sql
- เติมคอลัมน์ให้ตรงกับ frontend types
- `bots`: `line_access_token`, `is_web_enabled`
- `chat_sessions`: `status`, `platform_source`, `platform_user_id`
- ในหัวไฟล์ระบุว่าเคย apply แล้ว (เก็บไว้เพื่ออ้างอิง/ติดตั้งใหม่)

### 003_user_profiles_rls.sql
- สร้างตาราง **`user_profiles`** (ผูก `auth.users(id)`)
  - เก็บ `organization_id` (nullable), `role` (user/support/admin), `is_approved`
- สร้าง function **`get_my_role()`** แบบ `SECURITY DEFINER` เพื่อใช้ใน policy
- เปิด RLS ให้ `user_profiles` และตั้ง policy:
  - SELECT: ตัวเอง หรือ support/admin ดูได้ทั้งหมด
  - UPDATE: เฉพาะ support/admin
  - INSERT: user ใส่ได้เฉพาะ record ของตัวเองตอนสมัคร
- มี **seed admin** (ต้องตรง UUID ใน `auth.users` ของ instance นั้น)

### 004_auth_trigger.sql
- แก้ปัญหา signup ติด RLS/ไม่มี session (อธิบายในไฟล์)
- สร้าง trigger function **`handle_new_auth_user()`** (`SECURITY DEFINER`) และ trigger บน `auth.users`
- พฤติกรรมเดิม (ก่อน 012):
  - สร้าง `user_profiles` ให้ผู้ใช้ใหม่
  - auto-assign `organization_id` เป็น org แรกในระบบ (`organizations LIMIT 1`)

### 005_create_support_account.sql
- ขั้นตอน “สร้างบัญชี support”
  - ย้ำว่า **ห้าม INSERT ลง `auth.users` ตรงๆ** ต้องสร้างผ่าน Supabase Admin API
  - หลังสร้าง auth user แล้ว ให้รัน SQL เพื่อ update `user_profiles` → `role='support'`, approve และผูก org

### 006_match_chunks_bot_filter.sql
- อัปเดต RPC **`match_child_chunks`** ให้รับพารามิเตอร์ `target_bot_id UUID DEFAULT NULL`
- ถ้า `target_bot_id` ไม่เป็น `NULL` จะคืน chunk เฉพาะ `documents` ที่ `bot_id` ตรงกัน
- ความเชื่อม:
  - `document_child_chunks` → `documents` (ใช้ `dcc.document_id IN (SELECT ... FROM documents WHERE bot_id = ...)`)

### 007_admin_role.sql
- ปรับ CHECK constraint ของ `chat_messages.role`
- เพิ่ม role `admin` เพื่อให้ human agent (admin/support) ส่งข้อความใน session ได้

### 008_fix_organizations_rls.sql
- แก้ RLS ของ `organizations`
- ลบ policy เดิม `org_isolation` แล้วเพิ่ม:
  - `org_read_own`: ผู้ใช้ select org ของตัวเองโดยดูจาก `user_profiles.organization_id`
  - `org_service_role`: service_role ทำได้ทุกอย่าง

### 009_fix_user_profiles_rls_update.sql
- แก้ policy UPDATE ของ `user_profiles`:
  - เดิมมี `USING` อย่างเดียว → เพิ่ม `WITH CHECK` ด้วย เพื่อให้ update ผ่านได้อย่างถูกต้อง/ชัดเจน
- มี SQL ตัวอย่าง approve ผู้ใช้เฉพาะราย และ query ตรวจสอบ

### 010_add_helped_status.sql
- ปรับ CHECK constraint ของ `chat_sessions.status`
- เพิ่มค่า `helped` ในสถานะของ session
- ใช้ block `DO $$ ... $$` เพื่อหา constraint name แบบ dynamic แล้ว drop ก่อนค่อย add ใหม่ (กันชื่อ constraint ไม่ตรง)

### 011_org_roles_and_invitations.sql
- เพิ่มความสามารถ multi-tenant/การชวนเข้าทีม
- เพิ่มคอลัมน์ใน `user_profiles`:
  - `org_role` (owner/member)
  - `desired_org_name` (ผู้ใช้กรอกตอนสมัคร)
  - `invite_org_id` (org ที่มากับ invite link)
- สร้างตาราง **`org_invitations`** (สถานะ pending/accepted/expired) + เปิด RLS
- ตั้ง policy ให้ support/admin หรือคนที่เชิญ (invited_by) จัดการ invitations ได้
- อัปเดต user ที่เป็น admin ให้เป็น `org_role='owner'` (ถ้ายังไม่ได้ตั้ง)

### 012_update_auth_trigger.sql
- อัปเดต function **`handle_new_auth_user()`** (trigger ยังใช้ตัวเดิมจาก 004)
- พฤติกรรมใหม่:
  - ตรวจ `org_invitations` ว่ามี email นี้ที่ pending ไหม → ถ้ามี set `invite_org_id`
  - ดึง `desired_org_name` จาก `raw_user_meta_data`
  - **ไม่ auto-assign `organization_id`** (ปล่อย `NULL` รอ Support approve)
  - ถ้าพบ invitation ให้ mark เป็น `accepted`

## Dependency / ลำดับการรันที่แนะนำ

### Fresh install (ทำใหม่ทั้งระบบ)
1. `001_schema.sql`
2. `002_add_missing_columns.sql`
3. `003_user_profiles_rls.sql`
4. `004_auth_trigger.sql`
5. `006_match_chunks_bot_filter.sql`
6. `007_admin_role.sql`
7. `008_fix_organizations_rls.sql`
8. `009_fix_user_profiles_rls_update.sql`
9. `010_add_helped_status.sql`
10. `011_org_roles_and_invitations.sql`
11. `012_update_auth_trigger.sql`

### จุดที่ต้องระวัง
- `003_user_profiles_rls.sql` มี seed admin UUID ที่ต้องตรงกับ `auth.users` ของโปรเจกต์จริง
- `012_update_auth_trigger.sql` ต้องรันหลัง `011_org_roles_and_invitations.sql` เพราะอ้างถึง `org_invitations` และคอลัมน์ใหม่ใน `user_profiles`
- `006_match_chunks_bot_filter.sql` เปลี่ยน signature ของ `match_child_chunks` → ฝั่ง backend/frontend ที่เรียก RPC ต้องส่งพารามิเตอร์ให้ตรง (หรือปล่อย `target_bot_id` เป็น `NULL`)
