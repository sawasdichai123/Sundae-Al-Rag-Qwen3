"""
SUNDAE Backend — Authentication Dependencies (Optimized)

Performance optimizations applied:
  - JWT verification via supabase.auth.get_user() (handles any algorithm)
  - In-memory profile cache with TTL (default 5 minutes)
  - 1 network call on cache hit (auth verify), 2 on cache miss (+DB fetch)

Provides FastAPI dependencies:
  - get_current_user:   Decodes JWT locally + cached profile → CurrentUser
  - require_approved:   Ensures user.is_approved == True
  - require_role:       Ensures user has one of the allowed roles

Usage in routers::

    @router.post("/upload")
    async def upload(user: CurrentUser = Depends(require_approved)):
        ...

    @router.get("/admin-only")
    async def admin_view(user: CurrentUser = Depends(require_role("admin"))):
        ...
"""

from __future__ import annotations

import dataclasses
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status

from app.core.database import get_supabase

logger = logging.getLogger(__name__)


# ── User Model ───────────────────────────────────────────────────

@dataclass
class CurrentUser:
    """Represents the authenticated user extracted from JWT + user_profiles."""

    id: str
    email: str
    role: str               # "user" | "support" | "admin"
    is_approved: bool
    organization_id: str | None   # DEPRECATED — use org_members table
    first_name: str | None
    last_name: str | None
    avatar_url: str | None = None
    active_org_id: str | None = None  # from X-Active-Org header


# ── Profile Cache ────────────────────────────────────────────────
#
# Two implementations:
#   _InMemoryCache  — per-process dict, suitable for single-worker / dev
#   _RedisCache     — Redis-backed, suitable for multi-worker production
#
# Selected at first use based on REDIS_URL setting.
# Both expose the same async interface so the rest of the code is identical.

@dataclass
class _CacheEntry:
    user: CurrentUser
    expires_at: float


class _InMemoryCache:
    """Per-process TTL cache. Not shared across uvicorn workers."""

    def __init__(self, ttl: int = 300):
        self._ttl = ttl
        self._store: dict[str, _CacheEntry] = {}

    async def get(self, user_id: str) -> CurrentUser | None:
        entry = self._store.get(user_id)
        if entry is None:
            return None
        if time.monotonic() > entry.expires_at:
            del self._store[user_id]
            return None
        return entry.user

    async def set(self, user_id: str, user: CurrentUser) -> None:
        self._store[user_id] = _CacheEntry(
            user=user,
            expires_at=time.monotonic() + self._ttl,
        )

    async def invalidate(self, user_id: str) -> None:
        self._store.pop(user_id, None)

    async def clear(self) -> None:
        self._store.clear()


class _RedisCache:
    """Redis-backed distributed cache. Shared across all uvicorn workers."""

    _PREFIX = "sundae:auth:"

    def __init__(self, client: Any, ttl: int = 300):
        self._r = client
        self._ttl = ttl

    async def get(self, user_id: str) -> CurrentUser | None:
        try:
            raw = await self._r.get(f"{self._PREFIX}{user_id}")
            if raw is None:
                return None
            return CurrentUser(**json.loads(raw))
        except Exception as exc:
            logger.warning("[Cache] Redis get error: %s", exc)
            return None

    async def set(self, user_id: str, user: CurrentUser) -> None:
        try:
            await self._r.setex(
                f"{self._PREFIX}{user_id}",
                self._ttl,
                json.dumps(dataclasses.asdict(user)),
            )
        except Exception as exc:
            logger.warning("[Cache] Redis set error: %s", exc)

    async def invalidate(self, user_id: str) -> None:
        try:
            await self._r.delete(f"{self._PREFIX}{user_id}")
        except Exception as exc:
            logger.warning("[Cache] Redis invalidate error: %s", exc)

    async def clear(self) -> None:
        try:
            keys = await self._r.keys(f"{self._PREFIX}*")
            if keys:
                await self._r.delete(*keys)
        except Exception as exc:
            logger.warning("[Cache] Redis clear error: %s", exc)


# Lazy singleton — initialized on first request
_cache: _InMemoryCache | _RedisCache | None = None


async def _get_cache() -> _InMemoryCache | _RedisCache:
    """Return the cache singleton, initializing it on first call.

    Tries Redis if REDIS_URL is configured; falls back to in-memory on failure.
    """
    global _cache
    if _cache is not None:
        return _cache

    from app.core.config import get_settings
    settings = get_settings()

    if settings.redis_url:
        try:
            import redis.asyncio as aioredis  # type: ignore[import]
            client = aioredis.from_url(settings.redis_url, decode_responses=True)
            await client.ping()
            _cache = _RedisCache(client, settings.cache_ttl_seconds)
            logger.info("[Cache] Redis cache active at %s", settings.redis_url)
        except Exception as exc:
            logger.warning(
                "[Cache] Redis unavailable (%s) — falling back to in-memory cache. "
                "Not suitable for multi-worker deployments.",
                exc,
            )
            _cache = _InMemoryCache(settings.cache_ttl_seconds)
    else:
        _cache = _InMemoryCache(settings.cache_ttl_seconds)
        logger.debug(
            "[Cache] Using in-memory cache (set REDIS_URL for multi-worker support)."
        )

    return _cache


async def get_profile_cache() -> _InMemoryCache | _RedisCache:
    """Return the active cache instance (useful for testing/invalidation)."""
    return await _get_cache()


# ── Core Dependency: Local JWT Decode + Cached Profile ───────────

async def get_current_user(request: Request) -> CurrentUser:
    """Extract Bearer token, decode JWT locally, fetch profile (with cache).

    Performance:
      - Cache hit:  ~1ms (0 network calls)
      - Cache miss: ~50-100ms (1 DB call)
      - Old version: ~200-400ms (2 network calls EVERY request)

    Raises:
        HTTPException 401: Missing, invalid, or expired token.
        HTTPException 403: User profile not found.
    """
    # ── 1. Extract Bearer token ──────────────────────────────────
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_header.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── 2. Verify JWT with Supabase Auth ─────────────────────────
    # Uses supabase.auth.get_user() which handles any JWT algorithm
    # (HS256, ES256, etc.) — more robust than local jwt.decode().
    supabase = get_supabase()
    try:
        user_response = await supabase.auth.get_user(token)
        auth_user = user_response.user
    except Exception as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if auth_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = auth_user.id

    # ── 3. Check cache first ─────────────────────────────────────
    cache = await _get_cache()
    cached = await cache.get(user_id)
    if cached is not None:
        logger.debug("[Auth] Cache HIT for %s", cached.email)
        # Always re-read X-Active-Org from current request — never use the
        # cached value, because the user may switch orgs between requests
        # without invalidating the cache (cache only stores auth profile).
        active_org_header = request.headers.get("X-Active-Org")
        cached.active_org_id = active_org_header or None
        return cached

    # ── 4. Cache miss → fetch from DB ────────────────────────────
    try:
        result = await (
            supabase.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
        ).execute()
        profile = result.data
    except Exception as exc:
        logger.error("Failed to fetch user profile for %s: %s", user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify user profile. Please try again later.",
        )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile not found. Contact your administrator.",
        )

    # Read active org from X-Active-Org header (multi-org support)
    # Note: profile.organization_id is a legacy single-org field; do not fall back to it
    # as it is null for users who joined via invitation. Frontend always sends X-Active-Org.
    active_org_header = request.headers.get("X-Active-Org")
    active_org_id = active_org_header or None

    current_user = CurrentUser(
        id=profile["id"],
        email=profile.get("email") or auth_user.email or "",
        role=profile.get("role", "user"),
        is_approved=profile.get("is_approved", False),
        organization_id=profile.get("organization_id"),
        first_name=profile.get("first_name"),
        last_name=profile.get("last_name"),
        avatar_url=profile.get("avatar_url"),
        active_org_id=active_org_id,
    )

    # ── 5. Store in cache ────────────────────────────────────────
    await cache.set(user_id, current_user)

    logger.debug(
        "[Auth] Cache MISS → loaded %s (role=%s, approved=%s)",
        current_user.email,
        current_user.role,
        current_user.is_approved,
    )

    return current_user


# ── Authorization Dependencies ───────────────────────────────────

async def require_approved(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Ensure the authenticated user is approved.

    Raises:
        HTTPException 403: User is not approved.
    """
    if not user.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending approval. Contact Support.",
        )
    return user


def require_role(*allowed_roles: str) -> Callable:
    """Factory that returns a dependency requiring the user to have one of
    the specified roles AND be approved.

    Usage::

        @router.get("/admin")
        async def admin_endpoint(user = Depends(require_role("admin"))):
            ...

        @router.get("/support-or-admin")
        async def support_endpoint(user = Depends(require_role("support", "admin"))):
            ...
    """

    async def _check_role(
        user: CurrentUser = Depends(require_approved),
    ) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {', '.join(allowed_roles)}.",
            )
        return user

    return _check_role


async def require_platform_admin(
    user: CurrentUser = Depends(require_approved),
) -> CurrentUser:
    """Ensure the user has platform-level admin or support role.

    Use this for endpoints that don't require org membership but need
    elevated platform privileges (e.g. org overview, create org, approve user).

    Usage::

        @router.get("/orgs/{org_id}/overview")
        async def org_overview(user = Depends(require_platform_admin)):
            ...
    """
    if user.role not in ("support", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin/support role required.",
        )
    return user


async def require_org_admin(
    user: CurrentUser = Depends(require_approved),
) -> CurrentUser:
    """Ensure the user is an Org Admin of their active org (via org_members table).

    No platform-level bypass — user must actually be an org admin.

    IMPORTANT: For endpoints that accept org_id as a path parameter,
    use verify_org_admin(user, org_id) instead — this dependency only
    checks against active_org_id from the header.

    Usage::

        @router.post("/bots")
        async def create_bot(user = Depends(require_org_admin)):
            ...
    """
    if not user.active_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active organization selected.",
        )

    supabase = get_supabase()
    result = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", user.active_org_id)
        .limit(1)
    ).execute()

    if not result.data or result.data[0].get("org_role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Org Admin role required.",
        )

    return user


async def verify_org_admin(user: CurrentUser, organization_id: str) -> None:
    """Verify the user is an Org Admin of the SPECIFIC org (not just active org).

    Use this in endpoints that accept org_id as a path parameter to prevent
    bypass via X-Active-Org header mismatch.

    No platform-level bypass — user must actually be an org admin.

    Raises:
        HTTPException 403: User is not an Org Admin of this org.
    """
    supabase = get_supabase()
    result = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .limit(1)
    ).execute()

    if not result.data or result.data[0].get("org_role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Org Admin role required.",
        )


async def verify_session_access(
    user: CurrentUser,
    session_id: str,
    organization_id: str,
) -> None:
    """Verify the user can access a specific chat session.

    Access is granted if:
      - The user is an Org Admin (can view all sessions in their org), OR
      - The user owns the session (platform_user_id == user.id).

    Platform support/admin has NO bypass — they must be org members.
    This prevents regular members from reading/writing other users' sessions.

    Raises:
        HTTPException 404: Session not found (or not in this org).
        HTTPException 403: User does not have access to this session.
    """
    from app.core.database import get_supabase
    supabase = get_supabase()

    # Check if user is Org Admin — admins can access all sessions in their org
    admin_result = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .limit(1)
    ).execute()

    if admin_result.data and admin_result.data[0].get("org_role") == "admin":
        return  # Org Admin can access any session in their org

    # Regular member — check session ownership
    result = await (
        supabase.table("chat_sessions")
        .select("platform_user_id")
        .eq("id", session_id)
        .eq("organization_id", organization_id)
        .limit(1)
    ).execute()

    if not result.data:
        # Session doesn't exist yet (new chat) — allow; it will be created
        return

    session_owner = result.data[0].get("platform_user_id")
    if session_owner and session_owner != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You do not own this session.",
        )


async def verify_organization(user: CurrentUser, organization_id: str) -> None:
    """Verify the authenticated user belongs to the given organization
    via the org_members table (many-to-many), AND the org is active.

    No platform-level bypass — ALL users (including support/admin) must be
    org members to access org-specific data. This enforces data confidentiality.

    This is the primary multi-tenant isolation check. Every endpoint that
    accepts organization_id MUST call this before proceeding.

    Raises:
        HTTPException 403: User does not belong to the organization.
        HTTPException 404: Organization not found or deleted.
    """
    supabase = get_supabase()

    # Always check org status — even admin/support cannot operate on deleted orgs
    org_result = await (
        supabase.table("organizations")
        .select("status")
        .eq("id", organization_id)
        .limit(1)
    ).execute()

    if not org_result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found.",
        )

    org_status = org_result.data[0].get("status", "active")
    if org_status == "deleted":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization has been deleted.",
        )

    # ALL users must be org members — no platform-level bypass
    result = await (
        supabase.table("org_members")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .limit(1)
    ).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You do not belong to this organization.",
        )
