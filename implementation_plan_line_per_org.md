# LINE Integration — Per-Org + Quick Reply Bot Selection

## เป้าหมาย

ย้าย LINE credentials จาก **Per-Bot** (เดิม) ไปเป็น **Per-Org** เพื่อให้ 1 Organization ใช้ 1 LINE OA ได้อย่างสมบูรณ์ พร้อมระบบเลือก Bot ผ่าน Quick Reply สำหรับ Org ที่มี Bot หลายตัว

### หลักการ

```
1 Organization = 1 LINE OA = 1 ชุด Credentials (channel_secret + access_token)
1 LINE OA = 1 Webhook URL → /api/webhook/line/{org_id}
ถ้า Org มี Bot > 1 ตัว → ถาม user ด้วย Quick Reply ก่อนเริ่มแชท
```

---

## User Review Required

> [!IMPORTANT]
> **เรื่อง columns เก่าใน `bots` table**
> ปัจจุบัน `bots` มี `line_access_token` และ `line_channel_secret` อยู่
> แผนนี้จะ **ย้าย** credentials ไปไว้ที่ `organizations` แทน แล้ว **ลบ** columns เก่าออกจาก `bots`
> ถ้าต้องการเก็บไว้แบบ backward-compatible กรุณาแจ้ง

> [!IMPORTANT]
> **เรื่องคำสั่ง "เปลี่ยนบอท"**
> เมื่อ user พิมพ์ข้อความต่อไปนี้ระบบจะ reset session แล้วให้เลือก Bot ใหม่:
> - `เปลี่ยนบอท`
> - `สลับบอท`
> - `เมนู`
> - `/menu`
> ต้องการเพิ่ม/ลดคำสั่งไหนมั้ยคะ?

---

## Proposed Changes

### Step 1: SQL Migration

#### [NEW] `backend/sql/018_line_per_org.sql`

```sql
-- ===== Step 1: เพิ่ม LINE columns ที่ organizations =====
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS line_channel_secret TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS line_access_token TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_line_enabled BOOLEAN DEFAULT false;

-- ===== Step 2: ย้ายข้อมูลจาก bots → organizations (ถ้ามี) =====
-- กรณี org ยังไม่มี credentials แต่ bot มี → copy ค่ามาให้
UPDATE organizations o
SET
    line_access_token = sub.line_access_token,
    line_channel_secret = sub.line_channel_secret,
    is_line_enabled = true
FROM (
    SELECT DISTINCT ON (organization_id)
        organization_id,
        line_access_token,
        line_channel_secret
    FROM bots
    WHERE line_access_token IS NOT NULL
      AND line_channel_secret IS NOT NULL
    ORDER BY organization_id, created_at ASC
) sub
WHERE o.id = sub.organization_id
  AND o.line_access_token IS NULL;

-- ===== Step 3: ลบ columns เก่าออกจาก bots =====
ALTER TABLE bots DROP COLUMN IF EXISTS line_access_token;
ALTER TABLE bots DROP COLUMN IF EXISTS line_channel_secret;
```

---

### Step 2: Backend — Webhook Router (แก้หลัก)

#### [MODIFY] `backend/app/routers/webhook_line.py`

เปลี่ยนแปลงหลัก:

1. **Webhook URL**: `/api/webhook/line/{bot_id}` → `/api/webhook/line/{org_id}`
2. **ดึง Credentials**: จาก `organizations` แทน `bots`
3. **Bot Selection Flow**:
   - ถ้า Org มี Bot 1 ตัว → ใช้เลย
   - ถ้า Org มี Bot หลายตัว → ตรวจ session เก่าก่อน
     - มี session อยู่ → ส่งเข้า Bot ที่ผูกไว้
     - ไม่มี session + user เป็นคนใหม่ → ส่ง Quick Reply ให้เลือก Bot
     - user พิมพ์คำสั่ง "เปลี่ยนบอท" → ปิด session เก่า + ส่ง Quick Reply ใหม่
4. **Quick Reply**: ใช้ LINE Messaging API `quickReply.items` ซึ่งแสดงเป็นปุ่มกดท้ายข้อความ

**Flow ละเอียด:**

```
POST /api/webhook/line/{org_id}
  │
  ├── 1. ดึง org → ตรวจ is_line_enabled + credentials
  ├── 2. Verify X-Line-Signature ด้วย org.line_channel_secret
  ├── 3. Parse events → สำหรับแต่ละ text message:
  │     │
  │     ├── 3a. ผู้ใช้พิมพ์ "เปลี่ยนบอท/เมนู/menu"?
  │     │     ├── ใช่ → ปิด session เก่า + ส่ง Quick Reply เลือก Bot ใหม่
  │     │     └── ไม่ใช่ → ต่อ
  │     │
  │     ├── 3b. มี active session อยู่แล้ว?
  │     │     ├── ใช่ → ส่งข้อความเข้า RAG pipeline กับ Bot ที่ผูกไว้
  │     │     └── ไม่ใช่ → ต่อ
  │     │
  │     ├── 3c. Org มี Bot กี่ตัว?
  │     │     ├── 1 ตัว → สร้าง session กับ Bot ตัวนั้น + เข้า RAG
  │     │     └── หลายตัว → ต่อ
  │     │
  │     ├── 3d. ผู้ใช้กดเลือก Bot จาก Quick Reply? (ตรวจ text = "bot:{bot_id}")
  │     │     ├── ใช่ → สร้าง session กับ Bot ที่เลือก + ส่งข้อความต้อนรับ
  │     │     └── ไม่ใช่ → ส่ง Quick Reply ให้เลือก
  │     │
  │     └── return 200 OK
```

**Quick Reply payload:**

```json
{
  "replyToken": "...",
  "messages": [{
    "type": "text",
    "text": "สวัสดีค่ะ! กรุณาเลือกบริการที่ต้องการ:",
    "quickReply": {
      "items": [
        {
          "type": "action",
          "action": {
            "type": "message",
            "label": "ฝ่ายขาย",
            "text": "bot:uuid-of-sales-bot"
          }
        },
        {
          "type": "action",
          "action": {
            "type": "message",
            "label": "ฝ่ายบริการ",
            "text": "bot:uuid-of-support-bot"
          }
        }
      ]
    }
  }]
}
```

---

### Step 3: Backend — Inbox LINE Push (แก้แหล่งดึง Token)

#### [MODIFY] `backend/app/routers/inbox.py` (บรรทัด ~410-428)

```diff
  # ── LINE Push: if this session is from LINE, push the reply ──
  if sess.get("platform_source") == "line" and sess.get("platform_user_id"):
-     bot_result = await (
-         supabase.table("bots")
-         .select("line_access_token")
-         .eq("id", sess["bot_id"])
+     org_result = await (
+         supabase.table("organizations")
+         .select("line_access_token")
+         .eq("id", organization_id)
          .limit(1)
      ).execute()
-     if bot_result.data and bot_result.data[0].get("line_access_token"):
+     if org_result.data and org_result.data[0].get("line_access_token"):
          from app.services.line_service import push_message
          await push_message(
              user_id=sess["platform_user_id"],
              text=content,
-             access_token=bot_result.data[0]["line_access_token"],
+             access_token=org_result.data[0]["line_access_token"],
          )
```

---

### Step 4: Backend — Bot Router (ลบ LINE fields)

#### [MODIFY] `backend/app/routers/bot.py`

- ลบ `line_access_token` ออกจาก `BotUpdateRequest`
- ลบ logic ที่เช็ค `body.line_access_token` ในฟังก์ชัน update

---

### Step 5: Backend — Organization Router (เพิ่ม LINE API)

#### [MODIFY] `backend/app/routers/organization.py`

เพิ่ม 2 endpoints ใหม่:

```python
# GET /api/orgs/{org_id}/line-config → ดึง LINE config (Org Admin only)
# PUT /api/orgs/{org_id}/line-config → อัปเดต LINE credentials + toggle

class LineConfigRequest(BaseModel):
    line_channel_secret: Optional[str] = None
    line_access_token: Optional[str] = None
    is_line_enabled: Optional[bool] = None

class LineConfigResponse(BaseModel):
    is_line_enabled: bool
    has_credentials: bool  # true ถ้า channel_secret + access_token มีค่า
    webhook_url: str       # เช่น https://yourdomain.com/api/webhook/line/{org_id}
```

> [!NOTE]
> **เรื่อง Security**: จะไม่ส่ง `line_channel_secret` / `line_access_token` กลับไปให้ Frontend ตรงๆ
> ส่งแค่ `has_credentials: true/false` เพื่อบอกว่ากรอกค่าไว้แล้วหรือยัง

---

### Step 6: Frontend — Integration Page (เชื่อม API จริง)

#### [MODIFY] `frontend/src/pages/IntegrationPage.tsx`

ปัจจุบัน toggle เป็น **UI-only** (ไม่บันทึกลง DB) → แก้ให้:

1. โหลด LINE config จาก `GET /api/orgs/{org_id}/line-config` ตอนเปิดหน้า
2. แสดง Webhook URL สำหรับ copy ไปตั้งค่าใน LINE Console
3. ฟอร์มกรอก `Channel Secret` + `Channel Access Token`
4. Toggle `is_line_enabled` บันทึกจริงผ่าน `PUT /api/orgs/{org_id}/line-config`
5. ปุ่ม "ทดสอบ Webhook" (optional — ส่ง verification ping)

#### [MODIFY] `frontend/src/api/endpoints.ts`

เพิ่ม API calls:

```typescript
orgApi: {
    getLineConfig: (orgId: string) =>
        apiClient.get(`/api/orgs/${orgId}/line-config`),
    updateLineConfig: (orgId: string, data: LineConfigPayload) =>
        apiClient.put(`/api/orgs/${orgId}/line-config`, data),
}
```

---

## สรุปไฟล์ที่ต้องแก้ (ทั้งหมด)

| กลุ่ม | ไฟล์ | การเปลี่ยนแปลง |
|-------|------|---------------|
| **SQL** | `sql/018_line_per_org.sql` [NEW] | เพิ่ม columns + ย้ายข้อมูล + ลบ columns เก่า |
| **Backend** | `routers/webhook_line.py` | เปลี่ยน path, ดึง creds จาก org, เพิ่ม Bot Selection + Quick Reply |
| **Backend** | `routers/inbox.py` | แก้ LINE Push ให้ดึง token จาก `organizations` |
| **Backend** | `routers/bot.py` | ลบ `line_access_token` ออกจาก schema |
| **Backend** | `routers/organization.py` | เพิ่ม GET/PUT `/line-config` endpoints |
| **Frontend** | `pages/IntegrationPage.tsx` | เชื่อม API จริง, ฟอร์มกรอก credentials, แสดง Webhook URL |
| **Frontend** | `api/endpoints.ts` | เพิ่ม `getLineConfig` + `updateLineConfig` |

---

## Decisions (Resolved)

| # | คำถาม | คำตอบ |
|---|-------|-------|
| 1 | ลบ columns เก่าใน `bots` ทันที? | ✅ ลบเลย — เพื่อนรัน SQL migration บน Supabase แล้ว |
| 2 | Webhook URL domain | ✅ ใช้ env var `PUBLIC_API_URL` — ตอนทดสอบใช้ **ngrok static domain** |
| 3 | ข้อความต้อนรับ | ✅ ใช้ `"คุณกำลังพูดคุยกับ {bot.name} พิมพ์คำถามได้เลยค่ะ"` |

---

## Implementation Status

| Step | รายการ | สถานะ |
|------|--------|-------|
| 1 | SQL Migration (`018_line_per_org.sql`) | ✅ เพื่อนรันบน Supabase แล้ว |
| 2 | `webhook_line.py` — Per-Org + Quick Reply + Bot Selection | ✅ Done |
| 3 | `inbox.py` — LINE Push ดึง token จาก `organizations` | ✅ Done |
| 4 | `bot.py` — ลบ `line_access_token` ออกจาก schema | ✅ Done |
| 5 | `organization.py` — เพิ่ม GET/PUT `/line-config` endpoints | ✅ Done |
| 5 | `config.py` — เพิ่ม `PUBLIC_API_URL` env var | ✅ Done |
| 6 | `IntegrationPage.tsx` — เชื่อม API จริง + แสดง Webhook URL | ✅ Done |
| 6 | `endpoints.ts` — เพิ่ม `getLineConfig` + `updateLineConfig` | ✅ Done |
| 6 | `line_service.py` — เพิ่ม `reply_with_quick_reply()` | ✅ Done |

---

## Verification Plan

### Setup ก่อนทดสอบ
1. สมัคร [ngrok.com](https://ngrok.com) → รับ **static domain** (ฟรี 1 domain)
2. Run: `ngrok http --domain=<your-static-domain> 8001`
3. ตั้ง `backend/.env`: `PUBLIC_API_URL=https://<your-static-domain>`
4. Restart backend

### Manual Verification
1. **ใส่ Credentials ผ่าน IntegrationPage** → บันทึกลง DB จริง
2. **Copy Webhook URL** จาก IntegrationPage → ไปตั้งใน LINE Developers Console
3. **ส่ง Verification Ping** จาก LINE Console → ได้ 200 OK
4. **ส่งข้อความจาก LINE** (Org มี Bot 1 ตัว) → ได้คำตอบจาก Bot ทันที
5. **ส่งข้อความจาก LINE** (Org มี Bot หลายตัว) → ได้ Quick Reply → กดเลือก → ได้คำตอบ
6. **พิมพ์ "เปลี่ยนบอท"** → ได้ Quick Reply เลือก Bot ใหม่
7. **Admin ตอบกลับใน Inbox** → ข้อความไปถึง LINE user (Push API)
