# SUNDAE Frontend — Browser Test Guide for AI Agent

> **Version**: 2.0
> **Date**: 16 March 2569 (updated for multi-tenant org_members)
> **Target**: Antigravity AI Agent (Browser-based testing)
> **App URL**: `http://localhost:5173`
> **Backend URL**: `http://localhost:8001`

---

## Prerequisites

Before starting tests, ensure:

1. **Backend** is running: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
2. **Frontend** is running: `cd frontend && npm run dev` (Vite dev server on port 5173)
3. **Ollama** is running with model loaded: `ollama serve` (model: qwen2.5:3b)
4. **Supabase** is accessible (cloud or local)
5. **SQL Migrations** 001-012 have been run

### Test Accounts

| Role | Email | Password | Org Role (org_members) |
|------|-------|----------|------------------------|
| Admin | `admin@sundae.local` | `Admin@1234` | owner (in org_members) |
| Support | `support@sundae.local` | `Sundae@2025` | — (no org) |
| New User | (create during test) | (create during test) | — (creates org after approval) |

### Pass/Fail Criteria

- **PASS**: Expected result matches actual behavior
- **FAIL**: UI broken, wrong text, wrong navigation, error not shown, or element missing

---

## TEST 1: Login Page — เข้าสู่ระบบ

**URL**: `http://localhost:5173/login`
**Objective**: Verify login form UI, validation, and successful authentication

### Step 1.1 — Verify Page Structure

1. Navigate to `http://localhost:5173/login`
2. **Expected**:
   - Brand logo "S" (yellow square) visible top-left
   - Title text: "เข้าสู่ระบบ"
   - Subtitle: "SUNDAE Admin Dashboard"
   - Two tab buttons: "เข้าสู่ระบบ" (active/white) | "สมัครใช้งาน"
   - Footer text: "© 2025 SUNDAE · Powered by Supabase Auth"

### Step 1.2 — Verify Login Form Fields

1. Ensure "เข้าสู่ระบบ" tab is active
2. **Expected form fields**:
   - Label "อีเมล" → input with `id="login-email"`, `type="email"`, placeholder "name@company.com"
   - Label "รหัสผ่าน" → input with `id="login-password"`, `type="password"`, placeholder "••••••••"
   - Link "ลืมรหัสผ่าน?" below password field
   - Submit button text: "เข้าสู่ระบบ"

### Step 1.3 — Test Empty Field Validation

1. Click "เข้าสู่ระบบ" button without filling any fields
2. **Expected**: Button is disabled (has `disabled` attribute) — form does not submit

### Step 1.4 — Test Wrong Credentials

1. Type `wrong@email.com` in email field
2. Type `wrongpassword` in password field
3. Click "เข้าสู่ระบบ"
4. **Expected**:
   - Error alert appears (red background `bg-red-50`)
   - Error message visible (e.g., "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
   - Close button "✕" visible in error alert
5. Click "✕" to dismiss error
6. **Expected**: Error alert disappears

### Step 1.5 — Successful Login (Admin)

1. Clear fields
2. Type `admin@sundae.local` in email field
3. Type `Admin@1234` in password field
4. Click "เข้าสู่ระบบ"
5. **Expected**:
   - Button shows spinner + text "กำลังเข้าสู่ระบบ..."
   - Page redirects to `http://localhost:5173/` (Dashboard)
   - Dashboard page loads with sidebar visible

### Step 1.6 — Already Authenticated Redirect

1. While logged in, navigate to `http://localhost:5173/login`
2. **Expected**: Auto-redirects back to `/` (Dashboard)

---

## TEST 2: Register — สมัครสมาชิก

**URL**: `http://localhost:5173/login` (register tab)
**Objective**: Verify registration form (simplified — no org name), success/error messages

### Step 2.1 — Switch to Register Tab

1. Logout first (if logged in) → navigate to `/login`
2. Click "สมัครใช้งาน" tab button
3. **Expected**:
   - Title changes to "สมัครใช้งาน"
   - "สมัครใช้งาน" tab is active (white background)
   - Form fields change to registration form

### Step 2.2 — Verify Register Form Fields

1. **Expected form fields** (in order):
   - Label "ชื่อ-นามสกุล" → input `id="reg-name"`, placeholder "สมชาย ใจดี"
   - Label "อีเมล" → input `id="reg-email"`, placeholder "name@company.com", required
   - Label "รหัสผ่าน (อย่างน้อย 6 ตัว)" → input `id="reg-password"`, placeholder "••••••••", required, minLength=6
   - Submit button: "สมัครใช้งาน"
   - Help text: "สมัครแล้วต้องรอ Support อนุมัติก่อนจึงจะใช้ฟีเจอร์ทั้งหมดได้"
2. **NO "ชื่อองค์กร" field** — org is created separately after approval

### Step 2.3 — Test Registration (New User)

1. Fill in:
   - ชื่อ-นามสกุล: `ทดสอบ ระบบ`
   - อีเมล: `test-agent-{timestamp}@test.com` (use unique email)
   - รหัสผ่าน: `Test@123`
2. Click "สมัครใช้งาน"
3. **Expected**:
   - Button shows spinner + "กำลังสมัคร..."
   - Green success message appears: "✅ สมัครสำเร็จ! กรุณาเข้าสู่ระบบด้านล่าง (รอ Support อนุมัติก่อนใช้งาน)"
   - After ~1.5 seconds, auto-switches to "เข้าสู่ระบบ" tab

### Step 2.4 — Test Duplicate Email

1. Switch to "สมัครใช้งาน" tab
2. Fill same email as Step 2.3
3. Fill password: `Test@123`
4. Click "สมัครใช้งาน"
5. **Expected**: Error message: "อีเมลนี้มีผู้ใช้งานแล้ว กรุณาใช้อีเมลอื่น"

### Step 2.5 — Test Short Password

1. Fill new email and password with only 3 characters: `abc`
2. Click "สมัครใช้งาน"
3. **Expected**: Error message about minimum password length

---

## TEST 3: Forgot Password Page

**URL**: `http://localhost:5173/forgot-password`
**Objective**: Verify forgot password form and messages

### Step 3.1 — Navigate from Login

1. Go to `/login`
2. Click "ลืมรหัสผ่าน?" link
3. **Expected**: Navigates to `/forgot-password`

### Step 3.2 — Verify Page Structure

1. **Expected**:
   - Brand logo "S" + Title "ลืมรหัสผ่าน"
   - Subtitle: "SUNDAE Admin Dashboard"
   - Help text: "กรอกอีเมลที่ใช้สมัครสมาชิก ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้"
   - Email input with `id="reset-email"`, placeholder "name@company.com"
   - Submit button: "ส่งลิงก์รีเซ็ตรหัสผ่าน"
   - Back link: "กลับไปหน้าเข้าสู่ระบบ"

### Step 3.3 — Submit Reset Request

1. Type `admin@sundae.local` in email field
2. Click "ส่งลิงก์รีเซ็ตรหัสผ่าน"
3. **Expected**:
   - Button shows spinner + "กำลังส่ง..."
   - Success message (green box): "ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว กรุณาตรวจสอบอีเมล admin@sundae.local ..."
   - (Note: admin@sundae.local is a fake email, actual email won't be sent)

### Step 3.4 — Navigate Back

1. Click "กลับไปหน้าเข้าสู่ระบบ"
2. **Expected**: Navigates back to `/login`

---

## TEST 4: Dashboard Page (Admin)

**URL**: `http://localhost:5173/`
**Objective**: Verify dashboard metrics, quick actions, and system status

### Pre-condition: Login as Admin

1. Login with `admin@sundae.local` / `Admin@1234`
2. Verify you are on Dashboard page

### Step 4.1 — Verify Page Header

1. **Expected**:
   - Title: "Dashboard"
   - Subtitle: "ภาพรวมระบบ SUNDAE — ข้อมูลอัปเดตล่าสุด"

### Step 4.2 — Verify Metric Cards

1. **Expected 4 metric cards** in grid layout:
   - Card 1: "เอกสารทั้งหมด" — shows a number + "live" badge
   - Card 2: "Bot ที่ใช้งาน" — shows a number + "live" badge
   - Card 3: "แชทวันนี้" — shows a number + "live" badge
   - Card 4: "แชทที่รอดูแล" — shows a number + "live" badge
2. Numbers should be real values (not "—" after loading)

### Step 4.3 — Verify Quick Action Buttons

1. **Expected 3 quick action cards**:
   - "จัดการ Knowledge" — description: "อัปโหลดและจัดการเอกสาร PDF"
   - "จัดการ Bot" — description: "สร้างและแก้ไข AI Bot"
   - "ดู Inbox" — description: "ดูประวัติการสนทนาทั้งหมด"

### Step 4.4 — Test Quick Action Navigation

1. Click "จัดการ Knowledge"
2. **Expected**: Navigates to `/knowledge-base`
3. Navigate back to Dashboard
4. Click "จัดการ Bot"
5. **Expected**: Navigates to `/bots`
6. Navigate back to Dashboard
7. Click "ดู Inbox"
8. **Expected**: Navigates to `/inbox`

### Step 4.5 — Verify System Status

1. Scroll to "สถานะระบบ" section
2. **Expected 5 status indicators**:
   - RAG Pipeline — green dot (if backend running)
   - Ollama — green dot (if Ollama running)
   - Embedding — green dot
   - Supabase DB — green dot
   - LINE Webhook — gray/pulsing dot (not implemented)

---

## TEST 5: Sidebar Navigation

**URL**: Any dashboard page
**Objective**: Verify sidebar nav items, collapse, user card, and logout

### Pre-condition: Login as Admin

### Step 5.1 — Verify Sidebar Structure

1. **Expected sidebar elements** (dark background, left side):
   - Brand: "S" logo + "SUNDAE" text + "Enterprise AI" subtitle
   - Navigation menu items (see step 5.2)
   - Collapse button at bottom: "Collapse"
   - User card: avatar + name + email + role badge

### Step 5.2 — Verify Nav Items (Admin Role)

1. **Expected navigation items** (all visible for admin):
   | Icon | Label | Route |
   |------|-------|-------|
   | Home | Dashboard | `/` |
   | Book | Knowledge Base | `/knowledge-base` |
   | Bot | Bots | `/bots` |
   | Chat | Inbox | `/inbox` |
   | Link | Integration | `/integration` |
   | Building | Organization | `/organization` |
   | User | Approvals | `/approvals` |
   | Chat bubble | Web Chat | `/chat` |

2. Click each nav item and verify it navigates to the correct page
3. Active nav item should have highlighted background

### Step 5.3 — Test Sidebar Collapse

1. Click "Collapse" button
2. **Expected**:
   - Sidebar width shrinks (256px → 64px)
   - Nav labels hidden, only icons visible
   - Brand text "SUNDAE" hidden, only "S" logo visible
   - User name/email hidden
3. Click collapse button again
4. **Expected**: Sidebar expands back to full width

### Step 5.4 — Verify User Card

1. Look at bottom of sidebar
2. **Expected**:
   - Avatar circle with initial letter (yellow/brand background)
   - Display name (full_name or email prefix)
   - Email text below name
   - Role badge showing "Admin"
   - Logout icon button

### Step 5.5 — Verify Top Navbar

1. Look at top of page
2. **Expected**:
   - Breadcrumb: "SUNDAE > {Current Page Name}"
   - Right side: green dot + "Online" status indicator

### Step 5.6 — Test Logout

1. Click logout button in user card
2. **Expected**:
   - Redirects to `/login`
   - Session cleared
   - Cannot access dashboard pages without re-login

---

## TEST 6: Knowledge Base Page

**URL**: `http://localhost:5173/knowledge-base`
**Objective**: Verify document upload, display, search, and delete

### Pre-condition: Login as Admin (owner)

### Step 6.1 — Navigate to Knowledge Base

1. Click "Knowledge Base" in sidebar
2. **Expected**:
   - Page title: "Knowledge"
   - Button: "+ Add knowledge collection" (top right)
   - Search bar with placeholder "Search Models"

### Step 6.2 — Verify Empty State (if no documents)

1. If no documents exist:
   - **Expected**: Cloud upload icon + "ยังไม่มีเอกสาร"
   - Help text: "Drag and drop a file to upload or select a file to view"
   - Button: "เลือกไฟล์"

### Step 6.3 — Upload PDF Document

1. Click "+ Add knowledge collection" button (or "เลือกไฟล์")
2. Select a PDF file from file picker
3. **Expected**:
   - Upload modal appears: "กำลังอัปโหลดและประมวลผล... อาจใช้เวลาสักครู่ในการ chunk และ embed"
   - After upload completes, document card appears in list
   - Document card shows:
     - Document name
     - File info (type + size)
     - Status badge: "รอดำเนินการ" → "กำลังประมวลผล" (amber, pulsing) → "พร้อมใช้" (green)
     - Timestamp: "Update ล่าสุด ..."

### Step 6.4 — Test Search

1. Type document name in search bar
2. **Expected**: Document list filters to matching results
3. Type non-existent name
4. **Expected**: "ไม่พบเอกสารที่ค้นหา" + help text "ลองค้นหาด้วยคำอื่น"
5. Clear search
6. **Expected**: All documents shown again

### Step 6.5 — Delete Document

1. Hover over a document card
2. **Expected**: Delete icon (trash) appears
3. Click delete icon
4. **Expected**: Confirmation dialog with "ยืนยันลบ" and "ยกเลิก" buttons
5. Click "ยืนยันลบ"
6. **Expected**: Document removed from list + success toast

### Step 6.6 — Test Non-PDF Upload

1. Try uploading a non-PDF file (e.g., .txt, .jpg)
2. **Expected**: Toast error: "กรุณาอัปโหลดไฟล์ PDF เท่านั้น"

---

## TEST 7: Bots Page

**URL**: `http://localhost:5173/bots`
**Objective**: Verify bot CRUD (create, read, update, delete)

### Pre-condition: Login as Admin (owner)

### Step 7.1 — Navigate to Bots

1. Click "Bots" in sidebar
2. **Expected**:
   - Page title: "Bots"
   - Button: "Create bot +" (top right)
   - Search bar with placeholder "Search Models"

### Step 7.2 — Verify Empty State (if no bots)

1. If no bots exist:
   - **Expected**: Bot icon + "ยังไม่มี Bot"
   - Help text: "สร้าง Bot แรกของคุณเพื่อเริ่มใช้งาน"
   - Button: "+ สร้าง Bot ใหม่"

### Step 7.3 — Create New Bot

1. Click "Create bot +" button
2. **Expected**: Create form appears with:
   - Bot name input (placeholder "ชื่อบอท")
   - Description textarea (placeholder "เพิ่มคำอธิบายสั้น ๆ สำหรับโมเดลที่ทำ")
   - System prompt textarea (label "พารามิเตอร์ของบอท / ระบบพรอมต์")
   - Toggle: "เปิดใช้ Web Chat" (default ON)
   - Save button (disabled until name filled)
   - Cancel button: "ยกเลิก"
3. Fill in:
   - Name: `Bot ทดสอบ`
   - Description: `Bot สำหรับทดสอบระบบ`
   - System prompt: `คุณคือผู้ช่วย AI ของบริษัททดสอบ`
4. Click save button
5. **Expected**:
   - Button shows "กำลังบันทึก..."
   - Returns to bot list
   - New bot appears in list with name "Bot ทดสอบ"
   - Status badges: "Web" (emerald, if web enabled)

### Step 7.4 — Edit Bot

1. Click on "Bot ทดสอบ" card
2. **Expected**: Edit form loads with pre-filled data
   - Bot name shows current value
   - Bot ID visible (UUID text)
   - Description and system prompt pre-filled
3. Change description to `Bot ทดสอบ — แก้ไขแล้ว`
4. Click save button
5. **Expected**: Returns to list, description updated

### Step 7.5 — Link Knowledge Document

1. Click on bot to edit
2. Look for "เลือกความรู้" button (or knowledge link section)
3. If documents exist, click "เลือกความรู้"
4. **Expected**: Modal appears with:
   - Title: "เลือกเอกสารเชื่อมต่อกับ Bot"
   - Close button "✕"
   - Document list with checkboxes
   - Status badges for each document
   - Footer: "เลือกแล้ว {N} เอกสาร" + "เสร็จสิ้น" button
5. Select a document (checkbox)
6. Click "เสร็จสิ้น"
7. **Expected**: Document appears as chip below knowledge section (📄 + doc name + ✕ remove button)

### Step 7.6 — Delete Bot

1. Go to bot list
2. Hover over "Bot ทดสอบ" card
3. Click delete icon (trash)
4. **Expected**: Confirmation dialog "ยืนยันลบ" | "ยกเลิก"
5. Click "ยืนยันลบ"
6. **Expected**: Bot removed from list + success toast

### Step 7.7 — Test Search

1. Type bot name in search bar
2. **Expected**: List filters to matching bots
3. Type non-existent name
4. **Expected**: "ไม่พบ Bot ที่ค้นหา" + "ลองค้นหาด้วยชื่ออื่น"

---

## TEST 8: Inbox Page

**URL**: `http://localhost:5173/inbox`
**Objective**: Verify two-panel layout, session management, message display, and status actions

### Pre-condition: Login as Admin. At least 1 chat session must exist (send a message from Web Chat first)

### Step 8.1 — Navigate to Inbox

1. Click "Inbox" in sidebar
2. **Expected**: Two-panel layout:
   - Left panel: Session list with header "Inbox"
   - Right panel: "เลือกเซสชันจากด้านซ้ายเพื่อดูข้อความ" (no session selected)
   - Search bar in left panel: placeholder "ค้นหาเซสชัน..."

### Step 8.2 — Verify Session List Items

1. If sessions exist, each session item shows:
   - Platform icon: 💬 (Web) or 📱 (LINE)
   - User name (or "Anonymous")
   - Relative time (e.g., "5m", "1h")
   - Status badge (color-coded)
   - Platform tag ("web" or "line")

### Step 8.3 — Select a Session

1. Click on a session in the left panel
2. **Expected**:
   - Session highlighted with brand-colored left border
   - Right panel shows:
     - Header: platform icon + user name + session ID (first 8 chars) + status badge
     - Messages area with chat bubbles
     - Status action buttons

### Step 8.4 — Verify Message Alignment (Admin Perspective)

1. Look at messages in right panel
2. **Expected alignment**:
   - **User (ลูกค้า)** messages: **Left side**, white background with border, avatar "U" (gray)
   - **Assistant (AI SUNDAE)** messages: **Left side**, brand-50 background, avatar "S" (yellow)
   - **Admin (เจ้าหน้าที่)** messages: **Right side**, blue background with white text, avatar "A" (blue)
   - **System** messages: **Centered**, amber banner
3. Each message shows timestamp below

### Step 8.5 — Test Status Change Buttons

1. For a session with status "active":
   - **Expected button**: "🙋 รับเรื่อง"
   - Click it → status changes to "human_takeover" (amber badge: "รับเรื่อง")

2. For a session with status "human_takeover":
   - **Expected buttons**: "🤖 คืนร่างให้ AI" + "✓ ช่วยเหลือเรียบร้อย"
   - **Expected**: Reply composer appears at bottom

3. For a session with status "helped":
   - **Expected button**: "🔄 ยังต้องช่วยเหลือ"

### Step 8.6 — Test Reply Composer

1. Set a session to "human_takeover" status (click "รับเรื่อง")
2. **Expected**: Blue-bordered reply area appears at bottom:
   - Textarea placeholder: "พิมพ์ข้อความตอบกลับ..."
   - Help text: "Enter เพื่อส่ง · Shift+Enter ขึ้นบรรทัดใหม่"
   - Send button (blue, arrow icon)
3. Type a message: `ทดสอบการตอบกลับ`
4. Press Enter (or click send button)
5. **Expected**:
   - Message appears as admin bubble (right side, blue)
   - Avatar "A" (blue circle)
   - Timestamp visible

### Step 8.7 — Test Search Sessions

1. Type in search bar: `web`
2. **Expected**: Session list filters to web sessions only
3. Clear search
4. **Expected**: All sessions shown

### Step 8.8 — Verify Empty State

1. Search with text that matches no sessions
2. **Expected**: "ไม่พบเซสชัน" message in left panel

---

## TEST 9: Web Chat Page

**URL**: `http://localhost:5173/chat`
**Objective**: Verify chat interface, bot selection, message streaming, and special features

### Pre-condition: Login as any authenticated user. At least 1 bot must exist with web enabled.

### Step 9.1 — Navigate to Web Chat

1. Click "Web Chat" in sidebar
2. **Expected**:
   - Full chat interface visible
   - Bot selector dropdown (top area)
   - Message input area at bottom
   - "New Chat" button visible

### Step 9.2 — Verify Bot Selector

1. Click bot selector dropdown
2. **Expected**: Shows list of available bots (only those with `is_web_enabled=true`)
3. Select a bot
4. **Expected**: Bot name displayed in selector

### Step 9.3 — Send a Message

1. Type in message input: `สวัสดี คุณคือใคร?`
2. Press Enter (or click send button)
3. **Expected**:
   - User message appears as right-aligned blue bubble
   - Loading indicator shows (AI thinking)
   - AI response streams in token-by-token (left-aligned brand bubble)
   - After complete, response fully visible with timestamp

### Step 9.4 — Verify Source Citations (if RAG enabled)

1. Send a question about uploaded document content
2. **Expected**: AI response may include source citations section
   - Expandable references
   - Shows document name + chunk index + confidence score

### Step 9.5 — Test New Chat Button

1. Click "New Chat" button
2. **Expected**:
   - Chat history cleared
   - New session started
   - Previous messages no longer visible

### Step 9.6 — Test Human Handoff Request

1. Look for "ขอพูดคุยกับเจ้าหน้าที่" button (or similar)
2. Click it
3. **Expected**:
   - System message appears: notification about requesting human agent
   - Session status changes to "human_takeover"
   - Chat behavior may change (admin can now respond via Inbox)

### Step 9.7 — Test Session Persistence

1. Send a few messages
2. Refresh the page (F5)
3. **Expected**: Previous messages reload from database (chat history preserved)

---

## TEST 10: Approvals Page (Support/Admin)

**URL**: `http://localhost:5173/approvals`
**Objective**: Verify pending user list, approve, and reject functionality

### Pre-condition: Login as Support (`support@sundae.local` / `Sundae@2025`) or Admin

### Step 10.1 — Navigate to Approvals

1. Click "Approvals" in sidebar (only visible for support/admin)
2. **Expected**:
   - Page title: "อนุมัติผู้ใช้งาน"
   - Subtitle: "ตรวจสอบและอนุมัติผู้ใช้ที่สมัครเข้าระบบ"
   - Amber stats card showing pending count + label "รออนุมัติ"

### Step 10.2 — Verify Pending Users List

1. If users registered in Test 2 are pending:
   - **Expected**: Table/list with:
     - Avatar circle (initials)
     - Full name (or "ไม่ระบุชื่อ")
     - Email address
     - Date (th-TH format)
     - Two buttons: "อนุมัติ" (brand/yellow) + "ปฏิเสธ" (red)
   - **NO** "องค์กร:" or "ได้รับเชิญเข้า:" info (removed in multi-tenant migration)

### Step 10.3 — Approve a User

1. Click "อนุมัติ" on a pending user
2. **Expected**:
   - Button shows "กำลัง..." while processing
   - Success toast appears: "อนุมัติสำเร็จ"
   - User removed from pending list
   - Pending count decreases
3. **Note**: Approve only sets `is_approved=true` — user creates org themselves via `/create-org`

### Step 10.4 — Reject a User

1. Click "ปฏิเสธ" on a pending user
2. **Expected**: Browser confirmation dialog: "ปฏิเสธผู้ใช้นี้? การดำเนินการนี้ไม่สามารถย้อนกลับได้"
3. Click OK/Confirm
4. **Expected**:
   - Button shows "กำลัง..." while processing
   - Success toast: "ปฏิเสธผู้ใช้สำเร็จ"
   - User removed from list

### Step 10.5 — Verify Empty State

1. After all users approved/rejected
2. **Expected**: "ไม่มีผู้ใช้ที่รออนุมัติ" message

---

## TEST 11: Create Organization Page

**URL**: `http://localhost:5173/create-org`
**Objective**: Verify org creation form and invitation acceptance for approved users without orgs

### Pre-condition: Login as an approved user that has NO organizations yet

To set up: Register a new user (Test 2) → Approve via Test 10 → Login with new user

### Step 11.1 — Auto-redirect to Create Org

1. Login as approved user with no orgs
2. **Expected**: Auto-redirected to `/create-org`
3. Sidebar should show message indicating no org yet

### Step 11.2 — Verify Page Structure

1. **Expected**:
   - Title: "สร้างองค์กร"
   - Subtitle: "สร้างองค์กรใหม่หรือรับคำเชิญเข้าร่วมองค์กรที่มีอยู่"
   - Invitations section (if any pending invitations exist)
   - Form card: "สร้างองค์กรใหม่"

### Step 11.3 — Verify Create Org Form

1. **Expected form**:
   - Label "ชื่อองค์กร" → text input, placeholder "เช่น บริษัท ABC จำกัด"
   - Submit button: "สร้างองค์กร"
   - Button disabled when input is empty

### Step 11.4 — Create Organization

1. Type org name: `บริษัท ทดสอบ AI จำกัด`
2. Click "สร้างองค์กร"
3. **Expected**:
   - Button shows spinner + "กำลังสร้าง..."
   - Success toast: "สร้างองค์กรสำเร็จ"
   - Redirected to `/` (Dashboard)
   - Sidebar now shows org name in OrgSwitcher
   - User is `owner` of the new org

### Step 11.5 — Verify Invitations Section (if applicable)

1. If user has pending invitations:
   - **Expected**: Card showing "คำเชิญที่ได้รับ" with invitation list
   - Each invitation shows: org name, invited by email, date
   - "เข้าร่วม" (Accept) button
2. Click "เข้าร่วม" on an invitation
3. **Expected**:
   - Toast: "เข้าร่วมองค์กรสำเร็จ"
   - Page reloads, user now has an org
   - Redirected to Dashboard

---

## TEST 12: Organization Management Page

**URL**: `http://localhost:5173/organization`
**Objective**: Verify org settings, member management, invite flow, and deletion

### Pre-condition: Login as org owner (admin or user who created org in Test 11)

### Step 12.1 — Navigate to Organization

1. Click "Organization" in sidebar (or navigate to `/organization`)
2. **Expected**:
   - Page title: "จัดการองค์กร"
   - Subtitle shows org name
   - 4 sections visible (for owner): Settings, Members, Invite, Danger Zone

### Step 12.2 — Verify Org Settings Section (Owner Only)

1. **Expected**: Card "ตั้งค่าองค์กร"
   - Label "ชื่อองค์กร" → input with current org name
   - "บันทึก" button
2. Change name to `บริษัท ทดสอบ AI (แก้ไข)`
3. Click "บันทึก"
4. **Expected**:
   - Success toast: "อัปเดตชื่อองค์กรสำเร็จ"
   - Input shows new name

### Step 12.3 — Verify Members List

1. **Expected**: Card "สมาชิก"
   - Table/list showing members:
     - Avatar (initials)
     - Full name + email
     - Role badge: "Owner" (brand color) or "Member" (steel color)
     - "ลบ" button for non-owner members (owner only)
   - Current user should be listed as "Owner"

### Step 12.4 — Invite Member by Email

1. **Expected**: Card "เชิญสมาชิก" (owner only)
   - Email input: placeholder "email@company.com"
   - "ส่งคำเชิญ" button
2. Type `invite-test@example.com`
3. Click "ส่งคำเชิญ"
4. **Expected**:
   - Toast: "ส่งคำเชิญสำเร็จ"
   - Email field cleared
   - Invitation appears in invitations list below

### Step 12.5 — Verify Invitations List

1. **Expected**: Sub-section showing sent invitations
   - Each invitation shows:
     - Email address
     - Date
     - Status badge:
       - "รอตอบรับ" (amber) — pending
       - "ตอบรับแล้ว" (green) — accepted
       - "ยกเลิกแล้ว" (gray) — revoked

### Step 12.6 — Test Duplicate Invite

1. Try inviting the same email again: `invite-test@example.com`
2. **Expected**: Error toast (email already invited)

### Step 12.7 — Danger Zone — Request Deletion

1. **Expected**: Card "ลบองค์กร" (red border, owner only)
   - Warning text about irreversible deletion
   - Button: "ขอลบองค์กร"
2. Click "ขอลบองค์กร"
3. **Expected**:
   - Confirmation prompt
   - After confirming: Toast "ส่งคำขอลบสำเร็จ — รอ Support ยืนยัน"
   - Org status changes to "pending_deletion"
   - Button text changes (e.g., "รอการยืนยันจาก Support")

### Step 12.8 — Non-Owner View

1. Login as a member (not owner) of the org
2. Navigate to `/organization`
3. **Expected**:
   - Can see members list
   - **CANNOT** see: Settings edit, Invite section, Danger zone
   - No edit/delete buttons visible

---

## TEST 13: OrgSwitcher (Sidebar Component)

**URL**: Any dashboard page
**Objective**: Verify org switcher dropdown, multi-org support

### Pre-condition: Login as user with at least 1 org

### Step 13.1 — Verify OrgSwitcher in Sidebar

1. Look at sidebar, below the brand header "SUNDAE"
2. **Expected**:
   - Dropdown/button showing current org name
   - Role badge (Owner/Member) next to org name
   - Clickable to expand

### Step 13.2 — Expand OrgSwitcher

1. Click the OrgSwitcher
2. **Expected**: Dropdown opens showing:
   - List of user's organizations (each with name + role badge)
   - Active org highlighted
   - Link at bottom: "สร้างองค์กรใหม่" → navigates to `/create-org`

### Step 13.3 — Switch Organization (if multiple orgs)

1. If user has multiple orgs, click on a different org
2. **Expected**:
   - Page reloads
   - OrgSwitcher shows new org name
   - Dashboard data changes to new org's data
   - localStorage `sundae_active_org_id` updates

### Step 13.4 — Collapsed Sidebar OrgSwitcher

1. Collapse the sidebar (click "Collapse")
2. **Expected**: OrgSwitcher still visible but shows abbreviated/icon form
3. Click on it
4. **Expected**: Still functional — dropdown opens

### Step 13.5 — Create New Org from Switcher

1. Open OrgSwitcher dropdown
2. Click "สร้างองค์กรใหม่"
3. **Expected**: Navigates to `/create-org`

---

## TEST 14: Integration Page

**URL**: `http://localhost:5173/integration`
**Objective**: Verify integration cards and toggle behavior

### Pre-condition: Login as org owner

### Step 14.1 — Navigate to Integration

1. Click "Integration" in sidebar
2. **Expected**:
   - Page title: "Integration"
   - Subtitle: "เชื่อมต่อช่องทางการสื่อสารเพื่อใช้งาน Bot"

### Step 14.2 — Verify Integration Cards

1. **Expected 2 cards**:
   - **LINE card**:
     - Green "L" icon
     - Name: "LINE" + "connect" badge (amber)
     - Description: "Connect to LINE for Seamless Integration and Quick Communication"
     - Toggle switch (default OFF)
   - **Website card**:
     - Blue globe icon
     - Name: "Website" + "connect" badge (amber)
     - Description: "Connect to Website for Seamless Integration and Quick Communication"
     - Toggle switch (default ON)

### Step 14.3 — Test Toggle Switch

1. Click LINE toggle to enable
2. **Expected**: Toast notification: "ฟีเจอร์นี้ยังอยู่ระหว่างพัฒนา — การตั้งค่าจะยังไม่ถูกบันทึก"
3. Toggle visual: changes from gray to brand color
4. Toggle Website off
5. **Expected**: Same toast notification
6. Refresh page
7. **Expected**: Toggles reset to defaults (state not persisted)

---

## TEST 15: Permission & Role-Based Access Control

**Objective**: Verify that roles correctly gate page access and navigation

### Test 15.1 — Unapproved User Experience

1. Register a new user (Test 2) but DO NOT approve
2. Login with the new user credentials
3. **Expected**:
   - Dashboard shows lockout screen:
     - Title: "บัญชีกำลังรอการอนุมัติ"
     - Message: "บัญชีของคุณกำลังรอการอนุมัติจากเจ้าหน้าที่ Support..."
     - Icon: ⏳
     - Shows what's allowed vs. not allowed
   - Sidebar has NO nav items
   - Shows message: "⏳ บัญชีรออนุมัติ"
   - Top navbar: "⏳ รออนุมัติ" badge
4. Navigate to `/chat`
5. **Expected**: Web Chat page should still be accessible (basic feature)
6. Navigate to `/knowledge-base`
7. **Expected**: Redirected away (not accessible)

### Test 15.2 — Approved User Without Org

1. Approve the user from Test 15.1 (via Approvals page)
2. Login with the approved user
3. **Expected**:
   - Auto-redirected to `/create-org` (no org yet)
   - Sidebar shows OrgSwitcher but no org selected
   - Cannot access `/knowledge-base`, `/bots`, `/inbox` without org

### Test 15.3 — Support Role Navigation

1. Login as Support (`support@sundae.local` / `Sundae@2025`)
2. **Expected sidebar nav items**:
   - Approvals ✅
   - Web Chat ✅
   - Dashboard ❌ (not visible)
   - Knowledge Base ❌ (not visible)
   - Bots ❌ (not visible)
   - Inbox ❌ (not visible)
   - Integration ❌ (not visible)
   - Organization ❌ (not visible)
3. Directly navigate to `/knowledge-base`
4. **Expected**: Redirected to `/` (unauthorized)
5. Navigate to `/approvals`
6. **Expected**: Approvals page loads correctly

### Test 15.4 — Admin Role Navigation

1. Login as Admin (`admin@sundae.local` / `Admin@1234`)
2. **Expected sidebar nav items** (ALL visible):
   - Dashboard ✅
   - Knowledge Base ✅
   - Bots ✅
   - Inbox ✅
   - Integration ✅
   - Organization ✅
   - Approvals ✅
   - Web Chat ✅
3. OrgSwitcher visible in sidebar showing admin's org
4. Verify all pages load without errors

### Test 15.5 — Member Role Navigation

1. Login as a user with `org_role=member` in org_members (invited user who accepted)
2. **Expected**:
   - Auto-redirected from `/` to `/chat`
   - Sidebar shows only: Web Chat ✅
   - OrgSwitcher shows org name + "Member" badge
   - Cannot access `/knowledge-base`, `/bots`, `/inbox`, `/organization`
   - Directly navigate to `/bots` → redirected to `/chat`

### Test 15.6 — Owner Role Navigation

1. Login as an org owner (approved user who created org)
2. **Expected sidebar items**:
   - Dashboard ✅
   - Knowledge Base ✅
   - Bots ✅
   - Inbox ✅
   - Integration ✅
   - Organization ✅
   - Web Chat ✅
3. OrgSwitcher shows org name + "Owner" badge

### Test 15.7 — Direct URL Access (Unauthenticated)

1. Clear session / open incognito browser
2. Navigate to `http://localhost:5173/` directly
3. **Expected**: Redirected to `/login`
4. Navigate to `http://localhost:5173/bots`
5. **Expected**: Redirected to `/login`
6. Navigate to `http://localhost:5173/approvals`
7. **Expected**: Redirected to `/login`

### Test 15.8 — Catch-All Route

1. Login as any user
2. Navigate to `http://localhost:5173/nonexistent-page`
3. **Expected**: Redirected to `/` (Dashboard)

---

## TEST 16: Toast Notifications

**Objective**: Verify toast notifications appear correctly across the app

### Step 16.1 — Verify Toast Container

1. Trigger any action that shows a toast (e.g., approve user, send invitation)
2. **Expected**:
   - Toast appears in top-right corner
   - Shows icon + message text
   - Auto-disappears after a few seconds
   - Types:
     - **Success**: Green/emerald styling
     - **Error**: Red styling
     - **Info**: Blue/steel styling

---

## TEST 17: Loading Screen

**Objective**: Verify initial auth loading screen

### Step 17.1 — Verify Loading Screen on First Visit

1. Clear browser storage (localStorage, sessionStorage)
2. Navigate to `http://localhost:5173/`
3. **Expected** (briefly visible):
   - Centered "S" logo (pulsing animation)
   - Text: "กำลังตรวจสอบเซสชัน..."
   - Then auto-redirects to `/login` (no session found)
   - Maximum display time: 5 seconds

---

## Summary Checklist

| # | Test | Pages | Status |
|---|------|-------|--------|
| 1 | Login Page UI + Auth | `/login` | ☐ |
| 2 | Register (simplified, no org) | `/login` (register tab) | ☐ |
| 3 | Forgot Password | `/forgot-password` | ☐ |
| 4 | Dashboard Metrics + Actions | `/` | ☐ |
| 5 | Sidebar Nav + Collapse + Logout | Layout | ☐ |
| 6 | Knowledge Base CRUD | `/knowledge-base` | ☐ |
| 7 | Bots CRUD + Knowledge Link | `/bots` | ☐ |
| 8 | Inbox Messages + Status | `/inbox` | ☐ |
| 9 | Web Chat + Streaming | `/chat` | ☐ |
| 10 | Approvals (Approve/Reject) | `/approvals` | ☐ |
| 11 | **Create Organization** | `/create-org` | ☐ |
| 12 | **Organization Management** | `/organization` | ☐ |
| 13 | **OrgSwitcher** | Sidebar component | ☐ |
| 14 | Integration Toggles | `/integration` | ☐ |
| 15 | Permission & Role Access (multi-org) | All pages | ☐ |
| 16 | Toast Notifications | Global | ☐ |
| 17 | Loading Screen | Initial load | ☐ |

---

## Notes for AI Agent

1. **Thai Text**: The app uses Thai (ภาษาไทย) for most UI text. Verify exact text matches.
2. **Selectors**: Prefer using `id` attributes (e.g., `#login-email`) when available. Otherwise use visible text content.
3. **Timing**: Some actions have delays (e.g., register success auto-switch after 1.5s, polling every 2-3s). Wait accordingly.
4. **Toasts**: Toast notifications auto-dismiss. Capture them quickly after triggering actions.
5. **Streaming**: AI chat responses stream token-by-token. Wait for completion before verifying content.
6. **Session State**: Some tests require specific session state (e.g., chat sessions for Inbox). Run Web Chat tests before Inbox tests.
7. **Order**: Follow tests in order — some create data needed by later tests (e.g., Test 2 creates user for Test 10, Test 10 approves for Test 11).
8. **Multi-org flow**: The new flow is: Register → Approve → Create Org → Use features. No org is created during registration or approval. User creates org themselves at `/create-org`.
9. **OrgSwitcher**: After creating or joining an org, verify the OrgSwitcher in sidebar shows the correct org name and role.
10. **X-Active-Org header**: All API calls include `X-Active-Org` header from localStorage. Switching org reloads the page to ensure fresh data.
11. **Recommended test order for org flow**: Test 2 (register) → Test 10 (approve) → Test 11 (create org) → Test 13 (OrgSwitcher) → Test 12 (org management) → Test 15 (permissions).
