# Implementation Plan — แก้ไขตามคอมเม้น (24 เมษายน 2569)

---

## 1. ระบบการอนุมัติและจัดการผู้ใช้งาน (User Approval & Management)

### 1.1 ปรับเปลี่ยนสิทธิ์การอนุมัติ

**สถานะปัจจุบัน:**
- Platform Admin/Support เป็นคนอนุมัติผู้ใช้ทุกคนผ่าน `/api/admin/pending-users`
- เมื่อ approve → auto-accept org invitation → สร้าง org_members

**สิ่งที่ต้องเปลี่ยน:**
- Platform Admin มีหน้าที่แค่ **สร้าง Org** + **กำหนด Org Admin**
- **Org Admin** ของแต่ละองค์กรเป็นผู้อนุมัติสมาชิกในองค์กรของตัวเอง

**แผนการ Implement:**

#### Backend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/app/routers/approval.py` | เพิ่ม endpoint ใหม่ `GET /api/orgs/{org_id}/pending-members` — ให้ Org Admin ดูรายชื่อสมาชิกที่รออนุมัติใน org ของตัวเอง |
| `backend/app/routers/approval.py` | เพิ่ม endpoint `POST /api/orgs/{org_id}/approve/{user_id}` — Org Admin อนุมัติสมาชิก |
| `backend/app/routers/approval.py` | เพิ่ม endpoint `POST /api/orgs/{org_id}/reject/{user_id}` — Org Admin ปฏิเสธสมาชิก |
| `backend/app/routers/approval.py` | endpoint เดิม `/api/admin/approve` ยังคงใช้สำหรับ Platform Admin สร้าง Org + กำหนด Admin |

#### Frontend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/pages/ApprovalsPage.tsx` | แยก UI เป็น 2 มุมมอง: Platform Admin เห็นทุก org / Org Admin เห็นเฉพาะ org ตัวเอง |
| `frontend/src/pages/OrganizationPage.tsx` | เพิ่ม tab "รออนุมัติ" ให้ Org Admin เห็นสมาชิกที่รอ approve ใน org |

---

### 1.2 แสดงสถานะผู้ใช้ + ประวัติการอนุมัติ

**สถานะปัจจุบัน:**
- ไม่มีข้อมูลว่าใครเป็นคน approve / เมื่อไหร่ — แค่ log ใน console
- `user_profiles` มี `is_approved` + `created_at` อยู่แล้ว แต่ไม่มี field บอกผู้อนุมัติ

**แนวทาง: เพิ่ม column ใน `user_profiles` ที่มีอยู่แล้ว (ไม่ต้องสร้างตารางใหม่)**

> เหตุผล: ข้อมูล "ใครอนุมัติ เมื่อไหร่" ผูกกับ user โดยตรง — เก็บไว้ใน `user_profiles` ได้เลย
> ไม่ต้องสร้างตาราง `approval_logs` แยก เพราะแต่ละ user ถูก approve ได้แค่ครั้งเดียว

#### Database (SQL Migration)
```sql
-- เพิ่ม 2 columns ใน user_profiles (ไม่ต้องสร้างตารางใหม่)
ALTER TABLE user_profiles ADD COLUMN approved_by UUID REFERENCES user_profiles(id);
ALTER TABLE user_profiles ADD COLUMN approved_at TIMESTAMPTZ;
```

#### Backend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/app/routers/approval.py` | ตอน approve → UPDATE `user_profiles` SET `approved_by = admin.id`, `approved_at = now()` พร้อมกับ `is_approved = true` |
| `backend/app/routers/approval.py` | endpoint `GET /api/admin/pending-users` — JOIN กับ `user_profiles` เพื่อดึงชื่อผู้อนุมัติ |
| `backend/app/routers/organization.py` | หน้า org members → แสดง `approved_by` + `approved_at` ได้จาก user_profiles โดยตรง |

#### Frontend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/pages/OrganizationPage.tsx` | หน้ารายชื่อสมาชิก — แสดงคอลัมน์ "อนุมัติโดย" + "วันที่อนุมัติ" |
| `frontend/src/pages/ApprovalsPage.tsx` | แสดง badge สถานะ (pending/approved/rejected) ข้างชื่อผู้ใช้ |

---

## 2. การจัดการคลังความรู้และไฟล์ (Knowledge Base & Files)

### 2.1 แจ้งเตือนรองรับเฉพาะ PDF

**สถานะปัจจุบัน:**
- Upload UI จำกัดเฉพาะ `.pdf` อยู่แล้ว + มี toast แจ้งเตือนถ้าลากไฟล์ผิดประเภท
- แต่ยังไม่มีข้อความแจ้งเตือนถาวรบนหน้า upload ก่อนกดอัปโหลด

**สิ่งที่ต้องเพิ่ม:**

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/pages/KnowledgeBasePage.tsx` | เพิ่มข้อความแจ้งเตือนถาวร (info banner) ใน upload zone: "รองรับเฉพาะไฟล์ PDF เท่านั้น" |
| `frontend/src/i18n/th.json` + `en.json` | เพิ่ม key `kb.pdfOnlyNotice` |

---

### 2.2 แสดงรายละเอียดไฟล์ให้ครบถ้วน

**สถานะปัจจุบัน:**
- แสดง: ชื่อไฟล์, ขนาด, สถานะ (processing/ready/error), วันที่แบบ relative ("5 นาทีที่แล้ว"), บอทที่ link
- **ไม่แสดง:** ชื่อผู้อัปโหลด (ไม่มี field `uploaded_by` ใน DB)

**สิ่งที่ต้องเปลี่ยน:**

#### Database (SQL Migration)
```sql
-- เพิ่ม column uploaded_by
ALTER TABLE documents ADD COLUMN uploaded_by UUID REFERENCES user_profiles(id);
```

#### Backend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/app/routers/document.py` | `upload_document()` — เพิ่ม `uploaded_by: user.id` ตอน INSERT |
| `backend/app/routers/document.py` | `DocumentResponse` — เพิ่ม field `uploaded_by`, `uploader_name` |
| `backend/app/routers/document.py` | `list_documents()` — JOIN กับ `user_profiles` เพื่อดึงชื่อผู้อัปโหลด |

#### Frontend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/pages/KnowledgeBasePage.tsx` | แสดงชื่อผู้อัปโหลดในแต่ละ document card |
| `frontend/src/pages/KnowledgeBasePage.tsx` | เปลี่ยนจาก "อัปเดตเมื่อ X วันที่แล้ว" → "อัปโหลดเมื่อ DD/MM/YYYY" (วันที่แบบชัดเจน) |
| `frontend/src/pages/KnowledgeBasePage.tsx` | แสดง badge สถานะไฟล์ชัดเจน: "พร้อมใช้งาน" (เขียว) / "กำลังประมวลผล" (เหลือง) / "ข้อผิดพลาด" (แดง) พร้อมข้อความ |

---

### 2.3 ระบบแท็กจัดกลุ่มไฟล์

> **รายละเอียดทั้งหมดอยู่ใน:** [`implementation_plan (1).md`](implementation_plan%20(1).md)
> ครอบคลุม: DB schema, Backend endpoints (5 จุด), Frontend UI (Tag filter bar, chips, upload dialog, edit modal), i18n keys, Verification Plan

**สรุปสั้น:**
- DB: เพิ่ม `tags TEXT[]` + GIN index ในตาราง documents
- Backend: upload รับ tags, list filter by tag, PATCH tags, GET /tags (auto-suggest)
- Frontend: Tag filter bar + tag chips บน document card + tag input ตอน upload + edit modal

---

## 3. สิทธิ์การเข้าถึงบอท (Bot Visibility)

### 3.1 แบ่งกลุ่มการมองเห็นบอท

**สถานะปัจจุบัน:**
- บอทเป็นของ org → ทุกคนใน org เห็นบอททุกตัว
- ไม่มีระบบ group/department

**สิ่งที่ต้องเพิ่ม:**

#### Database (SQL Migration)
```sql
-- เพิ่ม visibility mode + allowed members
ALTER TABLE bots ADD COLUMN visibility TEXT NOT NULL DEFAULT 'all'
    CHECK (visibility IN ('all', 'restricted'));
ALTER TABLE bots ADD COLUMN visible_to UUID[] NOT NULL DEFAULT '{}';
```

> **วิธีทำงาน:**
> - `visibility = 'all'` → บอทส่วนกลาง ทุกคนเห็น (default — พฤติกรรมเดิม)
> - `visibility = 'restricted'` → เฉพาะ user_id ที่อยู่ใน `visible_to[]` + Org Admin เห็นเสมอ

#### Backend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/app/routers/bot.py` | `list_bots()` — filter: แสดงเฉพาะบอทที่ `visibility = 'all'` หรือ user_id อยู่ใน `visible_to` หรือ user เป็น Org Admin |
| `backend/app/routers/bot.py` | `create_bot()` / `update_bot()` — รับ `visibility` + `visible_to` parameters |
| `backend/app/routers/bot.py` | เพิ่ม endpoint `GET /api/bots/count?organization_id=xxx` — return จำนวนบอททั้งหมด (สำหรับแสดง Total) |

#### Frontend
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/pages/BotsPage.tsx` | สร้าง/แก้ไขบอท — เพิ่ม setting "การมองเห็น": ทุกคน / เฉพาะกลุ่ม → เลือกสมาชิก |
| `frontend/src/pages/BotsPage.tsx` | แสดง badge "ส่วนกลาง" หรือ "เฉพาะกลุ่ม" บน bot card |
| `frontend/src/pages/BotsPage.tsx` | แสดงจำนวนบอททั้งหมด (Total) ที่ header ของหน้า |

---

## 4. การปรับปรุง UI/UX และการแจ้งเตือน

### 4.1 Notification Badge บนเมนู

**สถานะปัจจุบัน:**
- ไม่มี badge บน nav items ใดเลย
- มีแค่ "Pending Approval" badge ใน header สำหรับ user ที่ยังไม่ถูก approve

**สิ่งที่ต้องเพิ่ม:**

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `frontend/src/layouts/DashboardLayout.tsx` | เพิ่ม badge ตัวเลขที่เมนู **"องค์กร"** — แสดงจำนวนสมาชิกรออนุมัติ |
| `frontend/src/layouts/DashboardLayout.tsx` | เพิ่ม badge ตัวเลขที่เมนู **"แชท"** — แสดงจำนวนข้อความที่ยังไม่อ่าน (ถ้ามีระบบ read/unread) |
| `frontend/src/store/orgStore.ts` หรือ store ใหม่ | เพิ่ม state สำหรับ pending count + unread chat count |
| `frontend/src/api/endpoints.ts` | เพิ่ม API call สำหรับดึง pending count + unread count |

#### Backend (API สำหรับ badge counts)
| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/app/routers/approval.py` | เพิ่ม `GET /api/orgs/{org_id}/pending-count` — return จำนวนสมาชิกรออนุมัติ |
| `backend/app/routers/inbox.py` | เพิ่ม `GET /api/orgs/{org_id}/unread-count` — return จำนวนข้อความที่ยังไม่อ่าน (ต้องเพิ่ม read/unread tracking ใน chat_sessions ด้วย) |

---

### 4.2 ความสอดคล้องของคำศัพท์และสี

**สถานะปัจจุบัน:**
- แก้ไขไปแล้วบางส่วน (commit `195df60`) — Bot→บอท, Knowledge Base→คลังความรู้ ฯลฯ
- อาจยังมีตกหล่นในบางหน้า

**สิ่งที่ต้องตรวจสอบ:**

| ตรวจสอบ | มาตรฐาน |
|---------|---------|
| "Bot" vs "AI Bot" vs "บอท" | ใช้ **"บอท"** ทั้งหมด (Thai) / **"Bot"** (English) |
| "Knowledge Base" vs "คลังความรู้" | ใช้ **"คลังความรู้"** ทั้งหมด (Thai) |
| สีของ badge/สถานะ | เขียว = พร้อมใช้งาน, เหลือง = รอดำเนินการ, แดง = ข้อผิดพลาด |

> **หมายเหตุ:** ส่วนใหญ่แก้ไขไปแล้วใน th.json — ต้อง audit ซ้ำหลัง implement ฟีเจอร์ใหม่

---

## สรุปลำดับความสำคัญ (Priority)

| ลำดับ | งาน | ความซับซ้อน | ผลกระทบ |
|-------|-----|-------------|---------|
| 1 | แจ้งเตือน PDF only + แสดงรายละเอียดไฟล์ (2.1, 2.2) | ต่ำ-กลาง | แก้ปัญหาผู้ใช้สับสน |
| 2 | ปรับระบบอนุมัติ + ประวัติ (1.1, 1.2) | สูง | เปลี่ยน flow หลัก |
| 3 | Notification Badge (4.1) | กลาง | UX ดีขึ้นมาก |
| 4 | Bot Visibility (3.1) | กลาง | ต้องการเมื่อ org มีหลายแผนก |
| 5 | ระบบแท็ก (2.3) | กลาง | ต้องการเมื่อเอกสารเยอะ |
| 6 | คำศัพท์/สี (4.2) | ต่ำ | audit ซ้ำหลัง implement |

---

## SQL Migration

รวมทุกอย่างในไฟล์เดียว — รันบน Supabase SQL Editor ได้เลย:

```
backend/sql/020_comment_feedback_migrations.sql
```

ประกอบด้วย:
1. **User Approval Tracking** — `approved_by` + `approved_at` ใน user_profiles
2. **Documents uploaded_by + tags** — `uploaded_by` + `tags TEXT[]` + GIN index ใน documents
3. **Bot Visibility** — `visibility` + `visible_to UUID[]` + GIN index ใน bots

---

## ข้อควรระวัง

1. **Backward compatibility** — ระบบอนุมัติเดิม (Platform Admin) ยังต้องทำงานได้ สำหรับกรณีที่ Org ยังไม่มี Admin / user ที่ approve ไปแล้วก่อนหน้า `approved_by` + `approved_at` จะเป็น NULL (ไม่มีข้อมูลย้อนหลัง) ถ้า approve ใหม่ทั้งหมดจะไม่มีปัญหานี้
2. **Bot visibility filter** — ต้อง filter ทั้ง list API และ chat API (ไม่ให้ member เรียกใช้บอทที่ไม่มีสิทธิ์เห็น) ถ้า filter แค่ list แต่ไม่ filter chat → member ยังเรียกใช้บอทที่ซ่อนได้ผ่าน API ตรง
3. **Tags ไม่ควรซับซ้อน** — ใช้ free-form text array, ไม่ต้องสร้างระบบ tag management แยก
4. **Unread count (chat badge)** — ปัจจุบัน chat_sessions/chat_messages ไม่มี field read/unread → ต้องเพิ่ม column (เช่น `last_read_at` ใน org_members หรือ `is_read` ใน chat_sessions) ก่อนถึงจะแสดง badge ได้
5. **Org Admin approve เฉพาะ org ตัวเอง** — ต้องเช็คให้ชัดว่า Org Admin ของ Org A จะ approve สมาชิกของ Org B ไม่ได้ (cross-org protection)
6. **Documents uploaded_by = NULL สำหรับเอกสารเก่า** — เอกสารที่อัปโหลดก่อน deploy จะไม่มีชื่อผู้อัปโหลด → Frontend ต้อง handle กรณีนี้ (แสดง "-" หรือ "ไม่ทราบ")
7. **Bot visible_to[] กับสมาชิกที่ถูกลบ** — ถ้า member ออกจาก org แล้วแต่ user_id ยังค้างอยู่ใน `visible_to[]` → ไม่กระทบการทำงาน (แค่ ID ที่ไม่ match) แต่ควร cleanup ตอน member ออก
8. **Notification badge polling** — ถ้าดึง pending count + unread count บ่อยเกินไปจะเป็นภาระ DB → ควรใช้ polling interval (เช่น ทุก 30 วินาที) ไม่ใช่ทุก render
