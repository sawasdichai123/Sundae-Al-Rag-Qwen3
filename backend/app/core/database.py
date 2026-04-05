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

import asyncio
import logging
from typing import Optional

from supabase import acreate_client, AsyncClient

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# ── Module-level singleton ───────────────────────────────────────
_client: Optional[AsyncClient] = None


async def init_supabase() -> AsyncClient:
    """Initialise the async Supabase client (call once at startup).

    Retries up to 3 times with exponential backoff (1s → 2s → 4s) on failure.

    Returns:
        The initialised ``AsyncClient`` instance.
    """
    global _client
    if _client is not None:
        logger.warning("Supabase client already initialised — skipping.")
        return _client

    s = get_settings()
    max_retries = 3

    for attempt in range(max_retries):
        try:
            _client = await asyncio.wait_for(
                acreate_client(
                    supabase_url=s.supabase_url,
                    supabase_key=s.supabase_service_role_key,
                ),
                timeout=10,
            )
            logger.info("Supabase async client initialised (URL: %s)", s.supabase_url)
            return _client
        except Exception as exc:
            if attempt < max_retries - 1:
                wait = 2 ** attempt  # 1s, 2s, 4s
                logger.warning(
                    "Supabase init failed (attempt %d/%d): %s — retrying in %ds",
                    attempt + 1, max_retries, exc, wait,
                )
                await asyncio.sleep(wait)
            else:
                raise RuntimeError(
                    f"Supabase async client failed after {max_retries} attempts. "
                    f"Last error: {exc}. Check connectivity to: {s.supabase_url}"
                ) from exc

    raise RuntimeError("Supabase init failed unexpectedly.")


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
