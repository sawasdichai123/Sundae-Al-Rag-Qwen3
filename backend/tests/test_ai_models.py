"""
Unit tests for the AI Models service (Embedding & Reranker).

Uses mocked SentenceTransformer and CrossEncoder to avoid downloading
real models during CI/testing.
"""

from __future__ import annotations

import pytest
import numpy as np
from unittest.mock import patch, MagicMock

from app.services.ai_models import (
    EmbeddingService,
    RerankerService,
    RerankResult,
    get_embedding_service,
    get_reranker_service,
    reset_services,
)


# ═══════════════════════════════════════════════════════════════════
# Fixtures & Helpers
# ═══════════════════════════════════════════════════════════════════

EMBED_DIM = 1024


def _fake_embeddings(n: int) -> np.ndarray:
    """Generate n random normalised 1024-dim embedding vectors."""
    rng = np.random.default_rng(42)
    vecs = rng.random((n, EMBED_DIM), dtype=np.float32)
    # Normalise to unit vectors (mimics normalize_embeddings=True)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / norms


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Reset singleton instances before each test."""
    reset_services()
    yield
    reset_services()


# ═══════════════════════════════════════════════════════════════════
# Tests for EmbeddingService
# ═══════════════════════════════════════════════════════════════════


class TestEmbeddingService:
    """Tests for the embedding pipeline."""

    @patch("app.services.ai_models.SentenceTransformer")
    def test_embed_texts_returns_correct_shape(self, mock_st_cls):
        """embed_texts_sync should return N vectors of 1024 dims."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(3)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        results = service.embed_texts_sync(["text1", "text2", "text3"])

        assert len(results) == 3
        assert all(len(vec) == EMBED_DIM for vec in results)
        assert all(isinstance(vec, list) for vec in results)

    @patch("app.services.ai_models.SentenceTransformer")
    def test_embed_texts_returns_plain_python_floats(self, mock_st_cls):
        """Vectors must be plain Python lists (not numpy) for JSON."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(1)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        results = service.embed_texts_sync(["hello"])

        assert isinstance(results[0], list)
        assert isinstance(results[0][0], float)

    @patch("app.services.ai_models.SentenceTransformer")
    def test_embed_texts_calls_normalize(self, mock_st_cls):
        """Model.encode should be called with normalize_embeddings=True."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(1)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        service.embed_texts_sync(["hello"])

        mock_model.encode.assert_called_once()
        call_kwargs = mock_model.encode.call_args
        assert call_kwargs.kwargs.get("normalize_embeddings") is True

    def test_embed_empty_list_raises(self):
        """Should raise ValueError for empty input."""
        service = EmbeddingService(model_name="test-model")
        with pytest.raises(ValueError, match="empty"):
            service.embed_texts_sync([])

    @patch("app.services.ai_models.SentenceTransformer")
    def test_model_loaded_only_once(self, mock_st_cls):
        """Model should load lazily on first use and be cached."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(1)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        service.embed_texts_sync(["a"])
        service.embed_texts_sync(["b"])
        service.embed_texts_sync(["c"])

        # SentenceTransformer() should have been called exactly once
        assert mock_st_cls.call_count == 1

    @pytest.mark.asyncio
    @patch("app.services.ai_models.SentenceTransformer")
    async def test_embed_texts_async(self, mock_st_cls):
        """Async wrapper should produce the same results."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(2)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        results = await service.embed_texts(["hello", "world"])

        assert len(results) == 2
        assert all(len(v) == EMBED_DIM for v in results)

    @pytest.mark.asyncio
    @patch("app.services.ai_models.SentenceTransformer")
    async def test_embed_query(self, mock_st_cls):
        """embed_query should return a single vector."""
        mock_model = MagicMock()
        mock_model.encode.return_value = _fake_embeddings(1)
        mock_model.get_sentence_embedding_dimension.return_value = EMBED_DIM
        mock_model.device = "cpu"
        mock_st_cls.return_value = mock_model

        service = EmbeddingService(model_name="test-model")
        vec = await service.embed_query("คำถามภาษาไทย")

        assert isinstance(vec, list)
        assert len(vec) == EMBED_DIM


# ═══════════════════════════════════════════════════════════════════
# Tests for RerankerService
# ═══════════════════════════════════════════════════════════════════


class TestRerankerService:
    """Tests for the reranking pipeline."""

    @patch("app.services.ai_models.CrossEncoder")
    def test_rerank_returns_sorted_results(self, mock_ce_cls):
        """Results should be sorted by score descending."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.2, 0.9, 0.6])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test-reranker", score_threshold=0.0)
        results = service.rerank_sync(
            "query", ["low", "high", "mid"]
        )

        assert len(results) == 3
        assert results[0].score == pytest.approx(0.9)
        assert results[1].score == pytest.approx(0.6)
        assert results[2].score == pytest.approx(0.2)

    @patch("app.services.ai_models.CrossEncoder")
    def test_rerank_filters_below_threshold(self, mock_ce_cls):
        """Passages below the threshold should be filtered out."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.1, 0.8, 0.25])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test-reranker", score_threshold=0.3)
        results = service.rerank_sync(
            "query", ["bad", "great", "borderline"]
        )

        # Only "great" (0.8) should survive; 0.1 and 0.25 are below 0.3
        assert len(results) == 1
        assert results[0].text == "great"
        assert results[0].score == pytest.approx(0.8)

    @patch("app.services.ai_models.CrossEncoder")
    def test_rerank_preserves_original_index(self, mock_ce_cls):
        """Each result should track its original position in the input."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.5, 0.9, 0.7])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test-reranker", score_threshold=0.0)
        results = service.rerank_sync("q", ["a", "b", "c"])

        # "b" was at index 1 in input, should be first in output
        assert results[0].original_index == 1
        assert results[1].original_index == 2
        assert results[2].original_index == 0

    @patch("app.services.ai_models.CrossEncoder")
    def test_rerank_top_k(self, mock_ce_cls):
        """top_k should limit the number of results."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.5, 0.9, 0.7, 0.8])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test-reranker", score_threshold=0.0)
        results = service.rerank_sync("q", ["a", "b", "c", "d"], top_k=2)

        assert len(results) == 2
        assert results[0].score == pytest.approx(0.9)
        assert results[1].score == pytest.approx(0.8)

    @patch("app.services.ai_models.CrossEncoder")
    def test_rerank_override_threshold(self, mock_ce_cls):
        """Per-call threshold override should work."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.4, 0.6])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test", score_threshold=0.5)

        # With default threshold (0.5): only 0.6 passes
        result_default = service.rerank_sync("q", ["a", "b"])
        assert len(result_default) == 1

        # Override threshold to 0.3: both pass
        result_override = service.rerank_sync(
            "q", ["a", "b"], score_threshold=0.3
        )
        assert len(result_override) == 2

    def test_rerank_empty_query(self):
        """Empty query should return empty list."""
        service = RerankerService(model_name="test")
        assert service.rerank_sync("", ["passage"]) == []

    def test_rerank_empty_passages(self):
        """Empty passages should return empty list."""
        service = RerankerService(model_name="test")
        assert service.rerank_sync("query", []) == []

    @patch("app.services.ai_models.CrossEncoder")
    def test_model_loaded_only_once(self, mock_ce_cls):
        """CrossEncoder should load lazily and be cached."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.5])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test", score_threshold=0.0)
        service.rerank_sync("q", ["a"])
        service.rerank_sync("q", ["b"])

        assert mock_ce_cls.call_count == 1

    @pytest.mark.asyncio
    @patch("app.services.ai_models.CrossEncoder")
    async def test_rerank_async(self, mock_ce_cls):
        """Async wrapper should produce identical results."""
        mock_model = MagicMock()
        mock_model.predict.return_value = np.array([0.3, 0.9])
        mock_ce_cls.return_value = mock_model

        service = RerankerService(model_name="test", score_threshold=0.0)
        results = await service.rerank("query", ["a", "b"])

        assert len(results) == 2
        assert results[0].score == pytest.approx(0.9)


# ═══════════════════════════════════════════════════════════════════
# Tests for singleton accessors
# ═══════════════════════════════════════════════════════════════════


class TestSingletons:
    """Tests for get_embedding_service / get_reranker_service."""

    def test_embedding_singleton_same_instance(self):
        s1 = get_embedding_service(model_name="model-a")
        s2 = get_embedding_service(model_name="model-b")  # ignored
        assert s1 is s2

    def test_reranker_singleton_same_instance(self):
        s1 = get_reranker_service(model_name="model-a")
        s2 = get_reranker_service(model_name="model-b")  # ignored
        assert s1 is s2

    def test_reset_creates_new_instances(self):
        s1 = get_embedding_service(model_name="model-a")
        reset_services()
        s2 = get_embedding_service(model_name="model-b")
        assert s1 is not s2
