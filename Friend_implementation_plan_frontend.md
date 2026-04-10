# 🔒 รายงานตรวจสอบช่องโหว่ด้านความปลอดภัย — Frontend (SUNDAE)

**วันที่ตรวจสอบ:** 6 เมษายน 2026  
**ขอบเขต:** `frontend/src/` — React + TypeScript + Supabase Auth + Axios  
**มาตรฐานอ้างอิง:** OWASP Top 10 (2021), OWASP Frontend Security Best Practices

---

## สรุปภาพรวม

| ระดับความรุนแรง | จำนวน |
|:---|:---:|
| 🔴 **Critical** | 2 |
| 🟠 **High** | 4 |
| 🟡 **Medium** | 5 |
| 🟢 **Low** | 4 |
| **รวม** | **15** |

---

## รายละเอียดช่องโหว่

---

### 🔴 SEC-F01: Supabase Anon Key Fallback เป็น Placeholder — เปิด Client ที่ไม่ปลอดภัย

> [!CAUTION]
> ระดับ: **Critical** · OWASP: A05:2021 — Security Misconfiguration

**ไฟล์:** [supabaseClient.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/supabaseClient.ts#L66-L68)

**ปัญหา:**  
เมื่อ environment variables `VITE_SUPABASE_URL` หรือ `VITE_SUPABASE_ANON_KEY` ไม่ได้ตั้งค่า ระบบจะ fallback ไปใช้ค่า hardcoded:
```typescript
export const supabase = createClient(
    supabaseUrl || "http://localhost:54321",      // ← fallback URL
    supabaseAnonKey || "placeholder-key",          // ← fallback key
    ...
);
```

- แอปจะ **ไม่หยุดทำงาน** แม้ตั้งค่าไม่ครบ เพียงแค่แสดง `console.warn` (บรรทัด 21-26)
- ในกรณี production build ที่ลืมตั้งค่า `.env` ระบบจะพยายามเชื่อมต่อกับ `localhost:54321` โดยใช้ placeholder key ซึ่งอาจนำไปสู่ error ที่ไม่ชัดเจน หรือกรณีที่มี local Supabase instance ทำงานอยู่ อาจเชื่อมต่อผิด instance ได้

**แนวทางแก้ไข:**
```typescript
if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "[SUNDAE] FATAL: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
        "Application cannot start without valid Supabase configuration."
    );
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey, { ... });
```

---

### 🔴 SEC-F02: Token/Sensitive Data Leaked ผ่าน console.log ใน Production

> [!CAUTION]
> ระดับ: **Critical** · OWASP: A09:2021 — Security Logging and Monitoring Failures

**ไฟล์ที่ได้รับผลกระทบ:**
- [endpoints.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/endpoints.ts#L121-L147) — log token status และ API URL
- [ResetPasswordPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/ResetPasswordPage.tsx#L36-L103) — log URL hash (มี recovery token), session status

**ปัญหา:**

```typescript
// endpoints.ts:125
console.log("[askStream] Step 1 done, token:", token ? "YES" : "NO");
// endpoints.ts:147
console.log("[askStream] Sending fetch to", import.meta.env.VITE_API_BASE_URL);

// ResetPasswordPage.tsx:36-37
console.log("[ResetPassword] URL hash:", hash);         // ← RECOVERY TOKEN!
console.log("[ResetPassword] error_code:", errorCode, "error_description:", errorDesc);
```

- **URL hash มี recovery token ของ Supabase** — การ log ค่านี้ออกมาทำให้ผู้ที่เข้าถึง browser console (เช่น browser extension, shared workstation) สามารถอ่าน token ได้
- API Base URL ถูก log ออกมาเสมอ ทำให้ผู้โจมตีรู้โครงสร้าง backend ง่ายขึ้น
- ไม่มี log stripping สำหรับ production build

**แนวทางแก้ไข:**

1. ลบ `console.log` ที่มี sensitive data ทั้งหมดออก
2. ใช้ wrapper function ที่ทำงานเฉพาะ development:
```typescript
const isDev = import.meta.env.DEV;
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args); };
```
3. เพิ่ม ESLint rule `no-console` สำหรับ production build

---

### 🟠 SEC-F03: Role-Based Access Control (RBAC) พึ่ง Client-Side เท่านั้น

> [!WARNING]
> ระดับ: **High** · OWASP: A01:2021 — Broken Access Control

**ไฟล์:**
- [ProtectedRoute.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/components/ProtectedRoute.tsx#L18-L44)
- [App.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/App.tsx#L188-L221)
- [DashboardLayout.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/layouts/DashboardLayout.tsx#L185-L223)

**ปัญหา:**

การจำกัดสิทธิ์ทำที่ฝั่ง client เท่านั้น:
```typescript
// ProtectedRoute.tsx
if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
}
```

- `ProtectedRoute` ตรวจสอบ role จาก Zustand store ซึ่ง **ผู้ใช้สามารถแก้ไขได้** ผ่าน browser devtools
- ผู้โจมตีสามารถเข้าถึงหน้า admin-only โดยแก้ไข `useAuthStore` ใน devtools ได้ทันที
- **หมายเหตุ:** หากเฉพาะ UI เท่านั้นที่ถูกเปิดเผย แต่ API endpoint ตรวจสอบ role ที่ backend อยู่แล้ว ความเสี่ยงก็ลดลง

**แนวทางแก้ไข:**

1. ✅ **ต้องตรวจสอบสิทธิ์ที่ Backend API ทุก endpoint** (ควรมีอยู่แล้ว — ตรวจสอบว่า backend enforce อยู่)
2. เพิ่ม `Object.freeze()` หรือ store protection ป้องกันการแก้ไขผ่าน devtools
3. พิจารณาเพิ่ม middleware ที่ re-verify token + role ก่อนแสดงหน้า sensitive

---

### 🟠 SEC-F04: Organization ID จาก localStorage ส่งไปเป็น X-Active-Org Header — อาจถูก Tamper

> [!WARNING]
> ระดับ: **High** · OWASP: A01:2021 — Broken Access Control (IDOR)

**ไฟล์:**
- [axios.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/axios.ts#L134-L140)
- [endpoints.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/endpoints.ts#L165-L166)

**ปัญหา:**

```typescript
// axios.ts:136-138
const activeOrgId = localStorage.getItem("sundae_active_org_id");
if (activeOrgId) {
    config.headers["X-Active-Org"] = activeOrgId;
}
```

- Organization ID อ่านจาก localStorage ที่ **ผู้ใช้แก้ไขได้**
- Header `X-Active-Org` ถูกส่งไปกับทุก API request เพื่อ multi-tenant isolation
- ผู้โจมตีสามารถเปลี่ยน org ID ใน localStorage เป็น org อื่นได้ ทำให้เข้าถึงข้อมูลขององค์กรอื่น **ถ้า backend ไม่ตรวจสอบ membership**

**แนวทางแก้ไข:**

1. ✅ **Backend ต้องตรวจสอบ org_members ว่า user เป็นสมาชิกของ org นั้นจริงหรือไม่** ก่อนให้เข้าถึงข้อมูล
2. Frontend ควร validate org ID กับ `orgs` list ก่อนส่ง:
```typescript
const orgs = useOrgStore.getState().orgs;
const isValid = orgs.some(o => o.id === activeOrgId);
if (isValid) config.headers["X-Active-Org"] = activeOrgId;
```

---

### 🟠 SEC-F05: ไม่มี Rate Limiting สำหรับ Login / Register Form

> [!WARNING]
> ระดับ: **High** · OWASP: A07:2021 — Identification and Authentication Failures

**ไฟล์:** [LoginPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/LoginPage.tsx#L44-L84)

**ปัญหา:**

- ไม่มีการจำกัดจำนวนครั้งที่ login ได้ (rate limiting) ที่ฝั่ง frontend
- ไม่มี CAPTCHA / reCAPTCHA หรือ anti-bot mechanism
- ผู้โจมตีสามารถทำ brute force attack หรือ credential stuffing ได้
- ฟอร์ม register ก็ไม่มี rate limiting ทำให้สร้าง account จำนวนมากได้

**แนวทางแก้ไข:**

1. เพิ่ม rate limiter ที่ฝั่ง frontend (เช่น disable ปุ่ม login 30 วินาทีหลัง fail 5 ครั้ง)
2. เพิ่ม reCAPTCHA v3 หรือ Turnstile สำหรับ login/register
3. ✅ **Backend ต้องมี rate limiting** (Supabase มี built-in ระดับหนึ่ง แต่ควรเพิ่ม custom rate limiter)
4. เพิ่ม exponential backoff หลัง login ล้มเหลวต่อเนื่อง

---

### 🟠 SEC-F06: Password Policy ที่ Frontend อ่อนเกินไป (ขั้นต่ำ 6 ตัวอักษร)

> [!WARNING]
> ระดับ: **High** · OWASP: A07:2021 — Identification and Authentication Failures

**ไฟล์:**
- [LoginPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/LoginPage.tsx#L230) — `minLength={6}`
- [ResetPasswordPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/ResetPasswordPage.tsx#L122) — `password.length < 6`

**ปัญหา:**

```typescript
// LoginPage.tsx:230
<input ... minLength={6} ... />

// ResetPasswordPage.tsx:122
if (password.length < 6) {
    setError(t("resetPassword.tooShort"));
}
```

- Password policy ขั้นต่ำ 6 ตัวอักษรเท่านั้น
- ไม่มีข้อกำหนดด้าน complexity (ตัวพิมพ์ใหญ่/เล็ก, ตัวเลข, อักขระพิเศษ)
- ไม่มีการตรวจสอบ common/leaked passwords
- NIST SP 800-63B แนะนำขั้นต่ำ 8 ตัวอักษร

**แนวทางแก้ไข:**

1. เพิ่ม password strength validation:
```typescript
const isStrongPassword = (pw: string): boolean => {
    return pw.length >= 8 
        && /[A-Z]/.test(pw)
        && /[a-z]/.test(pw)
        && /[0-9]/.test(pw);
};
```
2. แสดง password strength meter ให้ผู้ใช้เห็น
3. ✅ **ตรวจสอบที่ Supabase config ด้วย** ว่า auth.password_min_length ตั้งค่าเท่าไร

---

### 🟡 SEC-F07: Session Token เก็บใน localStorage — เสี่ยงต่อ XSS

> [!IMPORTANT]
> ระดับ: **Medium** · OWASP: A07:2021 — Identification and Authentication Failures

**ไฟล์:**
- [axios.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/axios.ts#L55-L71) — `readTokenFromStorage()`
- [supabaseClient.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/supabaseClient.ts#L76) — `persistSession: true`

**ปัญหา:**

Supabase client ใช้ `persistSession: true` ซึ่งเก็บ session tokens (access_token + refresh_token) ใน localStorage:
```typescript
// axios.ts:57-58
const storageKey = Object.keys(localStorage).find(
    (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
);
```

- localStorage **ไม่มี HttpOnly flag** ดังนั้นหากเกิด XSS attack ได้ ผู้โจมตีสามารถอ่าน token ได้ทันที
- แม้ว่า codebase นี้ **ไม่พบ XSS vectors** (ไม่มี `dangerouslySetInnerHTML`, `innerHTML`, `eval`) แต่การพึ่ง localStorage ยังคงเป็นความเสี่ยง
- Third-party libraries หรือ browser extensions ก็สามารถเข้าถึง localStorage ได้

**แนวทางแก้ไข:**

1. เป็นข้อจำกัดของ Supabase JS SDK ที่ใช้ localStorage เป็น default — ยอมรับความเสี่ยงนี้ได้ แต่ต้อง:
   - เพิ่ม Content Security Policy (CSP) headers ให้เข้มงวด
   - Monitor XSS ผ่าน CSP reporting
2. พิจารณา custom storage adapter ที่ใช้ HttpOnly cookies ผ่าน backend proxy

---

### 🟡 SEC-F08: ไม่มี Security Headers ใน Nginx Configuration

> [!IMPORTANT]
> ระดับ: **Medium** · OWASP: A05:2021 — Security Misconfiguration

**ไฟล์:** [nginx.conf](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/nginx.conf)

**ปัญหา:**

Nginx configuration ขาด security headers ที่สำคัญ:
- ❌ ไม่มี `Content-Security-Policy` (CSP) — ป้องกัน XSS
- ❌ ไม่มี `X-Content-Type-Options: nosniff` — ป้องกัน MIME sniffing
- ❌ ไม่มี `X-Frame-Options: DENY` — ป้องกัน clickjacking
- ❌ ไม่มี `Strict-Transport-Security` (HSTS) — บังคับ HTTPS
- ❌ ไม่มี `Referrer-Policy` — ควบคุม referrer leakage
- ❌ ไม่มี `Permissions-Policy` — จำกัด browser features

**แนวทางแก้ไข:**

```nginx
# เพิ่มใน nginx.conf
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "0" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co; img-src 'self' data: https://*.supabase.co; frame-ancestors 'none';" always;
```

---

### 🟡 SEC-F09: ExternalOrgGuard — ตรวจสอบ B2B Privacy ไม่ครอบคลุม /organization

> [!IMPORTANT]
> ระดับ: **Medium** · OWASP: A01:2021 — Broken Access Control

**ไฟล์:**
- [App.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/App.tsx#L211-L213)
- [DashboardLayout.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/layouts/DashboardLayout.tsx#L136)

**ปัญหา:**

```typescript
// App.tsx:211-213 — /organization ไม่มี ExternalOrgGuard!
<Route element={<ProtectedRoute allowedRoles={["user", "support", "admin"]} />}>
    <Route path="/organization" element={<OrganizationPage />} />
    <Route path="/danger-zone" element={<DangerZonePage />} />
</Route>
```

```typescript
// DashboardLayout.tsx:136 — อนุญาตให้ staff เข้า /organization ของ external org
const STAFF_EXTERNAL_ORG_ALLOWED = ["/danger-zone", "/organization"];
```

- Admin/Support สามารถเข้าถึง `/organization` ของ org อื่นได้ (ตั้งใจเผื่อ invite สมาชิกใหม่)
- แต่ `OrganizationPage` แสดงรายชื่อสมาชิก (email, ชื่อ) ทั้งหมด ซึ่ง **อาจเป็น privacy leak** สำหรับ B2B customers
- `MemberManagement` component จะแสดงข้อมูลสมาชิกแม้ `canManage` เป็น false

**แนวทางแก้ไข:**

1. จำกัดข้อมูลที่ platform staff เห็นใน external org (ซ่อน email/ชื่อ ของสมาชิก)
2. หรือสร้างหน้า invite-only สำหรับ staff แทนที่จะเปิด organization page เต็มรูปแบบ

---

### 🟡 SEC-F10: Avatar Upload ไม่มี Server-Side Validation ที่สมบูรณ์

> [!IMPORTANT]
> ระดับ: **Medium** · OWASP: A04:2021 — Insecure Design

**ไฟล์:** [ProfilePage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/ProfilePage.tsx#L99-L151)

**ปัญหา:**

```typescript
// ProfilePage.tsx:109
if (!file.type.startsWith("image/")) {
    toast("error", t("profile.avatarInvalid"));
    return;
}
```

- การ validate file type ด้วย `file.type` (MIME type จาก browser) สามารถ spoof ได้ง่าย
- ไม่มีการตรวจสอบ magic bytes ของไฟล์จริง
- Upload path ใช้ `${user.id}.${ext}` โดย `ext` มาจาก `file.name.split(".").pop()` ซึ่งอาจถูก manipulate เป็น extension อันตราย (เช่น `.svg` ที่มี script)
- ไฟล์อัปโหลดขึ้น Supabase Storage ด้วย `getPublicUrl` — URL เป็น public ทำให้ใครก็เข้าถึงได้

**แนวทางแก้ไข:**

1. ตรวจสอบ magic bytes ของไฟล์:
```typescript
const validMagicBytes: Record<string, number[]> = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
};
```
2. จำกัด allowed extensions เฉพาะ `jpg, jpeg, png, webp`
3. ปิด SVG upload (เสี่ยง XSS)
4. ✅ **ตรวจสอบ Supabase Storage policy** — ควรจำกัด MIME type ที่ bucket level

---

### 🟡 SEC-F11: Error Messages เปิดเผยข้อมูล Internal Implementation

> [!IMPORTANT]
> ระดับ: **Medium** · OWASP: A09:2021 — Security Logging and Monitoring Failures

**ไฟล์:**
- [ResetPasswordPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/ResetPasswordPage.tsx#L150)
- [LoginPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/LoginPage.tsx#L70)

**ปัญหา:**

```typescript
// ResetPasswordPage.tsx:150 — raw backend error แสดงให้ user เห็น
setError(`ไม่สามารถเปลี่ยนรหัสผ่านได้: ${msg}`);

// LoginPage.tsx:70 — raw Supabase error
: `❌ ${error.message}`
```

- Error messages จาก Supabase ถูกแสดงให้ผู้ใช้เห็นโดยตรง ซึ่งอาจรั่วไหลข้อมูล internal (เช่น database error, schema names)
- การแสดง "User already registered" ช่วยผู้โจมตี enumerate email addresses

**แนวทางแก้ไข:**

1. ใช้ generic error messages สำหรับผู้ใช้ เช่น "เกิดข้อผิดพลาด กรุณาลองใหม่"
2. Log detailed error ไว้ที่ monitoring system แทน (ไม่แสดงให้ user)
3. สำหรับ email enumeration — ใช้ generic response "หากอีเมลนี้มีอยู่ในระบบ เราจะส่งลิงก์รีเซ็ตให้"

---

### 🟡 SEC-F12: ไม่มี `<meta>` CSP ใน index.html

> [!NOTE]
> ระดับ: **Medium** · OWASP: A05:2021 — Security Misconfiguration

**ไฟล์:** [index.html](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/index.html)

**ปัญหา:**

`index.html` ไม่มี `<meta http-equiv="Content-Security-Policy">` tag สำหรับ fallback CSP เมื่อ Nginx headers ไม่ทำงาน (เช่น development mode หรือ CDN bypass)

**แนวทางแก้ไข:**

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co;">
```

---

### 🟢 SEC-F13: Sign Out ไม่ Invalidate Token ทันที — Fire-and-Forget

> [!NOTE]
> ระดับ: **Low** · OWASP: A07:2021 — Identification and Authentication Failures

**ไฟล์:** [authStore.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/store/authStore.ts#L82-L103)

**ปัญหา:**

```typescript
// authStore.ts:99-102
// Fire-and-forget: invalidate token on the server
supabase.auth.signOut().catch((err) => {
    console.warn("[Auth] signOut API error (local state already cleared):", err);
});
```

- Token ถูกลบจาก client ทันที แต่ server-side invalidation เป็น fire-and-forget
- หาก network request fails, access token ยังใช้งานได้จนหมดอายุ (~1 ชั่วโมงตาม Supabase default)
- ใน shared workstation scenario ผู้โจมตีอาจ capture token ก่อน sign out แล้วใช้ต่อได้

**แนวทางแก้ไข:**

1. ใช้ `await supabase.auth.signOut()` แทน fire-and-forget
2. Short-lived access tokens (ลด Supabase JWT expiry เหลือ 15 นาที)
3. เพิ่ม token blacklist ที่ backend สำหรับ critical scenarios

---

### 🟢 SEC-F14: ใช้ `crypto.randomUUID()` สำหรับ Session ID — ดีแต่มี Fallback Risk

> [!NOTE]
> ระดับ: **Low** · OWASP: A02:2021 — Cryptographic Failures

**ไฟล์:** [WebChatPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/WebChatPage.tsx#L94)

**ปัญหา:**

```typescript
const [platformUserId] = useState(() => 
    user?.id || `web-${crypto.randomUUID().slice(0, 8)}`
);
```

- `crypto.randomUUID().slice(0, 8)` ตัด UUID 36 ตัวเหลือ 8 ตัว ลด entropy จาก 122 bits เหลือ ~32 bits
- Platform user ID ที่สั้นเกินอาจ collision กันได้
- อาจทำให้ anonymous user sessions สับสนกัน

**แนวทางแก้ไข:**

ใช้ UUID เต็มความยาว:
```typescript
const [platformUserId] = useState(() => user?.id || `web-${crypto.randomUUID()}`);
```

---

### 🟢 SEC-F15: Open Redirect Potential ผ่าน `window.location.href`

> [!NOTE]
> ระดับ: **Low** · OWASP: A01:2021 — Broken Access Control

**ไฟล์:**
- [supabaseClient.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/supabaseClient.ts#L147) — `window.location.href = "/login"`
- [axios.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/axios.ts#L171) — `window.location.href = "/login"`
- [endpoints.ts](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/api/endpoints.ts#L137) — `window.location.href = "/login"`
- [DangerZonePage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/DangerZonePage.tsx#L98) — `window.location.href = "/create-org"`

**ปัญหา:**

- ใช้ `window.location.href` แทน React Router `navigate()` 
- ปัจจุบัน redirect ไปยัง path แบบ relative (เช่น `/login`) ซึ่งไม่เสี่ยงต่อ open redirect
- แต่ **pattern นี้เป็นอันตรายหากมีการเปลี่ยนเป็น dynamic redirect** ในอนาคต (เช่น `window.location.href = returnUrl`)
- นอกจากนี้ `window.location.href` redirect ทำให้เกิด full page reload ซึ่งสิ้นเปลือง

**แนวทางแก้ไข:**

1. ใช้ `navigate("/login", { replace: true })` จาก React Router แทน
2. ในกรณีที่ต้อง redirect แบบ hard (เช่น sign out) ตรวจสอบว่า target เป็น relative path เสมอ

---

### 🟢 SEC-F16: ForgotPasswordPage — redirectTo ใช้ `window.location.origin` โดยไม่ Validate

> [!NOTE]
> ระดับ: **Low** · OWASP: A01:2021 — Broken Access Control

**ไฟล์:** [ForgotPasswordPage.tsx](file:///c:/Users/jinju/Downloads/Ver_1.0/frontend/src/pages/ForgotPasswordPage.tsx#L28)

**ปัญหา:**

```typescript
const { error: err } = await supabase.auth.resetPasswordForEmail(
    email.trim(),
    { redirectTo: `${window.location.origin}/reset-password` },
);
```

- `window.location.origin` ส่งไปยัง Supabase เพื่อใช้เป็น redirect URL หลัง reset password
- ⚠️ Supabase **ต้อง whitelist** redirect URLs ใน Dashboard → URL Configuration
- หาก whitelist ไม่ถูกตั้ง ผู้โจมตีอาจ phish token ได้

**แนวทางแก้ไข:**

1. ✅ ตรวจสอบว่า Supabase Dashboard มี **Site URL** และ **Redirect URLs** whitelist ที่ถูกต้อง
2. ใช้ hardcoded domain แทน `window.location.origin` ใน production

---

## ✅ สิ่งที่ทำได้ดีแล้ว (Positive Findings)

| หมวด | รายละเอียด |
|:---|:---|
| **XSS Prevention** | ไม่พบ `dangerouslySetInnerHTML`, `innerHTML`, หรือ `eval()` — React auto-escaping ทำงานได้ดี |
| **Token Refresh** | มีระบบ 3 layers (request interceptor, response interceptor, periodic refresh) ป้องกัน token expiry ได้ดี |
| **Mutex Lock** | ใช้ in-memory mutex ป้องกัน concurrent refresh ที่อาจ invalidate refresh token |
| **CSRF Protection** | ใช้ Bearer token ใน Authorization header (ไม่ใช้ cookies) จึงไม่เสี่ยงต่อ CSRF |
| **401 Retry** | Response interceptor retry 1 ครั้งเท่านั้น ป้องกัน infinite loops |
| **Unapproved User Lockout** | มี strict lockout ระดับ layout สำหรับ user ที่ยังไม่ได้รับอนุมัติ |
| **B2B Privacy Guard** | มี `ExternalOrgGuard` ป้องกัน admin/support เข้าถึงข้อมูลของ org อื่น |
| **TypeScript** | ใช้ TypeScript ทั้งหมด ลดโอกาส type-related bugs |
| **Docker Multi-stage** | Dockerfile ใช้ multi-stage build, production image มีแค่ static files |

---

## 📊 สรุปตารางช่องโหว่

| ID | ระดับ | ไฟล์หลัก | ช่องโหว่ | OWASP Category |
|:---|:---:|:---|:---|:---|
| SEC-F01 | 🔴 Critical | `supabaseClient.ts` | Placeholder key fallback | A05 — Misconfiguration |
| SEC-F02 | 🔴 Critical | `endpoints.ts`, `ResetPasswordPage.tsx` | Sensitive data ใน console.log | A09 — Logging Failures |
| SEC-F03 | 🟠 High | `ProtectedRoute.tsx`, `App.tsx` | Client-only RBAC | A01 — Broken Access Control |
| SEC-F04 | 🟠 High | `axios.ts`, `endpoints.ts` | X-Active-Org จาก localStorage | A01 — IDOR |
| SEC-F05 | 🟠 High | `LoginPage.tsx` | ไม่มี Rate Limiting / CAPTCHA | A07 — Auth Failures |
| SEC-F06 | 🟠 High | `LoginPage.tsx`, `ResetPasswordPage.tsx` | Weak password policy (6 chars) | A07 — Auth Failures |
| SEC-F07 | 🟡 Medium | `axios.ts`, `supabaseClient.ts` | Token ใน localStorage (XSS risk) | A07 — Auth Failures |
| SEC-F08 | 🟡 Medium | `nginx.conf` | ขาด security headers | A05 — Misconfiguration |
| SEC-F09 | 🟡 Medium | `App.tsx`, `DashboardLayout.tsx` | External org privacy leak | A01 — Broken Access Control |
| SEC-F10 | 🟡 Medium | `ProfilePage.tsx` | Avatar upload validation | A04 — Insecure Design |
| SEC-F11 | 🟡 Medium | `ResetPasswordPage.tsx`, `LoginPage.tsx` | Error message info leak | A09 — Logging Failures |
| SEC-F12 | 🟡 Medium | `index.html` | ไม่มี CSP meta tag | A05 — Misconfiguration |
| SEC-F13 | 🟢 Low | `authStore.ts` | Fire-and-forget sign out | A07 — Auth Failures |
| SEC-F14 | 🟢 Low | `WebChatPage.tsx` | Truncated UUID low entropy | A02 — Crypto Failures |
| SEC-F15 | 🟢 Low | Multiple files | window.location.href pattern | A01 — Broken Access Control |
| SEC-F16 | 🟢 Low | `ForgotPasswordPage.tsx` | redirectTo unvalidated origin | A01 — Broken Access Control |

---

## ⚡ ลำดับความสำคัญในการแก้ไข

### ทำทันที (Week 1)
1. **SEC-F01** — เปลี่ยน fallback เป็น throw error
2. **SEC-F02** — ลบ/ปิด console.log ที่มี sensitive data

### ทำเร็ว (Week 2)
3. **SEC-F08** — เพิ่ม security headers ใน nginx.conf
4. **SEC-F06** — ปรับ password policy ให้เข้มงวดขึ้น (≥8 chars + complexity)
5. **SEC-F11** — ใช้ generic error messages

### วางแผนทำ (Week 3-4)
6. **SEC-F05** — เพิ่ม rate limiting + CAPTCHA
7. **SEC-F04** — Validate org ID ก่อนส่ง header
8. **SEC-F09** — จำกัดข้อมูลสมาชิกที่ staff เห็นใน external org
9. **SEC-F10** — เพิ่ม magic bytes validation สำหรับ avatar
10. **SEC-F12** — เพิ่ม CSP meta tag ใน index.html

### Backlog
11. **SEC-F03** — Backend RBAC verification (ตรวจสอบว่ามีแล้วหรือไม่)
12. **SEC-F13-F16** — Low priority items
