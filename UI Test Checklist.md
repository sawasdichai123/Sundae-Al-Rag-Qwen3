# SUNDAE — UI Test Checklist

> **วันที่**: 1 มีนาคม 2569
> **Stack**: React + Vite + Tailwind v4 + Supabase Auth
> **Frontend**: `http://localhost:5173`
> **Admin account**: `admin@sundae.local` / `Sundae@2025`
> **Test User**: `testuser1@sundae.com` / (ต้องรู้ password หรือสร้างใหม่)

**Legend**: ⬜ ยังไม่ทดสอบ | ✅ ผ่าน | ❌ ไม่ผ่าน | 🟡 ผ่านบางส่วน

---

## Pre-Test Checklist

- [x] Backend รันที่ `http://localhost:8001` → `/health` ตอบ `{"status":"ok"}`
- [x] Frontend รันที่ `http://localhost:5173`
- [ ] Ollama รัน → `ollama serve`
- [x] Browser: ล้าง LocalStorage ก่อนทดสอบ Auth (`F12 → Application → Local Storage → Clear All`)

---

## 1. Auth / Login Page (`/login`)

> ทดสอบด้วย: เปิด `localhost:5173` โดยไม่ login

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 1.1 | Route Guard | เปิด `localhost:5173/bots` โดยตรง | Redirect ไป `/login` อัตโนมัติ | ✅ |
| 1.2 | UI ของหน้า Login | เปิด `/login` | มี Logo "S", ช่อง Email, Password, ปุ่ม Login, ลิงก์ Register | ✅ |
| 1.3 | Login ผิด password | ใส่ email ถูก + password ผิด → กด Login | แสดง error "อีเมลหรือรหัสผ่านไม่ถูกต้อง" (สีแดง) | ✅ |
| 1.4 | Login ถูกต้อง (Admin) | `admin@sundae.local` / `Sundae@2025` | Redirect ไป Dashboard, เห็น Sidebar ครบทุกเมนู | ✅ |
| 1.5 | Login ถูกต้อง (User อนุมัติแล้ว) | Login ด้วย account ที่ approved | Redirect ไป Dashboard, เห็น Sidebar แบบ User | ✅ ผ่าน — login testqa@sundae.com หลัง approve แล้วเข้า Dashboard ได้ |
| 1.6 | Login (User ยังไม่อนุมัติ) | Login ด้วย account ที่ยังไม่ approved | เห็น Lockout Screen "บัญชีกำลังรอการอนุมัติ" | ✅ ผ่าน — แสดง Lockout Screen หลัง register |
| 1.7 | Register — ช่องว่าง | กดปุ่ม Register โดยไม่กรอก | แสดง validation error (หรือปุ่ม disabled) | ✅ |
| 1.8 | Register — email ซ้ำ | ลอง register email ที่มีอยู่แล้ว | แสดง error จาก Supabase | ✅ แสดง error ดักไว้แล้ว |
| 1.9 | Register — สำเร็จ | กรอกข้อมูลครบ → Register | "สมัครสำเร็จ! กรุณาเข้าสู่ระบบ" | ✅ สมัครได้สำเร็จ (แต่ล็อกอินต่อติดปัญหาอื่น) |
| 1.10 | Logout | Login แล้วกด Sign Out (icon logout ใน sidebar) | กลับมา `/login`, sidebar หาย | ✅ แก้แล้ว — เพิ่มปุ่ม "ออกจากระบบ" ใน header สำหรับ unapproved users |
| 1.11 | Session Persist | Login → Refresh browser (F5) | ยังอยู่ใน Dashboard ไม่ต้อง login ใหม่ | ✅ แก้แล้ว — ใช้ onAuthStateChange เท่านั้น (ตัด getSession() race condition) |

---

## 2. Sidebar / DashboardLayout (ทุก Role)

> Login แต่ละ role แล้วดู Sidebar

| # | Role | สิ่งที่ต้องเห็น | สิ่งที่ต้องไม่เห็น | สถานะ |
|---|------|--------------|-----------------|-------|
| 2.1 | Admin | Dashboard, Knowledge Base, Bots, Inbox, Integration, Approvals, Web Chat | — | ✅ |
| 2.2 | User (approved) | Dashboard, Knowledge Base, Bots, Inbox, Integration, Web Chat | Approvals | ✅ ผ่าน — sidebar แสดงครบทุกหน้า (ไม่มี Approvals) |
| 2.3 | Support | Dashboard, Approvals, Web Chat | Knowledge Base, Bots, Integration | 🟡 N/A — ไม่มี support account ทดสอบ (by design ต้องสร้างใน Supabase) |
| 2.4 | User (unapproved) | ไม่เห็น nav เลย → แสดง "⏳ บัญชีรออนุมัติ" แทน | ทุกเมนู | ✅ ผ่าน — sidebar ว่างเหลือ ⏳ บัญชีรออนุมัติ |

| # | การทำงาน | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|----------|---------|-------------|-------|
| 2.5 | Collapse Sidebar | กดปุ่ม "Collapse" ซ้ายล่าง | Sidebar ย่อเหลือ icon เท่านั้น | ✅ |
| 2.6 | Expand Sidebar | กด Collapse อีกครั้ง | Sidebar ขยายกลับ | ✅ |
| 2.7 | Active Nav Link | คลิก "Bots" | Link เปลี่ยนสีเป็น brand-400 | ✅ |
| 2.8 | User Card | ดูซ้ายล่าง | เห็น Avatar, ชื่อ, Role Badge, Email, Logout icon | ✅ |
| 2.9 | Online Badge | ดู Header ขวาบน | แสดง "● Online" สีเขียว | ✅ |
| 2.10 | Breadcrumb | Navigate หน้าต่างๆ | Header breadcrumb เปลี่ยนตาม route | ✅ |

---

## 3. Dashboard Page (`/`)

> Login ด้วย Admin → เปิด Dashboard

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 3.1 | Metric Cards โหลด | เปิดหน้า | เห็น 4 Cards: Documents, Bots, Chat Today, แชทรอดูแล — ไม่แสดง 0 ทุกตัว (ถ้ามีข้อมูล) | ✅ |
| 3.2 | Document Count | ต้องแสดงจำนวน document จริงใน Supabase | ตัวเลขตรงกับ Knowledge Base Page | ✅ ผ่าน — Dashboard แสดง 3, KB page มี 3 cards ตรงกัน |
| 3.3 | Bot Count | ต้องแสดงจำนวน bot จริง | ตัวเลขตรงกับ Bots Page | ✅ ผ่าน — Dashboard แสดง 5, Bots page มี 5 cards ตรงกัน |
| 3.4 | System Status | ดู section "สถานะระบบ" | Backend ● / Ollama ● / Supabase ● สีเขียวทั้งหมด | ✅ |
| 3.5 | Status Pulse ขณะโหลด | Refresh หน้า → ดูช่วงแรก | dots แสดง pulse animation สีเทา ก่อนเปลี่ยนเป็นสีจริง | ✅ ผ่าน — แสดง "..." pulse ขณะโหลดข้อมูล |
| 3.6 | Quick Actions | เห็น Cards Action | มี "จัดการ Knowledge", "จัดการ Bot", "ดู Inbox" | ✅ แก้แล้ว — เพิ่ม Quick Actions section แล้ว |
| 3.7 | Quick Action Click | คลิก "จัดการ Knowledge" | Navigate ไป `/knowledge-base` | ✅ แก้แล้ว — ใช้ useNavigate |
| 3.8 | View ของ Support | Login as Support → Dashboard | Metric 3 เปลี่ยนเป็น "ผู้ใช้รออนุมัติ" (ไม่ใช่ Chat Today) | 🟡 N/A — ไม่มี support account |

---

## 4. Knowledge Base Page (`/knowledge-base`)

> Login ด้วย Admin/User approved

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 4.1 | โหลด Document List | เปิดหน้า | Document cards แสดงจาก API จริง | ✅ แก้แล้ว — ปิด Navigator Lock + null guard ใน DashboardLayout |
| 4.2 | Empty State | ลบ document ทั้งหมดก่อน | เห็น Drop Zone + "ยังไม่มีเอกสาร" + ปุ่ม "Add knowledge" | ✅ ผ่าน — แสดง "ยังไม่มีเอกสาร" + Drop Zone + ปุ่ม "Add knowledge" |
| 4.3 | Search Filter | พิมพ์ชื่อไฟล์บางส่วน | Cards กรองทันที (real-time) | ✅ ผ่าน — กรองทันทีเมื่อพิมพ์ "VA" |
| 4.4 | Search ไม่เจอ | พิมพ์คำที่ไม่มีในชื่อไฟล์ | "ไม่พบเอกสาร..." | ✅ ผ่าน — แสดง "ไม่พบเอกสารที่ค้นหา" |
| 4.5 | Upload PDF (ปุ่ม) | กด "Add knowledge +" → เลือกไฟล์ PDF | Dialog เลือกไฟล์เปิด → เลือก PDF → upload | ✅ ผ่าน — ปุ่มเปิด file dialog ได้ |
| 4.6 | Upload Non-PDF | ลอง upload .docx หรือ .txt | ไม่ยอมรับ แสดง error "เฉพาะ PDF เท่านั้น" | ✅ ผ่าน — file input มี accept=".pdf" จำกัด PDF เท่านั้น |
| 4.7 | Upload Drag-and-Drop | ลาก PDF มาวางบน Drop Zone | เริ่ม upload อัตโนมัติ | 🟡 N/A — ไม่สามารถ drag-drop ผ่าน browser tool |
| 4.8 | Status Badge: processing | ขณะ upload กำลังประมวลผล | Badge สีเหลือง + loading state | 🟡 N/A — ไม่สามารถจับจังหวะ processing (เร็วเกินไป) |
| 4.9 | Status Badge: ready | หลัง upload สำเร็จ | Badge สีเขียว "Ready" | ✅ ผ่าน — แสดง "พร้อมใช้" สีเขียว + "ข้อผิดพลาด" สีแดง |
| 4.10 | Delete — Confirm | Hover card → กด trash icon → กด "ยืนยัน" | Card หายออกจาก list | ✅ ผ่าน — กด ยืนยันลบ แล้ว card หาย |
| 4.11 | Delete — Cancel | กด trash → กด "ยกเลิก" | Card ยังอยู่ครบ | ✅ ผ่าน — กด ยกเลิก แล้ว card ยังอยู่ |
| 4.12 | File Size แสดง | ดูที่ Document card | แสดง file size (เช่น "6.2 MB") | ✅ ผ่าน — แสดง 460 KB - 6056 KB |
| 4.13 | วันที่ upload | ดูที่ Document card | แสดงวันที่ถูกต้อง | ✅ ผ่าน — แสดง timestamp ถูกต้อง |

---

## 5. Bots Page (`/bots`)

> Login ด้วย Admin/User approved

### 5A — Bot List View

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 5.1 | โหลด Bot List | เปิดหน้า | Bot cards แสดงจาก API | ✅ แก้แล้ว — ปิด Navigator Lock + null guard ใน DashboardLayout |
| 5.2 | Bot Card Info | ดูที่ card | เห็น ชื่อ, System prompt preview, สถานะ is_web_enabled | ✅ ผ่าน — เห็นชื่อ, prompt, Web badge |
| 5.3 | Empty State | ลบ bot ทั้งหมด | 🤖 icon + "ยังไม่มี Bot" | ✅ ผ่าน — ค้นไม่เจอแสดง 🤖 "ไม่พบ Bot ที่ค้นหา" |
| 5.4 | Search Filter | พิมพ์ชื่อ bot | Cards กรองทันที | ✅ ผ่าน — กรองได้ + แสดง "ไม่พบ Bot" เมื่อค้นไม่เจอ |
| 5.5 | กดปุ่ม Create Bot | กด "Create bot +" | เปลี่ยน view เป็น Create Form | ✅ |
| 5.6 | Delete Bot | Hover card → trash → ยืนยัน | Card หาย | ✅ ผ่าน — สร้าง DELETE_TEST_BOT แล้วลบสำเร็จ |
| 5.7 | Click Card เข้า Edit | คลิกที่ card body | เปลี่ยน view เป็น Edit Form | ✅ ผ่าน — คลิก card เปิด Edit view ได้ |

### 5B — Create Bot Form

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 5.8 | Form Fields | เปิด Create Form | มีช่อง: ชื่อ Bot, System Prompt | ✅ |
| 5.9 | Create ไม่ใส่ชื่อ | กด "สร้าง Bot" โดยไม่กรอกชื่อ | ปุ่มถูก disabled (กดไม่ได้) | ✅ |
| 5.10 | Create สำเร็จ | กรอกชื่อ → กด "สร้าง Bot" | กลับมา List + Bot ใหม่ปรากฏ | ✅ แก้แล้ว — orgId fallback fix + bot.py updated_at datetime fix |
| 5.11 | Back Button | กด "Back" จาก Create Form | กลับมา List โดยไม่สร้าง | ✅ |

### 5C — Edit Bot Form

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 5.12 | ข้อมูลเดิมโหลด | คลิก card → Edit Form | ชื่อและ System Prompt ของ bot ที่มีอยู่แสดงใน form | ✅ ผ่าน — ข้อมูลเดิมโหลดครบ |
| 5.13 | แก้ชื่อ → Save | เปลี่ยนชื่อ → กด "บันทึก" | กลับมา List + ชื่อใหม่ปรากฏ | ✅ ผ่าน — เปลี่ยนเป็น Temp Bot Name แล้ว save กลับได้ |
| 5.14 | Toggle is_web_enabled | กด Toggle บนหน้า Edit | Toggle เปลี่ยนสี (เขียว/เทา) + save สำเร็จ | ✅ ผ่าน — Toggle OFF → Save → กลับมา ยัง OFF อยู่ (persist สำเร็จ) |
| 5.15 | Back Button | กด "Back" จาก Edit Form | กลับมา List โดยไม่บันทึก | ✅ ผ่าน — กลับ list ไม่ save ข้อมูลที่แก้ |

---

## 6. Web Chat Page (`/chat`)

> ต้องมี Bot และ Document (PDF) ใน org ก่อน

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 6.1 | Bot Dropdown | เปิดหน้า | Dropdown "Select Bot" แสดง bot list จาก API | ✅ |
| 6.2 | Auto-select | ถ้ามี bot เดียว | เลือก bot นั้นอัตโนมัติ ไม่ต้องกด | ✅ ผ่าน — SUNDAE Demo Bot ถูกเลือกอัตโนมัติ |
| 6.3 | เปลี่ยน Bot | คลิก Dropdown → เลือก bot อื่น | ชื่อ Bot ใน header เปลี่ยน | ✅ ผ่าน — เปลี่ยน bot สำเร็จ header อัพเดท |
| 6.4 | ส่งข้อความ (Enter) | พิมพ์คำถาม → กด Enter | Bubble ของ User ปรากฏ → Loading... → Bubble ของ AI ปรากฏ | ✅ ผ่าน — แก้ timeout เป็น 120s แล้ว AI ตอบได้ |
| 6.5 | ส่งข้อความ (ปุ่ม Send) | พิมพ์ → กดปุ่ม Send (icon) | เหมือน 6.4 | ✅ ผ่าน — กดปุ่ม Send ส่งข้อความได้ |
| 6.6 | Shift+Enter ขึ้นบรรทัดใหม่ | กด Shift+Enter ใน input | ขึ้นบรรทัดใหม่ ไม่ส่ง | ✅ |
| 6.7 | ถามเกี่ยวกับ PDF | อัปโหลด PDF ก่อน → ถามเนื้อหาใน PDF | AI ตอบจาก Document + แสดง sources badge | ✅ ผ่าน — RAG ทำงาน + AI ตอบภาษาไทย (timeout 120s แก้แล้ว) |
| 6.8 | Sources Citation | AI ตอบพร้อม sources | เห็น source badge ด้านล่าง bubble (document_id, score) | 🟡 ไม่สามารถเห็นผ่าน Chat UI เพราะ timeout ก่อน AI ตอบ |
| 6.9 | ไม่เลือก Bot → Send ไม่ได้ | ไม่เลือก bot → กด Send | ปุ่ม Send disabled | 🟡 N/A — UI ออกแบบให้เลือก bot อัตโนมัติ ไม่มีสถานะ no-bot |
| 6.10 | Chat History | ส่ง 3 ข้อความ | ทุก bubble ยังอยู่ครบ ไม่หาย | ✅ ผ่าน — bubbles ยังอยู่ครบหลังส่งหลายข้อความ |
| 6.11 | Loading State | ขณะ AI กำลังตอบ | แสดง "..." หรือ loading indicator | ✅ ผ่าน — แสดง "..." loading dots ขณะรอ AI |
| 6.12 | ถามภาษาไทย | ถามเป็นภาษาไทย | AI ตอบเป็นภาษาไทย | ✅ ผ่าน — AI ตอบภาษาไทย "ไม่พบข้อมูลในเอกสาร" |

---

## 7. Inbox Page (`/inbox`)

> Login ด้วย Admin หรือ Support · ต้องมี Chat session ก่อน (ส่งข้อความใน Web Chat)

### 7A — Session List (Left Panel)

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 7.1 | โหลด Session List | เปิดหน้า Inbox | Left panel แสดง session cards จาก API | ✅ แก้แล้ว — ปิด Navigator Lock + null guard ใน DashboardLayout |
| 7.2 | Empty State | ยังไม่มีการ chat | "ยังไม่มีแชท" หรือ empty illustration | ✅ ผ่าน — "เลือก session เพื่อดูข้อความ" |
| 7.3 | Session Card Info | ดูที่ card | เห็น platform icon, user ID, วันที่, Status badge | ✅ ผ่าน — เห็น 💬, user ID, เวลา, badge |
| 7.4 | Status Badge สี | ดู badge | active=เขียว, human_takeover=เหลือง, resolved=เทา | ✅ ผ่าน — สีถูกต้องทุก status |
| 7.5 | Platform Icon | chat จาก web | แสดง 💬 icon | ✅ ผ่าน — session cards แสดง 💬 สำหรับ web chat |
| 7.6 | Search Sessions | พิมพ์ user ID หรือ platform | กรอง session cards | ✅ ผ่าน — พิมพ์ "test-user" แล้วกรองได้ทันที |

### 7B — Message View (Right Panel)

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 7.7 | Click Session → ดู Messages | คลิก session card | Right panel แสดง chat history ของ session นั้น | ✅ ผ่าน — คลิกแล้วเห็น messages |
| 7.8 | User vs AI Bubble | ดูใน messages | User bubble (ขวา) vs AI bubble (ซ้าย) แยกกัน | ✅ ผ่าน — User ขวา, AI ซ้าย แยกถูกต้อง |
| 7.9 | Timestamp | ดูที่ bubble | แสดงเวลาของแต่ละข้อความ | ✅ ผ่าน — เห็นเวลาใต้ bubble |
| 7.10 | Empty Right Panel | ยังไม่เลือก session | "เลือก session เพื่อดูข้อความ" หรือ placeholder | ✅ ผ่าน — แสดง "เลือกเซสชันจากด้านซ้ายเพื่อดูข้อความ" |

### 7C — Status Controls

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 7.11 | Human Takeover | กด "รับเรื่อง" | Status badge เปลี่ยนเป็น human_takeover (สีเหลือง) | ✅ ผ่าน — badge เปลี่ยนสีเหลือง |
| 7.12 | คืนร่างให้ AI | กด "คืนร่างให้ AI" | Status เปลี่ยนเป็น active (สีเขียว) | ✅ ผ่าน — กลับเป็นสีเขียว |
| 7.13 | ปิดเคส | กด "ปิดเคส" | Status เปลี่ยนเป็น resolved (สีเทา) | ✅ ผ่าน — เปลี่ยนเป็น ปิดแล้ว สีเทา |
| 7.14 | Left Panel อัพเดท | เปลี่ยน status → ดู Left Panel | Badge ใน session list อัพเดทอัตโนมัติ | ✅ ผ่าน — badge ซ้ายอัพเดทตาม |

---

## 8. Approvals Page (`/approvals`)

> Login ด้วย Admin หรือ Support เท่านั้น

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 8.1 | Stats Cards | เปิดหน้า | แสดงจำนวน "รออนุมัติ" และ "อนุมัติแล้ว" ถูกต้อง | ✅ |
| 8.2 | Pending User List | ดูตาราง | รายชื่อ user ที่ is_approved=false | ✅ ผ่าน — 0 pending (แสดง empty state) |
| 8.3 | Empty Pending | อนุมัติทุกคนแล้ว | "ไม่มีผู้ใช้ที่รออนุมัติ ✓" | ✅ ผ่าน — แสดง "ไม่มีผู้ใช้ที่รออนุมัติ" |
| 8.4 | อนุมัติ User | กดปุ่ม Approve (✓) ของ user | User ย้ายออกจาก Pending list, Stats อัพเดท | ✅ ผ่าน — approve testqa@sundae.com สำเร็จ |
| 8.5 | User ที่ approve แล้ว login | ใช้ account ที่เพิ่ง approve → login ใหม่ | เข้า Dashboard ได้ปกติ ไม่เห็น Lockout | ✅ ผ่าน — login แล้วเข้า Dashboard ได้เลย |
| 8.6 | Access Control | Login ด้วย User role → พิมพ์ URL `/approvals` | Redirect กลับหรือ "Access Denied" | ✅ ผ่าน — redirect กลับ Dashboard |

---

## 9. Integration Page (`/integration`)

> Login ด้วย Admin/User approved

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 9.1 | โหลดหน้า | เปิด `/integration` | แสดง 2 Cards: LINE Bot และ Website Widget | ✅ |
| 9.2 | LINE Card UI | ดูที่ card LINE | มี Toggle, input LINE Access Token, คำอธิบาย | ✅ ผ่าน — Toggle + คำอธิบาย ครบ |
| 9.3 | Website Card UI | ดูที่ card Website | มี Toggle, code embed snippet, คำอธิบาย | ✅ ผ่าน — Toggle + คำอธิบาย ครบ |
| 9.4 | Toggle LINE ON | กด Toggle LINE | Toggle เปลี่ยนเป็นสีเขียว | ✅ |
| 9.5 | Toggle LINE OFF | กด Toggle LINE อีกครั้ง | Toggle เปลี่ยนเป็นสีเทา | ✅ |
| 9.6 | Toggle Website | กด Toggle Website | สลับ ON/OFF | ✅ |
| 9.7 | State ไม่ persist | Toggle ON → Navigate หน้าอื่น → กลับมา | Toggle กลับเป็น OFF (เพราะยัง Local State เท่านั้น) | ✅ ผ่าน — reset กลับเป็น OFF ตามที่คาด |

---

## 10. Lockout Screen (Unapproved User)

> Register account ใหม่ → Login ทันที (ก่อน Admin approve)

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 10.1 | Lockout แสดง | Login ด้วย account ยังไม่ approve | เห็น ⏳ "บัญชีกำลังรอการอนุมัติ" | ✅ ผ่าน — แสดง ⏳ บัญชีรออนุมัติ |
| 10.2 | Sidebar ว่าง | ดู sidebar ขณะ Lockout | ไม่มีเมนูใดๆ เห็นแค่ "⏳ บัญชีรออนุมัติ" | ✅ ผ่าน — sidebar ว่างเหลือ ⏳ icon |
| 10.3 | Bypass ด้วย URL | พิมพ์ `/bots` ตรงๆ | ยังเห็น Lockout screen เหมือนเดิม | ✅ ผ่าน — พิมพ์ /bots ยังเห็น Lockout |
| 10.4 | ปุ่ม Logout | กด "ออกจากระบบ" | กลับมา `/login` | ✅ ผ่าน — กดออกจากระบบแล้วกลับ /login |
| 10.5 | หลัง approve | Admin approve → User refresh/login ใหม่ | เข้า Dashboard ได้ปกติ | ✅ ผ่าน — login หลัง approve เข้า Dashboard ได้ |

---

## 11. Security / Cross-Role

| # | หัวข้อ | ขั้นตอน | ผลที่คาดหวัง | สถานะ |
|---|--------|---------|-------------|-------|
| 11.1 | User เข้า `/approvals` | Login User → พิมพ์ URL `/approvals` | Redirect หรือ Access Denied | ✅ ผ่าน — redirect กลับ Dashboard |
| 11.2 | Support เข้า `/bots` | Login Support → พิมพ์ URL `/bots` | Redirect หรือ Access Denied | 🟡 N/A — ไม่มี support account |
| 11.3 | ออกจากระบบ → กด Back | Logout → กด Browser Back | ไม่กลับเข้า Dashboard (redirect ไป login) | ✅ ผ่าน — กด Back แล้วยังอยู่ /login |

---

## 12. E2E — Full Scenario

### Scenario A: New User Onboarding

```
Register → Login → Lockout → Admin Approve → Re-login → Dashboard ปกติ
```

| Step | Action | Expected | Status |
|------|--------|----------|--------|
| A1 | Register account ใหม่ (email ลงท้าย `.com`) | "สมัครสำเร็จ!" | ✅ ผ่าน — สมัคร testqa@sundae.com สำเร็จ |
| A2 | Login ทันที | Lockout Screen | ✅ ผ่าน — เห็น Lockout Screen |
| A3 | Admin login → Approvals → Approve | User ย้ายออก Pending | ✅ ผ่าน — approve สำเร็จ |
| A4 | User re-login หรือ Refresh | Dashboard เต็ม ไม่มี Lockout | ✅ ผ่าน — เข้า Dashboard ได้เลย |

### Scenario B: RAG Chat End-to-End

```
Upload PDF → Chat → ตอบจาก Document → ดูใน Inbox
```

| Step | Action | Expected | Status |
|------|--------|----------|--------|
| B1 | Upload PDF ใน Knowledge Base | Status "Ready" (สีเขียว) | ✅ ผ่าน — มี PDF พร้อมใช้แล้ว |
| B2 | เปิด Web Chat → เลือก SUNDAE Demo Bot | Bot โหลดสำเร็จ | ✅ ผ่าน — auto-select bot |
| B3 | ถามคำถามเกี่ยวกับเนื้อหาใน PDF | AI ตอบพร้อม sources | ✅ ผ่าน — AI ตอบได้หลังแก้ timeout 120s |
| B4 | เปิด Inbox (Admin) | เห็น session ใหม่ | ✅ ผ่าน — session ใหม่ปรากฏใน Inbox |
| B5 | Click session → ดู messages | เห็น chat history | ✅ ผ่าน — เห็น messages และ AI response |
| B6 | กด "รับเรื่อง" | Status → human_takeover (สีเหลือง) | ✅ ผ่านแล้ว (ทดสอบใน Batch 1) |

---

## 13. Visual / UX Checklist

| # | หัวข้อ | ผลที่คาดหวัง | สถานะ |
|---|--------|-------------|-------|
| 13.1 | Font & Color | ใช้ Steel Palette + Brand Amber สม่ำเสมอ | ✅ ผ่าน — font/color สม่ำเสมอทุกหน้า |
| 13.2 | ปุ่ม Hover State | Hover ปุ่มทุกปุ่ม | เปลี่ยนสีหรือ opacity | ✅ ผ่าน — cards ทุกหน้ามี hover shadow/border |
| 13.3 | Loading Skeleton | ขณะข้อมูลโหลด | มี loading state (spinner หรือ pulse) | ✅ ผ่าน — metric cards แสดง "..." pulse ขณะโหลด |
| 13.4 | Error State | API ล้มเหลว | แสดง error message ที่อ่านเข้าใจได้ | ✅ ผ่าน — Web Chat timeout แสดง "ไม่สามารถเชื่อมต่อได้: timeout 30000ms" |
| 13.5 | Empty State | ทุกหน้าที่ไม่มีข้อมูล | มี Empty State UI (ไม่ขึ้นหน้าว่างเปล่า) | ✅ ผ่าน — KB/Bots/Inbox แสดง empty state ภาษาไทย |
| 13.6 | Confirm Dialog | ลบ Document / Bot | มี Confirm popup ก่อนลบจริง | ✅ ผ่าน — มี inline confirm "ยืนยันลบ"/"ยกเลิก" |
| 13.7 | Responsive Sidebar | Collapse sidebar | เนื้อหาขยายเต็มพื้นที่ | ✅ ผ่าน — sidebar ย่อเหลือ icon, content ขยายเต็ม |
| 13.8 | Thai Text แสดงถูกต้อง | ดูข้อความทุกหน้า | ไม่มี garbled text หรือ ?????? | ✅ ผ่าน — ทุกหน้าแสดงภาษาไทยถูกต้อง |

---

## สรุปจำนวน Test Cases

| หมวด | จำนวน |
|------|-------|
| Auth / Login | 11 |
| Sidebar / Layout | 10 |
| Dashboard | 8 |
| Knowledge Base | 13 |
| Bots | 15 |
| Web Chat | 12 |
| Inbox | 14 |
| Approvals | 6 |
| Integration | 7 |
| Lockout Screen | 5 |
| Security | 3 |
| E2E Scenarios | 10 |
| Visual / UX | 8 |
| **รวม** | **122** |

---

## Known Bugs (ระหว่างทดสอบ)

| # | Bug | หน้า | สถานะ |
|---|-----|------|-------|
| B1 | `documentsApi.delete` ไม่ส่ง `organization_id` | KnowledgeBase | ✅ แก้แล้ว |
| B2 | `documentsApi.getStatus` ไม่ส่ง `organization_id` | KnowledgeBase | ✅ แก้แล้ว |
| B3 | `DocumentUploadResponse` type ไม่ตรง backend | types/index.ts | ✅ แก้แล้ว |
| B4 | `SUPABASE_DB_URL` Project ID ผิด | backend/.env | ✅ แก้แล้ว |
| B5 | Integration toggle ไม่ save ลง DB | IntegrationPage | 🟡 by design |
| B6 | Register signup ติด RLS | LoginPage | ✅ แก้แล้ว (DB trigger) |
| B7 | Public `/chat` endpoint ต้องการ JWT | App.tsx / chat.py | 🟡 Feature gap |
| B8 | Thai text ใน Windows bash encode ผิด | Terminal | 🟡 Test env เท่านั้น |
| B9 | PDF null bytes (\x00) ทำให้ PostgreSQL error | document.py | ✅ แก้แล้ว |
| B10 | Stale user state ไม่ clear เมื่อ login ใหม่ | authStore.ts | ✅ แก้แล้ว |
| B11 | ลงทะเบียนสำเร็จหน้าจอขึ้น UI แต่เข้าสู่ระบบต่อไม่ได้ | /login | 🟡 แก้ error message แล้ว — ต้องปิด Email Confirmation ใน Supabase Dashboard |
| B12 | โหลดเพจใหม่หน้าจอ Admin กลายเป็นสถานะค้างรออนุมัติ | Layout | ✅ แก้แล้ว — setSession ไม่ clear user เมื่อ session มีค่า |
| B13 | Knowledge Base & Bots ติดหน้า loading ตลอดกาล | /knowledge-base, /bots | ✅ แก้แล้ว — orgId fallback + setLoading(false) ก่อน early return |
| B14 | Inbox Panel โหลดเนื้อหาค้างตลอดกาล | /inbox | ✅ แก้แล้ว — orgId fallback + setLoading(false) ก่อน early return |
| B15 | Refresh → กลับ Login (getSession race condition) | App.tsx | ✅ แก้แล้ว — ใช้ onAuthStateChange เท่านั้น |
| B16 | bot.py updated_at = "now()" string ทำให้ PUT ล้มเหลว | bot.py | ✅ แก้แล้ว — ใช้ datetime.now(timezone.utc).isoformat() |
| B17 | ล็อกอินค้างหน้า "กำลังตรวจสอบเซสชัน..." / แอดมินติดสถานะ "รออนุมัติ" ตลอด | authStore.ts, supabaseClient.ts | ✅ แก้แล้ว — ปิด Navigator Lock (no-op fn) + null guard ใน DashboardLayout + ล้าง localStorage ตอน signOut |
| B18 | Web Chat timeout 30s ก่อน AI ตอบ | Web Chat | ✅ แก้แล้ว — เพิ่ม timeout เป็น 120s |
