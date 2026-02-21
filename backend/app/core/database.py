"""
SUNDAE Backend — Async Supabase Client Manager

Provides a singleton async Supabase client initialised during FastAPI lifespan.
All database operations flow through this client.

SECURITY NOTE:
    This client uses the **Service Role Key** which BYPASSES Row Level Security.
    Every query function MUST explicitly filter by ``organization_id`` to prevent
    cross-tenant data access. This constraint is enforced architecturally by
    making ``organization_id`` a required parameter in all service functions.
"""

from __future__ import annotations

import logging
from typing import Optional

from supabase import acreate_client, AsyncClient

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# ── Module-level singleton ───────────────────────────────────────
_client: Optional[AsyncClient] = None


async def init_supabase() -> AsyncClient:
    """Initialise the async Supabase client (call once at startup).

    Returns:
        The initialised ``AsyncClient`` instance.
    """
    global _client
    if _client is not None:
        logger.warning("Supabase client already initialised — skipping.")
        return _client

    s = get_settings()
    _client = await acreate_client(
        supabase_url=s.supabase_url,
        supabase_key=s.supabase_service_role_key,
    )
    logger.info("Supabase async client initialised (URL: %s)", s.supabase_url)
    return _client


async def close_supabase() -> None:
    """Clean up the Supabase client (call on shutdown)."""
    global _client
    if _client is not None:
        # supabase-py AsyncClient wraps httpx.AsyncClient under the hood
        # Closing the underlying HTTP session prevents resource leaks.
        try:
            await _client.auth.close()
        except Exception:
            pass  # Best-effort cleanup
        _client = None
        logger.info("Supabase async client closed.")


def get_supabase() -> AsyncClient:
    """Return the initialised Supabase client.

    Raises:
        RuntimeError: If called before ``init_supabase()``.

    Usage in FastAPI dependency injection::

        @router.get("/example")
        async def example(db: AsyncClient = Depends(get_supabase)):
            ...
    """
    if _client is None:
        raise RuntimeError(
            "Supabase client not initialised. "
            "Ensure init_supabase() is called during app startup."
        )
    return _client
