"""
SUNDAE Backend — Authentication Dependencies

Provides FastAPI dependencies for JWT verification and authorization:
  - get_current_user:   Extracts + verifies Supabase JWT → returns UserProfile
  - require_approved:   Ensures user is approved (is_approved = true)
  - require_role:       Ensures user has one of the allowed roles

Usage in routers::

    @router.post("/upload")
    async def upload(user: UserProfile = Depends(require_approved)):
        ...

    @router.get("/admin-only")
    async def admin_view(user: UserProfile = Depends(require_role("admin"))):
        ...
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException, Request, status

from app.core.database import get_supabase

logger = logging.getLogger(__name__)


# ── User Model ───────────────────────────────────────────────────

@dataclass
class CurrentUser:
    """Represents the authenticated user extracted from the JWT + user_profiles."""

    id: str
    email: str
    role: str               # "user" | "support" | "admin"
    is_approved: bool
    organization_id: str | None
    full_name: str | None


# ── Core Dependency: Extract & Verify JWT ────────────────────────

async def get_current_user(request: Request) -> CurrentUser:
    """Extract the Bearer token from the request, verify it with Supabase,
    and fetch the user profile from user_profiles table.

    Raises:
        HTTPException 401: Missing or invalid token.
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

    # ── 3. Fetch profile from user_profiles ──────────────────────
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile not found. Contact your administrator.",
        )

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile not found. Contact your administrator.",
        )

    current_user = CurrentUser(
        id=profile["id"],
        email=profile.get("email") or auth_user.email or "",
        role=profile.get("role", "user"),
        is_approved=profile.get("is_approved", False),
        organization_id=profile.get("organization_id"),
        full_name=profile.get("full_name"),
    )

    logger.debug(
        "[Auth] Verified user: %s (role=%s, approved=%s)",
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
