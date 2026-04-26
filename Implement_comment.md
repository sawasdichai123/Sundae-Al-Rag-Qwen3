# Implementation Plan — แก้ไขตามคอมเม้น (24 เมษายน 2569)

> **อัพเดทล่าสุด:** 25 เมษายน 2569

---

## 1. ระบบการอนุมัติและจัดการผู้ใช้งาน (User Approval & Management)

### 1.1 ปรับเปลี่ยนสิทธิ์การอนุมัติ ✅ เสร็จแล้ว

> **Implement เมื่อ:** 25 เม.ย. 2569 | **Commit:** `f645f73`

**สิ่งที่ Implement ไปแล้ว (ปรับจากแผนเดิม → ใช้ระบบ 3 Flow แทน):**

แทนที่จะให้ Org Admin approve สมาชิกทีละคน ได้เปลี่ยนเป็นระบบอนุมัติอัตโนมัติ 3 Flow:

| Flow | รายละเอียด | สถานะ |
|------|-----------|-------|
| **Flow 1** | Org Admin เชิญอีเมล → ผู้ใช้สมัคร → auto-approve + เข้า org ทันที (รองรับ multi-org) | ✅ |
| **Flow 2** | ผู้ใช้สมัครก่อน (pending) → Org Admin เชิญอีเมลนั้น → popup ยืนยัน → auto-approve + เข้า org | ✅ |
| **Flow 3** | สมัครโดยไม่มีคำเชิญ → รอ Platform Admin อนุมัติเท่านั้น | ✅ |

**ไฟล์ที่แก้ไข:**

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `backend/sql/020_comment_feedback_migrations.sql` | SQL trigger `handle_new_auth_user()` — ตรวจ `org_invitations` ตอนสมัคร ถ้ามีคำเชิญ → auto-approve + เข้า org ทันที |
| `backend/app/routers/organization.py` | `invite_member` endpoint — รองรับ 3 กรณี: ยังไม่สมัคร (409 `USER_NOT_REGISTERED`), pending approval (409 `USER_PENDING_APPROVAL`), ปกติ → มี `confirm_approve` flag สำหรับยืนยัน |
| `backend/app/routers/approval.py` | auto-accept invitation flow — เมื่อ Platform Admin approve ถ้ามี pending invitation จะ join org ให้อัตโนมัติ |
| `frontend/src/pages/OrganizationPage.tsx` | ConfirmModal popup สำหรับยืนยันการเชิญ (แทน browser `confirm()`) |
| `frontend/src/components/ConfirmModal.tsx` | **ไฟล์ใหม่** — Custom modal component รองรับ variant: warning/danger/info, ใช้ theme brand/steel |
| `frontend/src/api/endpoints.ts` | `invite()` เพิ่ม `confirmApprove` parameter |
| `frontend/src/i18n/th.json` + `en.json` | เพิ่ม ~14 keys สำหรับ invite confirmation messages |

**การปรับปรุง UI เพิ่มเติมที่ทำพร้อมกัน:**

| รายการ | ไฟล์ที่แก้ |
|--------|-----------|
| ลบ backdrop สีดำออกจาก modal ทุกจุด | `BotsPage.tsx`, `KnowledgeBasePage.tsx`, `OrganizationPage.tsx` |
| Password validation — label + error handling ตรงกับเงื่อนไข (8 ตัวขึ้นไป) | `LoginPage.tsx` |
| Protected org เปลี่ยนจากเช็ค slug → เช็ค org ID (ป้องกัน bypass) | `DangerZonePage.tsx`, `ProfilePage.tsx`, `OrganizationPage.tsx` |
| แยก canManage (promote/demote) กับ canRemove (ลบสมาชิก) | `OrganizationPage.tsx` |

---

### 1.2 แสดงสถานะผู้ใช้ + ประวัติการอนุมัติ ✅ เสร็จแล้ว

> **Implement เมื่อ:** 25 เม.ย. 2569 | **Commit:** `f645f73`

**สิ่งที่ Implement ไปแล้ว:**

#### Database (SQL Migration)
```sql
-- เพิ่ม 2 columns ใน user_profiles (อยู่ใน 020_comment_feedback_migrations.sql)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES user_profiles(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
```

#### Backend
| ไฟล์ | การเปลี่ยนแปลง | สถานะ |
|------|----------------|-------|
| `backend/app/routers/approval.py` | ตอน approve → UPDATE `approved_by = admin.id`, `approved_at = now()` | ✅ |
| `backend/app/routers/approval.py` | endpoint `GET /api/admin/approved-users` — JOIN approver email, เรียงล่าสุดก่อน | ✅ |
| `frontend/src/pages/ApprovalsPage.tsx` | แสดงประวัติ: ผู้อนุมัติ + วันเวลา, auto-approved badge, stats cards (pending/approved) | ✅ |
| `frontend/src/types/index.ts` | เพิ่ม `ApprovedUser` interface | ✅ |
| `frontend/src/api/endpoints.ts` | เพิ่ม `listApproved()` API call | ✅ |

---

## 2. การจัดการคลังความรู้และไฟล์ (Knowledge Base & Files)

### 2.1 แจ้งเตือนรองรับเฉพาะ PDF + Block Scanned PDF ✅ เสร็จแล้ว

> **Implement เมื่อ:** 26 เม.ย. 2569

**สิ่งที่ Implement ไปแล้ว:**

| รายการ | รายละเอียด |
|--------|-----------|
| Info banner | แสดง "รองรับเฉพาะไฟล์ PDF แบบมีข้อความ (ขนาดสูงสุด 50 MB) — ไฟล์ PDF สแกนไม่รองรับ" |
| Block scanned PDF | ตรวจสอบ text layer **ก่อน** สร้าง record — ถ้าดึงข้อความไม่ได้ → reject ทันที ไม่สร้าง record ค้างในระบบ |
| Error message | Toast แจ้ง "ไฟล์นี้เป็น PDF สแกน (ภาพ) ไม่สามารถดึงข้อความได้ กรุณาอัปโหลด PDF ที่มีข้อความ" |

**ไฟล์ที่แก้ไข:**
- `backend/app/routers/document.py` — ย้าย `extract_text_from_pdf()` ขึ้นมาก่อน insert record
- `frontend/src/pages/KnowledgeBasePage.tsx` — เพิ่ม banner + error handling สำหรับ scanned PDF
- `frontend/src/i18n/th.json` + `en.json` — เพิ่ม keys: `kb.pdfOnlyNotice`, `kb.scannedPdfError`

**แนวทาง OCR ในอนาคต (ถ้าต้องการรองรับ PDF สแกน):**

| แนวทาง | Library | ข้อดี | ข้อเสีย |
|--------|---------|-------|---------|
| **Tesseract OCR** | `pytesseract` + `pdf2image` | ฟรี, รองรับภาษาไทย | ต้องติดตั้ง system dependency (`tesseract-ocr`, `poppler`), ช้า |
| **EasyOCR** | `easyocr` | รองรับไทย built-in, ง่าย | โมเดลใหญ่ (~1GB), ใช้ GPU ดีกว่า |
| **Google Cloud Vision** | `google-cloud-vision` | แม่นมาก, เร็ว | มีค่าใช้จ่าย API, ต้อง setup credentials |
| **Azure AI Document Intelligence** | `azure-ai-formrecognizer` | แม่น, รองรับ table extraction | มีค่าใช้จ่าย, ซับซ้อนกว่า |

> **แผนการ implement OCR:**
> 1. ตรวจจับ scanned PDF → ถ้าดึง text ไม่ได้ → ถาม user ว่าต้องการใช้ OCR หรือไม่
> 2. แปลง PDF page → image (ใช้ `pdf2image` + `poppler`)
> 3. OCR แต่ละ page → text (ใช้ Tesseract/EasyOCR)
> 4. ต่อ text เข้ากับ pipeline เดิม (chunking → embedding → store)
> 5. เพิ่ม flag `is_ocr: true` ใน documents เพื่อแยกแยะ

---

### 2.2 แสดงรายละเอียดไฟล์ให้ครบถ้วน ✅ เสร็จแล้ว

> **Implement เมื่อ:** 26 เม.ย. 2569

**สิ่งที่ Implement ไปแล้ว:**

| รายการ | รายละเอียด |
|--------|-----------|
| `uploaded_by` column | บันทึก user ID ตอน upload (เอกสารเก่า = NULL) |
| Uploader name | JOIN `user_profiles` แสดง "อัปโหลดโดย ชื่อ-นามสกุล" |
| วันที่ absolute | เปลี่ยนจาก "5 นาทีที่แล้ว" → "อัปโหลดเมื่อ DD/MM/YYYY" |
| Status badge | เขียว (พร้อมใช้งาน) / เหลือง (กำลังประมวลผล) / แดง (ผิดพลาด) — มีอยู่แล้ว |

**ไฟล์ที่แก้ไข:**
- `backend/app/routers/document.py` — `DocumentResponse` เพิ่ม `uploaded_by`, `uploader_name`, `tags` / `list_documents()` JOIN uploader / `upload_document()` บันทึก `uploaded_by`
- `frontend/src/pages/KnowledgeBasePage.tsx` — แสดง uploader name + วันที่ absolute
- `frontend/src/types/index.ts` — `Document` interface เพิ่ม `tags`, `uploaded_by`, `uploader_name`

---

### 2.3 ระบบแท็กจัดกลุ่มไฟล์ ✅ เสร็จแล้ว

> **Implement เมื่อ:** 26 เม.ย. 2569

**สิ่งที่ Implement ไปแล้ว:**

| รายการ | รายละเอียด |
|--------|-----------|
| DB | `tags TEXT[]` + GIN index ใน documents (อยู่ใน migration 020) |
| Upload รับ tags | `upload_document()` รับ `tags` parameter (comma-separated) |
| `PATCH /documents/{id}/tags` | อัพเดทแท็กของเอกสาร (Org Admin) |
| `GET /documents/tags/all` | ดึงแท็กทั้งหมดใน org (auto-suggest) |
| Tag filter bar | ปุ่มกรอง "ทั้งหมด" + ชื่อแท็ก ด้านบนรายการเอกสาร |
| Tag chips | แสดงแท็กเป็น chip บน document card |
| Edit tags modal | พิมพ์แท็กใหม่ + แสดง chip ของแท็กที่เคยใช้ให้กดเลือกได้ทันที |

**ไฟล์ที่แก้ไข:**
- `backend/app/routers/document.py` — endpoints: `update_document_tags`, `list_all_tags` / upload รับ tags
- `frontend/src/pages/KnowledgeBasePage.tsx` — tag filter bar + tag chips + edit tags modal
- `frontend/src/api/endpoints.ts` — `updateTags()`, `listTags()`, `upload()` เพิ่ม tags param
- `frontend/src/i18n/th.json` + `en.json` — ~10 keys สำหรับ tags UI

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

| ลำดับ | งาน | ความซับซ้อน | ผลกระทบ | สถานะ |
|-------|-----|-------------|---------|-------|
| ~~2~~ | ~~ปรับระบบอนุมัติ + ประวัติ (1.1, 1.2)~~ | ~~สูง~~ | ~~เปลี่ยน flow หลัก~~ | ✅ เสร็จแล้ว |
| ~~1~~ | ~~แจ้งเตือน PDF + รายละเอียดไฟล์ + Block Scan (2.1, 2.2)~~ | ~~ต่ำ-กลาง~~ | ~~แก้ปัญหาผู้ใช้สับสน~~ | ✅ เสร็จแล้ว |
| ~~5~~ | ~~ระบบแท็ก (2.3)~~ | ~~กลาง~~ | ~~ต้องการเมื่อเอกสารเยอะ~~ | ✅ เสร็จแล้ว |
| 3 | Notification Badge (4.1) | กลาง | UX ดีขึ้นมาก | ⏳ ยังไม่ได้ทำ |
| 4 | Bot Visibility (3.1) | กลาง | ต้องการเมื่อ org มีหลายแผนก | ⏳ ยังไม่ได้ทำ |
| 6 | คำศัพท์/สี (4.2) | ต่ำ | audit ซ้ำหลัง implement | ⏳ ยังไม่ได้ทำ |

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
