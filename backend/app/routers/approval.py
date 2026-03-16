"""
SUNDAE Backend — User Approval Router

Provides endpoints for Support/Admin to manage user approvals.
Approval only sets is_approved=true — user creates their own org after.

Endpoints:
    GET    /api/admin/pending-users       → List unapproved users
    POST   /api/admin/approve/{user_id}   → Approve user
    POST   /api/admin/reject/{user_id}    → Reject (delete) user

SECURITY:
    All endpoints require support or admin role.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_role
from app.core.database import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["Admin"])


# ── Response Models ──────────────────────────────────────────────

class PendingUserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    role: str
    is_approved: bool
    created_at: str


class ApproveResponse(BaseModel):
    message: str
    user_id: str


class RejectResponse(BaseModel):
    message: str
    user_id: str


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/pending-users", response_model=list[PendingUserResponse])
async def list_pending_users(
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> list[PendingUserResponse]:
    """List all users pending approval."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("user_profiles")
            .select("id, email, full_name, role, is_approved, created_at")
            .eq("is_approved", False)
            .order("created_at", desc=True)
        ).execute()

        return [
            PendingUserResponse(
                id=u["id"],
                email=u.get("email", ""),
                full_name=u.get("full_name"),
                role=u.get("role", "user"),
                is_approved=u.get("is_approved", False),
                created_at=u.get("created_at", ""),
            )
            for u in (result.data or [])
        ]

    except Exception as exc:
        logger.error("Failed to list pending users: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list pending users.")


@router.post("/approve/{user_id}", response_model=ApproveResponse)
async def approve_user(
    user_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> ApproveResponse:
    """Approve a pending user. Sets is_approved=true only.
    User will create/join an org themselves after login."""
    supabase = get_supabase()

    # 1. Fetch the pending user profile
    try:
        result = await (
            supabase.table("user_profiles")
            .select("id, is_approved")
            .eq("id", user_id)
            .single()
        ).execute()
        profile = result.data
    except Exception:
        raise HTTPException(status_code=404, detail="User not found.")

    if not profile:
        raise HTTPException(status_code=404, detail="User not found.")

    if profile.get("is_approved"):
        raise HTTPException(status_code=400, detail="User is already approved.")

    # 2. Set is_approved = true
    try:
        await (
            supabase.table("user_profiles")
            .update({"is_approved": True})
            .eq("id", user_id)
        ).execute()

        logger.info("User approved: %s (by %s)", user_id, user.email)

        return ApproveResponse(
            message="User approved successfully.",
            user_id=user_id,
        )

    except Exception as exc:
        logger.error("Failed to approve user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to approve user.")


@router.post("/reject/{user_id}", response_model=RejectResponse)
async def reject_user(
    user_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> RejectResponse:
    """Reject a pending user by deleting their profile."""
    supabase = get_supabase()

    try:
        check = await (
            supabase.table("user_profiles")
            .select("id, is_approved")
            .eq("id", user_id)
            .single()
        ).execute()

        if not check.data:
            raise HTTPException(status_code=404, detail="User not found.")

        if check.data.get("is_approved"):
            raise HTTPException(status_code=400, detail="Cannot reject an already approved user.")

        await (
            supabase.table("user_profiles")
            .delete()
            .eq("id", user_id)
        ).execute()

        logger.info("User rejected: %s (by %s)", user_id, user.email)

        return RejectResponse(
            message="User rejected successfully.",
            user_id=user_id,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to reject user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to reject user.")
