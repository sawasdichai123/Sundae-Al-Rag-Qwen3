# SUNDAE — Manual Browser Test Script
# สำหรับ AI Agent (Gemini / Anigravity) ทดสอบผ่าน Browser

> **Frontend URL**: `http://localhost:5173`
> **Backend URL**: `http://localhost:8001`
> **วันที่**: 2 มีนาคม 2569

---

## Pre-Conditions (ต้องพร้อมก่อนเริ่มทดสอบ)

- [ ] Backend รันอยู่ที่ `http://localhost:8001` (ตรวจสอบ: เปิด `http://localhost:8001/health` ต้องเห็น `{"status":"ok"}`)
- [ ] Frontend รันอยู่ที่ `http://localhost:5173`
- [ ] Ollama รันอยู่ (ตรวจสอบ: `ollama list` ต้องเห็น model `qwen3:14b` หรือ `qwen2.5:3b`)
- [ ] มี PDF อัปโหลดไว้แล้วใน Knowledge Base (status "พร้อมใช้")
- [ ] รัน SQL `005_create_support_account.sql` ใน Supabase แล้ว

---

## Test Suite A: Support Role — Sidebar & Permissions

### A1: Login ด้วย Support Account

```
ขั้นตอน:
1. เปิด http://localhost:5173/login
2. ล้าง LocalStorage ก่อน (F12 → Application → Local Storage → Clear All)
3. กรอก Email: support@sundae.local
4. กรอก Password: Sundae@2025
5. กดปุ่ม "เข้าสู่ระบบ"

ผลที่คาดหวัง:
- Redirect ไปหน้า Dashboard (URL เป็น `/` หรือ `/dashboard`)
- เห็น Sidebar ด้านซ้ายมี SUNDAE logo (ตัว S สีเหลือง)
- เห็น Role Badge ที่ซ้ายล่างเป็น "Support" (สีม่วง)
```

### A2: ตรวจสอบ Sidebar Menu (Support Role)

```
ขั้นตอน:
1. ดู Sidebar ด้านซ้าย
2. นับจำนวนเมนูที่เห็น

ผลที่คาดหวัง — ต้องเห็นเมนูเหล่านี้เท่านั้น:
✅ Dashboard
✅ Approvals
✅ Web Chat

ผลที่คาดหวัง — ต้องไม่เห็นเมนูเหล่านี้:
❌ Knowledge Base (ต้องไม่มี)
❌ Bots (ต้องไม่มี)
❌ Inbox (ต้องไม่มี)
❌ Integration (ต้องไม่มี)

สถานะ: ⬜ รอทดสอบ (Test ID: 2.3)
```

### A3: Dashboard Metric สำหรับ Support

```
ขั้นตอน:
1. คลิกเมนู "Dashboard" (หรืออยู่หน้า Dashboard อยู่แล้ว)
2. ดูการ์ดตัวเลขด้านบน (Metric Cards)
3. ดูการ์ดที่ 3 (ตัวที่ 3 จากซ้าย)

ผลที่คาดหวัง:
- การ์ดที่ 3 ต้องแสดง "ผู้ใช้รออนุมัติ" (ไม่ใช่ "แชทวันนี้")
- ตัวเลขต้องเป็นจำนวนผู้ใช้ที่ is_approved = false

สถานะ: ⬜ รอทดสอบ (Test ID: 3.8)
```

### A4: Support เข้า /bots ไม่ได้

```
ขั้นตอน:
1. แก้ URL ใน address bar เป็น http://localhost:5173/bots
2. กด Enter

ผลที่คาดหวัง:
- ถูก redirect กลับไปหน้า Dashboard (URL กลับเป็น `/`)
- ไม่เห็นหน้า Bots

สถานะ: ⬜ รอทดสอบ (Test ID: 11.2)
```

### A5: Support เข้า /knowledge-base ไม่ได้

```
ขั้นตอน:
1. แก้ URL ใน address bar เป็น http://localhost:5173/knowledge-base
2. กด Enter

ผลที่คาดหวัง:
- ถูก redirect กลับไปหน้า Dashboard (URL กลับเป็น `/`)
- ไม่เห็นหน้า Knowledge Base
```

### A6: Support เข้า /integration ไม่ได้

```
ขั้นตอน:
1. แก้ URL ใน address bar เป็น http://localhost:5173/integration
2. กด Enter

ผลที่คาดหวัง:
- ถูก redirect กลับไปหน้า Dashboard (URL กลับเป็น `/`)
```

### A7: Support เข้า /approvals ได้

```
ขั้นตอน:
1. คลิกเมนู "Approvals" ใน Sidebar
2. หรือแก้ URL เป็น http://localhost:5173/approvals

ผลที่คาดหวัง:
- เห็นหน้า Approvals สำเร็จ
- เห็น Stats Cards (จำนวน "รออนุมัติ" และ "อนุมัติแล้ว")
- เห็นตาราง pending users (หรือ "ไม่มีผู้ใช้ที่รออนุมัติ" ถ้าไม่มี)
```

### A8: Support เข้า /chat ได้

```
ขั้นตอน:
1. คลิกเมนู "Web Chat" ใน Sidebar

ผลที่คาดหวัง:
- เห็นหน้า Web Chat
- เห็น Bot dropdown ด้านบนซ้าย
- เห็นข้อความ "Welcome to SUNDAE LLM"
```

### A9: Support Logout

```
ขั้นตอน:
1. ดูซ้ายล่างของ Sidebar
2. กดปุ่ม Logout (icon ลูกศรออก)

ผลที่คาดหวัง:
- กลับมาหน้า /login
- Sidebar หายไป
```

---

## Test Suite B: Sources Citation UI (ทดสอบด้วย Admin Account)

### B1: Login ด้วย Admin Account

```
ขั้นตอน:
1. เปิด http://localhost:5173/login
2. ล้าง LocalStorage ก่อน (F12 → Application → Local Storage → Clear All)
3. กรอก Email: admin@sundae.local
4. กรอก Password: Sundae@2025
5. กดปุ่ม "เข้าสู่ระบบ"

ผลที่คาดหวัง:
- Redirect ไปหน้า Dashboard
- เห็น Role Badge "Admin" (สีเหลือง)
```

### B2: ตรวจสอบว่ามี PDF ใน Knowledge Base

```
ขั้นตอน:
1. คลิกเมนู "Knowledge Base" ใน Sidebar
2. ดูรายการเอกสาร

ผลที่คาดหวัง:
- เห็นเอกสาร PDF อย่างน้อย 1 รายการ
- เอกสารมี status badge "พร้อมใช้" (สีเขียว)
- ถ้าไม่มีเอกสาร: กดปุ่ม "Add knowledge +" → เลือกไฟล์ PDF → รอ upload สำเร็จ

⚠️ จำชื่อเอกสารที่เห็นไว้ — จะใช้ถามคำถามในขั้นต่อไป
```

### B3: เปิด Web Chat และเลือก Bot

```
ขั้นตอน:
1. คลิกเมนู "Web Chat" ใน Sidebar
2. ดู Bot dropdown ด้านบนซ้าย

ผลที่คาดหวัง:
- Bot ถูกเลือกอัตโนมัติ (เช่น "SUNDAE Demo Bot")
- เห็นข้อความ "Welcome to SUNDAE LLM"
- เห็น Online badge สีเขียวด้านขวาบน
```

### B4: ถามคำถามที่ตรงกับเนื้อหา PDF

```
ขั้นตอน:
1. พิมพ์คำถามที่เกี่ยวข้องกับเนื้อหาใน PDF ที่อัปโหลดไว้
   ตัวอย่าง:
   - ถ้า PDF เป็นเรื่อง HR: "นโยบายการลาหยุดเป็นอย่างไร"
   - ถ้า PDF เป็นเรื่อง สัญญา: "เงื่อนไขการยกเลิกสัญญาคืออะไร"
   - ถ้า PDF เป็นเรื่อง คู่มือ: "ขั้นตอนการสมัครมีอะไรบ้าง"
2. กด Enter หรือกดปุ่ม Send (icon ลูกศร)

ผลที่คาดหวัง:
- เห็น User bubble (ขวา, สีเทาเข้ม) แสดงข้อความที่พิมพ์
- เห็น Loading dots (...) กับข้อความ:
  - 3-9 วินาที: "กำลังค้นหาเอกสาร..."
  - 10-29 วินาที: "กำลังวิเคราะห์คำตอบ..."
  - 30+ วินาที: "กำลังประมวลผล (Xs)..."
- รอจนกว่า AI จะตอบ (อาจใช้เวลา 30-90 วินาที)
- เห็น AI bubble (ซ้าย, สีขาว) แสดงคำตอบเป็นภาษาไทย

⚠️ สำคัญ: ถ้า AI ตอบว่า "ไม่พบข้อมูลในเอกสาร" หมายความว่าคำถามไม่ตรงกับเนื้อหา PDF
   → ลองถามคำถามอื่นที่ตรงกับ PDF มากขึ้น
```

### B5: ตรวจสอบ Sources Citation Badge ⭐ (Test ID: 6.8)

```
ขั้นตอน:
1. ดูที่ AI bubble ที่ตอบมา
2. มองหาส่วน "อ้างอิงจากเอกสาร" ใต้คำตอบ (มีเส้นแบ่งด้านบน)

ผลที่คาดหวัง (ถ้า AI ตอบจากเอกสาร):
- เห็นข้อความ "อ้างอิงจากเอกสาร" พร้อม icon ซองจดหมาย
- เห็น source pills (badge กลม) แสดง:
  - document_id (8 ตัวอักษรแรก) เช่น "a1b2c3d4…"
  - #chunk_index เช่น "#0", "#1", "#2"
  - score เป็น % เช่น "85%", "92%" (สีเขียว)
- pills มีสีพื้นหลังเทาอ่อน + ขอบเทา + จุดสีเหลืองด้านหน้า

ผลที่คาดหวัง (ถ้า AI ตอบว่า "ไม่พบข้อมูล"):
- ไม่มีส่วน "อ้างอิงจากเอกสาร" (ถูกต้อง — ไม่มี sources)

สถานะ: ⬜ รอทดสอบ (Test ID: 6.8)
```

### B6: ถามคำถามที่ 2 เพื่อยืนยัน Sources

```
ขั้นตอน:
1. ถามคำถามอื่นที่เกี่ยวกับเนื้อหาใน PDF (ต่างจากคำถามแรก)
2. รอ AI ตอบ

ผลที่คาดหวัง:
- เห็น Sources citation อีกครั้ง (ถ้า AI ตอบจากเอกสาร)
- document_id อาจเป็นตัวเดียวกับคำถามแรก (เพราะ PDF เดียวกัน)
- chunk_index อาจต่างกัน (เพราะถามเรื่องต่างกัน)
- bubble เก่ายังอยู่ครบ (chat history ไม่หาย)
```

### B7: ตรวจสอบใน Inbox ว่า Sources ถูกบันทึก

```
ขั้นตอน:
1. คลิกเมนู "Inbox" ใน Sidebar
2. ดู Session list ด้านซ้าย → ควรเห็น session ใหม่ล่าสุด
3. คลิกที่ session card

ผลที่คาดหวัง:
- เห็น chat history ของ session นั้น
- เห็น User messages (ขวา) และ AI messages (ซ้าย)
- AI messages แสดงคำตอบที่ตรงกับ Web Chat
```

---

## Test Suite C: Cross-Role Verification (กลับมาทดสอบ Admin)

### C1: Admin Sidebar ครบ

```
ขั้นตอน:
1. ขณะ login เป็น Admin อยู่ ดู Sidebar

ผลที่คาดหวัง — ต้องเห็นเมนูทั้งหมด:
✅ Dashboard
✅ Knowledge Base
✅ Bots
✅ Inbox
✅ Integration
✅ Approvals
✅ Web Chat

(รวม 7 เมนู — Admin เห็นทุกเมนู)
```

### C2: Logout Admin แล้ว Login Support ทันที

```
ขั้นตอน:
1. กด Logout (icon ซ้ายล่าง)
2. กรอก Email: support@sundae.local
3. กรอก Password: Sundae@2025
4. กด "เข้าสู่ระบบ"

ผลที่คาดหวัง:
- Sidebar เปลี่ยนเป็น 3 เมนูเท่านั้น (Dashboard, Approvals, Web Chat)
- Role Badge เปลี่ยนเป็น "Support" (สีม่วง)
- ไม่เห็นเมนู Knowledge Base, Bots, Inbox, Integration
```

---

## สรุป Test Cases

| Test ID | หัวข้อ | Test Suite | Checklist Ref |
|---------|--------|------------|---------------|
| A1 | Login Support | A | - |
| A2 | Sidebar Menu (Support) | A | 2.3 |
| A3 | Dashboard Metric (Support) | A | 3.8 |
| A4 | Block /bots | A | 11.2 |
| A5 | Block /knowledge-base | A | - |
| A6 | Block /integration | A | - |
| A7 | Access /approvals | A | - |
| A8 | Access /chat | A | - |
| A9 | Logout | A | - |
| B1 | Login Admin | B | - |
| B2 | Check PDF exists | B | - |
| B3 | Open Web Chat | B | - |
| B4 | Ask question about PDF | B | 6.4, 6.7 |
| B5 | Verify Sources Badge | B | 6.8 ⭐ |
| B6 | Ask 2nd question | B | 6.10 |
| B7 | Check Inbox | B | 7.7 |
| C1 | Admin Sidebar full | C | 2.1 |
| C2 | Switch to Support | C | - |

**รวม 18 test cases** — ครอบคลุม Support role + Sources citation + Cross-role verification

---

## หลังทดสอบเสร็จ: บันทึกผล

กรุณาบันทึกผลลัพธ์ในรูปแบบนี้:

```
| Test ID | ผลลัพธ์ | หมายเหตุ |
|---------|---------|---------|
| A1 | ✅/❌ | ... |
| A2 | ✅/❌ | ... |
| ... | ... | ... |
```

โดยเฉพาะ **B5 (Sources Badge)** — กรุณา screenshot หรือบรรยายสิ่งที่เห็นให้ละเอียด:
- เห็น "อ้างอิงจากเอกสาร" ไหม?
- เห็น pills/badges ไหม?
- แสดง document_id, chunk_index, score ไหม?
