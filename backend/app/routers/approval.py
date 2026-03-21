"""
SUNDAE Backend — User Approval Router

Provides endpoints for Support/Admin to manage user approvals.
Approval sets is_approved=true AND auto-accepts pending org invitations
so invited users appear in the org's member list immediately.

Endpoints:
    GET    /api/admin/pending-users       → List unapproved users
    POST   /api/admin/approve/{user_id}   → Approve + auto-accept invitations
    POST   /api/admin/reject/{user_id}    → Reject (delete) user

SECURITY:
    All endpoints require support or admin role.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

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
    first_name: str | None = None
    last_name: str | None = None
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
            .select("id, email, first_name, last_name, role, is_approved, created_at")
            .eq("is_approved", False)
            .order("created_at", desc=True)
        ).execute()

        return [
            PendingUserResponse(
                id=u["id"],
                email=u.get("email", ""),
                first_name=u.get("first_name"),
                last_name=u.get("last_name"),
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
    """Approve a pending user.

    1. Sets is_approved=true
    2. Auto-accepts any pending org invitations for the user's email
       → creates org_members rows so user appears in org member list immediately
    """
    supabase = get_supabase()

    # 1. Fetch the pending user profile
    try:
        result = await (
            supabase.table("user_profiles")
            .select("id, email, is_approved, organization_id")
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
    except Exception as exc:
        logger.error("Failed to approve user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to approve user.")

    # 3. Auto-accept pending org invitations for this user's email
    user_email = (profile.get("email") or "").strip().lower()
    accepted_count = 0
    if user_email:
        try:
            inv_result = await (
                supabase.table("org_invitations")
                .select("id, organization_id")
                .eq("invited_email", user_email)
                .eq("status", "pending")
            ).execute()

            now_iso = datetime.now(timezone.utc).isoformat()
            first_org_id: str | None = None

            for inv in inv_result.data or []:
                org_id = inv["organization_id"]

                # Check not already a member (safety)
                existing = await (
                    supabase.table("org_members")
                    .select("id")
                    .eq("user_id", user_id)
                    .eq("organization_id", org_id)
                    .limit(1)
                ).execute()

                if not existing.data:
                    # Add to org_members as member
                    await (
                        supabase.table("org_members").insert({
                            "user_id": user_id,
                            "organization_id": org_id,
                            "org_role": "member",
                            "joined_at": now_iso,
                        })
                    ).execute()

                    if first_org_id is None:
                        first_org_id = org_id

                # Mark invitation accepted
                await (
                    supabase.table("org_invitations")
                    .update({"status": "accepted"})
                    .eq("id", inv["id"])
                ).execute()
                accepted_count += 1

            # Set user_profiles.organization_id to first accepted org (if not already set)
            if first_org_id and not profile.get("organization_id"):
                await (
                    supabase.table("user_profiles")
                    .update({"organization_id": first_org_id})
                    .eq("id", user_id)
                ).execute()

        except Exception as exc:
            # Non-fatal: user is approved, invitations just weren't auto-accepted
            logger.warning(
                "User %s approved but auto-accept invitations failed: %s",
                user_id, exc,
            )

    logger.info(
        "User approved: %s (by %s, auto-accepted %d invitations)",
        user_id, user.email, accepted_count,
    )

    return ApproveResponse(
        message="User approved successfully.",
        user_id=user_id,
    )


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
