"""
Unit tests for the Document Upload Router (Task 6.6.1).

Uses mocked Supabase + AI services to test the upload pipeline
without requiring a live database or GPU.
"""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


# ── Helpers ──────────────────────────────────────────────────────

FAKE_ORG_ID = "org-001-test"
FAKE_BOT_ID = "bot-001-test"


def _make_fake_pdf() -> bytes:
    """Create a minimal valid PDF with extractable text using PyMuPDF."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "สวัสดีครับ นี่คือเนื้อหาทดสอบสำหรับ SUNDAE Platform")
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_empty_pdf() -> bytes:
    """Create a valid PDF with no text content."""
    import fitz

    doc = fitz.open()
    doc.new_page()  # blank page
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _mock_supabase_insert() -> MagicMock:
    """Create a mock Supabase client that handles insert() and update() chains."""
    mock_client = MagicMock()

    # Mock response for all operations
    mock_response = MagicMock()
    mock_response.data = [{"id": "test"}]

    # insert chain: client.table("x").insert(row).execute()
    mock_execute = AsyncMock(return_value=mock_response)
    mock_insert = MagicMock()
    mock_insert.execute = mock_execute

    # update chain: client.table("x").update(row).eq("id", x).eq("org", y).execute()
    mock_eq_inner = MagicMock()
    mock_eq_inner.execute = AsyncMock(return_value=mock_response)
    mock_eq_outer = MagicMock()
    mock_eq_outer.eq.return_value = mock_eq_inner
    mock_update = MagicMock()
    mock_update.eq.return_value = mock_eq_outer

    mock_table = MagicMock()
    mock_table.insert.return_value = mock_insert
    mock_table.update.return_value = mock_update

    mock_client.table.return_value = mock_table

    return mock_client


# ── Test Class ───────────────────────────────────────────────────

client = TestClient(app, raise_server_exceptions=False)


class TestDocumentUpload:
    """Tests for POST /api/documents/upload."""

    @patch("app.routers.document.store_child_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.store_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.get_embedding_service")
    @patch("app.routers.document.get_supabase")
    def test_upload_valid_pdf(
        self, mock_get_sb, mock_get_emb, mock_store_parents, mock_store_children
    ):
        """Upload a valid PDF → should return 200 with document_id and chunk counts."""
        # Setup mocks
        mock_get_sb.return_value = _mock_supabase_insert()

        mock_embedder = MagicMock()
        mock_embedder.embed_texts = AsyncMock(return_value=[[0.1] * 1024])
        mock_get_emb.return_value = mock_embedder

        pdf_bytes = _make_fake_pdf()

        response = client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"organization_id": FAKE_ORG_ID, "bot_id": FAKE_BOT_ID},
        )

        assert response.status_code == 200
        data = response.json()
        assert "document_id" in data
        assert data["status"] == "ready"
        assert data["filename"] == "test.pdf"
        assert data["total_parent_chunks"] >= 1
        assert data["total_child_chunks"] >= 1

    @patch("app.routers.document.get_supabase")
    def test_upload_non_pdf_returns_400(self, mock_get_sb):
        """Upload a non-PDF file → should return 400."""
        mock_get_sb.return_value = _mock_supabase_insert()

        response = client.post(
            "/api/documents/upload",
            files={"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")},
            data={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 400
        assert "Invalid file type" in response.json()["detail"]

    @patch("app.routers.document.get_supabase")
    def test_upload_empty_pdf_returns_400(self, mock_get_sb):
        """Upload a PDF with no text → should return 400."""
        mock_get_sb.return_value = _mock_supabase_insert()

        pdf_bytes = _make_empty_pdf()

        response = client.post(
            "/api/documents/upload",
            files={"file": ("empty.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 400
        assert "no extractable text" in response.json()["detail"]

    @patch("app.routers.document.store_child_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.store_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.get_embedding_service")
    @patch("app.routers.document.get_supabase")
    def test_db_failure_returns_500(
        self, mock_get_sb, mock_get_emb, mock_store_parents, mock_store_children
    ):
        """If store_parent_chunks fails → should return 500 and set status to error."""
        mock_sb = _mock_supabase_insert()
        mock_get_sb.return_value = mock_sb

        mock_embedder = MagicMock()
        mock_embedder.embed_texts = AsyncMock(return_value=[[0.1] * 1024])
        mock_get_emb.return_value = mock_embedder

        # Make store_parent_chunks raise an exception
        mock_store_parents.side_effect = RuntimeError("DB connection lost")

        pdf_bytes = _make_fake_pdf()

        response = client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 500
        assert "DB connection lost" in response.json()["detail"]

    @patch("app.routers.document.store_child_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.store_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.document.get_embedding_service")
    @patch("app.routers.document.get_supabase")
    def test_org_id_included_in_all_inserts(
        self, mock_get_sb, mock_get_emb, mock_store_parents, mock_store_children
    ):
        """Verify organization_id is passed to every storage function."""
        mock_sb = _mock_supabase_insert()
        mock_get_sb.return_value = mock_sb

        mock_embedder = MagicMock()
        mock_embedder.embed_texts = AsyncMock(return_value=[[0.1] * 1024])
        mock_get_emb.return_value = mock_embedder

        pdf_bytes = _make_fake_pdf()

        response = client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"organization_id": FAKE_ORG_ID},
        )

        assert response.status_code == 200

        # Verify store_parent_chunks received org_id
        mock_store_parents.assert_called_once()
        assert mock_store_parents.call_args[0][1] == FAKE_ORG_ID

        # Verify store_child_chunks received org_id
        mock_store_children.assert_called_once()
        assert mock_store_children.call_args[0][1] == FAKE_ORG_ID

        # Verify document insert included organization_id
        insert_calls = mock_sb.table.return_value.insert.call_args_list
        assert len(insert_calls) >= 1
        doc_row = insert_calls[0][0][0]
        assert doc_row["organization_id"] == FAKE_ORG_ID
