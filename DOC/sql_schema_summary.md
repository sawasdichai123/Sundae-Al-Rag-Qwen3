# สรุปโครงสร้าง Database Schema (SUNDAE)
> อ้างอิงจาก `schema_snapshot_latest.sql` (รวม Migration 001 - 012)

โครงสร้างฐานข้อมูลของ SUNDAE ถูกออกแบบมาเพื่อรองรับระบบ **Multi-Tenant (ผู้ใช้งานหลายองค์กร)**, **Role-Based Access Control (RBAC)**, และรองรับการเชื่อมต่อจากหลาย **Platform (Web/LINE)** โดยแบ่งกลุ่มตารางหลักๆ ได้ดังนี้:

---

## 1. กลุ่มจัดการผู้ใช้งานและองค์กร (Identity & Multi-Tenant)

### `organizations` (ตารางองค์กร)
- ข้อมูลพื้นฐานของบริษัท/องค์กร (`id`, `name`, `slug`)
- มีระบบ Soft Delete (`status`: active, pending_deletion, deleted) 

### `user_profiles` (ตารางผู้ใช้งาน)
- เก็บข้อมูลส่วนตัวที่ผูกกับ Supabase Auth (`id`, `email`, `first_name`, `last_name`)
- เก็บสิทธิ์ระดับระบบคลาวด์ (`role`: user, support, admin) และสถานะการอนุมัติ (`is_approved`)
- *หมายเหตุ: `organization_id` ในตารางนี้เป็น Legacy Column แล้ว จะถูกแทนที่ด้วย `org_members`*

### `org_members` (ตารางสมาชิกองค์กร - Many-to-Many)
- **หัวใจสำคัญของระบบ Multi-Tenant** ที่ทำให้ 1 User อยู่ได้หลายองค์กร
- เก็บว่าใคร (`user_id`) อยู่ในองค์กรไหน (`organization_id`) 
- เก็บสิทธิ์ระดับองค์กร (`org_role`: owner, member) เพื่อกั้นการเข้าถึงข้อมูล (Owner จัดการทุกอย่างได้, Member แค่ใช้งาน)

### `org_invitations` (คำเชิญเข้าองค์กร)
- เก็บคำเชิญผ่านอีเมล (`invited_email`) พร้อมสถานะ (`pending`, `accepted`, `revoked`)

---

## 2. กลุ่มแชทบอท (Bot Management)

### `bots` (ตารางสร้าง AI Bot)
- เก็บการตั้งค่า Bot ภายใต้องค์กร (`bot_id`, `organization_id`)
- ตั้งค่า Prompt, LINE Access Token (`line_access_token`)
- กำหนดว่าให้เปิดใช้งานบนหน้าเว็บด้วยไหม (`is_web_enabled`)

---

## 3. กลุ่มคลังความรู้ (Knowledge Base / RAG)

### `documents` (ตารางไฟล์ความรู้)
- เก็บข้อมูลไฟล์ PDF/Word ที่โหลดเข้ามาให้ Bot อ่าน
- บอกสถานะการประมวลผล (pending, processing, ready)

### `document_parent_chunks` & `document_child_chunks` (ย่อยข้อความ)
- **Parent Chunks:** ข้อความก้อนใหญ่ สำหรับส่งให้ LLM อ่าน (เก็บแค่ text)
- **Child Chunks:** ข้อความก้อนเล็ก ทำ Vector Embedding (`VECTOR(1024)`) สำหรับทำ Similarity Search หาความเกี่ยวข้องกันด้วย `pgvector`

---

## 4. กลุ่มแชทและประวัติ (Unified Inbox)

### `chat_sessions` (ห้องแชท)
- เก็บหน้าต่างสนทนาว่าใครคุยกับบอทตัวไหน 
- **รองรับ Multi-Platform:**
  - ติดตามว่ามาจากช่องทางไหน (`channel`, `platform_source`: web, line, api)
  - เก็บ ID ผู้ใช้งานภายนอก เช่น LINE User ID (`external_user_id`, `platform_user_id`)
- **การทำงานของเจ้าหน้าที่ (Handoff):** เก็บสถานะห้องแชท (`status`: active, human_takeover, helped, resolved)

### `chat_messages` (ข้อความในแชท)
- เก็บข้อความแต่ละบรรทัด ส่งจากใคร (`role`: user, assistant, system, admin)
- เจ้าหน้าที่ (admin) สามารถเข้ามาแทรกตอบแชทได้ตอนที่ระบบเป็น `human_takeover`
