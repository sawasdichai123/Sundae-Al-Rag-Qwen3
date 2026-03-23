# Email Change Implementation Plan

> **สถานะ**: รอ deploy server จริง
> **วันที่สร้าง**: 23 มีนาคม 2569
> **เหตุผลที่ยังไม่ทำ**: ต้องมี SMTP service + production URL สำหรับ confirmation link

---

## ภาพรวม

ให้ user (role: user) เปลี่ยน email ของตัวเองผ่านหน้า Profile โดยต้องยืนยันผ่าน email ใหม่ก่อน

## ขั้นตอนที่ต้องทำ

### 1. Supabase Dashboard — ตั้งค่า Email Template

- ไปที่ **Authentication → Email Templates → Change Email Address**
- ตั้ง redirect URL เป็น production URL เช่น `https://yourdomain.com/profile?email_confirmed=true`
- ปรับ email template ให้เป็นภาษาไทย

### 2. Backend — Endpoint เปลี่ยน Email

**ไฟล์**: `backend/app/routers/organization.py`

```python
class ChangeEmailRequest(BaseModel):
    new_email: str

@router.post("/profile/me/change-email")
async def change_email(
    body: ChangeEmailRequest,
    user: CurrentUser = Depends(require_approved),
):
    """ส่ง confirmation link ไป email ใหม่ — user role เท่านั้น"""
    if user.role in ("admin", "support"):
        raise HTTPException(400, "Admin/Support ไม่สามารถเปลี่ยน email ผ่านหน้านี้ได้")

    new_email = body.new_email.strip().lower()
    if not EMAIL_RE.match(new_email):
        raise HTTPException(400, "รูปแบบอีเมลไม่ถูกต้อง")

    # ตรวจว่า email ซ้ำไหม
    supabase = get_supabase()
    existing = await (
        supabase.table("user_profiles")
        .select("id")
        .eq("email", new_email)
        .limit(1)
    ).execute()
    if existing.data:
        raise HTTPException(400, "อีเมลนี้ถูกใช้งานแล้ว")

    # ส่ง confirmation ผ่าน Supabase Auth
    # NOTE: ต้องใช้ user's access token ไม่ใช่ service role
    # เพราะ updateUser ต้องรู้ว่า user คนไหนกำลังเปลี่ยน
    await supabase.auth.admin.update_user_by_id(
        user.id,
        {"email": new_email}
    )

    return {"message": f"ส่งลิงก์ยืนยันไปที่ {new_email} แล้ว กรุณาตรวจสอบกล่องจดหมาย"}
```

### 3. Backend — Webhook/Trigger Sync user_profiles.email

หลังจาก user กดยืนยัน email ใหม่ Supabase จะอัพเดท `auth.users.email` อัตโนมัติ แต่ `user_profiles.email` ยังเป็นค่าเดิม

**วิธีแก้** — เพิ่ม DB trigger:

```sql
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.email IS DISTINCT FROM NEW.email THEN
        UPDATE public.user_profiles
        SET email = NEW.email
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_change
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_email();
```

### 4. Frontend — UI ใน ProfilePage

**ไฟล์**: `frontend/src/pages/ProfilePage.tsx`

- เพิ่มปุ่ม "เปลี่ยนอีเมล" ข้าง email (เฉพาะ role user)
- กดแล้วโชว์ modal/inline form ให้กรอก email ใหม่
- เรียก API → แสดง toast "ส่งลิงก์ยืนยันไปที่ xxx แล้ว"
- หลัง user กดยืนยันจาก email → redirect กลับมาหน้า Profile → email ใหม่จะโชว์

**ไฟล์**: `frontend/src/api/endpoints.ts`

```typescript
changeEmail: (newEmail: string) =>
    apiClient.post("/api/orgs/profile/me/change-email", { new_email: newEmail }),
```

### 5. Frontend — Handle Redirect หลังยืนยัน

ใน `ProfilePage` ตรวจ query param `email_confirmed=true`:

```typescript
useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("email_confirmed") === "true") {
        toast("success", "เปลี่ยนอีเมลสำเร็จ");
        // refresh profile
        if (user?.id) fetchProfile(user.id);
    }
}, []);
```

---

## Prerequisites ก่อนทำ

| # | สิ่งที่ต้องมี | สถานะ |
|---|--------------|--------|
| 1 | Production URL (ไม่ใช่ localhost) | รอ deploy |
| 2 | SMTP / Email service ใน Supabase | รอตั้งค่า |
| 3 | Email template ภาษาไทย | รอตั้งค่า |
| 4 | Redirect URL ใน Supabase Dashboard | รอ production URL |

---

## ข้อควรระวัง

- **Rate limit**: Supabase free tier ส่ง email ได้จำกัด (4 emails/hour) — ควรมี cooldown ที่ UI
- **Security**: ต้องยืนยันจาก email ใหม่เท่านั้น ห้ามเปลี่ยนตรงๆ โดยไม่ยืนยัน
- **Auth cache**: หลังเปลี่ยน email ต้อง clear profile cache ใน `auth.py` (in-memory 5 min TTL)
- **org_invitations**: ถ้ามี pending invitation ที่ผูกกับ email เก่า ต้องตัดสินใจว่าจะ migrate หรือปล่อยทิ้ง
