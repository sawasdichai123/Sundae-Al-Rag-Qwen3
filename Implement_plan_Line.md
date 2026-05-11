# Implementation Plan — LINE Visibility Control (User Binding)

## สรุปแนวคิด

ผูก LINE User ID กับสมาชิกใน org เพื่อให้ระบบ Visibility Control ที่มีอยู่แล้ว
ทำงานกับ LINE ได้เหมือน Web Chat — บอทที่ตั้ง "restricted" จะแสดงเฉพาะ
สมาชิกที่มีสิทธิ์เท่านั้น

**หลักการ:** LINE user ที่ไม่ได้ผูกบัญชี = ยังใช้งานได้ปกติ แต่จะเห็นเฉพาะบอท `visibility: "all"`

---

## Flow หลัก

```
ผู้ใช้ LINE ส่งข้อความ
       │
       ▼
Webhook รับ → ได้ LINE User ID
       │
       ▼
Lookup org_members ด้วย line_user_id
       │
       ├── พบ member → ดึง user_id → กรอง bot ตาม visibility + visible_to (เหมือน Web)
       │
       └── ไม่พบ → ถือเป็น guest → เห็นเฉพาะบอท visibility: "all"
```

---

## Section 1 — Database: เพิ่ม line_user_id ใน org_members

### 1.1 เพิ่มคอลัมน์

```sql
ALTER TABLE org_members
ADD COLUMN line_user_id TEXT DEFAULT NULL;

-- Unique per org (1 LINE account ผูกได้ 1 member ต่อ org)
CREATE UNIQUE INDEX idx_org_members_line_user_id
ON org_members (organization_id, line_user_id)
WHERE line_user_id IS NOT NULL;
```

**เหตุผล:**
- `line_user_id` เป็น nullable — ไม่บังคับผูก
- Unique index per org — ป้องกันผูกซ้ำ
- Partial index (WHERE NOT NULL) — ไม่กินพื้นที่จาก row ที่ยังไม่ผูก

### 1.2 ไม่ต้องสร้างตารางใหม่

ใช้โครงสร้างเดิมทั้งหมด:
- `org_members` → เก็บ LINE binding
- `bots.visibility` + `bots.visible_to` → logic เดิม
- `chat_sessions.platform_user_id` → LINE UID เดิม

---

## Section 2 — Backend: LINE Binding API

### 2.1 Endpoint ผูก LINE กับบัญชี

**ไฟล์:** `backend/app/routers/organization.py`

```
POST /api/organizations/{org_id}/line-binding
```

| Field | Type | Description |
|-------|------|-------------|
| `binding_code` | string | รหัส 6 หลักที่ผู้ใช้ได้จาก LINE |

**Flow:**
1. ผู้ใช้ login Web → ไปหน้า Settings → กด "ผูกบัญชี LINE"
2. ระบบสร้าง **binding code** (6 หลัก, หมดอายุ 5 นาที) เก็บใน memory/cache
3. ผู้ใช้ไปพิมพ์ binding code ใน LINE chat
4. LINE webhook รับ code → จับคู่กับ pending binding → บันทึก `line_user_id` ใน `org_members`
5. ตอบกลับทั้ง 2 ฝั่ง (LINE: "ผูกสำเร็จ", Web: polling สถานะ)

### 2.2 Endpoint ยกเลิกการผูก

```
DELETE /api/organizations/{org_id}/line-binding
```

- ลบ `line_user_id` ออกจาก `org_members` ของ user ปัจจุบัน
- ต้องเป็นเจ้าของบัญชีเอง หรือ Org Admin

### 2.3 Endpoint ดูสถานะการผูก

```
GET /api/organizations/{org_id}/line-binding
```

- ส่งกลับ: `{ "is_linked": true/false, "line_display_name": "..." | null }`
- ดึง display name จาก LINE Profile API (optional)

### 2.4 Binding Code Storage

```python
# In-memory dict (single worker) หรือ Redis (multi-worker)
# Key: binding_code → Value: { user_id, organization_id, created_at }
# TTL: 5 นาที
_pending_bindings: dict[str, dict] = {}
```

---

## Section 3 — Backend: Webhook กรอง Bot ตาม Visibility

### 3.1 แก้ไข `_get_active_bots()` ใน `webhook_line.py`

**ก่อน (ปัจจุบัน):** ดึงทุก active bot ไม่กรอง visibility

**หลัง:**

```python
async def _get_visible_bots(organization_id: str, line_user_id: str) -> list[dict]:
    """Return active bots filtered by LINE user's visibility permissions."""
    supabase = get_supabase()

    # 1. ดึงทุก active bots
    bots_result = await (
        supabase.table("bots")
        .select("id, name, visibility, visible_to")
        .eq("organization_id", organization_id)
        .eq("is_active", True)
        .order("created_at", desc=False)
    ).execute()
    all_bots = bots_result.data or []

    # 2. Lookup member จาก LINE UID
    member = await _lookup_member_by_line(organization_id, line_user_id)

    # 3. กรอง visibility
    if member:
        user_id = member["user_id"]
        is_admin = member.get("org_role") == "admin"
        visible = [
            b for b in all_bots
            if b["visibility"] == "all"
            or is_admin
            or user_id in (b.get("visible_to") or [])
        ]
    else:
        # Guest (ไม่ได้ผูก) → เห็นเฉพาะ visibility: "all"
        visible = [b for b in all_bots if b["visibility"] == "all"]

    return visible
```

### 3.2 เพิ่ม Helper: Lookup member จาก LINE UID

```python
async def _lookup_member_by_line(organization_id: str, line_user_id: str) -> dict | None:
    """Find org member by their linked LINE User ID."""
    supabase = get_supabase()
    result = await (
        supabase.table("org_members")
        .select("user_id, org_role")
        .eq("organization_id", organization_id)
        .eq("line_user_id", line_user_id)
        .limit(1)
    ).execute()
    return result.data[0] if result.data else None
```

### 3.3 แก้ไข Webhook main flow

เปลี่ยนจาก:
```python
bots = await _get_active_bots(org_id)
```

เป็น:
```python
bots = await _get_visible_bots(org_id, line_user_id)
```

### 3.4 เพิ่ม Binding Code Handler ใน Webhook

เพิ่มเช็ค binding code ก่อน keyword อื่นๆ:

```python
# 5a-new. Binding code (6 หลัก)
if user_text.isdigit() and len(user_text) == 6:
    handled = await _try_bind_account(user_text, line_user_id, org_id, reply_token, access_token)
    if handled:
        processed += 1
        continue
```

---

## Section 4 — Frontend: หน้า LINE Binding

### 4.1 เพิ่มส่วน "ผูกบัญชี LINE" ในหน้า Profile

**ไฟล์:** `frontend/src/pages/ProfilePage.tsx` (เพิ่มในส่วนข้อมูลส่วนตัว)

> **เหตุผลที่ไม่ใช้ OrganizationPage:**
> OrganizationPage เป็นหน้าสำหรับ Org Admin เท่านั้น แต่การผูก LINE
> เป็นการตั้งค่า **ส่วนตัว** ที่ **สมาชิกทุกคน** ต้องทำได้
> ProfilePage เหมาะที่สุดเพราะทุก role เข้าถึงได้

**UI:**
```
┌──────────────────────────────────────────┐
│  ผูกบัญชี LINE                            │
│                                          │
│  สถานะ: ยังไม่ได้ผูก                      │
│                                          │
│  [สร้างรหัสผูกบัญชี]                      │
│                                          │
│  ──────── หลังกดปุ่ม ────────            │
│                                          │
│  รหัสของคุณ:  4 8 2 7 1 5               │
│  หมดอายุใน: 4:32                         │
│                                          │
│  วิธีใช้:                                │
│  1. เปิด LINE แชทกับ OA ขององค์กร        │
│  2. พิมพ์รหัส 6 หลักด้านบน               │
│  3. ระบบจะผูกบัญชีให้อัตโนมัติ            │
│                                          │
│  ──────── หลังผูกสำเร็จ ────────          │
│                                          │
│  สถานะ: ผูกแล้ว                          │
│  [ยกเลิกการผูก]                          │
│                                          │
└──────────────────────────────────────────┘
```

### 4.2 Component Structure

```
ProfilePage.tsx
  └── LineBindingSection (new section ต่อจาก profile form)
        ├── สถานะ: ผูก/ไม่ผูก
        ├── ปุ่มสร้างรหัส → POST /line-binding/code
        ├── แสดงรหัส + countdown
        ├── Polling สถานะ (ทุก 3 วินาที) → GET /line-binding
        └── ปุ่มยกเลิก → DELETE /line-binding
```

---

## Section 5 — ลำดับการ Implement

| ขั้นตอน | งาน | ไฟล์ที่แก้ |
|---------|------|-----------|
| **5.1** | SQL: เพิ่ม `line_user_id` column + unique index | Supabase SQL Editor |
| **5.2** | Backend: `_lookup_member_by_line()` helper | `webhook_line.py` |
| **5.3** | Backend: `_get_visible_bots()` แทน `_get_active_bots()` | `webhook_line.py` |
| **5.4** | Backend: Binding API (create code, verify, unbind) | `organization.py` |
| **5.5** | Backend: Binding code handler ใน webhook | `webhook_line.py` |
| **5.6** | Frontend: LINE Binding UI section | `ProfilePage.tsx` |
| **5.7** | ทดสอบ E2E: ผูก → เห็นบอท restricted → ยกเลิก → ไม่เห็น | Manual test |

---

## Security Considerations

| ข้อ | มาตรการ |
|-----|---------|
| Binding code brute-force | Rate limit: 5 ครั้ง/นาที ต่อ LINE UID, code หมดอายุ 5 นาที |
| ผูกซ้ำ | Unique index ป้องกัน 1 LINE = 1 member per org |
| ยกเลิกโดยคนอื่น | เฉพาะเจ้าของบัญชี หรือ Org Admin เท่านั้น |
| LINE UID ปลอม | ไม่มีปัญหา — UID มาจาก LINE webhook ที่ verify signature แล้ว |
| Guest access | ยังใช้งานบอท `visibility: "all"` ได้ปกติ ไม่บังคับผูก |

---

## Bug ที่พบ (ต้องแก้ก่อน/พร้อมกับ implement)

### Bug: Inbox LINE Push ไม่ decrypt access_token

**ไฟล์:** `backend/app/routers/inbox.py` บรรทัด 440-446

**ปัญหา:** เมื่อ Admin ตอบ LINE session ผ่าน Inbox ระบบดึง `line_access_token` จาก DB
แต่ **ไม่ได้ decrypt** ก่อนส่งให้ LINE Push API — token ที่เก็บใน DB ถูกเข้ารหัส AES-GCM
ทำให้ push ไป LINE ไม่ได้ (fail silently เพราะ try/except ดักไว้)

**แก้:** เพิ่ม `decrypt_secret()` ก่อนส่ง:

```python
# ก่อน (bug)
access_token=org_result.data[0]["line_access_token"],

# หลัง (แก้)
from app.core.utils import decrypt_secret
access_token=decrypt_secret(org_result.data[0]["line_access_token"]),
```

**เทียบกับ webhook ที่ทำถูก:** `webhook_line.py` บรรทัด 364
```python
access_token = decrypt_secret(org.get("line_access_token") or "")
```

---

## สิ่งที่ไม่เปลี่ยน

- **DB schema ของ bots** — ไม่เพิ่ม column ใหม่
- **Visibility logic เดิม** — ใช้ `visibility` + `visible_to` เหมือนเดิม
- **Web Chat flow** — ไม่กระทบ
- **Widget flow** — ไม่กระทบ
- **LINE webhook signature verification** — ยังคงเดิม
- **RAG pipeline** — ไม่เปลี่ยนแปลง
