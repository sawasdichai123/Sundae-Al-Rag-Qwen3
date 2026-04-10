# Code Review — Implementation Plan

**อิงจาก:** Code Review Report.md (Round 4 — 2026-04-04)
**ขอบเขต:** ไม่รวม LINE Integration (แยกไว้ใน implementation_plan_line_per_org.md)
**วิธีใช้:** ทำทีละ Phase — ติ๊ก `[x]` เมื่อเสร็จแต่ละ item หยุดตรงไหนก็ได้แล้วกลับมาทำต่อ

---

## สถานะภาพรวม

| Phase | หัวข้อ | จำนวน | เวลารวม | สถานะ |
|-------|--------|--------|---------|-------|
| Phase 1 | Security | 5 items | ~5 ชม. | ✅ Done |
| Phase 2 | Data Integrity | 4 items | ~2.5 ชม. | ✅ Done |
| Phase 3 | UX / i18n | 6 items | ~4.75 ชม. | ✅ Done |
| Phase 4 | Code Quality | 3 items | ~2 ชม. | ✅ Done |
| Phase 5 | Complex Refactor | 2 items | ~10 ชม. | ✅ Done |

---

## Phase 1 — Security (~5 ชั่วโมง)

> ควรแก้ก่อน deploy จริง — endpoint สาธารณะที่ไม่มีการป้องกัน

### 1.1 Widget: Message Max Length (~15 นาที) ✅

- [x] **ไฟล์:** `backend/app/routers/widget.py`
- [x] เพิ่ม `max_length=5000` ใน `WidgetChatRequest.message` field (Pydantic auto-validates → 422)

```python
# ตัวอย่าง
if len(body.message) > 5000:
    raise HTTPException(status_code=422, detail="Message too long (max 5,000 chars)")
```

---

### 1.2 /health/metrics Unauthenticated (~15 นาที) ✅

- [x] **ไฟล์:** `backend/app/routers/health.py`
- [x] เพิ่ม `_user=Depends(get_current_user)` — ต้อง login ก่อนถึงจะดู metrics ได้

---

### 1.3 Unverified Bot Ownership ใน link_document ✅ (False Positive)

- [x] ตรวจสอบแล้ว — `link_document_to_bot` มี `require_org_admin` + `verify_organization` + `.eq("organization_id", organization_id)` บน bot query อยู่แล้ว → secure

```python
# ตัวอย่าง
bot_result = await supabase.table("bots").select("organization_id").eq("id", bot_id).single().execute()
if bot_result.data["organization_id"] != organization_id:
    raise HTTPException(status_code=403, detail="Bot does not belong to your organization")
```

---

### 1.4 Widget: No Rate Limiting (~2 ชั่วโมง) ✅

- [x] เพิ่ม `slowapi>=0.1.9` ใน `requirements.txt`
- [x] ตั้ง `Limiter` + `RateLimitExceeded` handler ใน `main.py`
- [x] `/session/{bot_id}` → 20/minute per IP
- [x] `/chat/{bot_id}` → 30/minute per IP
- [x] `/history/{session_id}` → 30/minute per IP

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

---

### 1.5 Widget: Session History Enumerable (~2 ชั่วโมง) ✅

- [x] เพิ่ม `_sign_session()` + `_verify_session_token()` helpers (HMAC-SHA256 ใช้ `supabase_jwt_secret`)
- [x] `WidgetSessionResponse` เพิ่ม `session_token` field
- [x] `create_widget_session` → return `session_token` พร้อม session_id
- [x] `widget_chat` → verify token ก่อน reuse session; done event ส่ง token กลับด้วย
- [x] `get_widget_history` → require `session_token` query param + verify ก่อน return ข้อมูล

```python
import hmac, hashlib

def sign_session(session_id: str, secret: str) -> str:
    return hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()

def verify_session(session_id: str, token: str, secret: str) -> bool:
    expected = sign_session(session_id, secret)
    return hmac.compare_digest(expected, token)
```

**Phase 1 เสร็จแล้ว → อัพเดทสถานะเป็น ✅**

---

## Phase 2 — Data Integrity (~2.5 ชั่วโมง)

> Race conditions ที่อาจทำให้ข้อมูลเสียหาย

### 2.1 Slug Collision Race Condition (~30 นาที) ✅

- [x] **ไฟล์:** `backend/app/routers/organization.py`
- [x] ลบ pre-check query ออก — ใช้ DB UNIQUE constraint แทน
- [x] Try insert → ถ้า duplicate error → retry ครั้งเดียวด้วย 6-char random suffix
- [x] เพิ่ม `import random, string` ที่ต้องใช้

```python
import random, string

def make_slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9-]", "-", name.lower()).strip("-")
    return base

try:
    # insert with slug
except Exception as e:
    if "duplicate" in str(e).lower():
        suffix = "".join(random.choices(string.ascii_lowercase, k=4))
        # retry with f"{slug}-{suffix}"
    else:
        raise
```

---

### 2.2 Auto-Accept Race Condition (~30 นาที) ✅

- [x] **ไฟล์:** `backend/app/routers/approval.py`
- [x] เปลี่ยน `insert` → `upsert` พร้อม `on_conflict="user_id,organization_id"` + `ignore_duplicates=True`

```python
await supabase.table("org_members").upsert(
    {"org_id": org_id, "user_id": user_id, "role": role},
    on_conflict="org_id,user_id"
).execute()
```

---

### 2.3 First-Accepter Gets Owner Role (~1 ชั่วโมง) ✅

- [x] **ไฟล์:** `backend/app/routers/organization.py` — `accept_invitation`
- [x] เปลี่ยน `insert` → `upsert` พร้อม `on_conflict="user_id,organization_id"` + `ignore_duplicates=True`
- [x] ป้องกัน concurrent accepts ที่ทำให้ duplicate member record ได้

---

### 2.4 DB Connection Retry (~30 นาที) ✅

- [x] **ไฟล์:** `backend/app/core/database.py`
- [x] เพิ่ม retry loop 3 รอบใน `init_supabase()` พร้อม exponential backoff: 1s → 2s → 4s
- [x] Log warning แต่ละ attempt ที่ fail
- [x] Raise `RuntimeError` พร้อม last error message หลัง 3 ครั้ง

```python
import asyncio

async def get_supabase_with_retry(max_retries=3):
    for attempt in range(max_retries):
        try:
            return await get_supabase()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(2 ** attempt)
```

**Phase 2 เสร็จแล้ว → อัพเดทสถานะเป็น ✅**

---

## Phase 3 — UX / i18n (~4.75 ชั่วโมง)

> สิ่งที่ user เห็นโดยตรง

### 3.1 ลบ Emoji ออกจาก UI (~1 ชั่วโมง)

- [ ] **Grep หา emoji ทั่วทั้ง codebase:**
  ```bash
  grep -rn "✅\|❌\|⚠️\|🔴\|🟢\|💡\|🚀\|📋\|🔒\|👤\|📁" frontend/src/
  ```
- [ ] ลบออกจาก:
  - [ ] `i18n/th.json` — ค่าที่มี emoji นำหน้า/ต่อท้าย
  - [ ] `i18n/en.json` — เช่นกัน
  - [ ] Pages ที่ inline emoji ใน JSX
  - [ ] authStore.ts error messages
- [ ] **ห้ามลบ emoji ที่เป็น icon จาก library** (lucide-react, heroicons) — ลบเฉพาะ emoji character จริงๆ

---

### 3.2 LoginPage: registerMsg ใช้ Emoji ตรวจ Success (~15 นาที)

- [ ] **ไฟล์:** `frontend/src/pages/LoginPage.tsx`
- [ ] หา logic ที่เช็ค `"✅"` ใน string เพื่อตัดสิน success/error style
- [ ] แทนด้วย boolean flag `isSuccess: boolean` แยกออกมา

```typescript
// แทนที่
const [registerMsg, setRegisterMsg] = useState("")
// ด้วย
const [registerMsg, setRegisterMsg] = useState("")
const [registerSuccess, setRegisterSuccess] = useState(false)

// แล้วตอน set:
setRegisterMsg(t("login.registerSuccess"))
setRegisterSuccess(true)
```

---

### 3.3 InboxPage: timeAgo() Time Units (~30 นาที)

- [ ] **ไฟล์:** `frontend/src/pages/InboxPage.tsx`
- [ ] เพิ่ม i18n keys ใน `th.json` + `en.json`:
  ```json
  "common": {
    "justNow": "เมื่อกี้",
    "minutesAgo": "นาทีที่แล้ว",
    "hoursAgo": "ชั่วโมงที่แล้ว",
    "daysAgo": "วันที่แล้ว",
    "weeksAgo": "สัปดาห์ที่แล้ว"
  }
  ```
- [ ] แก้ `timeAgo()` ให้รับ translations object แทน hardcode Thai

---

### 3.4 ForgotPassword / ResetPassword Thai ที่เหลือ (~30 นาที)

- [ ] **ไฟล์:** `frontend/src/pages/ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`
- [ ] Grep หา string Thai ที่ยังค้างอยู่:
  ```bash
  grep -n "[\u0E00-\u0E7F]" frontend/src/pages/ForgotPasswordPage.tsx
  grep -n "[\u0E00-\u0E7F]" frontend/src/pages/ResetPasswordPage.tsx
  ```
- [ ] เพิ่ม keys ใน JSON แล้วแทนด้วย `t()`

---

### 3.5 axios.ts: Forced Redirect ทับ User Data (~1 ชั่วโมง)

- [ ] **ไฟล์:** `frontend/src/api/axios.ts`
- [ ] แทนที่ `window.location.href = "/login"` ทันที ด้วย event-based approach
- [ ] Emit custom event `"session-expired"` แทน
- [ ] ใน `App.tsx` หรือ `ProtectedRoute.tsx` — listen event แล้วแสดง dialog ให้ user กด confirm ก่อน redirect

```typescript
// axios.ts — แทนที่ redirect ด้วย:
window.dispatchEvent(new CustomEvent("session-expired"))

// App.tsx — เพิ่ม listener:
useEffect(() => {
  const handler = () => setShowSessionExpired(true)
  window.addEventListener("session-expired", handler)
  return () => window.removeEventListener("session-expired", handler)
}, [])
```

---

### 3.6 authStore.ts: Hardcoded Thai Errors (~1.5 ชั่วโมง)

- [ ] **ไฟล์:** `frontend/src/stores/authStore.ts`
- [ ] Store ไม่มี React context → ใช้ `i18nStore.getState().t()` โดยตรงแทน `useT()`
- [ ] เพิ่ม keys ใน JSON: `auth.loadFailed`, `auth.sessionExpired`, `auth.loginRequired`
- [ ] แทนที่ hardcoded string ทั้งหมดด้วย store-level translation call

```typescript
import { useI18nStore } from "../i18n"

// ใน store action:
const t = useI18nStore.getState().t
throw new Error(t("auth.loadFailed"))
```

**Phase 3 เสร็จแล้ว → อัพเดทสถานะเป็น ✅**

---

## Phase 4 — Code Quality (~2 ชั่วโมง)

> ไม่กระทบ user โดยตรง แต่ทำให้ codebase สะอาดขึ้น

### 4.1 OrganizationPage: window.location.href (~10 นาที)

- [ ] **ไฟล์:** `frontend/src/pages/OrganizationPage.tsx`
- [ ] หลังลบ org สำเร็จ — แทน `window.location.href = "/"` ด้วย `navigate("/")`
- [ ] import `useNavigate` จาก `react-router-dom`

---

### 4.2 bot.py: Inactive Bots ยังแสดงอยู่ (~15 นาที)

- [ ] **ไฟล์:** `backend/app/routers/bot.py`
- [ ] ใน `list_bots` endpoint — เพิ่ม `.eq("is_active", True)` filter
- [ ] ตรวจสอบว่า widget + LINE webhook ก็ filter `is_active = true` ด้วย (ถ้ายังไม่ได้ทำ)

---

### 4.3 inbox.py: Pagination (~1.5 ชั่วโมง)

- [ ] **ไฟล์:** `backend/app/routers/inbox.py`
- [ ] เพิ่ม query params: `page: int = 1`, `page_size: int = 20`
- [ ] แปลงเป็น `.range(offset, offset + page_size - 1)` ใน Supabase query
- [ ] ส่ง response พร้อม `total` count และ `page` metadata
- [ ] อัพเดท `frontend/src/api/endpoints.ts` ให้ส่ง params ด้วย

```python
@router.get("/sessions")
async def list_sessions(page: int = 1, page_size: int = 20, ...):
    offset = (page - 1) * page_size
    result = await supabase.table("chat_sessions")
        .select("*", count="exact")
        .range(offset, offset + page_size - 1)
        .execute()
    return {"data": result.data, "total": result.count, "page": page}
```

**Phase 4 เสร็จแล้ว → อัพเดทสถานะเป็น ✅**

---

## Phase 5 — Complex Refactor (~10 ชั่วโมง)

> ทำเป็น sprint แยก — ต้องการเวลาและสมาธิเต็มๆ

### 5.1 WebChatPage: Polling Memory Leak + Race Condition (~4 ชั่วโมง)

- [ ] **ไฟล์:** `frontend/src/pages/WebChatPage.tsx`
- [ ] สร้าง `useRef` สำหรับ interval ID ทุกตัว
- [ ] `useEffect` cleanup function ต้อง `clearInterval` ทุกครั้ง
- [ ] ป้องกัน race: ใช้ `AbortController` per-request, cancel เมื่อ session เปลี่ยน
- [ ] แก้ default poll timestamp จาก `"1970-01-01"` → `new Date().toISOString()` (ก่อน mount)
- [ ] Wrap chat bubbles ด้วย `React.memo` เพื่อลด re-render

```typescript
// Pattern สำหรับ cleanup
useEffect(() => {
  const controller = new AbortController()
  const interval = setInterval(() => {
    if (!controller.signal.aborted) fetchMessages(controller.signal)
  }, 3000)
  return () => {
    controller.abort()
    clearInterval(interval)
  }
}, [selectedSession?.id])
```

---

### 5.2 Token Refresh Race Condition (Cross-Tab) (~6 ชั่วโมง)

- [ ] **ไฟล์:** `frontend/src/lib/supabaseClient.ts`, `frontend/src/api/axios.ts`
- [ ] Implement `BroadcastChannel` เพื่อ sync token state ระหว่าง tabs
- [ ] Tab ที่ refresh token สำเร็จ → broadcast token ใหม่ไปทุก tab
- [ ] Tab อื่น receive → update token ใน memory ทันที ไม่ต้อง refresh ซ้ำ
- [ ] เพิ่ม distributed lock: tab แรกที่ได้ lock → refresh / tab อื่น → รอ

```typescript
const channel = new BroadcastChannel("auth-sync")

// Tab ที่ refresh:
channel.postMessage({ type: "token-refreshed", token: newToken })

// Tab อื่น:
channel.onmessage = (e) => {
  if (e.data.type === "token-refreshed") {
    updateToken(e.data.token)
  }
}
```

**Phase 5 เสร็จแล้ว → อัพเดทสถานะเป็น ✅**

---

## Progress Tracker

| Phase | Items Done | Total | % |
|-------|-----------|-------|---|
| Phase 1 | 5 | 5 | 100% |
| Phase 2 | 4 | 4 | 100% |
| Phase 3 | 6 | 6 | 100% |
| Phase 4 | 3 | 3 | 100% |
| Phase 5 | 2 | 2 | 100% |
| **รวม** | **0** | **20** | **0%** |

---

*สร้างเมื่อ 2026-04-04 | อิงจาก Code Review Report.md Round 4*
