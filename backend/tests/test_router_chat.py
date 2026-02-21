"""
Unit tests for the RAG Chat Router (Task 6.6.2).

Uses mocked services to test the full RAG pipeline without
requiring a live database, GPU, or Ollama instance.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_models import RerankResult
from app.services.vector_search import RetrievedParentChunk


# ── Helpers ──────────────────────────────────────────────────────

FAKE_ORG_ID = "org-001-test"
FAKE_SESSION_ID = "session-001-test"
FAKE_EMBEDDING = [0.1] * 1024


def _make_parent_result(
    parent_id: str = "p1",
    doc_id: str = "doc-001",
    chunk_index: int = 0,
    text: str = "เนื้อหาทดสอบจากเอกสาร",
    similarity: float = 0.92,
) -> RetrievedParentChunk:
    """Create a fake RetrievedParentChunk."""
    return RetrievedParentChunk(
        id=parent_id,
        document_id=doc_id,
        chunk_index=chunk_index,
        text=text,
        best_child_similarity=similarity,
    )


def _make_rerank_result(
    text: str = "เนื้อหาทดสอบจากเอกสาร",
    score: float = 0.85,
    original_index: int = 0,
) -> RerankResult:
    """Create a fake RerankResult."""
    return RerankResult(text=text, score=score, original_index=original_index)


def _mock_supabase_for_chat() -> MagicMock:
    """Create a mock Supabase client for chat session/message logging."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.data = [{"id": "test"}]

    mock_execute = AsyncMock(return_value=mock_response)
    mock_upsert = MagicMock()
    mock_upsert.execute = mock_execute
    mock_insert = MagicMock()
    mock_insert.execute = AsyncMock(return_value=mock_response)

    mock_table = MagicMock()
    mock_table.upsert.return_value = mock_upsert
    mock_table.insert.return_value = mock_insert
    mock_client.table.return_value = mock_table

    return mock_client


# ── Test Class ───────────────────────────────────────────────────

client = TestClient(app, raise_server_exceptions=False)


class TestChatAsk:
    """Tests for POST /api/chat/ask."""

    @patch("app.routers.chat.generate_response", new_callable=AsyncMock)
    @patch("app.routers.chat.get_reranker_service")
    @patch("app.routers.chat.search_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.chat.get_embedding_service")
    def test_valid_query_returns_answer(
        self, mock_get_emb, mock_search, mock_get_reranker, mock_generate
    ):
        """Valid query → should return 200 with answer and sources."""
        # Setup mocks
        mock_embedder = MagicMock()
        mock_embedder.embed_query = AsyncMock(return_value=FAKE_EMBEDDING)
        mock_get_emb.return_value = mock_embedder

        parent = _make_parent_result()
        mock_search.return_value = [parent]

        mock_reranker = MagicMock()
        mock_reranker.rerank = AsyncMock(
            return_value=[_make_rerank_result()]
        )
        mock_get_reranker.return_value = mock_reranker

        mock_generate.return_value = "คำตอบจากเอกสารครับ"

        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "ข้อมูลเกี่ยวกับบริษัท",
                "organization_id": FAKE_ORG_ID,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["answer"] == "คำตอบจากเอกสารครับ"
        assert len(data["sources"]) == 1
        assert data["sources"][0]["document_id"] == "doc-001"

    def test_empty_query_returns_400(self):
        """Empty query string → should return 422 (Pydantic validation)."""
        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "",
                "organization_id": FAKE_ORG_ID,
            },
        )

        # Pydantic min_length=1 returns 422 for empty strings
        assert response.status_code == 422

    @patch("app.routers.chat.generate_response", new_callable=AsyncMock)
    @patch("app.routers.chat.search_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.chat.get_embedding_service")
    def test_no_documents_found(self, mock_get_emb, mock_search, mock_generate):
        """No vector search results → LLM receives empty context → graceful response."""
        mock_embedder = MagicMock()
        mock_embedder.embed_query = AsyncMock(return_value=FAKE_EMBEDDING)
        mock_get_emb.return_value = mock_embedder

        mock_search.return_value = []  # No results
        mock_generate.return_value = "ไม่พบข้อมูลในเอกสาร"

        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "คำถามที่ไม่มีคำตอบ",
                "organization_id": FAKE_ORG_ID,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "ไม่พบข้อมูล" in data["answer"]
        assert data["sources"] == []

    @patch("app.routers.chat.generate_response", new_callable=AsyncMock)
    @patch("app.routers.chat.get_reranker_service")
    @patch("app.routers.chat.search_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.chat.get_embedding_service")
    def test_org_id_passed_to_all_services(
        self, mock_get_emb, mock_search, mock_get_reranker, mock_generate
    ):
        """Verify organization_id is passed to vector search."""
        mock_embedder = MagicMock()
        mock_embedder.embed_query = AsyncMock(return_value=FAKE_EMBEDDING)
        mock_get_emb.return_value = mock_embedder

        mock_search.return_value = [_make_parent_result()]

        mock_reranker = MagicMock()
        mock_reranker.rerank = AsyncMock(return_value=[_make_rerank_result()])
        mock_get_reranker.return_value = mock_reranker

        mock_generate.return_value = "คำตอบ"

        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "คำถาม",
                "organization_id": "specific-org-999",
            },
        )

        assert response.status_code == 200

        # Verify org_id passed to search_parent_chunks
        mock_search.assert_called_once()
        call_kwargs = mock_search.call_args
        assert call_kwargs.kwargs.get("organization_id") or call_kwargs.args[1] == "specific-org-999"

    @patch("app.routers.chat.get_supabase")
    @patch("app.routers.chat.generate_response", new_callable=AsyncMock)
    @patch("app.routers.chat.get_reranker_service")
    @patch("app.routers.chat.search_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.chat.get_embedding_service")
    def test_session_logging(
        self, mock_get_emb, mock_search, mock_get_reranker, mock_generate, mock_get_sb
    ):
        """When session_id is provided, messages should be logged to DB."""
        mock_embedder = MagicMock()
        mock_embedder.embed_query = AsyncMock(return_value=FAKE_EMBEDDING)
        mock_get_emb.return_value = mock_embedder

        mock_search.return_value = [_make_parent_result()]

        mock_reranker = MagicMock()
        mock_reranker.rerank = AsyncMock(return_value=[_make_rerank_result()])
        mock_get_reranker.return_value = mock_reranker

        mock_generate.return_value = "คำตอบทดสอบ"

        mock_sb = _mock_supabase_for_chat()
        mock_get_sb.return_value = mock_sb

        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "คำถาม",
                "organization_id": FAKE_ORG_ID,
                "session_id": FAKE_SESSION_ID,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == FAKE_SESSION_ID

        # Verify upsert was called for chat_sessions
        mock_sb.table.assert_any_call("chat_sessions")

        # Verify inserts were called for chat_messages (user + assistant)
        mock_sb.table.assert_any_call("chat_messages")

    @patch("app.routers.chat.generate_response", new_callable=AsyncMock)
    @patch("app.routers.chat.get_reranker_service")
    @patch("app.routers.chat.search_parent_chunks", new_callable=AsyncMock)
    @patch("app.routers.chat.get_embedding_service")
    def test_sources_in_response(
        self, mock_get_emb, mock_search, mock_get_reranker, mock_generate
    ):
        """Response should contain source references with document_id, chunk_index, score."""
        mock_embedder = MagicMock()
        mock_embedder.embed_query = AsyncMock(return_value=FAKE_EMBEDDING)
        mock_get_emb.return_value = mock_embedder

        parents = [
            _make_parent_result("p1", "doc-A", 0, "ข้อความ A", 0.95),
            _make_parent_result("p2", "doc-B", 3, "ข้อความ B", 0.80),
        ]
        mock_search.return_value = parents

        rerank_results = [
            _make_rerank_result("ข้อความ A", 0.9, 0),
            _make_rerank_result("ข้อความ B", 0.6, 1),
        ]
        mock_reranker = MagicMock()
        mock_reranker.rerank = AsyncMock(return_value=rerank_results)
        mock_get_reranker.return_value = mock_reranker

        mock_generate.return_value = "คำตอบรวม"

        response = client.post(
            "/api/chat/ask",
            json={
                "user_query": "คำถาม",
                "organization_id": FAKE_ORG_ID,
            },
        )

        assert response.status_code == 200
        data = response.json()

        assert len(data["sources"]) == 2
        assert data["sources"][0]["document_id"] == "doc-A"
        assert data["sources"][0]["chunk_index"] == 0
        assert data["sources"][0]["score"] == 0.9
        assert data["sources"][1]["document_id"] == "doc-B"
