# Implementation Plan — แก้ไขตามคอมเม้น (24 เมษายน 2569)

> **อัพเดทล่าสุด:** 26 เมษายน 2569

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

### 3.1 แบ่งกลุ่มการมองเห็นบอท ✅ เสร็จแล้ว

> **Implement เมื่อ:** 26 เม.ย. 2569

**สิ่งที่ Implement ไปแล้ว:**

| รายการ | รายละเอียด |
|--------|-----------|
| **DB: visibility + visible_to** | `visibility TEXT` (all/restricted) + `visible_to UUID[]` + GIN index (migration 020) |
| **DB: visibility_label** | `visibility_label TEXT` — ชื่อกลุ่ม เช่น "HR", "ฝ่ายขาย" |
| **DB: ป้องกันชื่อซ้ำ** | Unique index `idx_bots_unique_name_per_org` — case-insensitive ต่อ org เฉพาะ active bots |
| **Backend: list_bots()** | Org Admin เห็นทุกตัว / Member เห็นเฉพาะ `visibility='all'` หรือ user_id ∈ `visible_to` |
| **Backend: create/update** | รับ `visibility` + `visible_to` + `visibility_label` / เช็คชื่อซ้ำ → 409 |
| **Backend: chat.py** | `_validate_bot()` เช็ค visibility ตอนแชท — ป้องกัน API bypass |
| **Frontend: Visibility toggle** | Toggle 2 ช่อง (ทุกคนใน Org / เฉพาะกลุ่ม) ในฟอร์ม create/edit |
| **Frontend: ชื่อกลุ่ม** | Input "ชื่อกลุ่ม" + existing group suggestion chips (กดแล้ว auto-fill สมาชิกจากบอทตัวอื่น) |
| **Frontend: Member selector** | Modal เลือกสมาชิก (ไม่รวม admin — เข้าถึงได้เสมอ) + chips แสดงคนที่เลือก |
| **Frontend: Badge** | การ์ดบอทแสดง badge สีฟ้า "ส่วนกลาง" / สีส้ม "เฉพาะกลุ่ม: ชื่อ" |
| **Frontend: Filter chips** | ปุ่มกรอง "ทั้งหมด" / "ส่วนกลาง" / ชื่อกลุ่มแต่ละกลุ่ม ใต้ช่องค้นหา |
| **Frontend: จำนวนบอท** | แสดง "บอททั้งหมด N ตัว" ใต้หัวข้อหน้า |
| **Frontend: 409 handling** | Toast แจ้ง "ชื่อบอทนี้มีอยู่แล้วในองค์กร" เมื่อชื่อซ้ำ |

**ไฟล์ที่แก้ไข:**

| ไฟล์ | การแก้ไข |
|------|----------|
| `backend/sql/020_comment_feedback_migrations.sql` | เพิ่ม `visibility`, `visible_to`, `visibility_label`, unique index ชื่อบอท |
| `backend/app/routers/bot.py` | Create/Update/Response models + visibility filter + duplicate name check |
| `backend/app/routers/chat.py` | `_validate_bot()` เช็ค visibility |
| `frontend/src/types/index.ts` | `Bot` เพิ่ม `visibility`, `visible_to`, `visibility_label` |
| `frontend/src/api/endpoints.ts` | `botsApi.create()` เพิ่ม visibility params |
| `frontend/src/pages/BotsPage.tsx` | Visibility toggle, member modal, group auto-fill, badges, filter chips, duplicate handling |
| `frontend/src/i18n/th.json` + `en.json` | เพิ่ม ~20 keys (visibility, badge, groupName, filter, existingGroups, duplicateName) |

---

## 4. การปรับปรุง UI/UX และการแจ้งเตือน

### 4.1 Notification Badge บนเมนู ✅ เสร็จแล้ว

> **Implement เมื่อ:** 27 เม.ย. 2569

**สิ่งที่ Implement ไปแล้ว:**

| รายการ | รายละเอียด |
|--------|-----------|
| **Badge "องค์กร"** | แสดงจำนวนสมาชิกรออนุมัติ (org-level, Org Admin เท่านั้น) |
| **Badge "กล่องข้อความ"** | แสดงจำนวน session ที่เรียกหาแอดมิน (`status = 'human_takeover'`) |
| **Badge "อนุมัติผู้ใช้"** | แสดงจำนวน user รออนุมัติ platform-wide (support/admin เท่านั้น) |
| **Polling 10 วินาที** | อัพเดทอัตโนมัติทุก 10 วินาที + refresh เมื่อเปลี่ยนหน้า + refresh เมื่อกลับมาที่ tab |
| **ไม่ต้องเพิ่ม DB** | ใช้ข้อมูลจาก `chat_sessions`, `org_invitations`, `user_profiles` ที่มีอยู่แล้ว |

**ไฟล์ที่แก้ไข:**

| ไฟล์ | การแก้ไข |
|------|----------|
| `backend/app/routers/inbox.py` | เพิ่ม `GET /api/inbox/takeover-count` — นับ session `human_takeover` |
| `frontend/src/api/endpoints.ts` | เพิ่ม `inboxApi.takeoverCount()` |
| `frontend/src/layouts/DashboardLayout.tsx` | Badge counts polling + render badge สีแดงบน nav items (รองรับ sidebar ปกติ + ย่อ) |

> **หมายเหตุ:** Unread chat count (นับข้อความที่ยังไม่อ่าน) ไม่ได้ทำเพราะต้องสร้าง table ใหม่ — ใช้ takeover count แทนซึ่งตอบโจทย์ "ลูกค้าเรียกหาแอดมิน" ได้ตรงกว่า

---

### 4.2 ความสอดคล้องของคำศัพท์และสี ✅ เสร็จแล้ว

> **Implement เมื่อ:** 27 เม.ย. 2569

**ผล Audit:**

| ตรวจสอบ | ผล |
|---------|-----|
| i18n keys TH/EN ครบ | ✅ 655 keys ตรงกันทั้ง 2 ภาษา |
| "Bot" vs "บอท" | ✅ ถูกต้องทุกหน้า ไม่มี "AI Bot" ปน |
| "คลังความรู้" | ✅ ใช้ i18n ถูกต้อง |
| สี badge/สถานะ | ✅ เขียว=พร้อม, เหลือง=รอ, แดง=ผิดพลาด ทุกหน้า |
| Hardcoded strings | ✅ แก้ InboxPage.tsx "ทั้งหมด/LINE/Web" → i18n |
| "owner" → "admin" | ✅ เปลี่ยน `dangerZone.ownerOnly` → `dangerZone.adminOnly` |

**ไฟล์ที่แก้ไข:**

| ไฟล์ | การแก้ไข |
|------|----------|
| `frontend/src/pages/InboxPage.tsx` | แก้ hardcoded "ทั้งหมด" → `t("inbox.filterAll")` |
| `frontend/src/pages/DangerZonePage.tsx` | เปลี่ยน key `dangerZone.ownerOnly` → `dangerZone.adminOnly` |
| `frontend/src/i18n/th.json` + `en.json` | เพิ่ม `inbox.filterAll/Line/Web` + rename `dangerZone.adminOnly` |

---

## สรุปลำดับความสำคัญ (Priority)

| ลำดับ | งาน | ความซับซ้อน | ผลกระทบ | สถานะ |
|-------|-----|-------------|---------|-------|
| ~~2~~ | ~~ปรับระบบอนุมัติ + ประวัติ (1.1, 1.2)~~ | ~~สูง~~ | ~~เปลี่ยน flow หลัก~~ | ✅ เสร็จแล้ว |
| ~~1~~ | ~~แจ้งเตือน PDF + รายละเอียดไฟล์ + Block Scan (2.1, 2.2)~~ | ~~ต่ำ-กลาง~~ | ~~แก้ปัญหาผู้ใช้สับสน~~ | ✅ เสร็จแล้ว |
| ~~5~~ | ~~ระบบแท็ก (2.3)~~ | ~~กลาง~~ | ~~ต้องการเมื่อเอกสารเยอะ~~ | ✅ เสร็จแล้ว |
| ~~4~~ | ~~Bot Visibility (3.1)~~ | ~~กลาง~~ | ~~ต้องการเมื่อ org มีหลายแผนก~~ | ✅ เสร็จแล้ว |
| ~~3~~ | ~~Notification Badge (4.1)~~ | ~~กลาง~~ | ~~UX ดีขึ้นมาก~~ | ✅ เสร็จแล้ว |
| ~~6~~ | ~~คำศัพท์/สี (4.2)~~ | ~~ต่ำ~~ | ~~audit ซ้ำหลัง implement~~ | ✅ เสร็จแล้ว |

---

## SQL Migration

รวมทุกอย่างในไฟล์เดียว — รันบน Supabase SQL Editor ได้เลย:

```
backend/sql/020_comment_feedback_migrations.sql
```

ประกอบด้วย:
1. **User Approval Tracking** — `approved_by` + `approved_at` ใน user_profiles
2. **Documents uploaded_by + tags** — `uploaded_by` + `tags TEXT[]` + GIN index ใน documents
3. **Bot Visibility** — `visibility` + `visible_to UUID[]` + `visibility_label TEXT` + GIN index + unique name index ใน bots
4. **Auto-approve invited users** — trigger `handle_new_auth_user()` เช็ค invitation ตอนสมัคร

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
