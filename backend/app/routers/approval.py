"""
SUNDAE Backend — User Approval Router

Two approval flows:
  1. Platform Admin (support/admin role) — approve any pending user
  2. Org Admin — approve pending members in their own organization

Approval sets is_approved=true, records who approved (approved_by + approved_at),
and auto-accepts pending org invitations.

Endpoints:
    GET    /api/admin/pending-users              → List all unapproved users (Platform Admin)
    POST   /api/admin/approve/{user_id}          → Approve user (Platform Admin)
    POST   /api/admin/reject/{user_id}           → Reject (delete) user (Platform Admin)
    GET    /api/orgs/{org_id}/pending-members     → List pending members in org (Org Admin)
    POST   /api/orgs/{org_id}/approve/{user_id}  → Approve member in org (Org Admin)
    POST   /api/orgs/{org_id}/reject/{user_id}   → Reject member in org (Org Admin)
    GET    /api/orgs/{org_id}/pending-count       → Count pending members (for badge)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_profile_cache, require_role, require_org_admin, verify_organization
from app.core.database import get_supabase
from app.core.utils import validate_uuid_param

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Admin"])


# ── Response Models ──────────────────────────────────────────────

class PendingUserResponse(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None
    role: str
    is_approved: bool
    created_at: str


class ApproveResponse(BaseModel):
    message: str
    user_id: str


class RejectResponse(BaseModel):
    message: str
    user_id: str


class ApprovedUserResponse(BaseModel):
    id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None
    role: str
    is_approved: bool
    approved_by: str | None = None
    approved_by_email: str | None = None
    approved_at: str | None = None
    created_at: str


class PendingCountResponse(BaseModel):
    count: int


# ══════════════════════════════════════════════════════════════════
# Platform Admin Endpoints (support/admin role)
# ══════════════════════════════════════════════════════════════════

@router.get("/api/admin/pending-users", response_model=list[PendingUserResponse])
async def list_pending_users(
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> list[PendingUserResponse]:
    """List all users pending approval (Platform Admin only)."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("user_profiles")
            .select("id, email, first_name, last_name, avatar_url, role, is_approved, created_at")
            .eq("is_approved", False)
            .order("created_at", desc=True)
        ).execute()

        return [
            PendingUserResponse(
                id=u["id"],
                email=u.get("email", ""),
                first_name=u.get("first_name"),
                last_name=u.get("last_name"),
                avatar_url=u.get("avatar_url"),
                role=u.get("role", "user"),
                is_approved=u.get("is_approved", False),
                created_at=u.get("created_at", ""),
            )
            for u in (result.data or [])
        ]

    except Exception as exc:
        logger.error("Failed to list pending users: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list pending users.")


@router.get("/api/admin/approved-users", response_model=list[ApprovedUserResponse])
async def list_approved_users(
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> list[ApprovedUserResponse]:
    """List all approved users with approval history (Platform Admin only)."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("user_profiles")
            .select("id, email, first_name, last_name, avatar_url, role, is_approved, approved_by, approved_at, created_at")
            .eq("is_approved", True)
        ).execute()

        users = sorted(
            result.data or [],
            key=lambda u: u.get("approved_at") or "",
            reverse=True,
        )
        approver_ids = list({u["approved_by"] for u in users if u.get("approved_by")})

        email_map: dict[str, str] = {}
        if approver_ids:
            approvers = await (
                supabase.table("user_profiles")
                .select("id, email")
                .in_("id", approver_ids)
            ).execute()
            email_map = {a["id"]: a["email"] for a in (approvers.data or [])}

        return [
            ApprovedUserResponse(
                id=u["id"],
                email=u.get("email", ""),
                first_name=u.get("first_name"),
                last_name=u.get("last_name"),
                avatar_url=u.get("avatar_url"),
                role=u.get("role", "user"),
                is_approved=True,
                approved_by=u.get("approved_by"),
                approved_by_email=email_map.get(u.get("approved_by", ""), None),
                approved_at=u.get("approved_at"),
                created_at=u.get("created_at", ""),
            )
            for u in users
        ]

    except Exception as exc:
        logger.error("Failed to list approved users: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list approved users.")


@router.post("/api/admin/approve/{user_id}", response_model=ApproveResponse)
async def approve_user(
    user_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> ApproveResponse:
    """Approve a pending user (Platform Admin).

    1. Sets is_approved=true + records approved_by/approved_at
    2. Auto-accepts any pending org invitations for the user's email
    """
    validate_uuid_param(user_id, "user_id")
    supabase = get_supabase()

    profile = await _get_pending_profile(supabase, user_id)

    await _do_approve(supabase, user_id, user.id)
    accepted_count = await _auto_accept_invitations(supabase, user_id, profile)

    logger.info(
        "User approved: %s (by %s, auto-accepted %d invitations)",
        user_id, user.email, accepted_count,
    )

    return ApproveResponse(message="User approved successfully.", user_id=user_id)


@router.post("/api/admin/reject/{user_id}", response_model=RejectResponse)
async def reject_user(
    user_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> RejectResponse:
    """Reject a pending user by deleting their profile (Platform Admin)."""
    validate_uuid_param(user_id, "user_id")
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

        try:
            cache = await get_profile_cache()
            await cache.invalidate(user_id)
        except Exception as cache_exc:
            logger.warning("Failed to invalidate cache for rejected user %s: %s", user_id, cache_exc)

        logger.info("User rejected: %s (by %s)", user_id, user.email)

        return RejectResponse(message="User rejected successfully.", user_id=user_id)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to reject user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to reject user.")


# ══════════════════════════════════════════════════════════════════
# Org Admin Endpoints
# ══════════════════════════════════════════════════════════════════

@router.get("/api/orgs/{org_id}/pending-members", response_model=list[PendingUserResponse])
async def list_org_pending_members(
    org_id: str,
    user: CurrentUser = Depends(require_org_admin),
) -> list[PendingUserResponse]:
    """List pending (unapproved) members who have been invited to this org."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    try:
        inv_result = await (
            supabase.table("org_invitations")
            .select("invited_email")
            .eq("organization_id", org_id)
            .eq("status", "pending")
        ).execute()

        pending_emails = [inv["invited_email"] for inv in (inv_result.data or [])]
        if not pending_emails:
            return []

        profiles_result = await (
            supabase.table("user_profiles")
            .select("id, email, first_name, last_name, avatar_url, role, is_approved, created_at")
            .eq("is_approved", False)
            .in_("email", pending_emails)
        ).execute()

        return [
            PendingUserResponse(
                id=u["id"],
                email=u.get("email", ""),
                first_name=u.get("first_name"),
                last_name=u.get("last_name"),
                avatar_url=u.get("avatar_url"),
                role=u.get("role", "user"),
                is_approved=False,
                created_at=u.get("created_at", ""),
            )
            for u in (profiles_result.data or [])
        ]

    except Exception as exc:
        logger.error("Failed to list org pending members (org=%s): %s", org_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list pending members.")


@router.post("/api/orgs/{org_id}/approve/{user_id}", response_model=ApproveResponse)
async def org_approve_member(
    org_id: str,
    user_id: str,
    user: CurrentUser = Depends(require_org_admin),
) -> ApproveResponse:
    """Approve a pending member in this org (Org Admin only).

    Only works if the user has a pending invitation to this specific org.
    """
    validate_uuid_param(org_id, "org_id")
    validate_uuid_param(user_id, "user_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    profile = await _get_pending_profile(supabase, user_id)

    # Verify user has a pending invitation to THIS org (cross-org protection)
    user_email = (profile.get("email") or "").strip().lower()
    try:
        inv_check = await (
            supabase.table("org_invitations")
            .select("id")
            .eq("organization_id", org_id)
            .eq("invited_email", user_email)
            .eq("status", "pending")
            .limit(1)
        ).execute()
    except Exception:
        inv_check = type("R", (), {"data": []})()

    if not inv_check.data:
        raise HTTPException(
            status_code=403,
            detail="User does not have a pending invitation to this organization.",
        )

    await _do_approve(supabase, user_id, user.id)
    accepted_count = await _auto_accept_invitations(supabase, user_id, profile)

    logger.info(
        "Org member approved: %s in org %s (by %s, auto-accepted %d invitations)",
        user_id, org_id, user.email, accepted_count,
    )

    return ApproveResponse(message="Member approved successfully.", user_id=user_id)


@router.post("/api/orgs/{org_id}/reject/{user_id}", response_model=RejectResponse)
async def org_reject_member(
    org_id: str,
    user_id: str,
    user: CurrentUser = Depends(require_org_admin),
) -> RejectResponse:
    """Reject a pending member's invitation to this org (Org Admin only).

    Revokes the invitation only — does NOT delete the user profile.
    """
    validate_uuid_param(org_id, "org_id")
    validate_uuid_param(user_id, "user_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    try:
        profile = await (
            supabase.table("user_profiles")
            .select("id, email")
            .eq("id", user_id)
            .single()
        ).execute()
    except Exception:
        raise HTTPException(status_code=404, detail="User not found.")

    if not profile.data:
        raise HTTPException(status_code=404, detail="User not found.")

    user_email = (profile.data.get("email") or "").strip().lower()

    try:
        result = await (
            supabase.table("org_invitations")
            .update({"status": "revoked"})
            .eq("organization_id", org_id)
            .eq("invited_email", user_email)
            .eq("status", "pending")
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="No pending invitation found for this user.")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to reject org member %s (org=%s): %s", user_id, org_id, exc)
        raise HTTPException(status_code=500, detail="Failed to reject member.")

    logger.info("Org member rejected: %s in org %s (by %s)", user_id, org_id, user.email)

    return RejectResponse(message="Invitation revoked.", user_id=user_id)


@router.get("/api/orgs/{org_id}/pending-count", response_model=PendingCountResponse)
async def org_pending_count(
    org_id: str,
    user: CurrentUser = Depends(require_org_admin),
) -> PendingCountResponse:
    """Return count of pending members in this org (for notification badge)."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    try:
        inv_result = await (
            supabase.table("org_invitations")
            .select("invited_email")
            .eq("organization_id", org_id)
            .eq("status", "pending")
        ).execute()

        pending_emails = [inv["invited_email"] for inv in (inv_result.data or [])]
        if not pending_emails:
            return PendingCountResponse(count=0)

        profiles_result = await (
            supabase.table("user_profiles")
            .select("id")
            .eq("is_approved", False)
            .in_("email", pending_emails)
        ).execute()

        return PendingCountResponse(count=len(profiles_result.data or []))

    except Exception as exc:
        logger.error("Failed to count pending members (org=%s): %s", org_id, exc)
        return PendingCountResponse(count=0)


# ══════════════════════════════════════════════════════════════════
# Shared Helpers
# ══════════════════════════════════════════════════════════════════

async def _get_pending_profile(supabase, user_id: str) -> dict:
    """Fetch a user profile and verify it's pending approval."""
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

    return profile


async def _do_approve(supabase, user_id: str, approved_by_id: str) -> None:
    """Set is_approved=true + record approved_by/approved_at."""
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        await (
            supabase.table("user_profiles")
            .update({
                "is_approved": True,
                "approved_by": approved_by_id,
                "approved_at": now_iso,
            })
            .eq("id", user_id)
        ).execute()
    except Exception as exc:
        logger.error("Failed to approve user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Failed to approve user.")

    try:
        cache = await get_profile_cache()
        await cache.invalidate(user_id)
    except Exception as cache_exc:
        logger.warning("Failed to invalidate cache for user %s: %s", user_id, cache_exc)


async def _auto_accept_invitations(supabase, user_id: str, profile: dict) -> int:
    """Auto-accept pending org invitations for the approved user."""
    user_email = (profile.get("email") or "").strip().lower()
    accepted_count = 0

    if not user_email:
        return 0

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

            existing = await (
                supabase.table("org_members")
                .select("user_id")
                .eq("user_id", user_id)
                .eq("organization_id", org_id)
                .limit(1)
            ).execute()

            if not existing.data:
                admin_check = await (
                    supabase.table("org_members")
                    .select("user_id")
                    .eq("organization_id", org_id)
                    .eq("org_role", "admin")
                    .limit(1)
                ).execute()
                assigned_role = "admin" if not admin_check.data else "member"

                await (
                    supabase.table("org_members").upsert(
                        {
                            "user_id": user_id,
                            "organization_id": org_id,
                            "org_role": assigned_role,
                            "joined_at": now_iso,
                        },
                        on_conflict="user_id,organization_id",
                        ignore_duplicates=True,
                    )
                ).execute()

                if first_org_id is None:
                    first_org_id = org_id

            await (
                supabase.table("org_invitations")
                .update({"status": "accepted"})
                .eq("id", inv["id"])
            ).execute()
            accepted_count += 1

        if first_org_id and not profile.get("organization_id"):
            await (
                supabase.table("user_profiles")
                .update({"organization_id": first_org_id})
                .eq("id", user_id)
            ).execute()

    except Exception as exc:
        logger.warning(
            "User %s approved but auto-accept invitations failed: %s",
            user_id, exc,
        )

    return accepted_count
