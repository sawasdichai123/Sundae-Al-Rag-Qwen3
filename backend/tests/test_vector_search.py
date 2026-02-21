"""
Unit tests for the Vector Search Service.

Uses mocked Supabase client to test the retrieval pipeline logic
without requiring a live database connection.
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.vector_search import (
    search_child_chunks,
    fetch_parent_chunks,
    search_parent_chunks,
    MatchedChildChunk,
    RetrievedParentChunk,
)


# ── Fixtures ─────────────────────────────────────────────────────

FAKE_ORG_ID = "org-001-test"
FAKE_EMBEDDING = [0.1] * 1024  # 1024-dim dummy vector


def _make_child_row(
    child_id: str,
    parent_id: str,
    doc_id: str = "doc-001",
    chunk_index: int = 0,
    similarity: float = 0.95,
) -> dict:
    """Create a fake child chunk row as returned by the RPC function."""
    return {
        "id": child_id,
        "parent_id": parent_id,
        "document_id": doc_id,
        "chunk_index": chunk_index,
        "text": f"Child text for {child_id}",
        "similarity": similarity,
    }


def _make_parent_row(
    parent_id: str,
    doc_id: str = "doc-001",
    chunk_index: int = 0,
) -> dict:
    """Create a fake parent chunk row."""
    return {
        "id": parent_id,
        "document_id": doc_id,
        "chunk_index": chunk_index,
        "text": f"Full parent context for {parent_id}",
    }


def _mock_supabase_rpc(response_data: list) -> MagicMock:
    """Create a mock Supabase client whose .rpc().execute() returns data.

    The Supabase async client pattern is:
        query = client.rpc("name", params)   # sync — returns query builder
        response = await query.execute()     # async — executes the query
    """
    mock_client = MagicMock()

    mock_response = MagicMock()
    mock_response.data = response_data

    # .rpc() returns a query builder (sync MagicMock)
    # .execute() on that builder is async
    mock_query_builder = MagicMock()
    mock_query_builder.execute = AsyncMock(return_value=mock_response)

    mock_client.rpc.return_value = mock_query_builder

    return mock_client


def _mock_supabase_table(response_data: list) -> MagicMock:
    """Create a mock Supabase client whose .table().select()...execute() works.

    Chain: client.table("x").select("...").in_("id", [...]).eq("org", "...").execute()
    All sync except .execute() which is async.
    """
    mock_client = MagicMock()

    mock_response = MagicMock()
    mock_response.data = response_data

    # Build the chain bottom-up: .eq() → has .execute()
    mock_eq = MagicMock()
    mock_eq.execute = AsyncMock(return_value=mock_response)

    mock_in = MagicMock()
    mock_in.eq.return_value = mock_eq

    mock_select = MagicMock()
    mock_select.in_.return_value = mock_in

    mock_table = MagicMock()
    mock_table.select.return_value = mock_select

    mock_client.table.return_value = mock_table

    return mock_client


def _mock_supabase_full(child_rows: list, parent_rows: list) -> MagicMock:
    """Create a mock that handles BOTH rpc() and table() calls."""
    mock_client = MagicMock()

    # ── RPC mock (for search_child_chunks) ───────────────────────
    rpc_response = MagicMock()
    rpc_response.data = child_rows

    rpc_builder = MagicMock()
    rpc_builder.execute = AsyncMock(return_value=rpc_response)
    mock_client.rpc.return_value = rpc_builder

    # ── Table mock (for fetch_parent_chunks) ─────────────────────
    table_response = MagicMock()
    table_response.data = parent_rows

    eq_mock = MagicMock()
    eq_mock.execute = AsyncMock(return_value=table_response)
    in_mock = MagicMock()
    in_mock.eq.return_value = eq_mock
    select_mock = MagicMock()
    select_mock.in_.return_value = in_mock
    table_mock = MagicMock()
    table_mock.select.return_value = select_mock
    mock_client.table.return_value = table_mock

    return mock_client


# ═══════════════════════════════════════════════════════════════════
# Tests for search_child_chunks
# ═══════════════════════════════════════════════════════════════════


class TestSearchChildChunks:
    """Tests for the vector similarity search on child chunks."""

    @pytest.mark.asyncio
    async def test_rpc_called_with_correct_params(self):
        """Verify that the RPC is called with embedding, org_id, and top_k."""
        mock_client = _mock_supabase_rpc([])

        await search_child_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            top_k=10,
            supabase=mock_client,
        )

        mock_client.rpc.assert_called_once_with(
            "match_child_chunks",
            {
                "query_embedding": FAKE_EMBEDDING,
                "target_org_id": FAKE_ORG_ID,
                "match_count": 10,
            },
        )

    @pytest.mark.asyncio
    async def test_returns_matched_children(self):
        """Verify that RPC response rows are parsed into MatchedChildChunk."""
        rows = [
            _make_child_row("c1", "p1", similarity=0.95),
            _make_child_row("c2", "p1", similarity=0.88),
            _make_child_row("c3", "p2", similarity=0.72),
        ]
        mock_client = _mock_supabase_rpc(rows)

        results = await search_child_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        assert len(results) == 3
        assert all(isinstance(r, MatchedChildChunk) for r in results)
        assert results[0].id == "c1"
        assert results[0].similarity == 0.95

    @pytest.mark.asyncio
    async def test_empty_results(self):
        """Verify graceful handling of zero matches."""
        mock_client = _mock_supabase_rpc([])

        results = await search_child_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        assert results == []

    @pytest.mark.asyncio
    async def test_org_id_is_always_passed(self):
        """Verify organization_id is ALWAYS sent to the RPC — security check."""
        mock_client = _mock_supabase_rpc([])

        await search_child_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        call_args = mock_client.rpc.call_args
        rpc_params = call_args[0][1]  # Second positional arg
        assert "target_org_id" in rpc_params
        assert rpc_params["target_org_id"] == FAKE_ORG_ID


# ═══════════════════════════════════════════════════════════════════
# Tests for fetch_parent_chunks
# ═══════════════════════════════════════════════════════════════════


class TestFetchParentChunks:
    """Tests for fetching parent chunk records."""

    @pytest.mark.asyncio
    async def test_fetches_with_org_filter(self):
        """Verify that the table query filters by both parent_ids AND org_id."""
        parent_rows = [_make_parent_row("p1"), _make_parent_row("p2")]
        mock_client = _mock_supabase_table(parent_rows)

        await fetch_parent_chunks(
            parent_ids=["p1", "p2"],
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        # Verify the chained calls
        mock_client.table.assert_called_once_with("document_parent_chunks")
        table_mock = mock_client.table.return_value
        table_mock.select.assert_called_once_with("id, document_id, chunk_index, text")
        select_mock = table_mock.select.return_value
        select_mock.in_.assert_called_once_with("id", ["p1", "p2"])
        in_mock = select_mock.in_.return_value
        in_mock.eq.assert_called_once_with("organization_id", FAKE_ORG_ID)

    @pytest.mark.asyncio
    async def test_returns_dict_keyed_by_id(self):
        """Verify result is a dict mapping parent_id → row."""
        parent_rows = [_make_parent_row("p1"), _make_parent_row("p2")]
        mock_client = _mock_supabase_table(parent_rows)

        result = await fetch_parent_chunks(
            parent_ids=["p1", "p2"],
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        assert "p1" in result
        assert "p2" in result
        assert result["p1"]["text"] == "Full parent context for p1"

    @pytest.mark.asyncio
    async def test_empty_parent_ids(self):
        """Empty parent_ids should return empty dict without calling DB."""
        mock_client = MagicMock()

        result = await fetch_parent_chunks(
            parent_ids=[],
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        assert result == {}
        mock_client.table.assert_not_called()


# ═══════════════════════════════════════════════════════════════════
# Tests for search_parent_chunks (full pipeline)
# ═══════════════════════════════════════════════════════════════════


class TestSearchParentChunks:
    """Tests for the full Parent-Child retrieval pipeline."""

    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        """End-to-end test: child search → parent mapping → aggregation."""
        child_rows = [
            _make_child_row("c1", "p1", similarity=0.95),
            _make_child_row("c2", "p1", similarity=0.88),
            _make_child_row("c3", "p2", similarity=0.72),
        ]
        parent_rows = [_make_parent_row("p1"), _make_parent_row("p2")]

        mock_client = _mock_supabase_full(child_rows, parent_rows)

        results = await search_parent_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        # Should return 2 parents (p1 and p2)
        assert len(results) == 2
        assert all(isinstance(r, RetrievedParentChunk) for r in results)

        # Results should be sorted by best_child_similarity descending
        assert results[0].best_child_similarity >= results[1].best_child_similarity

        # p1 should have 2 children (c1 + c2), p2 should have 1 child (c3)
        p1 = next(r for r in results if r.id == "p1")
        p2 = next(r for r in results if r.id == "p2")
        assert len(p1.matched_children) == 2
        assert len(p2.matched_children) == 1
        assert p1.best_child_similarity == 0.95
        assert p2.best_child_similarity == 0.72

    @pytest.mark.asyncio
    async def test_no_results(self):
        """Pipeline should return empty list when vector search finds nothing."""
        mock_client = _mock_supabase_rpc([])

        results = await search_parent_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        assert results == []

    @pytest.mark.asyncio
    async def test_missing_parent_skipped(self):
        """If a parent chunk is not found (wrong org), it should be skipped."""
        child_rows = [
            _make_child_row("c1", "p1", similarity=0.95),
            _make_child_row("c2", "p-missing", similarity=0.80),
        ]
        # Only p1 exists; p-missing is not returned (e.g. different org)
        parent_rows = [_make_parent_row("p1")]

        mock_client = _mock_supabase_full(child_rows, parent_rows)

        results = await search_parent_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id=FAKE_ORG_ID,
            supabase=mock_client,
        )

        # Only p1 should be returned; p-missing should be silently skipped
        assert len(results) == 1
        assert results[0].id == "p1"


# ═══════════════════════════════════════════════════════════════════
# Tests for organization_id enforcement
# ═══════════════════════════════════════════════════════════════════


class TestOrgIsolation:
    """Verify that organization_id is always passed in every DB call."""

    @pytest.mark.asyncio
    async def test_search_sends_org_to_rpc(self):
        """The RPC call MUST include target_org_id."""
        mock_client = _mock_supabase_rpc([])

        await search_child_chunks(
            query_embedding=FAKE_EMBEDDING,
            organization_id="specific-org-123",
            supabase=mock_client,
        )

        rpc_params = mock_client.rpc.call_args[0][1]
        assert rpc_params["target_org_id"] == "specific-org-123"

    @pytest.mark.asyncio
    async def test_fetch_parents_filters_by_org(self):
        """Parent fetch MUST filter by organization_id even with valid IDs."""
        mock_client = _mock_supabase_table([_make_parent_row("p1")])

        await fetch_parent_chunks(
            parent_ids=["p1"],
            organization_id="specific-org-456",
            supabase=mock_client,
        )

        # Verify .eq("organization_id", ...) was called
        table_mock = mock_client.table.return_value
        select_mock = table_mock.select.return_value
        in_mock = select_mock.in_.return_value
        in_mock.eq.assert_called_once_with("organization_id", "specific-org-456")
