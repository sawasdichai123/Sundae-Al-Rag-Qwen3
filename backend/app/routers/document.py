"""
SUNDAE Backend — Document Upload Router (Task 6.6.1)

Handles PDF upload, text extraction, chunking, embedding, and storage.
This is the ingestion pipeline that prepares documents for RAG retrieval.

Flow:
  1. Accept PDF via multipart form upload
  2. Store original PDF in Supabase Storage (for preview/download)
  3. Extract text using PyMuPDF
  4. Split into Parent-Child chunks (Thai-aware)
  5. Embed child chunks using BAAI/bge-m3
  6. Store everything in Supabase with organization_id isolation

SECURITY:
    Every database insert MUST include organization_id.
    The backend uses Service Role Key (bypasses RLS).
"""

from __future__ import annotations

import logging
import re as _re
import uuid
from typing import Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_approved, require_org_admin, verify_organization
from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.ai_models import get_embedding_service
from app.services.chunking import create_parent_child_chunks
from app.services.vector_search import store_parent_chunks, store_child_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["Documents"])


# ── Response Models ──────────────────────────────────────────────


class UploadResponse(BaseModel):
    """Response schema for a successful document upload."""

    document_id: str
    filename: str
    total_parent_chunks: int
    total_child_chunks: int
    status: str


class DocumentResponse(BaseModel):
    """Response schema for a single document."""

    id: str
    organization_id: str
    bot_ids: list[str] = []
    name: str
    file_path: Optional[str] = None
    file_size_bytes: Optional[int] = None
    storage_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    status: str
    created_at: str


class DeleteResponse(BaseModel):
    """Response schema for document deletion."""

    message: str
    document_id: str


# ── List / Get / Delete Endpoints ────────────────────────────────


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[DocumentResponse]:
    """List all documents belonging to an organization.

    Args:
        organization_id: UUID of the tenant organization.

    Returns:
        List of documents ordered by creation date (newest first).
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("documents")
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
        ).execute()

        # Fetch actual DB storage sizes per document
        storage_map: dict[str, int] = {}
        try:
            sizes = await supabase.rpc(
                "get_doc_storage_sizes",
                {"p_org_id": organization_id},
            ).execute()
            for row in sizes.data or []:
                storage_map[row["document_id"]] = row["storage_bytes"]
        except Exception as size_exc:
            logger.warning("Failed to fetch storage sizes: %s", size_exc)

        return [
            DocumentResponse(**{**doc, "storage_bytes": storage_map.get(doc["id"])})
            for doc in (result.data or [])
        ]

    except Exception as exc:
        logger.error("Failed to list documents (org=%s): %s", organization_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list documents.")


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> DocumentResponse:
    """Get a single document by ID.

    Args:
        document_id:      UUID of the document.
        organization_id:  UUID of the tenant organization.

    Returns:
        Document details.

    Raises:
        HTTPException 404: Document not found.
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("documents")
            .select("*")
            .eq("id", document_id)
            .eq("organization_id", organization_id)
            .single()
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Document not found.")

        return DocumentResponse(**result.data)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get document %s: %s", document_id, exc)
        raise HTTPException(status_code=404, detail="Document not found.")


@router.delete("/{document_id}", response_model=DeleteResponse)
async def delete_document(
    document_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_org_admin),
) -> DeleteResponse:
    """Delete a document and all associated chunks.

    Chunks are automatically deleted via ON DELETE CASCADE in the database.

    Args:
        document_id:      UUID of the document to delete.
        organization_id:  UUID of the tenant organization.

    Returns:
        Confirmation message with the deleted document ID.

    Raises:
        HTTPException 404: Document not found.
        HTTPException 500: Deletion failure.
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()

    # Verify document exists and belongs to the organization
    try:
        check = await (
            supabase.table("documents")
            .select("id")
            .eq("id", document_id)
            .eq("organization_id", organization_id)
            .single()
        ).execute()

        if not check.data:
            raise HTTPException(status_code=404, detail="Document not found.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Delete — cascading removes parent_chunks and child_chunks
    try:
        await (
            supabase.table("documents")
            .delete()
            .eq("id", document_id)
            .eq("organization_id", organization_id)
        ).execute()

        logger.info("Document deleted: %s (org=%s)", document_id, organization_id)

        return DeleteResponse(
            message="Document deleted successfully.",
            document_id=document_id,
        )

    except Exception as exc:
        logger.error("Failed to delete document %s: %s", document_id, exc)
        raise HTTPException(status_code=500, detail="Failed to delete document.")


class LinkBotsRequest(BaseModel):
    """Replace the full list of bot_ids linked to a document."""
    bot_ids: list[str] = []


@router.patch("/{document_id}/link-bots")
async def link_document_to_bots(
    document_id: str,
    organization_id: str,
    body: LinkBotsRequest,
    user: CurrentUser = Depends(require_org_admin),
):
    """Replace the full list of bots linked to a document.

    Pass `bot_ids: []` to unlink from all bots.
    Pass `bot_ids: [uuid1, uuid2, ...]` to set the complete link list.
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()

    try:
        bot_ids = list({b for b in body.bot_ids if b})  # dedupe + drop empty

        # Verify all bots belong to the same organization (prevent cross-tenant linking)
        if bot_ids:
            bot_check = await (
                supabase.table("bots")
                .select("id")
                .in_("id", bot_ids)
                .eq("organization_id", organization_id)
            ).execute()
            found_ids = {b["id"] for b in (bot_check.data or [])}
            missing = [b for b in bot_ids if b not in found_ids]
            if missing:
                raise HTTPException(status_code=404, detail=f"Bots not found in this organization: {missing}")

        result = await (
            supabase.table("documents")
            .update({"bot_ids": bot_ids})
            .eq("id", document_id)
            .eq("organization_id", organization_id)
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Document not found.")

        logger.info(
            "Document %s linked to bots %s (org=%s)",
            document_id, bot_ids, organization_id,
        )
        return {"message": "ok", "document_id": document_id, "bot_ids": bot_ids}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to link document %s to bot: %s", document_id, exc)
        raise HTTPException(status_code=500, detail="Failed to link document.")


# ── Helper Functions ─────────────────────────────────────────────


# Sentinel pattern injected before each page's text so the chunker can
# determine which PDF page(s) a chunk originates from.
PAGE_SENTINEL_PATTERN = "<<<PAGE:{page}>>>"


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF file using PyMuPDF.

    Each page is preceded by a sentinel marker ``<<<PAGE:N>>>`` (1-based)
    so that downstream chunking can compute page_start / page_end for
    every chunk.  The sentinel is stripped before storing chunk text.

    Args:
        pdf_bytes: Raw bytes of the PDF file.

    Returns:
        Full text with page sentinels interleaved, ready for chunking.

    Raises:
        ValueError: If the PDF contains no extractable text.
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Cannot open PDF — file may be corrupted or password-protected: {exc}")

    pages: list[str] = []

    try:
        for page in doc:
            text = page.get_text("text")
            if text and text.strip():
                # page.number is 0-based; use +1 to match physical PDF page numbers
                sentinel = f"\n{PAGE_SENTINEL_PATTERN.format(page=page.number + 1)}\n"
                pages.append(sentinel + text.strip())
    finally:
        doc.close()

    full_text = "\n\n".join(pages)
    if not full_text.strip():
        raise ValueError("PDF contains no extractable text.")

    # Remove null bytes — PostgreSQL text columns reject \u0000
    full_text = full_text.replace("\x00", "")

    return full_text


# Storage bucket name for original PDF files
STORAGE_BUCKET = "documents"


# ── Endpoint ─────────────────────────────────────────────────────


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    organization_id: str = Form(...),
    bot_ids: Optional[str] = Form(None),
    user: CurrentUser = Depends(require_org_admin),
) -> UploadResponse:
    """Upload a PDF document and process it through the RAG pipeline.

    Args:
        file:            PDF file to upload.
        organization_id: UUID of the tenant organization.
        bot_ids:         Optional comma-separated UUIDs of bots to link.
                         Empty/omitted = document is org-wide (not yet linked).
    """
    await verify_organization(user, organization_id)

    # ── 1. Validate file type (PDF only) ──────────────────────────
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Only PDF files are accepted.",
        )

    # Parse comma-separated bot_ids → list[str]
    parsed_bot_ids: list[str] = []
    if bot_ids:
        parsed_bot_ids = [b.strip() for b in bot_ids.split(",") if b.strip()]

    document_id = str(uuid.uuid4())
    sanitized_name = _re.sub(r"[^a-zA-Z0-9._\-\u0E00-\u0E7F ]", "_", file.filename or "untitled.pdf")
    supabase = get_supabase()

    try:
        # ── 2. Read & validate file size (max 50 MB) ──────────────
        MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
        doc_bytes = await file.read()

        # Validate magic bytes (don't rely solely on client-provided MIME type)
        if not doc_bytes[:5] == b"%PDF-":
            raise HTTPException(status_code=400, detail="Invalid file: not a valid PDF (bad magic bytes).")

        if len(doc_bytes) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large ({len(doc_bytes) / 1024 / 1024:.1f} MB). Maximum is 50 MB.",
            )

        # ── 3. Upload original PDF to Supabase Storage ───────────
        storage_path = f"{organization_id}/{document_id}.pdf"
        try:
            await supabase.storage.from_(STORAGE_BUCKET).upload(
                path=storage_path,
                file=doc_bytes,
                file_options={"content-type": "application/pdf"},
            )
            logger.info("Original PDF uploaded to storage: %s", storage_path)
        except Exception as storage_exc:
            logger.error("Failed to upload PDF to storage: %s", storage_exc)
            # Non-fatal — continue processing even if storage upload fails
            storage_path = None

        # ── 4. Insert document record (status = processing) ──────
        file_size = len(doc_bytes)

        doc_row = {
            "id": document_id,
            "organization_id": organization_id,
            "bot_ids": parsed_bot_ids,
            "name": sanitized_name,
            "file_path": storage_path,
            "file_size_bytes": file_size,
            "mime_type": "application/pdf",
            "status": "processing",
        }
        await (supabase.table("documents").insert(doc_row)).execute()
        logger.info(
            "Document record created: %s (org=%s)", document_id, organization_id
        )

        # ── 5. Extract text ──────────────────────────────────────
        try:
            full_text = extract_text_from_pdf(doc_bytes)
        except ValueError as exc:
            # Update status to error and return 400
            await (
                supabase.table("documents")
                .update({"status": "error"})
                .eq("id", document_id)
                .eq("organization_id", organization_id)
            ).execute()
            raise HTTPException(status_code=400, detail=str(exc))

        # ── Validate extracted text size ───────────────────────
        MAX_TEXT_SIZE = 10 * 1024 * 1024  # 10MB of text
        if len(full_text) > MAX_TEXT_SIZE:
            await (
                supabase.table("documents")
                .update({"status": "error"})
                .eq("id", document_id)
                .eq("organization_id", organization_id)
            ).execute()
            raise HTTPException(
                status_code=400,
                detail=f"Extracted text too large ({len(full_text)} bytes, max {MAX_TEXT_SIZE})",
            )

        logger.info(
            "Extracted %d characters from PDF '%s'",
            len(full_text),
            sanitized_name,
        )

        # ── 4. Chunk text (Parent-Child) ────────────────────────
        cfg = get_settings()
        parent_chunks = create_parent_child_chunks(
            text=full_text,
            document_id=document_id,
            parent_chunk_size=cfg.parent_chunk_size,
            parent_chunk_overlap=cfg.parent_chunk_overlap,
            child_chunk_size=cfg.child_chunk_size,
            child_chunk_overlap=cfg.child_chunk_overlap,
        )

        total_parent = len(parent_chunks)
        total_child = sum(len(p.children) for p in parent_chunks)

        logger.info(
            "Chunked into %d parents, %d children (doc=%s)",
            total_parent,
            total_child,
            document_id,
        )

        # ── 5. Embed child chunks ───────────────────────────────
        embedder = get_embedding_service()

        # Collect all child texts for batch embedding
        all_child_texts: list[str] = []
        for parent in parent_chunks:
            for child in parent.children:
                all_child_texts.append(child.text)

        if all_child_texts:
            all_embeddings = await embedder.embed_texts(all_child_texts)
        else:
            all_embeddings = []

        logger.info("Embedded %d child chunks (doc=%s)", len(all_embeddings), document_id)

        # ── 6. Store parent chunks ──────────────────────────────
        parent_rows = [
            {
                "id": p.id,
                "document_id": p.document_id,
                "chunk_index": p.chunk_index,
                "text": p.text,
                "page_start": p.page_start,
                "page_end": p.page_end,
            }
            for p in parent_chunks
        ]
        await store_parent_chunks(parent_rows, organization_id)

        # ── 7. Store child chunks (with embeddings) ─────────────
        embedding_idx = 0
        child_rows: list[dict] = []
        for parent in parent_chunks:
            for child in parent.children:
                child_rows.append(
                    {
                        "id": child.id,
                        "parent_id": child.parent_id,
                        "document_id": document_id,
                        "chunk_index": child.chunk_index,
                        "text": child.text,
                        "page_start": child.page_start,
                        "page_end": child.page_end,
                        "embedding": all_embeddings[embedding_idx],
                    }
                )
                embedding_idx += 1

        await store_child_chunks(child_rows, organization_id)

        # ── 8. Update document status to ready ──────────────────
        await (
            supabase.table("documents")
            .update({"status": "ready"})
            .eq("id", document_id)
            .eq("organization_id", organization_id)
        ).execute()

        logger.info("Document processing complete: %s (org=%s)", document_id, organization_id)

        return UploadResponse(
            document_id=document_id,
            filename=sanitized_name,
            total_parent_chunks=total_parent,
            total_child_chunks=total_child,
            status="ready",
        )

    except HTTPException:
        # Re-raise HTTP exceptions without wrapping
        raise

    except Exception as exc:
        logger.error("Document processing failed (doc=%s): %s", document_id, exc)

        # Attempt to update document status to error
        try:
            await (
                supabase.table("documents")
                .update({"status": "error"})
                .eq("id", document_id)
                .eq("organization_id", organization_id)
            ).execute()
        except Exception:
            pass  # Best-effort cleanup

        raise HTTPException(
            status_code=500,
            detail="Document processing failed. Please try again.",
        )


# ── Preview / Download Endpoint ──────────────────────────────────


@router.get("/{document_id}/preview")
async def get_document_preview_url(
    document_id: str,
    organization_id: str,
    download: bool = Query(False, description="If true, generate download URL (Org Admin only)"),
    user: CurrentUser = Depends(require_approved),
):
    """Generate a signed URL for previewing or downloading the original PDF.

    - **Preview mode** (default): Any approved user in the org can access.
    - **Download mode** (download=true): Only Org Admin can download.

    The signed URL expires after 1 hour.

    Args:
        document_id:      UUID of the document.
        organization_id:  UUID of the tenant organization.
        download:         If true, returns a download-oriented signed URL.

    Returns:
        JSON with ``url`` (signed URL) and ``filename``.

    Raises:
        HTTPException 403: Download requested by non-admin.
        HTTPException 404: Document not found or no file stored.
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()

    # If download is requested, check Org Admin role
    if download:
        try:
            membership = await (
                supabase.table("org_members")
                .select("org_role")
                .eq("user_id", user.id)
                .eq("organization_id", organization_id)
                .single()
            ).execute()
            member_role = membership.data.get("org_role") if membership.data else None
            logger.info("Download check: user=%s org=%s org_role=%s", user.id, organization_id, member_role)
            if member_role not in ("admin", "owner"):
                raise HTTPException(status_code=403, detail="Only Org Admin can download documents.")
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Cannot verify admin role for download: %s", exc)
            raise HTTPException(status_code=403, detail="Cannot verify admin role.")

    # Fetch document record
    try:
        result = await (
            supabase.table("documents")
            .select("id, name, file_path, mime_type")
            .eq("id", document_id)
            .eq("organization_id", organization_id)
            .single()
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Document not found.")

        doc = result.data
        file_path = doc.get("file_path")

        if not file_path:
            raise HTTPException(
                status_code=404,
                detail="Original file not available for preview (uploaded before storage was enabled).",
            )

        # Generate signed URL (valid for 1 hour = 3600 seconds)
        signed = await supabase.storage.from_(STORAGE_BUCKET).create_signed_url(
            path=file_path,
            expires_in=3600,
        )

        # Handle varying response formats across supabase-py versions
        logger.info("Signed URL response (type=%s): %s", type(signed).__name__, signed)
        signed_url = None

        def _extract_url(obj):
            """Try to extract signed URL from various response shapes."""
            if isinstance(obj, str):
                return obj
            if isinstance(obj, dict):
                return obj.get("signedURL") or obj.get("signed_url") or obj.get("signedUrl")
            if hasattr(obj, "signed_url") and obj.signed_url:
                return obj.signed_url
            if hasattr(obj, "signedURL") and obj.signedURL:
                return obj.signedURL
            return None

        # Case 1: response is a list (some versions return [{ signedURL: ... }])
        if isinstance(signed, list) and len(signed) > 0:
            signed_url = _extract_url(signed[0])
        # Case 2: response has .data (v2+ response object)
        elif hasattr(signed, "data") and signed.data:
            data = signed.data
            if isinstance(data, list) and len(data) > 0:
                signed_url = _extract_url(data[0])
            else:
                signed_url = _extract_url(data)
        # Case 3: response is a dict or has .signed_url directly
        if not signed_url:
            signed_url = _extract_url(signed)

        if not signed_url:
            logger.error("Could not extract signed URL from response (type=%s): %s", type(signed).__name__, signed)
            raise HTTPException(status_code=500, detail="Failed to generate preview URL.")

        return {
            "url": signed_url,
            "filename": doc.get("name", "document.pdf"),
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to generate preview URL for doc %s: %s", document_id, exc)
        raise HTTPException(status_code=500, detail="Failed to generate preview URL.")
