# Document Tags — จัดกลุ่มไฟล์ใน Knowledge Base

ระบบ Tag-based สำหรับจัดกลุ่มเอกสารใน Knowledge Base โดยไม่เพิ่มความซับซ้อนให้ผู้ใช้
เอกสาร 1 ไฟล์สามารถมีได้หลาย Tag, Filter ตาม Tag ได้, Tag auto-suggest จาก Tag ที่เคยใช้ในองค์กร

## Proposed Changes

### Database (SQL Migration)

#### [NEW] sql/017_add_document_tags.sql

```sql
-- เพิ่ม tags column ในตาราง documents
ALTER TABLE documents ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- Index สำหรับ filter ตาม tag (GIN index รองรับ ANY() query)
CREATE INDEX idx_documents_tags ON documents USING GIN (tags);
```

> แค่ 1 column + 1 index — ไม่ต้องสร้างตารางใหม่

---

### Backend

#### [MODIFY] [document.py]

**1. เพิ่ม `tags` ใน Response Model (line ~56-68)**

```python
class DocumentResponse(BaseModel):
    id: str
    organization_id: str
    bot_ids: list[str] = []
    name: str
    file_path: Optional[str] = None
    file_size_bytes: Optional[int] = None
    storage_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    tags: list[str] = []              # ← NEW
    status: str
    created_at: str
```

**2. เพิ่ม `tags` parameter ใน upload endpoint (line ~346-360)**

```python
@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    organization_id: str = Form(...),
    bot_ids: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),     # ← NEW: comma-separated tags
    user: CurrentUser = Depends(require_org_admin),
) -> UploadResponse:
```

- Parse `tags` string → `list[str]` (ตัดช่องว่าง, ลบ duplicate)
- บันทึกลง `doc_row["tags"]`

**3. เพิ่ม filter ตาม tag ใน list endpoint (line ~81-123)**

```python
@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    organization_id: str,
    tag: Optional[str] = Query(None),     # ← NEW: filter by tag
    user: CurrentUser = Depends(require_approved),
) -> list[DocumentResponse]:
```

- ถ้า `tag` ถูกส่งมา → เพิ่ม `.contains("tags", [tag])` ใน query

**4. เพิ่ม endpoint แก้ไข tags ของเอกสาร**

```python
@router.patch("/{document_id}/tags")
async def update_document_tags(
    document_id: str,
    organization_id: str,
    body: UpdateTagsRequest,    # { tags: ["HR", "นโยบาย"] }
    user: CurrentUser = Depends(require_org_admin),
) -> DocumentResponse:
```

**5. เพิ่ม endpoint ดึง tags ทั้งหมดขององค์กร (สำหรับ auto-suggest)**

```python
@router.get("/tags", response_model=list[str])
async def list_org_tags(
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[str]:
    """ดึง tags ที่ไม่ซ้ำทั้งหมดจากเอกสารในองค์กร"""
    # SQL: SELECT DISTINCT UNNEST(tags) FROM documents WHERE org_id = ?
```

---

### Frontend

#### [MODIFY] [index.ts]

เพิ่ม `tags` ใน Document interface (line ~107-118):

```typescript
export interface Document {
    id: string;
    organization_id: string;
    bot_ids: string[];
    name: string;
    file_path: string | null;
    file_size_bytes: number | null;
    storage_bytes: number | null;
    mime_type: string | null;
    tags: string[];                    // ← NEW
    status: DocumentStatus;
    created_at: string;
}
```

#### [MODIFY] [endpoints.ts]

เพิ่มใน `documentsApi`:

```typescript
documentsApi = {
    // แก้ upload ให้รับ tags parameter
    upload: (file, botIds, orgId, tags?) => ...,
    
    // เพิ่ม API ใหม่
    updateTags: (docId, orgId, tags) => 
        axios.patch(`/api/documents/${docId}/tags`, { tags, organization_id: orgId }),
    
    listTags: (orgId) => 
        axios.get(`/api/documents/tags?organization_id=${orgId}`),
}
```

#### [MODIFY] [KnowledgeBasePage.tsx]

**1. Tag Filter Bar** — เพิ่มใต้ Search bar (line ~274-286):

```
┌──────────────────────────────────────────────────────────┐
│ 🏷️ ทั้งหมด(12) │ HR(4) │ IT(3) │ การเงิน(5) │ อื่นๆ(0) │
└──────────────────────────────────────────────────────────┘
```

- State ใหม่: `selectedTag`, `orgTags`
- โหลด `orgTags` จาก `documentsApi.listTags(orgId)` ตอน mount
- กด tag → set `selectedTag` → filter documents

**2. Tag Chips บน Document Card** (line ~363-390):

แสดง tag เป็น pill/chip ข้างๆ Status Badge:

```
📄 นโยบายลาพัก.pdf    [Ready ✅] [HR] [นโยบาย]
```

**3. Tag Input ตอนอัปโหลด** — เพิ่มใน Upload flow:

- หลังเลือกไฟล์ → แสดง dialog เล็กๆ ให้ใส่ tags (optional)
- มี auto-suggest จาก `orgTags` ที่เคยใช้
- กด Enter หรือคอมม่าเพื่อเพิ่ม tag ใหม่

**4. แก้ไข Tags หลังอัปโหลด** (Org Admin only):

- เพิ่มปุ่ม 🏷️ (tag icon) ข้างปุ่ม Link Bots บน document card
- กดแล้วเปิด modal แก้ไข tags → เรียก `documentsApi.updateTags()`

#### [MODIFY] i18n files (th.json / en.json)

เพิ่ม translation keys:

```json
{
    "kb.allTags": "ทั้งหมด",
    "kb.filterByTag": "กรองตามป้ายกำกับ",
    "kb.addTags": "เพิ่มป้ายกำกับ",
    "kb.editTags": "แก้ไขป้ายกำกับ",
    "kb.tagsPlaceholder": "พิมพ์ป้ายกำกับ แล้วกด Enter...",
    "kb.tagsSaved": "บันทึกป้ายกำกับสำเร็จ",
    "kb.noTags": "ไม่มีป้ายกำกับ",
    "kb.tagsOptional": "ป้ายกำกับ (ไม่บังคับ)"
}
```

---

## สรุปไฟล์ที่ต้องแก้

| ชั้น | ไฟล์ | การเปลี่ยนแปลง |
|---|---|---|
| **DB** | `sql/017_add_document_tags.sql` | [NEW] เพิ่ม `tags TEXT[]` + GIN index |
| **Backend** | `app/routers/document.py` | เพิ่ม tags ใน models, upload, list filter, PATCH tags, GET tags |
| **Frontend** | `src/types/index.ts` | เพิ่ม `tags: string[]` ใน Document |
| **Frontend** | `src/api/endpoints.ts` | เพิ่ม `updateTags()`, `listTags()` |
| **Frontend** | `src/pages/KnowledgeBasePage.tsx` | Tag filter bar, tag chips, tag input dialog, edit tags modal |
| **Frontend** | `src/i18n/th.json` + `en.json` | เพิ่ม translation keys สำหรับ tags |

## Verification Plan

### Automated Tests
- อัปโหลดเอกสารพร้อม tags → ตรวจสอบว่า tags ถูกบันทึก
- Filter ตาม tag → ตรวจสอบว่าแสดงเฉพาะเอกสารที่มี tag นั้น
- แก้ไข tags → ตรวจสอบว่า tags อัปเดตสำเร็จ
- `GET /api/documents/tags` → return tags ที่ไม่ซ้ำทั้งหมด

### Manual Verification
- ตรวจสอบ UI: Tag filter bar แสดงจำนวนเอกสารถูกต้อง
- ตรวจสอบ auto-suggest: พิมพ์ tag → แสดง suggestion จาก tags เดิม
- ตรวจสอบ permission: Member ไม่สามารถแก้ไข tags ได้
