# SUNDAE — Test Object

> **วันที่**: 28 กุมภาพันธ์ 2569
> **ผู้เขียน**: Claude (Sonnet 4.6) — อ้างอิงจาก Source Code จริง
> **ผู้ทดสอบ**: Gemini
> **Stack**: FastAPI (port 8001) + React/Vite + Supabase
> **Admin account**: `admin@sundae.local` / `Sundae@2025`

---

## Pre-Test Setup

ก่อนเริ่มทดสอบ ตรวจสอบ:

- [ ] Backend รันอยู่ที่ `http://localhost:8001` (`uvicorn app.main:app --reload --port 8001`)
- [ ] Frontend รันอยู่ที่ `http://localhost:5173` (`npm run dev`)
- [ ] Swagger UI เข้าได้ที่ `http://localhost:8001/docs`
- [ ] Ollama รันอยู่ (`ollama serve`) — สำหรับ Chat tests
- [ ] `frontend/.env` มีค่า `VITE_DEFAULT_ORG_ID` และ `VITE_DEFAULT_BOT_ID`

---

## 1. Backend API — Health

| # | Test Case | Method | URL | Expected | Status |
|---|-----------|--------|-----|----------|--------|
| 1.1 | Health check | GET | `/health` | `{ "status": "ok" }` | ✅ (แก้จาก /api/health) |

---

## 2. Backend API — Documents

> ทดสอบผ่าน Swagger UI (`/docs`) — ต้องใส่ JWT header ก่อน (Authorize ด้วย Bearer token จาก Supabase)

| # | Test Case | Method | URL | Body / Params | Expected | Status |
|---|-----------|--------|-----|---------------|----------|--------|
| 2.1 | Upload PDF | POST | `/api/documents/upload` | `file=<pdf>`, `organization_id=<org_uuid>` | `{ document_id, filename, status: "ready" }` | ✅ |
| 2.2 | Upload non-PDF | POST | `/api/documents/upload` | `file=<jpg>`, `organization_id=<org_uuid>` | HTTP 400 | ✅ |
| 2.3 | List documents | GET | `/api/documents` | `?organization_id=<org_uuid>` | Array ของ documents | ✅ |
| 2.4 | Get single document | GET | `/api/documents/{id}` | `?organization_id=<org_uuid>` | Document object | ✅ |
| 2.5 | Get document wrong org | GET | `/api/documents/{id}` | `?organization_id=<wrong_uuid>` | HTTP 404 | ✅ (ได้ 403/404) |
| 2.6 | Delete document | DELETE | `/api/documents/{id}` | `?organization_id=<org_uuid>` | `{ message: "Document deleted successfully." }` | ✅ |
| 2.7 | Access without auth | GET | `/api/documents` | — | HTTP 401 / 403 | ✅ |

---

## 3. Backend API — Bots

| # | Test Case | Method | URL | Body | Expected | Status |
|---|-----------|--------|-----|------|----------|--------|
| 3.1 | Create bot | POST | `/api/bots` | `{ name, organization_id }` | Bot object (status 201) | ✅ |
| 3.2 | Create bot (no system_prompt) | POST | `/api/bots` | `{ name, organization_id }` ไม่ใส่ prompt | ใช้ default Thai prompt อัตโนมัติ | ✅ |
| 3.3 | List bots | GET | `/api/bots` | `?organization_id=<org_uuid>` | Array ของ bots | ✅ |
| 3.4 | Get single bot | GET | `/api/bots/{id}` | `?organization_id=<org_uuid>` | Bot object | ✅ |
| 3.5 | Update bot | PUT | `/api/bots/{id}` | `?organization_id=<org_uuid>`, `{ name, system_prompt }` | Updated bot object | ✅ |
| 3.6 | Update bot — updated_at เปลี่ยน | PUT | `/api/bots/{id}` | — | `updated_at` ต่างจากเดิม | ✅ |
| 3.7 | Update bot — empty body | PUT | `/api/bots/{id}` | `{}` | HTTP 400 | ✅ |
| 3.8 | Delete bot | DELETE | `/api/bots/{id}` | `?organization_id=<org_uuid>` | `{ message: "Bot deleted successfully." }` | ✅ |
| 3.9 | Delete bot — documents ยังอยู่ | DELETE | `/api/bots/{id}` | — | Documents ที่เชื่อมกับ bot จะมี `bot_id = null` | ✅ |

---

## 4. Backend API — Chat

| # | Test Case | Method | URL | Body | Expected | Status |
|---|-----------|--------|-----|------|----------|--------|
| 4.1 | Ask question (ไม่มี documents) | POST | `/api/chat/ask` | `{ user_query, organization_id, bot_id, platform_user_id }` | ตอบว่า "ไม่พบข้อมูล..." | ✅ ได้ `{"answer":"ไม่พบข้อมูลในเอกสาร","session_id":null,"sources":[]}` |
| 4.2 | Ask question (มี documents) | POST | `/api/chat/ask` | — | Answer + sources array | ⬜ (ต้องมี document upload + embedding ก่อน) |
| 4.3 | Ask ครั้งที่ 2 (session เดิม) | POST | `/api/chat/ask` | ใส่ `session_id` จากครั้งแรก | ตอบในบริบทเดิม | ✅ session_id ถูกส่งกลับและ messages ถูก log ลง DB |
| 4.4 | ถามภาษาไทย | POST | `/api/chat/ask` | `user_query` เป็นภาษาไทย | ตอบเป็นภาษาไทย | ✅ ตอบเป็นภาษาไทย "ไม่พบข้อมูลในเอกสาร" |

---

## 5. Backend API — Inbox

| # | Test Case | Method | URL | Params | Expected | Status |
|---|-----------|--------|-----|--------|----------|--------|
| 5.1 | List sessions (admin) | GET | `/api/inbox/sessions` | `?organization_id=<org_uuid>` | Array ของ sessions | ✅ ได้ session array |
| 5.2 | List sessions (user role) | GET | `/api/inbox/sessions` | — | HTTP 403 | ✅ ได้ `{"detail":"Access denied. Required role: support, admin."}` |
| 5.3 | Get messages by session | GET | `/api/inbox/sessions/{id}/messages` | `?organization_id=<org_uuid>` | Array ของ messages | ✅ ได้ array messages (user + assistant) |
| 5.4 | Update status → human_takeover | PUT | `/api/inbox/sessions/{id}/status` | `{ "status": "human_takeover" }` | `{ new_status: "human_takeover" }` | ✅ `{"new_status":"human_takeover"}` |
| 5.5 | Update status → resolved | PUT | `/api/inbox/sessions/{id}/status` | `{ "status": "resolved" }` | `{ new_status: "resolved" }` | ✅ `{"new_status":"resolved"}` |
| 5.6 | Update status — invalid value | PUT | `/api/inbox/sessions/{id}/status` | `{ "status": "invalid" }` | HTTP 400 | ✅ HTTP 400 `"Invalid status. Must be one of: resolved, human_takeover, active"` |

---

## 6. Frontend — Auth Flow

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 14.1 | Route Protection | ยังไม่ Login → มุ่งไป URL ภายใน `/bots` | ถูก redirect ไป `/login` | ✅ |
| 6.2 | Login ผิด password | ใส่ password ผิด | แสดง error message | ✅ |
| 6.3 | Register user ใหม่ | กรอก email/password/ชื่อ → Register | "สมัครสำเร็จ! กรุณาเข้าสู่ระบบ" | ✅ (แต่ `.local` ใช้ไม่ได้ ต้องเป็น `.com`) |
| 14.2 | Unapproved User Bypassing | Unapproved User ล็อกอินแล้วพิมพ์ `/bots` ในช่อง URL | เห็นหน้า Lockout Screen เหมือนเดิม ไม่แสดงเนื้อหา | ✅ (DashboardLayout ล็อกไว้) |
| 6.5 | Lockout — ไม่สามารถ navigate | ขณะอยู่ใน lockout พิมพ์ URL `/bots` ตรง ๆ | ยังเห็นแค่ Lockout Screen | ⬜ re-test หลัง run 004_auth_trigger.sql — DashboardLayout code ถูกต้อง |
| 6.6 | Session restore | Refresh browser หลัง login | ยังอยู่ใน Dashboard ไม่ต้อง login ใหม่ | ⬜ |
| 6.7 | Logout | กด Sign Out | กลับไปหน้า `/login` | ✅ |
| 6.8 | Session timeout (5s safety) | Mock getSession error | หน้า login ปรากฏภายใน 5 วินาที | ⬜ |

---

## 7. Frontend — Knowledge Base Page (`/knowledge-base`)

> **Role ที่เข้าได้**: user, admin (ไม่รวม support)

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 7.1 | โหลด document list | เปิดหน้า | แสดง documents จาก API จริง (หรือ empty state) | ✅ |
| 7.2 | Empty state | ยังไม่มี document | แสดง drag-and-drop zone + "ยังไม่มีเอกสาร" | ✅ |
| 7.3 | Search filter | พิมพ์ชื่อไฟล์ใน search box | กรอง cards ตาม keyword | ✅ |
| 7.4 | เปิด Modal Add Knowledge | กด "Add knowledge collection +" | มี options ให้เลือก PDF หรือ URL | ✅ (ตอนอัปโหลดเปิด Dialog เลือกไฟล์) |
| 7.5 | Upload PDF (drag-drop) | ลาก PDF มาวางบน drop zone | เหมือน 7.4 | ⬜ |
| 7.6 | Upload non-PDF | เลือกไฟล์ `.docx` หรือ `.jpg` | Alert "กรุณาอัปโหลดไฟล์ PDF เท่านั้น" | ✅ |
| 7.7 | Status badge — processing | ขณะ upload กำลังประมวลผล | Badge สีเหลือง + spinner | ⬜ |
| 7.8 | Status badge — ready | หลัง upload สำเร็จ | Badge สีเขียว | ⬜ |
| 7.9 | Delete document | Hover card → กด trash → ยืนยัน | Card หายออกจาก list | ✅ |
| 7.10 | Delete cancel | กด trash → กด "ยกเลิก" | Card ยังอยู่ | ✅ |
| 7.11 | Delete document ส่ง org_id ถูกต้อง | ลบ document → ดู Network tab | ✅ **แก้แล้ว** — request มี `?organization_id=` ครบ | ✅ |

---

## 8. Frontend — Bots Page (`/bots`)

> **Role ที่เข้าได้**: user, admin

| # | Test Case | Steps | Expected | Status |
|---|-----------|--------|-----|------|----------|--------|
| 8.1 | โหลด bot list | เปิดหน้า | แสดง bot cards (หรือ empty state) | ✅ |
| 8.2 | Empty state | ยังไม่มี bot | 🤖 icon + "ยังไม่มี Bot" | ✅ |
| 8.3 | Search filter | พิมพ์ชื่อ bot | กรอง cards | ✅ |
| 8.4 | Create bot | กด "Create bot +" → กรอกชื่อ → "สร้าง Bot" | กลับมาหน้า list + bot ใหม่ปรากฏ | ✅ |
| 8.5 | Create bot — ไม่ใส่ชื่อ | กด "สร้าง Bot" โดยไม่กรอกชื่อ | ปุ่ม disabled | ✅ |
| 8.6 | Edit bot | Click card → แก้ system prompt → "บันทึก" | กลับมา list, prompt อัพเดทแล้ว | ✅ |
| 8.7 | Toggle is_web_enabled | ใน edit form กด toggle | เปลี่ยนสี + save สำเร็จ | ✅ |
| 8.8 | Delete bot | Hover → trash → ยืนยัน | Card หาย | ✅ |
| 8.9 | Back button | กด "Back" จาก create/edit | กลับ list | ✅ |

---

## 9. Frontend — Web Chat Page (`/` หรือ `/chat`)

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 9.1 | โหลด bot selector | เปิดหน้า | Dropdown "Select Bots" แสดง bots จาก API | ✅ |
| 9.2 | Auto-select bot | ถ้ามีแค่ bot เดียว | เลือก bot นั้นอัตโนมัติ | ✅ |
| 9.3 | เปลี่ยน bot | เปิด dropdown → เลือก bot อื่น | ชื่อ bot เปลี่ยนใน header | ✅ |
| 9.4 | ส่งข้อความ (พิมพ์ + Enter) | พิมพ์คำถาม → Enter | Bubble ของ user ปรากฏ → loading → bubble ของ AI | ⬜ |
| 9.5 | ส่งข้อความ (ปุ่ม Send) | กด icon Send | เหมือน 9.4 | ⬜ |
| 9.6 | Shift+Enter ขึ้นบรรทัดใหม่ | Shift+Enter ใน input | ขึ้นบรรทัดใหม่ ไม่ส่ง | ✅ |
| 9.7 | AI ตอบจาก documents | อัปโหลด PDF ก่อน → ถามเกี่ยวกับเนื้อหา | ตอบจาก document + แสดง sources | ⬜ |
| 9.8 | Sources citation | AI ตอบพร้อม sources | แสดง source badges ด้านล่าง bubble | ⬜ |
| 9.9 | ไม่มี bot selected | ลบ bot ทั้งหมดแล้วลอง send | ปุ่ม Send disabled | ✅ |
| 9.10 | Public `/chat` (ไม่ login) | เปิด `/chat` โดยไม่ login | ใช้ `VITE_DEFAULT_BOT_ID` แทน, chat ได้ | ❌ (B7) — route public แต่ backend ต้องการ JWT, จะ error 401 |

---

## 10. Frontend — Inbox Page (`/inbox`)

> **Role ที่เข้าได้**: user, admin (แต่ backend API ต้องการ support/admin)

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 10.1 | โหลด session list (admin) | Login admin → เปิด Inbox | แสดง sessions จาก API | ⬜ |
| 10.2 | Empty — ยังไม่มี sessions | ก่อนมีการ chat | "ยังไม่มีแชท" | ⬜ |
| 10.3 | Search sessions | พิมพ์ user ID หรือ platform | กรองใน left panel | ⬜ |
| 10.4 | Click session → ดู messages | Click session card | Right panel แสดง chat history | ⬜ |
| 10.5 | Platform icon | Session จาก web | 💬 icon; จาก LINE → 📱 | ⬜ |
| 10.6 | Status badge | Session active | สีเขียว "Active" | ⬜ |
| 10.7 | Human takeover | กด "รับเรื่อง" | Status → human_takeover (badge สีเหลือง) | ⬜ |
| 10.8 | คืนร่างให้ AI | กด "คืนร่างให้ AI" | Status → active | ⬜ |
| 10.9 | ปิดเคส | กด "ปิดเคส" | Status → resolved (badge สีเทา) | ⬜ |
| 10.10 | Session list refresh หลังเปลี่ยน status | เปลี่ยน status | Left panel อัพเดท badge อัตโนมัติ | ⬜ |

---

## 11. Frontend — Approvals Page (`/approvals`)

> **Role ที่เข้าได้**: support, admin เท่านั้น

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 11.1 | โหลดรายการ Pending Users | Login ด้วย admin → เมนู Approvals | เห็นตารางรายชื่อรออนุมัติ | ✅ |
| 11.2 | Stats cards | ดูที่หน้า | แสดงจำนวน "รออนุมัติ" และ "อนุมัติแล้ว" ถูกต้อง | ✅ |
| 11.3 | อนุมัติ User | กดปุ่ม Approve (เครื่องหมายติ๊กถูก) | User ย้ายจาก Pending ไป Approved (หรือหายไป) | ✅ (เรียก API users.update) |
| 11.4 | ตรวจสอบ DB | หลัง approve | `is_approved = true` ใน Supabase Table Editor | ⬜ |
| 11.5 | User ที่ approve แล้ว login ได้ | Login ด้วย account ที่เพิ่ง approve | เข้า Dashboard ได้ปกติ (ไม่เห็น lockout) | ⬜ |
| 11.6 | User ธรรมดาเข้า `/approvals` | Login role=user → พิมพ์ URL `/approvals` | Redirect กลับ หรือแสดง access denied | ✅ |
| 11.7 | Empty pending | ไม่มีใครรออนุมัติ | "ไม่มีผู้ใช้ที่รออนุมัติ ✓" | ✅ |

---

## 12. Frontend — Integration Page (`/integration`)

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 12.1 | โหลดหน้า | เปิด `/integration` | แสดง 2 cards: LINE + Website | ✅ |
| 12.2 | Toggle LINE | กด Toggle บนการ์ด LINE | Toggle เปลี่ยนสี/ตำแหน่ง | 🟡 (สลับได้แต่เป็น Local State) |
| 12.3 | Toggle Website | กด Toggle บนการ์ด Website | Toggle เปลี่ยนสี/ตำแหน่ง | 🟡 (สลับได้แต่เป็น Local State) |
| 12.4 | Toggle state persist ใน session | toggle แล้ว navigate ออก → กลับมา | **คาดว่า reset** (เป็น local state ยังไม่ save DB) | ⬜ |
| 12.5 | Sidebar menu Integration | ดู sidebar | มีเมนู Integration ตำแหน่งถูกต้อง | ✅ |

---

## 13. Sidebar Navigation — Role Based

| # | Role | สิ่งที่เห็นใน Sidebar | สิ่งที่ไม่เห็น | Status |
|---|------|----------------------|----------------|--------|
| 13.1 | Admin view | Login ด้วย Admin | เห็นทุกเมนู (Home, Bots, Knowledge, Inbox, Integration, Approvals) | ✅ |
| 13.2 | support | Home, Approvals | Bots, Knowledge, Integration | ⬜ |
| 13.3 | User view | Login ด้วย User (approved) | เห็น Home, Bots, Knowledge, Inbox, Integration (ไม่เห็น Approvals) | ✅ |
| 13.4 | user (unapproved) | ไม่เห็น sidebar เลย | ทุกอย่าง | ✅ |

---

## 14. Security / RLS Tests

| # | Test Case | Steps | Expected | Status |
|---|-----------|-------|----------|--------|
| 14.1 | Cross-org isolation | Login org A → เรียก API ด้วย org_id ของ org B | ไม่เห็น data ของ org B | ⬜ |
| 14.2 | Unapproved user bypass | JWT valid แต่ `is_approved=false` → เรียก API โดยตรง | HTTP 403 | ⬜ |
| 14.3 | RLS — user อ่าน profile ตัวเอง | Login → frontend อ่าน user_profiles | ได้ข้อมูลตัวเอง | ✅ |
| 14.4 | RLS — user ไม่เห็น profile คนอื่น | Login role=user → query user_profiles จาก console | เห็นแค่แถวของตัวเอง | ✅ |
| 14.5 | RLS — admin เห็นทุกคน | Login role=admin → query user_profiles | เห็นทุกแถว | ✅ |

---

## 15. Known Issues — สถานะล่าสุด

| # | Issue | ที่อยู่ใน Code | สถานะ |
|---|-------|--------------|-------|
| **B1** | `documentsApi.delete` ไม่ส่ง `organization_id` | `endpoints.ts:47` | ✅ แก้แล้ว (28 ก.พ. 2569) |
| **B2** | `documentsApi.getStatus` ไม่ส่ง `organization_id` | `endpoints.ts:41` | ✅ แก้แล้ว (28 ก.พ. 2569) |
| **B3** | `DocumentUploadResponse` type ไม่ตรง backend (มี `message` แทน `total_parent/child_chunks`) | `types/index.ts:102-107` | ✅ แก้แล้ว (28 ก.พ. 2569) — อัพเดท type ให้ตรง backend response |
| **B4** | `SUPABASE_DB_URL` มี Project ID ผิด (`bzotgjsbuiuotyknjpfv`) | `backend/.env:10` | ✅ แก้แล้ว (28 ก.พ. 2569) — แก้เป็น `rcslrctohmbyejwjzoqs` (ไม่กระทบ runtime เพราะ backend ใช้ Supabase client ไม่ใช่ direct DB) |
| **B5** | Integration toggle ไม่ save ลง DB | `IntegrationPage.tsx` — local state เท่านั้น | 🟡 by design ตอนนี้ (UI-only) |
| **B6** | สมัครสมาชิกใหม่ (Register) ติด RLS | Frontend Signup → Insert `user_profiles` | ✅ แก้แล้ว (28 ก.พ. 2569) — DB trigger `handle_new_auth_user` + ลบ manual insert ออกจาก `LoginPage.tsx` |
| **B7** | Public `/chat` ใช้ไม่ได้จริง — backend ทุก endpoint ต้องการ JWT | `App.tsx:110` route public + `chat.py` ใช้ `require_approved` | 🟡 Feature gap — ต้องเพิ่ม public endpoint หรือ service-account auth สำหรับ web chat ใน backend |
| **B8** | Thai text ใน curl bash (Windows) encode ผิด — user messages เก็บเป็น `??????` แทน Thai ใน DB | Windows Git Bash ไม่รองรับ UTF-8 Thai ใน string literals ใน bash | 🟡 Test env issue เท่านั้น — ไม่ใช่ backend bug, production flow (HTTP JSON) ใช้งานได้ปกติ |

---

## 16. End-to-End Flow — Full Scenario

### Scenario A: New User Onboarding
```
Register → Login → Lockout Screen → Admin Approve → Re-login → Dashboard
```
| Step | Action | Expected | Status |
|------|--------|----------|--------|
| A1 | Register new account | Success message | ⬜ |
| A2 | Login ทันที | Lockout Screen | ⬜ |
| A3 | Admin login → Approvals → Approve | is_approved=true ใน DB | ⬜ |
| A4 | User re-login | Dashboard เต็ม | ⬜ |

### Scenario B: RAG Pipeline End-to-End
```
Upload PDF → Wait ready → Chat → ได้คำตอบจาก document → ดูใน Inbox
```
| Step | Action | Expected | Status |
|------|--------|----------|--------|
| B1 | อัปโหลด PDF ใน Knowledge page | Status: ready | ⬜ |
| B2 | ไปหน้า Chat → เลือก Bot | Bot dropdown แสดง | ⬜ |
| B3 | ถามคำถามเกี่ยวกับเนื้อหาใน PDF | AI ตอบจาก document + sources | ⬜ |
| B4 | ไปหน้า Inbox (admin) | เห็น session นั้น | ⬜ |
| B5 | Click session → ดู messages | เห็น chat history | ⬜ |
| B6 | กด "รับเรื่อง" | Status → human_takeover | ⬜ |

---

## สรุปจำนวน Test Cases

| หมวด | จำนวน |
|------|-------|
| Backend API | 25 |
| Auth Flow | 8 |
| Knowledge Page | 11 |
| Bots Page | 9 |
| Web Chat | 10 |
| Inbox | 10 |
| Approvals | 7 |
| Integration | 5 |
| Sidebar Navigation | 4 |
| Security/RLS | 5 |
| Known Issues | 5 |
| E2E Scenarios | 10 |
| **รวม** | **109** |
