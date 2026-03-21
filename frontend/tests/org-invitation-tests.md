# SUNDAE — Organization & Invitation UI Tests (All Roles)

> **Version**: 2.0 (rewritten to match current codebase)
> **Date**: 17 March 2569
> **Target**: Antigravity AI Agent (Browser-based testing)
> **App URL**: `http://localhost:5173`
> **Backend URL**: `http://localhost:8001`
> **Focus**: Organization lifecycle — create, invite, approve, switch, delete

---

## Prerequisites

1. **Backend** running: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload`
2. **Frontend** running: `cd frontend && npm run dev` (Vite on port 5173)
3. **Supabase** accessible
4. **SQL Migrations** 001-012 applied (`org_members`, `org_invitations` tables exist)
5. `public.users` table has been dropped (only `user_profiles` + `org_members` remain)

### Test Accounts

| # | Role | Email | Password | Notes |
|---|------|-------|----------|-------|
| A1 | Admin | `admin@sundae.local` | `Admin@1234` | Platform admin, org owner |
| A2 | Support | `support@sundae.local` | `Sundae@2025` | Approvals only, no org |
| A3 | User 1 | `orgtest-user1-{TS}@test.com` | `Test@123` | Will be invited to Admin's org |
| A4 | User 2 | `orgtest-user2-{TS}@test.com` | `Test@123` | Will create own org |

> Replace `{TS}` with Unix timestamp at test start (e.g. `1710600000`). Use the **same** timestamp for all tests.

### Pass/Fail

- **PASS**: Expected matches actual
- **FAIL**: UI broken, wrong text, wrong navigation, or element missing
- Capture screenshot at every **Expected** checkpoint

---

## TEST A: Admin Sends Invitations (Owner)

**Goal**: Admin (org owner) invites two emails

### A.1 — Login as Admin

1. Navigate to `http://localhost:5173/login`
2. Enter `admin@sundae.local` in `#login-email`
3. Enter `Admin@1234` in `#login-password`
4. Click "เข้าสู่ระบบ"
5. **Expected**:
   - Redirect to `/` (Dashboard)
   - Sidebar nav visible: Dashboard, Knowledge Base, Bots, Inbox, Integration, Organization, Approvals, Web Chat
   - OrgSwitcher below "SUNDAE" brand — shows org name + `owner` role text
   - User card at bottom: avatar + name + "Admin" badge (brand-400 background)

### A.2 — Navigate to Organization Page

1. Click "Organization" in sidebar
2. **Expected**:
   - URL: `/organization`
   - Title: **"จัดการองค์กร"**
   - Subtitle: **"ตั้งค่าองค์กร สมาชิก และคำเชิญ"**
   - 4 sections visible (admin = canManage):
     - Card **"ตั้งค่าองค์กร"** — input with current org name + "บันทึก" button
     - Card **"สมาชิก (N)"** — member list
     - Card **"เชิญสมาชิก"** — email input + "ส่งคำเชิญ" button
     - Card **"Danger Zone"** (red border) — "ขอลบองค์กร" button

### A.3 — Verify Members Section

1. Look at "สมาชิก" card
2. **Expected**:
   - Header: "สมาชิก" + count in parentheses, e.g. "สมาชิก (1)"
   - Each member row:
     - Circular avatar (first letter, bg-brand-100)
     - Bold name + gray email below
     - Role badge: `owner` (bg-brand-100, text-brand-700) or `member` (bg-steel-100, text-steel-600)
   - Owner rows have **NO** "ลบ" button
   - Non-owner rows have "ลบ" button (text-red-500)

### A.4 — Invite User 1

1. Scroll to "เชิญสมาชิก" card
2. **Expected**: Email input with placeholder `email@example.com` + "ส่งคำเชิญ" button
3. Type `orgtest-user1-{TS}@test.com`
4. Click "ส่งคำเชิญ"
5. **Expected**:
   - Toast (green): **"ส่งคำเชิญไปยัง orgtest-user1-{TS}@test.com สำเร็จ"**
   - Email input cleared
   - New invitation row below form: email + `pending` badge (bg-amber-100, text-amber-700)

### A.5 — Invite User 2

1. Type `orgtest-user2-{TS}@test.com`
2. Click "ส่งคำเชิญ"
3. **Expected**:
   - Toast: "ส่งคำเชิญไปยัง orgtest-user2-{TS}@test.com สำเร็จ"
   - 2 invitations now shown

### A.6 — Duplicate Invitation

1. Type same email: `orgtest-user1-{TS}@test.com`
2. Click "ส่งคำเชิญ"
3. **Expected**:
   - Error toast (red)
   - Email input NOT cleared

### A.7 — Empty Email

1. Clear email input
2. **Expected**: "ส่งคำเชิญ" button is **disabled** (has `disabled` attribute)

### A.8 — Logout

1. Click logout button (sidebar bottom)
2. **Expected**: Redirect to `/login`

---

## TEST B: Register Invited Users

**Goal**: Create accounts for invited emails (not yet approved)

### B.1 — Register User 1

1. Navigate to `/login`
2. Click "สมัครใช้งาน" tab
3. **Expected**: Title changes to **"สมัครใช้งาน"**, tab has white background
4. Fill in:
   - `#reg-name`: `ผู้ใช้ทดสอบ หนึ่ง`
   - `#reg-email`: `orgtest-user1-{TS}@test.com`
   - `#reg-password`: `Test@123`
5. Click "สมัครใช้งาน"
6. **Expected**:
   - Button: spinner + "กำลังสมัคร..."
   - Green message: **"✅ สมัครสำเร็จ! กรุณาเข้าสู่ระบบด้านล่าง (รอ Support อนุมัติก่อนใช้งาน)"**
   - Auto-switch to "เข้าสู่ระบบ" tab after ~1.5s

### B.2 — Register User 2

1. Click "สมัครใช้งาน" tab
2. Fill in:
   - `#reg-name`: `ผู้ใช้ทดสอบ สอง`
   - `#reg-email`: `orgtest-user2-{TS}@test.com`
   - `#reg-password`: `Test@123`
3. Click "สมัครใช้งาน"
4. **Expected**: Same success message + auto-switch

### B.3 — Login as Unapproved User 1

1. Switch to "เข้าสู่ระบบ" tab
2. Enter `orgtest-user1-{TS}@test.com` / `Test@123`
3. Click "เข้าสู่ระบบ"
4. **Expected**:
   - Redirect to `/`
   - **Lockout screen**:
     - Icon: ⏳ (in brand-100 rounded box)
     - Title: **"บัญชีกำลังรอการอนุมัติ"**
     - Text: **"บัญชีของคุณกำลังรอการอนุมัติจากเจ้าหน้าที่ Support"**
     - Feature list: "✗ อัปโหลดเอกสาร", "✗ จัดการ Bot", "✗ ดู Inbox & Dashboard"
     - Button: **"ออกจากระบบ"** (bg-steel-200)
   - Sidebar: EMPTY nav, shows "⏳ บัญชีรออนุมัติ"
   - Top navbar breadcrumb: "SUNDAE > **รออนุมัติ**"
   - Top navbar: **"⏳ รออนุมัติ"** badge (bg-amber-50, text-amber-700)
   - OrgSwitcher: NOT visible (no org)
   - **Auto-poll**: Lockout checks approval every 10 seconds
5. Click "ออกจากระบบ"

---

## TEST C: Approve Invited Users (Auto-Accept)

**Goal**: Admin approves users → backend auto-accepts pending org invitations → users become members

### C.1 — Login as Admin

1. Login: `admin@sundae.local` / `Admin@1234`

### C.2 — Navigate to Approvals

1. Click "Approvals" in sidebar
2. **Expected**:
   - URL: `/approvals`
   - Title: **"อนุมัติผู้ใช้งาน"**
   - Subtitle: **"ตรวจสอบและอนุมัติผู้ใช้ที่สมัครเข้าระบบ"**
   - Amber stats card: pending count (>= 2) + "รออนุมัติ"
   - Card **"ผู้ใช้ที่รออนุมัติ"** — list with:
     - `ผู้ใช้ทดสอบ หนึ่ง` / `orgtest-user1-...@test.com`
     - `ผู้ใช้ทดสอบ สอง` / `orgtest-user2-...@test.com`
   - Each row: avatar (bg-brand-100) + bold name + gray email + date (th-TH) + "อนุมัติ" button (bg-brand-400) + "ปฏิเสธ" button (bg-red-100)

### C.3 — Approve User 1

1. Find `orgtest-user1-...@test.com`
2. Click "อนุมัติ"
3. **Expected**:
   - Button briefly shows "กำลัง..."
   - Toast (green): **"อนุมัติสำเร็จ"**
   - User disappears from list
   - Count decreases
   - **BACKEND**: Auto-accepts pending invitation → user added to org_members as `member`

### C.4 — Approve User 2

1. Find `orgtest-user2-...@test.com`
2. Click "อนุมัติ"
3. **Expected**: Same — approved + invitation auto-accepted

### C.5 — Verify User 1 in Org Members

1. Navigate to `/organization`
2. Look at "สมาชิก" section
3. **Expected**:
   - `ผู้ใช้ทดสอบ หนึ่ง` appears with `member` badge
   - `ผู้ใช้ทดสอบ สอง` appears with `member` badge
   - Both have "ลบ" button (non-owner)

### C.6 — Logout

---

## TEST D: Invited User Login (Auto-Accepted Member)

**Goal**: User 1 (auto-accepted) logs in → directly becomes member, no /create-org step

### D.1 — Login as User 1

1. Login: `orgtest-user1-{TS}@test.com` / `Test@123`
2. **Expected**:
   - User already has org (auto-accepted during approval)
   - OrgSwitcher shows org name + `member` role text
   - Auto-redirect from `/` to `/chat` (member default page)
   - Sidebar: ONLY **"Web Chat"** visible

### D.2 — Verify Member Cannot See Owner Features

1. Check sidebar after redirect to `/chat`
2. **Expected visible**: Web Chat only
3. **Expected NOT visible**: Dashboard, Knowledge Base, Bots, Inbox, Integration, Organization, Approvals
4. OrgSwitcher: org name + `member`
5. User card: name + "Member" badge (bg-steel-100, text-steel-600)

### D.3 — Direct URL Access Blocked

1. Navigate to `http://localhost:5173/organization`
2. **Expected**: Redirect to `/chat`
3. Navigate to `http://localhost:5173/bots`
4. **Expected**: Redirect to `/chat`
5. Navigate to `http://localhost:5173/knowledge-base`
6. **Expected**: Redirect to `/chat`
7. Navigate to `http://localhost:5173/inbox`
8. **Expected**: Redirect to `/chat`

### D.4 — Web Chat Works

1. Navigate to `/chat`
2. **Expected**: Chat interface loads, can type and send messages

### D.5 — Logout

---

## TEST E: User Creates Own Org (Ignores Invitation)

**Goal**: User 2 (also auto-accepted as member) creates their OWN org instead of staying in Admin's org

### E.1 — Login as User 2

1. Login: `orgtest-user2-{TS}@test.com` / `Test@123`
2. **Expected**:
   - User already has org (auto-accepted during approval)
   - OrgSwitcher shows Admin's org name + `member`
   - Auto-redirect to `/chat` (member default)

### E.2 — Navigate to Create Org

1. Navigate to `http://localhost:5173/create-org`
2. **Expected**:
   - Title: **"สร้างองค์กร"** (with 🏢 icon)
   - Subtitle: **"สร้างองค์กรใหม่หรือเข้าร่วมองค์กรที่ได้รับเชิญ"**
   - Card **"สร้างองค์กรใหม่"**:
     - Label: "ชื่อองค์กร"
     - Input `#org-name`, placeholder **"บริษัท ABC จำกัด"**
     - Button: "สร้างองค์กร" (disabled when empty)

### E.3 — Create Organization

1. Type `บริษัท ทดสอบ AI` in `#org-name`
2. Click "สร้างองค์กร"
3. **Expected**:
   - Button: spinner + **"กำลังสร้าง..."**
   - Toast (green): **"สร้างองค์กรสำเร็จ"**
   - Redirect to `/` (Dashboard)
   - OrgSwitcher shows **"บริษัท ทดสอบ AI"** + `owner`
   - Sidebar: all owner items — Dashboard, Knowledge Base, Bots, Inbox, Integration, Organization, Web Chat

### E.4 — Verify Org

1. Click "Organization" in sidebar
2. **Expected**:
   - Org name: "บริษัท ทดสอบ AI"
   - Members: 1 (self) with `owner` badge
   - "ตั้งค่าองค์กร" visible (can edit)
   - "เชิญสมาชิก" visible (can invite)
   - "Danger Zone" visible

### E.5 — Logout

---

## TEST F: Admin Verifies Member List

**Goal**: Admin checks that User 1 is in org, User 2 is still there too (was auto-accepted)

### F.1 — Login as Admin

1. Login: `admin@sundae.local` / `Admin@1234`

### F.2 — Check Organization

1. Navigate to `/organization`
2. **Expected**:
   - Members include:
     - Admin (owner badge)
     - `ผู้ใช้ทดสอบ หนึ่ง` (member badge) — has "ลบ" button
     - `ผู้ใช้ทดสอบ สอง` (member badge) — has "ลบ" button
   - Both users were auto-accepted during approval

### F.3 — Logout

---

## TEST G: Member View Restrictions

**Goal**: Member (User 1) cannot manage org

### G.1 — Login as User 1

1. Login: `orgtest-user1-{TS}@test.com` / `Test@123`
2. **Expected**: Redirect to `/chat` (member default)

### G.2 — Try Organization Page

1. Navigate to `http://localhost:5173/organization`
2. **Expected**: Redirect to `/chat` (Organization nav requires owner, blocked for member)

### G.3 — OrgSwitcher as Member

1. Click OrgSwitcher in sidebar
2. **Expected**:
   - Dropdown opens: 1 org listed
   - Org name + `member` role text
   - **NO** "Create Organization" link (only visible for support/admin roles)

### G.4 — Logout

---

## TEST H: Support Role Restrictions

**Goal**: Support has no org, only sees Approvals + Web Chat

### H.1 — Login as Support

1. Login: `support@sundae.local` / `Sundae@2025`
2. **Expected**:
   - Sidebar: only **Approvals** + **Web Chat**
   - OrgSwitcher: NOT visible (no org, returns null)
   - User card: "Support" badge (bg-violet-100, text-violet-700)

### H.2 — No Org Access

1. Navigate to `http://localhost:5173/organization`
2. **Expected**: Redirect away (support has no org → no access)
3. Navigate to `/bots`
4. **Expected**: Redirect away
5. Navigate to `/knowledge-base`
6. **Expected**: Redirect away

### H.3 — Approvals Works

1. Click "Approvals" in sidebar
2. **Expected**: Page loads with title **"อนุมัติผู้ใช้งาน"**

### H.4 — Logout

---

## TEST I: Owner Removes Member

**Goal**: Admin removes User 2 from org

### I.1 — Login as Admin

1. Login: `admin@sundae.local` / `Admin@1234`

### I.2 — Navigate to Organization

1. Click "Organization" in sidebar

### I.3 — Remove Member

1. Find `ผู้ใช้ทดสอบ สอง` in members list
2. Click "ลบ" button (text-red-500)
3. **Expected**: Browser `confirm()` dialog: **"ลบ ผู้ใช้ทดสอบ สอง ออกจากองค์กร?"**
4. Click OK
5. **Expected**:
   - Toast (green): **"ลบสมาชิกสำเร็จ"**
   - User disappears from member list
   - Member count decreases

### I.4 — Verify Removed User Experience

1. Logout
2. Login as `orgtest-user2-{TS}@test.com` / `Test@123`
3. **Expected**:
   - User still has their own org ("บริษัท ทดสอบ AI" as owner)
   - OrgSwitcher shows "บริษัท ทดสอบ AI" + `owner`
   - Admin's org no longer in OrgSwitcher list

### I.5 — Logout

---

## TEST J: Multi-Org (Invite Existing User)

**Goal**: Admin invites User 2 (who has own org) → User 2 accepts → has 2 orgs

### J.1 — Login as Admin

1. Login: `admin@sundae.local` / `Admin@1234`

### J.2 — Invite User 2

1. Navigate to `/organization`
2. In "เชิญสมาชิก" → type `orgtest-user2-{TS}@test.com`
3. Click "ส่งคำเชิญ"
4. **Expected**: Toast: "ส่งคำเชิญไปยัง orgtest-user2-{TS}@test.com สำเร็จ"

### J.3 — Logout

### J.4 — Login as User 2

1. Login: `orgtest-user2-{TS}@test.com` / `Test@123`
2. **Expected**: Dashboard loads (user has own org as owner)

### J.5 — Accept Invitation

1. Navigate to `http://localhost:5173/create-org`
2. **Expected**:
   - Section **"คำเชิญที่รอดำเนินการ"** shows Admin's org invitation
   - Each invitation: org name + "เชิญไปที่ {email}" + **"เข้าร่วม"** button (bg-brand-400)
3. Click "เข้าร่วม"
4. **Expected**:
   - Button briefly shows **"กำลัง..."**
   - Toast (green): **"เข้าร่วมองค์กรสำเร็จ"**
   - Redirect to `/` (Dashboard)

### J.6 — Verify Multi-Org in OrgSwitcher

1. Click OrgSwitcher
2. **Expected**: Dropdown shows 2 orgs:
   - "บริษัท ทดสอบ AI" + `owner`
   - Admin's org + `member`
   - Active org highlighted (text-brand-400, bg-brand-400/10)
   - Other org in text-steel-300

### J.7 — Switch to Admin's Org

1. Click Admin's org in dropdown
2. **Expected**:
   - Full page reload (`window.location.href = "/"`)
   - OrgSwitcher shows Admin's org name
   - Role: `member`
   - Sidebar: ONLY "Web Chat" (member role)
   - `localStorage` key `sundae_active_org_id` updated

### J.8 — Switch Back to Own Org

1. Click OrgSwitcher → click "บริษัท ทดสอบ AI"
2. **Expected**:
   - Page reloads
   - OrgSwitcher: "บริษัท ทดสอบ AI" + `owner`
   - Full sidebar: Dashboard, KB, Bots, Inbox, Integration, Organization, Web Chat

### J.9 — Logout

---

## TEST K: Edit Org Name (Owner Only)

### K.1 — Login as Admin

1. Login: `admin@sundae.local` / `Admin@1234`

### K.2 — Edit Name

1. Navigate to `/organization`
2. In "ตั้งค่าองค์กร" → clear input, type `SUNDAE Corp (Updated)`
3. Click "บันทึก"
4. **Expected**:
   - Toast (green): **"อัปเดตชื่อองค์กรสำเร็จ"**
   - Input shows new name
   - OrgSwitcher updates to "SUNDAE Corp (Updated)"

### K.3 — Revert Name

1. Clear input, type original name back
2. Click "บันทึก"
3. **Expected**: Toast success

### K.4 — Logout

---

## TEST L: Org Deletion (2-Step)

**Goal**: Owner requests deletion → Support/Admin confirms → org deleted

> **WARNING**: This deletes User 2's org. Use User 2's org for this test.

### L.1 — Login as User 2

1. Login: `orgtest-user2-{TS}@test.com` / `Test@123`
2. Make sure "บริษัท ทดสอบ AI" is active org (switch if needed)

### L.2 — Request Deletion

1. Click "Organization" in sidebar
2. Scroll to **"Danger Zone"** (red border card)
3. **Expected**:
   - Title: **"Danger Zone"** (text-red-700)
   - Text: **"การลบองค์กรต้องได้รับการยืนยันจากทั้ง Owner และ Support/Admin"**
   - Button: **"ขอลบองค์กร"** (bg-red-100, text-red-700)
4. Click "ขอลบองค์กร"
5. **Expected**: `confirm()` dialog: **"ขอลบองค์กร? การดำเนินการนี้ต้องได้รับการยืนยันจากอีกฝ่าย"**
6. Click OK
7. **Expected**:
   - Toast (green): **"ส่งคำขอลบองค์กรสำเร็จ — รอการยืนยัน"**
   - Danger Zone changes: text **"มีคำขอลบองค์กรแล้ว — รอ Support/Admin ยืนยัน"**
   - "ขอลบองค์กร" button gone

### L.3 — Logout

### L.4 — Login as Admin to Confirm

1. Login: `admin@sundae.local` / `Admin@1234`
2. Admin is `admin` role → `canConfirmDeletion = true`
3. Switch to User 2's org if Admin is a member (from Test J)
4. Navigate to `/organization`
5. **Expected**: Danger Zone shows **"ยืนยันการลบองค์กร"** button (bg-red-600, text-white)

### L.5 — Confirm Deletion

1. Click "ยืนยันการลบองค์กร"
2. **Expected**: `confirm()` dialog: **"ยืนยันการลบองค์กร? การดำเนินการนี้ไม่สามารถย้อนกลับได้"**
3. Click OK
4. **Expected**:
   - Toast (green): **"ลบองค์กรสำเร็จ"**
   - Redirect to `/create-org` (`window.location.href = "/create-org"`)

### L.6 — Verify User 2's Org Deleted

1. Logout
2. Login: `orgtest-user2-{TS}@test.com` / `Test@123`
3. **Expected**:
   - If user has remaining orgs → OrgSwitcher shows them
   - If no orgs left → redirect to `/create-org`
   - Deleted org no longer appears

---

## TEST M: Edge Cases

### M.1 — Invite Self

1. Login as Admin → `/organization`
2. Type `admin@sundae.local` in invite field
3. Click "ส่งคำเชิญ"
4. **Expected**: Error toast (cannot invite self / already member)

### M.2 — Invite Existing Member

1. Type `orgtest-user1-{TS}@test.com` (already member) in invite field
2. Click "ส่งคำเชิญ"
3. **Expected**: Error toast

### M.3 — Invalid Email

1. Type `not-an-email` in invite field
2. Click "ส่งคำเชิญ"
3. **Expected**: Browser validation prevents submission (`type="email"` + `required`)

### M.4 — Empty Org Name

1. Navigate to `/create-org`
2. Leave `#org-name` empty
3. **Expected**: "สร้างองค์กร" button is **disabled** (`disabled` attribute)

### M.5 — OrgSwitcher Single Org

1. Login as user with exactly 1 org
2. Click OrgSwitcher
3. **Expected**: Dropdown with 1 org (highlighted) + optionally "Create Organization" link (support/admin only)

### M.6 — OrgSwitcher Collapsed Sidebar

1. Click "Collapse" button at bottom of sidebar
2. **Expected**: Sidebar shrinks, OrgSwitcher shows icon-only (org initial letter)
3. Click OrgSwitcher icon
4. **Expected**: Dropdown still opens if sidebar is expanded; if collapsed, click shows org icon but dropdown only opens when `!collapsed`

### M.7 — Unapproved User Auto-Poll

1. Register new user → login → lockout screen
2. Open another browser/tab → login as Admin → approve the user
3. **Expected**: Within ~10 seconds, lockout screen auto-refreshes and user proceeds past lockout
   - Alternative: Switch tab away and back → visibility change triggers immediate refetch

### M.8 — Member Auto-Redirect from Dashboard

1. Login as member (User 1 in Admin's org)
2. Navigate to `http://localhost:5173/`
3. **Expected**: Auto-redirect to `/chat` (member default)

### M.9 — Approved User Without Org → Create Org

1. Register new user → approve → remove from all orgs
2. Login
3. **Expected**: Auto-redirect to `/create-org`

---

## Summary Checklist

| # | Test | Role | Key Verification | Status |
|---|------|------|------------------|--------|
| A | Admin sends invitations | Admin (owner) | Invite 2 emails, duplicate check | ☐ |
| B | Register invited users | New users | Register, see lockout | ☐ |
| C | Approve (auto-accept) | Admin | Approve → auto-accept invitations → members created | ☐ |
| D | Invited user login | Auto-accepted member | Direct member, no /create-org, /chat redirect | ☐ |
| E | Create own org | Approved user | Ignore invitation, create org, become owner | ☐ |
| F | Verify member list | Admin (owner) | Confirm both users in member list | ☐ |
| G | Member restrictions | Member | No management, read-only, no org page | ☐ |
| H | Support restrictions | Support | Only Approvals + Web Chat | ☐ |
| I | Remove member | Admin (owner) | Remove, verify their experience | ☐ |
| J | Multi-org | Admin + User 2 | Accept invite, 2 orgs, OrgSwitcher | ☐ |
| K | Edit org name | Admin (owner) | Update name, OrgSwitcher updates | ☐ |
| L | Org deletion | Owner + Admin | 2-step delete flow | ☐ |
| M | Edge cases | Various | Self-invite, validation, auto-poll | ☐ |

---

## Recommended Execution Order

```
A → B → C → D → E → F → G → H → I → J → K → L → M
```

Tests are **sequential** — each depends on data from previous tests.

---

## Notes for AI Agent

1. **Thai Text**: Match exact Thai text. The app uses `ภาษาไทย` for all UI labels.
2. **Timestamps**: Replace `{TS}` with actual Unix timestamp once at test start. Use same value throughout.
3. **Selectors**: Use `id` attributes when available: `#login-email`, `#login-password`, `#reg-name`, `#reg-email`, `#reg-password`, `#org-name`. Otherwise match visible text.
4. **Toasts**: Auto-dismiss after ~3s. Capture immediately after action.
5. **`confirm()` Dialogs**: Browser-native dialogs — handle via browser automation API.
6. **Page Reloads**: OrgSwitcher triggers `window.location.href = "/"`. Wait for full reload.
7. **Auto-Poll**: Lockout polls every 10s via `setInterval`. Visibility change triggers immediate refetch.
8. **No Email**: Invitations are DB records only. Users see them at `/create-org`.
9. **X-Active-Org**: All API calls include this header from `localStorage`. Verify in network tab if debugging.
10. **Multi-Org**: A user can be `owner` in one org and `member` in another. Sidebar and features change per active org role.
11. **Auto-Accept on Approve**: When Admin approves a user who has pending invitations, backend auto-accepts them → user becomes member without needing to manually accept.
12. **Member Default**: Members auto-redirect from `/` to `/chat`. They cannot access owner pages.
13. **Screenshots**: Capture at every **Expected** checkpoint.
