"""
SUNDAE Backend — AI Model Services (Embedding & Reranker)

On-premise only — no external API calls. All inference runs locally.

This module provides two singleton services:
  1. **EmbeddingService**: Encodes text into 1024-dim vectors using BAAI/bge-m3.
  2. **RerankerService**: Scores query-context relevance using BAAI/bge-reranker-v2-m3.

Both models are loaded lazily (on first use) and cached for the lifetime of the
process to avoid repeated loading overhead.

Usage:
    >>> from app.services.ai_models import get_embedding_service, get_reranker_service
    >>> embedder = get_embedding_service()
    >>> vectors = await embedder.embed_texts(["สวัสดีครับ", "Hello world"])
    >>>
    >>> reranker = get_reranker_service()
    >>> ranked = await reranker.rerank("คำถาม", ["บริบท A", "บริบท B"])
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Optional

from sentence_transformers import SentenceTransformer, CrossEncoder

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# Embedding Service (BAAI/bge-m3)
# ═══════════════════════════════════════════════════════════════════


class EmbeddingService:
    """Singleton service for generating text embeddings using BAAI/bge-m3.

    The model produces 1024-dimensional dense vectors optimised for
    multilingual retrieval (including Thai).

    Parameters:
        model_name: HuggingFace model identifier (default: ``BAAI/bge-m3``).
        device:     Torch device — ``"cpu"``, ``"cuda"``, or ``None`` (auto).
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-m3",
        device: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self._model: Optional[SentenceTransformer] = None
        self._device = device

    # ── Lazy model loading ───────────────────────────────────────

    def _ensure_loaded(self) -> SentenceTransformer:
        """Load the model on first access and cache it."""
        if self._model is None:
            logger.info("Loading embedding model: %s ...", self.model_name)
            self._model = SentenceTransformer(
                self.model_name,
                device=self._device,
            )
            logger.info(
                "Embedding model loaded (dim=%d, device=%s)",
                self._model.get_sentence_embedding_dimension(),
                self._model.device,
            )
        return self._model

    # ── Public API ───────────────────────────────────────────────

    def embed_texts_sync(self, texts: List[str]) -> List[List[float]]:
        """Encode a list of texts into embedding vectors (synchronous).

        Args:
            texts: List of text strings to embed.

        Returns:
            List of 1024-dim float vectors.

        Raises:
            ValueError: If *texts* is empty.
            RuntimeError: If model loading fails.
        """
        if not texts:
            raise ValueError("Cannot embed an empty list of texts.")

        model = self._ensure_loaded()

        try:
            # normalize_embeddings=True ensures unit vectors for cosine similarity
            embeddings = model.encode(
                texts,
                normalize_embeddings=True,
                show_progress_bar=False,
                batch_size=32,
            )
            # Convert numpy arrays to plain Python lists for JSON serialisation
            return [emb.tolist() for emb in embeddings]

        except Exception as exc:
            logger.error("Embedding failed: %s", exc)
            raise RuntimeError(f"Embedding inference failed: {exc}") from exc

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Async wrapper — runs embedding in a thread pool to avoid blocking
        the FastAPI event loop.

        Args:
            texts: List of text strings to embed.

        Returns:
            List of 1024-dim float vectors.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed_texts_sync, texts)

    async def embed_query(self, query: str) -> List[float]:
        """Convenience method to embed a single query string.

        Args:
            query: The user query to embed.

        Returns:
            A single 1024-dim float vector.
        """
        results = await self.embed_texts([query])
        return results[0]

    @property
    def dimension(self) -> int:
        """Return the embedding dimensionality (loads model if needed)."""
        model = self._ensure_loaded()
        return model.get_sentence_embedding_dimension()  # type: ignore[return-value]


# ═══════════════════════════════════════════════════════════════════
# Reranker Service (BAAI/bge-reranker-v2-m3)
# ═══════════════════════════════════════════════════════════════════


@dataclass
class RerankResult:
    """A single reranked document with its relevance score."""

    text: str
    score: float
    original_index: int


class RerankerService:
    """Singleton service for cross-encoder reranking using BAAI/bge-reranker-v2-m3.

    Scores the relevance between a user query and candidate passages.
    Returns results sorted by relevance score (descending) and optionally
    filters out passages below a confidence threshold.

    Parameters:
        model_name:      HuggingFace model identifier.
        score_threshold: Minimum score to keep a passage.
        device:          Torch device — ``"cpu"``, ``"cuda"``, or ``None`` (auto).
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-reranker-v2-m3",
        score_threshold: float = 0.3,
        device: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.score_threshold = score_threshold
        self._model: Optional[CrossEncoder] = None
        self._device = device

    # ── Lazy model loading ───────────────────────────────────────

    def _ensure_loaded(self) -> CrossEncoder:
        """Load the cross-encoder model on first access and cache it."""
        if self._model is None:
            logger.info("Loading reranker model: %s ...", self.model_name)
            self._model = CrossEncoder(
                self.model_name,
                device=self._device,
            )
            logger.info("Reranker model loaded (device=%s)", self._device or "auto")
        return self._model

    # ── Public API ───────────────────────────────────────────────

    def rerank_sync(
        self,
        query: str,
        passages: List[str],
        *,
        top_k: Optional[int] = None,
        score_threshold: Optional[float] = None,
    ) -> List[RerankResult]:
        """Score and rank passages against a query (synchronous).

        Args:
            query:           The user question.
            passages:        Candidate passage texts (e.g. parent chunks).
            top_k:           Optional maximum number of results to return.
            score_threshold: Override the instance-level threshold. Passages
                             scoring below this value are dropped.

        Returns:
            List of ``RerankResult`` sorted by score descending, filtered
            by threshold.
        """
        if not query or not passages:
            return []

        model = self._ensure_loaded()
        threshold = score_threshold if score_threshold is not None else self.score_threshold

        try:
            # CrossEncoder expects list of [query, passage] pairs
            pairs = [[query, passage] for passage in passages]
            scores = model.predict(pairs, show_progress_bar=False)

            # Build results with original index tracking
            results: List[RerankResult] = []
            for idx, (passage, score) in enumerate(zip(passages, scores)):
                float_score = float(score)
                if float_score >= threshold:
                    results.append(
                        RerankResult(
                            text=passage,
                            score=float_score,
                            original_index=idx,
                        )
                    )

            # Sort by score descending
            results.sort(key=lambda r: r.score, reverse=True)

            # Optional top-k cutoff
            if top_k is not None:
                results = results[:top_k]

            logger.info(
                "Reranked %d passages → %d survived (threshold=%.2f)",
                len(passages),
                len(results),
                threshold,
            )
            return results

        except Exception as exc:
            logger.error("Reranking failed: %s", exc)
            raise RuntimeError(f"Reranker inference failed: {exc}") from exc

    async def rerank(
        self,
        query: str,
        passages: List[str],
        *,
        top_k: Optional[int] = None,
        score_threshold: Optional[float] = None,
    ) -> List[RerankResult]:
        """Async wrapper — runs reranking in a thread pool.

        Args:
            query:           The user question.
            passages:        Candidate passage texts.
            top_k:           Optional max number of results.
            score_threshold: Override instance-level threshold.

        Returns:
            List of ``RerankResult`` sorted by score descending.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.rerank_sync(
                query,
                passages,
                top_k=top_k,
                score_threshold=score_threshold,
            ),
        )


# ═══════════════════════════════════════════════════════════════════
# Singleton accessors
# ═══════════════════════════════════════════════════════════════════

_embedding_service: Optional[EmbeddingService] = None
_reranker_service: Optional[RerankerService] = None


def get_embedding_service(
    model_name: Optional[str] = None,
    device: Optional[str] = None,
) -> EmbeddingService:
    """Return the singleton EmbeddingService instance.

    On first call, creates and caches the service.  Subsequent calls
    return the same instance (model_name/device args are ignored after
    the first call).

    Args:
        model_name: Override model name (first call only).
        device:     Override device (first call only).
    """
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService(
            model_name=model_name or "BAAI/bge-m3",
            device=device,
        )
    return _embedding_service


def get_reranker_service(
    model_name: Optional[str] = None,
    score_threshold: Optional[float] = None,
    device: Optional[str] = None,
) -> RerankerService:
    """Return the singleton RerankerService instance.

    On first call, creates and caches the service.  Subsequent calls
    return the same instance.

    Args:
        model_name:      Override model name (first call only).
        score_threshold:  Override score threshold (first call only).
        device:           Override device (first call only).
    """
    global _reranker_service
    if _reranker_service is None:
        _reranker_service = RerankerService(
            model_name=model_name or "BAAI/bge-reranker-v2-m3",
            score_threshold=score_threshold if score_threshold is not None else 0.3,
            device=device,
        )
    return _reranker_service


def reset_services() -> None:
    """Reset singleton instances (used by tests to inject mocks)."""
    global _embedding_service, _reranker_service
    _embedding_service = None
    _reranker_service = None
