# SUNDAE — UX Flow Document

**Last Updated:** 2026-03-29
**Branch:** Ver_1.0

---

## 1. Route Map (เส้นทางทั้งหมด)

### Public Routes (AuthLayout)

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | LoginPage | เข้าสู่ระบบ / สมัครใช้งาน |
| `/forgot-password` | ForgotPasswordPage | ขอรีเซ็ตรหัสผ่านผ่านอีเมล |
| `/reset-password` | ResetPasswordPage | ตั้งรหัสผ่านใหม่ (token-based) |

### Protected Routes (DashboardLayout)

| Path | Component | Allowed Roles | Requires Org Owner? |
|------|-----------|---------------|---------------------|
| `/` | HomeRedirect | all | YES → Dashboard, NO → `/chat` |
| `/chat` | WebChatPage | all | — |
| `/profile` | ProfilePage | all | — |
| `/create-org` | CreateOrgPage | all | — |
| `/knowledge-base` | KnowledgeBasePage | user, admin | YES |
| `/bots` | BotsPage | user, admin | YES |
| `/inbox` | InboxPage | user, admin | YES |
| `/integration` | IntegrationPage | user, admin | YES |
| `/organization` | OrganizationPage | user, support, admin | YES |
| `/danger-zone` | DangerZonePage | user, support, admin | YES |
| `/approvals` | ApprovalsPage | support, admin | — |

### Route Hierarchy

```mermaid
graph LR
    App[App.tsx] --> Auth[AuthLayout]
    App --> Prot[ProtectedRoute]

    Auth --> Login["/login"]
    Auth --> Forgot["/forgot-password"]
    Auth --> Reset["/reset-password"]

    Prot --> Dash[DashboardLayout]

    Dash --> Home["/ HomeRedirect"]
    Dash --> Chat["/chat"]
    Dash --> CreateOrg["/create-org"]
    Dash --> Profile["/profile"]

    Dash --> PR1["ProtectedRoute\n{user, admin}"]
    PR1 --> KB["/knowledge-base"]
    PR1 --> Bots["/bots"]
    PR1 --> Inbox["/inbox"]
    PR1 --> Integ["/integration"]

    Dash --> PR2["ProtectedRoute\n{user, support, admin}"]
    PR2 --> Org["/organization"]
    PR2 --> Danger["/danger-zone"]

    Dash --> PR3["ProtectedRoute\n{support, admin}"]
    PR3 --> Approvals["/approvals"]
```

---

## 2. Authentication Flow (ขั้นตอนยืนยันตัวตน)

### 2.1 Register (สมัครใช้งาน)

```mermaid
graph LR
    A["เปิด /login\nแท็บ สมัครใช้งาน"] --> B["กรอก ชื่อ นามสกุล\nอีเมล รหัสผ่าน"]
    B --> C["Supabase signUp()"]
    C --> D["สร้าง auth.users\n+ user_profiles\nis_approved = false"]
    D --> E["แสดง: กรุณายืนยันอีเมล"]
    E --> F["User กดลิงก์\nยืนยันในอีเมล"]
    F --> G["พร้อม Login"]
```

### 2.2 Login (เข้าสู่ระบบ)

```mermaid
graph LR
    A["กรอกอีเมล\n+ รหัสผ่าน"] --> B["Supabase signIn()"]
    B --> C["fetchProfile()\nfetchOrgs()"]
    C --> D{is_approved?}
    D -- "false" --> E["Lockout Screen\n⏳ รออนุมัติ"]
    D -- "true" --> F{มี Org?}
    F -- "มี" --> G["/ Dashboard"]
    F -- "ไม่มี" --> H["/create-org"]
```

### 2.3 Password Reset (รีเซ็ตรหัสผ่าน)

```mermaid
graph LR
    A["/forgot-password\nกรอกอีเมล"] --> B["ส่งลิงก์ reset\nไปทางอีเมล"]
    B --> C["User กดลิงก์\nในอีเมล"]
    C --> D["/reset-password\nกรอกรหัสผ่านใหม่"]
    D --> E["updateUser()"]
    E --> F["redirect /login"]
```

---

## 3. Approval Flow (ระบบอนุมัติผู้ใช้)

```mermaid
graph LR
    A["User Register"] --> B["is_approved = false\n⏳ Lockout Screen\nPoll ทุก 10s"]
    B --> C["Admin เปิด\n/approvals"]
    C --> D{Approve\nor Reject?}
    D -- "Approve ✅" --> E["is_approved = true\nLockout หายไป"]
    D -- "Reject ❌" --> F["User ถูกปฏิเสธ\nไม่สามารถใช้งาน"]
    E --> G{มี Org?}
    G -- "มี" --> H["/ Dashboard"]
    G -- "ไม่มี" --> I["/create-org\nสร้างหรือรับคำเชิญ"]
    I --> H
```

---

## 4. Navigation Structure (โครงสร้างเมนู)

### 4.1 Sidebar Layout

```
┌──────────────────────────────┐
│  🍨 SUNDAE                   │  Brand logo
│                              │
│  ┌──────────────────────┐    │
│  │ 🏢 Org Name     ▼   │    │  Org Switcher dropdown
│  └──────────────────────┘    │
│                              │
│  📊 Dashboard                │  ต้องเป็น Org Owner
│  📚 Knowledge Base           │  user/admin + Owner
│  🤖 Bots                     │  user/admin + Owner
│  📨 Inbox                    │  user/admin + Owner
│  🔗 Integration              │  user/admin + Owner
│  ⚙️ Organization             │  ทุก role + Owner
│  ✅ Approvals                │  support/admin เท่านั้น
│  💬 Web Chat                 │  ทุก role
│  👤 Profile                  │  ทุก role
│  ⚠️ Danger Zone              │  ทุก role + Owner
│                              │
│  ┌──────────────────────┐    │
│  │ 👤 ชื่อ-นามสกุล       │    │  User card
│  │ 📧 email@example.com │    │
│  │ 🟡 Admin             │    │  Role badge
│  │ [Logout]             │    │
│  └──────────────────────┘    │
└──────────────────────────────┘
```

### 4.2 Header Bar

```
┌────────────────────────────────────────────────┐
│  ☰  หน้าปัจจุบัน          🟢 Online  [TH|EN]  │
└────────────────────────────────────────────────┘
     │                         │         │
     Hamburger (mobile)   Connection   Language Toggle
```

### 4.3 Sidebar States พิเศษ

| State | แสดงอะไร |
|-------|---------|
| **Unapproved** (is_approved=false) | Sidebar ว่างเปล่า + "⏳ รออนุมัติ" + ปุ่ม Logout เท่านั้น |
| **Approved แต่ไม่มี Org** | Auto-redirect ไป `/create-org` |
| **Staff ดู Org ภายนอก** (B2B Guard) | เห็นแค่ `/danger-zone` — route อื่นถูก redirect |

---

## 5. Role-Based Access Matrix

### 5.1 Platform Roles (user_profiles.role)

| Role | Description |
|------|-------------|
| `user` | ผู้ใช้ทั่วไป — สร้าง Org ได้, จัดการ KB/Bots/Inbox ถ้าเป็น Owner |
| `support` | เจ้าหน้าที่ support — เข้าถึง Approvals, ดู Org ภายนอกได้ (B2B Guard) |
| `admin` | ผู้ดูแลระบบ — เข้าถึงทุกอย่าง |

### 5.2 Org Roles (org_members.org_role)

| Role | Description |
|------|-------------|
| `owner` | เจ้าของ Org — จัดการสมาชิก, KB, Bots, Inbox, ตั้งค่าทั้งหมด |
| `member` | สมาชิก — ใช้ Chat (`/chat`) เท่านั้น |

### 5.3 Access Matrix

| Route | User (Owner) | User (Member) | Support | Admin |
|-------|:---:|:---:|:---:|:---:|
| `/` Dashboard | ✅ | ❌ → `/chat` | ✅ | ✅ |
| `/chat` | ✅ | ✅ | ✅ | ✅ |
| `/knowledge-base` | ✅ | ❌ | ❌ | ✅ |
| `/bots` | ✅ | ❌ | ❌ | ✅ |
| `/inbox` | ✅ | ❌ | ❌ | ✅ |
| `/integration` | ✅ | ❌ | ❌ | ✅ |
| `/organization` | ✅ | ❌ | ✅ | ✅ |
| `/approvals` | ❌ | ❌ | ✅ | ✅ |
| `/profile` | ✅ | ✅ | ✅ | ✅ |
| `/danger-zone` | ✅ | ❌ | ⚠️ | ✅ |
| `/create-org` | ✅ | ✅ | ✅ | ✅ |

> ⚠️ Support ดู Org ภายนอก: ถูก redirect ไป `/danger-zone` เท่านั้น (B2B Privacy Guard)

---

## 6. User Journeys (เส้นทางผู้ใช้)

### Journey A: ผู้ใช้ใหม่ → อนุมัติ → Dashboard

```mermaid
graph LR
    A["/login\nสมัครใช้งาน"] --> B["ยืนยันอีเมล"]
    B --> C["/login\nเข้าสู่ระบบ"]
    C --> D["Lockout ⏳\nPoll ทุก 10s"]
    D --> E["Admin approve ✅"]
    E --> F{มี Org?}
    F -- "มี" --> G["/ Dashboard"]
    F -- "ไม่มี" --> H["/create-org"]
    H --> I{"สร้าง Org\nหรือรับคำเชิญ"}
    I --> G
```

### Journey B: Admin สร้าง Organization

```mermaid
graph LR
    A["/create-org"] --> B["กรอกชื่อ\nOrganization"]
    B --> C["orgApi.create(name)"]
    C --> D["สร้าง organizations\n+ org_members\nrole=owner"]
    D --> E["fetchOrgs()"]
    E --> F["/ Dashboard\nOrg ใหม่ active"]
    F --> G["/organization\nเชิญสมาชิก"]
```

### Journey C: ผู้ใช้รับคำเชิญเข้า Org

```mermaid
graph LR
    A["Admin เชิญ\norgApi.invite()"] --> B["User เปิด\n/create-org"]
    B --> C["เห็นคำเชิญ\nที่รอดำเนินการ"]
    C --> D{ยอมรับ\nหรือปฏิเสธ?}
    D -- "ยอมรับ ✅" --> E["acceptInvitation()"]
    E --> F["สร้าง org_members"]
    F --> G["/ Dashboard"]
    D -- "ปฏิเสธ ❌" --> H["declineInvitation()"]
```

### Journey D: สมาชิกใช้ Chat Bot

```mermaid
graph LR
    A["/chat"] --> B["เลือก Bot\nจาก dropdown"]
    B --> C["พิมพ์คำถาม\nกดส่ง"]
    C --> D["chatApi.askStream()\nSSE streaming"]
    D --> E["Bot ตอบ\nพร้อม RAG sources"]
    E --> F{ถามต่อ?}
    F -- "ถามต่อ" --> C
    F -- "ขอคุยเจ้าหน้าที่" --> G["status =\nhuman_takeover"]
    G --> H["Admin เห็น\nใน /inbox"]
    H --> I["Admin ตอบกลับ"]
    I --> J["status =\nhelped / resolved"]
```

### Journey E: จัดการสมาชิก Organization

```mermaid
graph LR
    A["/organization"] --> B["เชิญสมาชิก\ngorgApi.invite()"]
    A --> C["โอนเจ้าของ\ntransferOwnership()"]
    A --> D["ลบสมาชิก\nremoveMember()"]
    A --> E["แก้ไขข้อมูล Org\norgApi.update()"]
```

### Journey F: Support ดู Org ภายนอก (B2B Guard)

```mermaid
graph LR
    A["Support staff\nเลือก Org ลูกค้า"] --> B["ExternalOrgGuard\nตรวจ org ≠ own"]
    B --> C["external = true"]
    C --> D["redirect ทุก route\n→ /danger-zone"]
    D --> E["แสดง:\nข้อมูล Org\nHard delete (admin)"]
```

---

## 7. Chat & Inbox Flow

### 7.1 Chat Session Lifecycle

```mermaid
graph LR
    A["🟢 active\nBot ตอบ"] -- "User กด\nขอคุยเจ้าหน้าที่" --> B["🟡 human_takeover\nรอเจ้าหน้าที่"]
    B -- "Admin ตอบ" --> C["✅ helped\nตอบแล้ว"]
    C -- "ปิดเคส" --> D["⬜ resolved\nจบแชท"]
```

### 7.2 Inbox (Admin View)

```
┌─────────────────────────────────────────────────┐
│  Inbox                                          │
│                                                 │
│  ┌─────────────────┐  ┌──────────────────────┐  │
│  │ Session List     │  │ Chat View            │  │
│  │                  │  │                      │  │
│  │ 🟢 สมชาย (active)│  │ [ประวัติข้อความ]      │  │
│  │ 🟡 สมหญิง (human)│  │                      │  │
│  │ ✅ User3 (helped)│  │ Bot: สวัสดีครับ...     │  │
│  │ ⬜ User4 (closed)│  │ User: ขอถามเรื่อง...  │  │
│  │                  │  │ Bot: จากเอกสาร...     │  │
│  │ [ค้นหา...]       │  │                      │  │
│  │ [Filter ▼]       │  │ ┌──────────────────┐ │  │
│  │                  │  │ │ พิมพ์ตอบกลับ...    │ │  │
│  │ Platform:        │  │ └──────────────────┘ │  │
│  │ 📱 LINE          │  │                      │  │
│  │ 💬 Web           │  │ [เปลี่ยนสถานะ ▼]     │  │
│  └─────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 8. Bot & Knowledge Base Management

### 8.1 สร้าง Bot

```mermaid
graph LR
    A["/bots\nกด สร้าง Bot ใหม่"] --> B["กรอก: ชื่อ Bot\nSystem Prompt"]
    B --> C["botsApi.create()"]
    C --> D["Bot สร้างเสร็จ\nis_active = true"]
    D --> E["เชื่อม\nKnowledge Base"]
```

### 8.2 อัปโหลดเอกสาร → RAG Index

```mermaid
graph LR
    A["/knowledge-base\nกด อัปโหลด"] --> B["เลือกไฟล์ PDF"]
    B --> C["documentsApi.upload()"]
    C --> D["📋 pending\nรอคิว"]
    D --> E["⚙️ processing\nchunking + embedding"]
    E --> F["✅ ready\nพร้อมใช้"]
    F --> G["Bot ใช้\nRAG ค้นหาได้"]
```

### 8.3 เชื่อม Bot กับ Platform

```mermaid
graph LR
    A["/integration"] --> B["LINE Bot"]
    A --> C["Web Widget"]
    B --> D["ตั้งค่า Channel\nAccess Token + Secret"]
    D --> E["Webhook URL\nสำหรับ LINE Bot"]
    C --> F["เปิด/ปิด\nis_web_enabled"]
    F --> G["ฝัง widget\nในเว็บไซต์"]
```

---

## 9. Organization Lifecycle

```mermaid
graph LR
    A["Admin สร้าง Org\norgApi.create()"] --> B["Org Active"]
    B --> C["จัดการสมาชิก"]
    B --> D["สร้าง Bot"]
    B --> E["อัปโหลดเอกสาร"]
    B --> F["ใช้ Chat"]
    B --> G["โอนเจ้าของ\ntransferOwnership()"]
    B --> H["ลบ Org\nHard Delete\n(Danger Zone)"]
```

---

## 10. State Management Overview

### 10.1 App Initialization

```mermaid
graph LR
    A["เปิดหน้าเว็บ"] --> B["App.tsx\nAuthProvider"]
    B --> C["isLoading = true\ntimeout 5s"]
    C --> D["supabase.auth\nonAuthStateChange()"]
    D --> E{Event?}
    E -- "PASSWORD_RECOVERY" --> F["→ ResetPasswordPage"]
    E -- "SIGNED_IN" --> G["setSession()\nfetchProfile()"]
    E -- "SIGNED_OUT" --> H["→ /login"]
    G --> I{is_approved?}
    I -- "true" --> J["fetchOrgs()\n→ Dashboard"]
    I -- "false" --> K["Lockout Screen"]
```

### 10.2 Stores

| Store | Key State | Persistence |
|-------|-----------|-------------|
| **authStore** | user, session, isAuthenticated, isLoading | Supabase session (cookie) |
| **orgStore** | orgs[], activeOrgId, activeOrgRole | localStorage (`ACTIVE_ORG_KEY`) |
| **localeStore** | locale ("th" \| "en") | localStorage (`sundae_locale`) |
| **toastStore** | toasts[] | Memory only |

---

## 11. Platform Integration Flow

### LINE Bot

```mermaid
graph LR
    A["LINE User\nส่งข้อความ"] --> B["LINE Platform"]
    B --> C["Webhook POST\n/webhook/line/{bot_id}"]
    C --> D["ตรวจ LINE\nsignature"]
    D --> E["หา/สร้าง\nchat_session"]
    E --> F["RAG pipeline"]
    F --> G["LINE Reply API"]
    G --> H["LINE User\nเห็นคำตอบ"]
```

### Web Widget

```mermaid
graph LR
    A["เว็บไซต์ลูกค้า\nฝัง widget script"] --> B["Widget iframe"]
    B --> C["User พิมพ์คำถาม"]
    C --> D["POST /widget/send\nไม่ต้อง auth"]
    D --> E["RAG pipeline"]
    E --> F["User เห็นคำตอบ\nใน widget"]
```

---

## 12. Error & Edge Cases

| สถานการณ์ | พฤติกรรม |
|-----------|---------|
| Session หมดอายุ | axios interceptor → redirect `/login` |
| API 401 | refreshToken → ถ้าไม่ได้ → redirect `/login` |
| API 403 | แสดง toast error |
| Network offline | Request fail → toast error |
| User ยังไม่ยืนยันอีเมล | Login fail → "กรุณายืนยันอีเมลก่อน" |
| User ถูก reject | ไม่สามารถ login ได้ |
| Org ถูกลบ | redirect `/create-org` |
| Multiple tabs | localStorage sync (อาจมี race condition) |

---

## 13. i18n (ระบบภาษา)

```mermaid
graph LR
    A["User กด\nLanguage Toggle"] --> B{เลือกภาษา}
    B -- "TH" --> C["ทุกข้อความ\nเป็นภาษาไทย"]
    B -- "EN" --> D["ทุกข้อความ\nเป็น English"]
    C --> E["Persist ใน\nlocalStorage\nsundae_locale"]
    D --> E
    E --> F["useT() hook\nt key → translation"]
```

---

*Document generated — 2026-03-29*
