"""
Vector Search Service — Parent-Child Retrieval Pipeline

Implements the core retrieval logic for the SUNDAE RAG pipeline:
  1. Vector search on ``document_child_chunks`` via Supabase RPC
  2. Deduplicate → extract unique ``parent_id``s
  3. Fetch full parent chunk text from ``document_parent_chunks``
  4. Return structured results ready for reranking

SECURITY:
    Every function requires ``organization_id`` as a mandatory parameter.
    This is the primary multi-tenant isolation mechanism since the backend
    uses the Supabase Service Role Key (which bypasses RLS).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

from supabase import AsyncClient

from app.core.database import get_supabase

logger = logging.getLogger(__name__)


# ── Data structures ──────────────────────────────────────────────


@dataclass
class MatchedChildChunk:
    """A child chunk returned from the vector similarity search."""

    id: str
    parent_id: str
    document_id: str
    chunk_index: int
    text: str
    similarity: float


@dataclass
class RetrievedParentChunk:
    """A parent chunk with its retrieval metadata."""

    id: str
    document_id: str
    chunk_index: int
    text: str
    # The best similarity score among the child chunks that mapped to this parent
    best_child_similarity: float
    # All child chunks that pointed to this parent
    matched_children: List[MatchedChildChunk] = field(default_factory=list)


# ── Vector search pipeline ───────────────────────────────────────


async def search_child_chunks(
    query_embedding: List[float],
    organization_id: str,
    *,
    bot_id: Optional[str] = None,
    top_k: int = 20,
    supabase: Optional[AsyncClient] = None,
) -> List[MatchedChildChunk]:
    """Execute vector similarity search on child chunks.

    Calls the ``match_child_chunks`` PostgreSQL RPC function which:
    - Uses the HNSW index for fast approximate cosine search
    - Filters by ``organization_id`` (mandatory)
    - Optionally filters by ``bot_id`` (only returns chunks from that bot's documents)
    - Returns the top-K most similar child chunks

    Args:
        query_embedding:  The query vector (1024 dimensions for bge-m3).
        organization_id:  Tenant ID — **required** for data isolation.
        bot_id:           Optional bot ID — filters to only that bot's documents.
        top_k:            Number of results to return (default 20).
        supabase:         Optional client override (for testing).

    Returns:
        List of ``MatchedChildChunk`` sorted by similarity (descending).
    """
    client = supabase or get_supabase()

    rpc_params: dict = {
        "query_embedding": query_embedding,
        "target_org_id": organization_id,
        "match_count": top_k,
    }
    if bot_id:
        rpc_params["target_bot_id"] = bot_id

    query = client.rpc("match_child_chunks", rpc_params)
    response = await query.execute()

    if not response.data:
        logger.info(
            "Vector search returned 0 results for org=%s", organization_id
        )
        return []

    return [
        MatchedChildChunk(
            id=row["id"],
            parent_id=row["parent_id"],
            document_id=row["document_id"],
            chunk_index=row["chunk_index"],
            text=row["text"],
            similarity=row["similarity"],
        )
        for row in response.data
    ]


async def fetch_parent_chunks(
    parent_ids: List[str],
    organization_id: str,
    *,
    supabase: Optional[AsyncClient] = None,
) -> dict[str, dict]:
    """Fetch full parent chunk records by ID, filtered by organization.

    Args:
        parent_ids:       List of parent chunk UUIDs to fetch.
        organization_id:  Tenant ID — **required** for data isolation.
        supabase:         Optional client override (for testing).

    Returns:
        Dict mapping ``parent_id → row dict``.
    """
    if not parent_ids:
        return {}

    client = supabase or get_supabase()

    # CRITICAL: Even though we filter by parent_ids, we ALSO filter by
    # organization_id to prevent any possibility of cross-tenant access
    # (e.g. if a child chunk's parent_id was somehow corrupted).
    query = (
        client.table("document_parent_chunks")
        .select("id, document_id, chunk_index, text")
        .in_("id", parent_ids)
        .eq("organization_id", organization_id)
    )
    response = await query.execute()

    return {row["id"]: row for row in (response.data or [])}


async def search_parent_chunks(
    query_embedding: List[float],
    organization_id: str,
    *,
    bot_id: Optional[str] = None,
    top_k: int = 20,
    supabase: Optional[AsyncClient] = None,
) -> List[RetrievedParentChunk]:
    """Full Parent-Child retrieval pipeline.

    1. Vector search on child chunks → Top-K children (filtered by bot_id)
    2. Extract unique parent_ids from matched children
    3. Fetch full parent chunk text (with org_id filter)
    4. Aggregate children under their parents, keep best similarity score

    Args:
        query_embedding:  The query vector (1024-dim).
        organization_id:  Tenant ID — **required** for data isolation.
        bot_id:           Optional bot ID — only search that bot's documents.
        top_k:            Number of child chunks to retrieve (default 20).
        supabase:         Optional client override (for testing).

    Returns:
        List of ``RetrievedParentChunk`` sorted by best_child_similarity
        (descending). Ready for reranking.
    """
    # Step 1 — Vector search on child chunks
    matched_children = await search_child_chunks(
        query_embedding=query_embedding,
        organization_id=organization_id,
        bot_id=bot_id,
        top_k=top_k,
        supabase=supabase,
    )

    if not matched_children:
        return []

    # Step 2 — Extract unique parent_ids
    parent_ids = list({child.parent_id for child in matched_children})

    logger.info(
        "Matched %d children → %d unique parents (org=%s)",
        len(matched_children),
        len(parent_ids),
        organization_id,
    )

    # Step 3 — Fetch parent chunk full text
    parent_map = await fetch_parent_chunks(
        parent_ids=parent_ids,
        organization_id=organization_id,
        supabase=supabase,
    )

    # Step 4 — Aggregate: group children under their parents
    parent_children: dict[str, List[MatchedChildChunk]] = {}
    for child in matched_children:
        parent_children.setdefault(child.parent_id, []).append(child)

    results: List[RetrievedParentChunk] = []
    for parent_id, children in parent_children.items():
        parent_row = parent_map.get(parent_id)
        if parent_row is None:
            # Parent not found or belongs to a different org — skip silently
            logger.warning(
                "Parent chunk %s not found for org=%s — skipping",
                parent_id,
                organization_id,
            )
            continue

        best_score = max(c.similarity for c in children)
        results.append(
            RetrievedParentChunk(
                id=parent_row["id"],
                document_id=parent_row["document_id"],
                chunk_index=parent_row["chunk_index"],
                text=parent_row["text"],
                best_child_similarity=best_score,
                matched_children=sorted(
                    children, key=lambda c: c.similarity, reverse=True
                ),
            )
        )

    # Sort by best child similarity (descending)
    results.sort(key=lambda r: r.best_child_similarity, reverse=True)

    return results


# ── Chunk storage ────────────────────────────────────────────────


async def store_parent_chunks(
    parent_chunks: list[dict],
    organization_id: str,
    *,
    supabase: Optional[AsyncClient] = None,
) -> None:
    """Insert parent chunks into ``document_parent_chunks``.

    Args:
        parent_chunks:    List of dicts with keys: id, document_id, chunk_index, text.
        organization_id:  Tenant ID — **required**.
        supabase:         Optional client override (for testing).
    """
    if not parent_chunks:
        return

    client = supabase or get_supabase()

    rows = [
        {
            "id": chunk["id"],
            "document_id": chunk["document_id"],
            "organization_id": organization_id,
            "chunk_index": chunk["chunk_index"],
            "text": chunk["text"],
        }
        for chunk in parent_chunks
    ]

    query = client.table("document_parent_chunks").insert(rows)
    await query.execute()
    logger.info("Inserted %d parent chunks (org=%s)", len(rows), organization_id)


async def store_child_chunks(
    child_chunks: list[dict],
    organization_id: str,
    *,
    supabase: Optional[AsyncClient] = None,
) -> None:
    """Insert child chunks with embeddings into ``document_child_chunks``.

    Args:
        child_chunks:     List of dicts with keys: id, parent_id, document_id,
                          chunk_index, text, embedding.
        organization_id:  Tenant ID — **required**.
        supabase:         Optional client override (for testing).
    """
    if not child_chunks:
        return

    client = supabase or get_supabase()

    rows = [
        {
            "id": chunk["id"],
            "parent_id": chunk["parent_id"],
            "document_id": chunk["document_id"],
            "organization_id": organization_id,
            "chunk_index": chunk["chunk_index"],
            "text": chunk["text"],
            "embedding": chunk["embedding"],
        }
        for chunk in child_chunks
    ]

    query = client.table("document_child_chunks").insert(rows)
    await query.execute()
    logger.info("Inserted %d child chunks (org=%s)", len(rows), organization_id)
