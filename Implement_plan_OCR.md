# OCR Implementation Plan — Knowledge Base

ระบบ OCR สำหรับ Knowledge Base เพื่อรองรับ:
- PDF ที่เป็นภาพสแกน (ไม่มี text layer)
- PDF ที่มี text layer บางหน้า + ภาพบางหน้า (hybrid)
- ไฟล์รูปภาพโดยตรง (PNG, JPG, JPEG, TIFF, BMP, WEBP)

**ไม่เพิ่ม DB / ไม่สร้างตารางใหม่** — OCR เป็นแค่ pre-processing step ก่อนเข้า pipeline เดิม (chunking → embedding → store)

---

## Section 1: Backend — OCR Service

### 1.1 เพิ่ม dependency

**[MODIFY] `backend/requirements.txt`**
```
easyocr>=1.7.0
Pillow>=10.0.0
```

> EasyOCR รองรับภาษาไทย + อังกฤษ ได้ดี, ไม่ต้องติดตั้ง Tesseract แยก

### 1.2 สร้าง OCR service

**[NEW] `backend/app/services/ocr_service.py`**

```python
import easyocr
from PIL import Image
import io

# Lazy-load EasyOCR reader (โหลดโมเดลครั้งเดียว)
_reader = None

def get_ocr_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["th", "en"], gpu=False)
    return _reader

def ocr_image_bytes(image_bytes: bytes) -> str:
    """OCR จากรูปภาพ (bytes) → ข้อความ"""
    reader = get_ocr_reader()
    results = reader.readtext(image_bytes, detail=0, paragraph=True)
    return "\n".join(results)

def ocr_pil_image(pil_image: Image.Image) -> str:
    """OCR จาก PIL Image → ข้อความ"""
    buf = io.BytesIO()
    pil_image.save(buf, format="PNG")
    return ocr_image_bytes(buf.getvalue())
```

---

## Section 2: Backend — แก้ไข document.py

### 2.1 แก้ `extract_text_from_pdf()` — fallback OCR สำหรับหน้าที่ไม่มี text

**[MODIFY] `backend/app/routers/document.py` → `extract_text_from_pdf()`**

Logic ใหม่:
1. ลอง `page.get_text("text")` เหมือนเดิม
2. ถ้าหน้าไหนไม่มี text (หรือน้อยกว่า 10 ตัวอักษร) → render เป็นภาพ → OCR
3. ถ้า OCR ได้ text มา → ใช้แทน
4. ถ้าทั้ง text + OCR ไม่ได้อะไรเลยทุกหน้า → raise ValueError เหมือนเดิม

```python
def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    
    for page in doc:
        text = page.get_text("text").strip()
        
        if len(text) < 10:
            # หน้านี้ไม่มี text layer → ลอง OCR
            from app.services.ocr_service import ocr_pil_image
            pix = page.get_pixmap(dpi=300)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            text = ocr_pil_image(img)
        
        if text.strip():
            sentinel = f"\n<<<PAGE:{page.number + 1}>>>\n"
            pages.append(sentinel + text.strip())
    
    doc.close()
    full_text = "\n\n".join(pages)
    
    if not full_text.strip():
        raise ValueError("PDF contains no extractable text (including OCR).")
    
    return full_text.replace("\x00", "")
```

### 2.2 รองรับไฟล์รูปภาพ (PNG, JPG, etc.)

**[MODIFY] `backend/app/routers/document.py` → `upload_document()`**

เปลี่ยน:
- ยอมรับ MIME type เพิ่ม: `image/png`, `image/jpeg`, `image/tiff`, `image/bmp`, `image/webp`
- ถ้าเป็นรูปภาพ → เรียก `ocr_image_bytes()` แทน `extract_text_from_pdf()`
- เก็บไฟล์ต้นฉบับใน Storage เหมือนเดิม (เปลี่ยน path extension)

```python
ALLOWED_MIME = {
    "application/pdf",
    "image/png", "image/jpeg", "image/tiff",
    "image/bmp", "image/webp",
}
IMAGE_MIME = {"image/png", "image/jpeg", "image/tiff", "image/bmp", "image/webp"}

# ในส่วน validate:
if file.content_type not in ALLOWED_MIME:
    raise HTTPException(400, f"Unsupported file type: {file.content_type}")

# ในส่วน extract:
if file.content_type in IMAGE_MIME:
    from app.services.ocr_service import ocr_image_bytes
    full_text = ocr_image_bytes(doc_bytes)
    if not full_text.strip():
        raise HTTPException(400, "Cannot extract text from image (OCR returned empty).")
else:
    full_text = extract_text_from_pdf(doc_bytes)
```

### 2.3 ปรับ magic bytes validation

**[MODIFY] `backend/app/routers/document.py`**

ตอนนี้เช็คแค่ `%PDF-` → เพิ่มเช็ค magic bytes สำหรับรูปภาพ หรือข้ามเช็คถ้าเป็นรูป

---

## Section 3: Frontend — รองรับไฟล์รูปภาพ

### 3.1 แก้ KnowledgeBasePage.tsx

**[MODIFY] `frontend/src/pages/KnowledgeBasePage.tsx`**

- เปลี่ยน `accept=".pdf"` → `accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp"`
- เปลี่ยนข้อความ "รองรับเฉพาะ PDF" → "รองรับ PDF และรูปภาพ"
- แสดง icon ต่างกันระหว่าง PDF กับรูปภาพ (ตาม `mime_type`)

### 3.2 อัพเดท i18n

**[MODIFY] `frontend/src/i18n/th.json` + `en.json`**

เพิ่ม/แก้ keys:
```json
{
    "kb.acceptedFiles": "รองรับ PDF และรูปภาพ (PNG, JPG)",
    "kb.ocrProcessing": "กำลังอ่านข้อความจากภาพ (OCR)...",
    "kb.ocrEmpty": "ไม่สามารถอ่านข้อความจากภาพได้"
}
```

---

## Section 4: Docker / Deployment

### 4.1 Dockerfile

**[MODIFY] `backend/Dockerfile`**

EasyOCR ต้องการ:
- `libgl1-mesa-glx` (สำหรับ OpenCV ที่ EasyOCR ใช้)
- โมเดลจะ download อัตโนมัติตอน first run (~100MB สำหรับ th+en)

---

## สรุปไฟล์ที่ต้องแก้

| ชั้น | ไฟล์ | การเปลี่ยนแปลง |
|---|---|---|
| **Backend** | `requirements.txt` | เพิ่ม `easyocr`, `Pillow` |
| **Backend** | `app/services/ocr_service.py` | [NEW] OCR service (EasyOCR th+en) |
| **Backend** | `app/routers/document.py` | แก้ extract ให้ fallback OCR + รับรูปภาพ |
| **Frontend** | `KnowledgeBasePage.tsx` | accept รูปภาพ + ข้อความ UI |
| **Frontend** | `th.json` + `en.json` | เพิ่ม i18n keys |
| **Docker** | `Dockerfile` | เพิ่ม system deps สำหรับ EasyOCR |

## ไม่ต้องแก้ DB

- ไม่มี migration ใหม่
- ไม่มี column ใหม่
- OCR text เข้า pipeline เดิม: chunking → embedding → parent_chunks / child_chunks

---

## ความแม่นยำ OCR

### EasyOCR (ตัวเลือกปัจจุบัน — ฟรี, run local)

| ภาษา | ความแม่นยำ | หมายเหตุ |
|---|---|---|
| อังกฤษ | ~85-95% | ฟอนต์มาตรฐานแม่นยำดี |
| ไทย | ~70-85% | สระ/วรรณยุกต์ซ้อนอาจอ่านผิดบ้าง |

### ปัจจัยที่มีผลต่อความแม่นยำ

| ปัจจัย | ดี | แย่ |
|---|---|---|
| ความละเอียด | 300 DPI ขึ้นไป | ต่ำกว่า 150 DPI |
| ภาพ | คมชัด, ตรง, สว่าง | เบลอ, เอียง, มีเงา |
| ฟอนต์ | มาตรฐาน (Angsana, TH Sarabun) | ลายมือ, ฟอนต์แฟนซี |
| เนื้อหา | ข้อความล้วน | ตารางซับซ้อน, กราฟ |

### ทางเลือกอัพเกรดในอนาคต (แก้แค่ `ocr_service.py` ไฟล์เดียว)

| ตัวเลือก | ไทย | อังกฤษ | ค่าใช้จ่าย | ข้อดี |
|---|---|---|---|---|
| **EasyOCR** (ปัจจุบัน) | ~70-85% | ~85-95% | ฟรี | run local, ไม่ต้อง API key |
| **Google Cloud Vision** | ~90-95% | ~95-99% | ~$1.50/1000 หน้า | แม่นยำมาก, รองรับตาราง |
| **Azure Document Intelligence** | ~90-95% | ~95-99% | ~$1.00/1000 หน้า | แม่นยำมาก, layout analysis |

> **หมายเหตุ:** สถาปัตยกรรมออกแบบให้เปลี่ยน OCR engine ได้ง่าย — แก้แค่ `ocr_service.py` ไฟล์เดียว ส่วน pipeline ที่เหลือ (chunking → embedding → store) ไม่ต้องแก้เลย
