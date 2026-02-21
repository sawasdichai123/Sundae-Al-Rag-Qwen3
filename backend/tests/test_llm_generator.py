"""
Unit tests for the LLM Generation Service.

Uses mocked httpx and config to test prompt assembly, Ollama integration,
and error handling without requiring a live Ollama instance.
"""

from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

import httpx

from app.services.llm_generator import (
    assemble_context,
    generate_response,
    SYSTEM_PROMPT,
    FALLBACK_MESSAGE,
    _build_user_message,
)


# ═══════════════════════════════════════════════════════════════════
# Tests for assemble_context
# ═══════════════════════════════════════════════════════════════════


class TestAssembleContext:
    """Tests for the context assembly helper."""

    def test_single_chunk(self):
        result = assemble_context(["This is context one."])
        assert "เอกสารอ้างอิง 1" in result
        assert "This is context one." in result

    def test_multiple_chunks(self):
        result = assemble_context(["chunk A", "chunk B", "chunk C"])
        assert "เอกสารอ้างอิง 1" in result
        assert "เอกสารอ้างอิง 2" in result
        assert "เอกสารอ้างอิง 3" in result
        assert "chunk A" in result
        assert "chunk C" in result

    def test_empty_list(self):
        assert assemble_context([]) == ""

    def test_whitespace_chunks_filtered(self):
        result = assemble_context(["valid text", "   ", "", "another valid"])
        assert "valid text" in result
        assert "another valid" in result
        # Should only have 2 numbered sections
        assert "เอกสารอ้างอิง 2" in result
        assert "เอกสารอ้างอิง 3" not in result

    def test_all_empty_chunks(self):
        assert assemble_context(["", "  ", "\n"]) == ""


# ═══════════════════════════════════════════════════════════════════
# Tests for _build_user_message
# ═══════════════════════════════════════════════════════════════════


class TestBuildUserMessage:
    """Tests for the message builder."""

    def test_with_context(self):
        msg = _build_user_message("คำถาม?", "context text")
        assert "[Context]" in msg
        assert "context text" in msg
        assert "[Question]" in msg
        assert "คำถาม?" in msg

    def test_without_context(self):
        msg = _build_user_message("คำถาม?", "")
        assert "ไม่มีข้อมูลจากเอกสาร" in msg
        assert "[Question]" in msg
        assert "คำถาม?" in msg


# ═══════════════════════════════════════════════════════════════════
# Tests for generate_response
# ═══════════════════════════════════════════════════════════════════


class TestGenerateResponse:
    """Tests for the main LLM generation function."""

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_successful_generation(self, mock_client_cls, mock_settings):
        """Should return the LLM's response text on success."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        # Mock the async context manager and response
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "นี่คือคำตอบจากเอกสาร"}
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="งบประมาณปี 2025 เท่าไหร่?",
            retrieved_contexts=["งบประมาณปี 2025 อยู่ที่ 50 ล้านบาท"],
        )

        assert result == "นี่คือคำตอบจากเอกสาร"

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_correct_payload_sent(self, mock_client_cls, mock_settings):
        """Verify the payload structure sent to Ollama."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "test response"}
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        await generate_response(
            user_query="test question",
            retrieved_contexts=["context chunk 1"],
            temperature=0.2,
        )

        # Verify post was called
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args

        # Check URL
        assert call_args[0][0] == "http://localhost:11434/api/chat"

        # Check payload structure
        payload = call_args[1]["json"]
        assert payload["model"] == "qwen3:14b"
        assert payload["stream"] is False
        assert payload["options"]["temperature"] == 0.2

        # Verify messages
        messages = payload["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert "[Context]" in messages[1]["content"]
        assert "[Question]" in messages[1]["content"]

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_system_prompt_is_strict_grounding(self, mock_client_cls, mock_settings):
        """The system prompt must contain strict grounding instructions."""
        assert "ห้ามใช้ความรู้เดิม" in SYSTEM_PROMPT
        assert "ห้ามแต่งข้อมูลเพิ่ม" in SYSTEM_PROMPT
        assert "ไม่พบข้อมูลในเอกสาร" in SYSTEM_PROMPT
        assert "[Context]" in SYSTEM_PROMPT

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_connection_error_returns_fallback(self, mock_client_cls, mock_settings):
        """Should return fallback message when Ollama is unreachable."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.ConnectError("Connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="test",
            retrieved_contexts=["context"],
        )

        assert result == FALLBACK_MESSAGE

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_timeout_returns_fallback(self, mock_client_cls, mock_settings):
        """Should return fallback message on timeout."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.ReadTimeout("Read timed out")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="test",
            retrieved_contexts=["context"],
        )

        assert result == FALLBACK_MESSAGE

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_http_error_returns_fallback(self, mock_client_cls, mock_settings):
        """Should return fallback message on HTTP error (e.g., 500)."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500 error",
            request=MagicMock(),
            response=mock_response,
        )

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="test",
            retrieved_contexts=["context"],
        )

        assert result == FALLBACK_MESSAGE

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_empty_response_returns_fallback(self, mock_client_cls, mock_settings):
        """If Ollama returns empty content, should return fallback."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {"message": {"content": ""}}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="test",
            retrieved_contexts=["context"],
        )

        assert result == FALLBACK_MESSAGE

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_empty_contexts_still_works(self, mock_client_cls, mock_settings):
        """With no contexts, should still call Ollama (LLM will refuse)."""
        mock_settings.return_value = MagicMock(
            llm_model="qwen3:14b",
            ollama_base_url="http://localhost:11434",
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "ไม่พบข้อมูลในเอกสาร"}
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await generate_response(
            user_query="อะไรก็ได้",
            retrieved_contexts=[],
        )

        assert result == "ไม่พบข้อมูลในเอกสาร"

        # Verify the message contains empty-context marker
        payload = mock_client.post.call_args[1]["json"]
        user_msg = payload["messages"][1]["content"]
        assert "ไม่มีข้อมูลจากเอกสาร" in user_msg

    @pytest.mark.asyncio
    @patch("app.services.llm_generator.get_settings")
    @patch("app.services.llm_generator.httpx.AsyncClient")
    async def test_model_override(self, mock_client_cls, mock_settings):
        """Custom model parameter should override config default."""
        mock_settings.return_value = MagicMock(
            llm_model="default-model",
            ollama_base_url="http://localhost:11434",
        )

        mock_response = MagicMock()
        mock_response.json.return_value = {"message": {"content": "ok"}}
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        await generate_response(
            user_query="test",
            retrieved_contexts=["ctx"],
            model="custom-model",
        )

        payload = mock_client.post.call_args[1]["json"]
        assert payload["model"] == "custom-model"
