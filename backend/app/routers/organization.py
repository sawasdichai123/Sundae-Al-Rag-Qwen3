"""
SUNDAE Backend — Organization Router

Full CRUD for organizations, member management, and invitations.

Endpoints:
    POST   /api/orgs                              → Create org (user = owner)
    GET    /api/orgs                              → List user's orgs
    GET    /api/orgs/{org_id}                     → Org details
    PUT    /api/orgs/{org_id}                     → Edit org (owner)
    POST   /api/orgs/{org_id}/request-deletion    → Request deletion
    POST   /api/orgs/{org_id}/confirm-deletion    → Confirm deletion
    GET    /api/orgs/{org_id}/members             → List members
    POST   /api/orgs/{org_id}/invite              → Invite by email
    DELETE /api/orgs/{org_id}/members/{user_id}   → Remove member
    GET    /api/orgs/invitations                  → My pending invitations
    POST   /api/orgs/invitations/{inv_id}/accept  → Accept invitation

SECURITY:
    Write ops require org owner role (via org_members).
    Read ops require org membership (via verify_organization).
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.auth import (
    CurrentUser,
    require_approved,
    require_role,
    require_org_owner,
    verify_organization,
)
from app.core.database import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/orgs", tags=["Organizations"])


# ── Request / Response Models ────────────────────────────────────

class CreateOrgRequest(BaseModel):
    name: str


class UpdateOrgRequest(BaseModel):
    name: str | None = None


class InviteRequest(BaseModel):
    email: str


class OrgResponse(BaseModel):
    id: str
    name: str
    slug: str | None = None
    status: str | None = None
    created_at: str


class OrgListItem(BaseModel):
    id: str
    name: str
    slug: str | None = None
    org_role: str
    created_at: str


class OrgMemberResponse(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None
    org_role: str
    joined_at: str | None = None


class InvitationResponse(BaseModel):
    id: str
    organization_id: str
    invited_email: str
    invited_by: str | None = None
    status: str
    created_at: str


class MyInvitationResponse(BaseModel):
    id: str
    organization_id: str
    org_name: str
    invited_email: str
    status: str
    created_at: str


class MessageResponse(BaseModel):
    message: str


# ── Helpers ──────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Convert org name to a URL-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\u0E00-\u0E7F]+", "-", slug)
    slug = slug.strip("-")
    return slug or "org"


# ── Org CRUD ─────────────────────────────────────────────────────

@router.post("", response_model=OrgResponse)
async def create_org(
    body: CreateOrgRequest,
    user: CurrentUser = Depends(require_approved),
):
    """Create a new organization. Any approved user can create; the creator becomes the owner."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Organization name is required.")

    supabase = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    slug = _slugify(name)

    # Make slug unique by appending timestamp suffix if needed
    slug_check = await (
        supabase.table("organizations").select("id").eq("slug", slug).limit(1)
    ).execute()
    if slug_check.data:
        slug = f"{slug}-{int(datetime.now(timezone.utc).timestamp())}"

    # 1. Create organization
    try:
        org_result = await (
            supabase.table("organizations").insert({
                "name": name,
                "slug": slug,
                "created_at": now_iso,
            })
        ).execute()
    except Exception as exc:
        logger.error("Org create failed (insert organizations): %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to create organization: {exc}")

    org_error = getattr(org_result, "error", None)
    if org_error:
        # org_error can be an Exception-like or dict-like depending on supabase-py version
        logger.error("Org create failed (organizations error): %s", org_error)
        raise HTTPException(status_code=500, detail=f"Failed to create organization: {org_error}")

    if not org_result.data:
        raise HTTPException(status_code=500, detail="Failed to create organization.")

    org = org_result.data[0]
    org_id = org["id"]

    # 2. Add creator as owner in org_members
    try:
        member_result = await (
            supabase.table("org_members").insert({
                "user_id": user.id,
                "organization_id": org_id,
                "org_role": "owner",
                "joined_at": now_iso,
            })
        ).execute()
    except Exception as exc:
        logger.error("Org create failed (insert org_members): %s", exc)
        # Best-effort cleanup to avoid orphan organizations
        try:
            await supabase.table("organizations").delete().eq("id", org_id).execute()
        except Exception:
            pass
        msg = str(exc)
        if "org_members" in msg and ("does not exist" in msg or "relation" in msg):
            raise HTTPException(
                status_code=500,
                detail="Database migration missing: org_members table not found. Run backend/sql/011_multi_tenant_migration.sql on Supabase.",
            )
        raise HTTPException(status_code=500, detail=f"Failed to create organization membership: {exc}")

    member_error = getattr(member_result, "error", None)
    if member_error:
        logger.error("Org create failed (org_members error): %s", member_error)
        # Best-effort cleanup to avoid orphan organizations
        try:
            await supabase.table("organizations").delete().eq("id", org_id).execute()
        except Exception:
            pass
        msg = str(member_error)
        if "org_members" in msg and ("does not exist" in msg or "relation" in msg):
            raise HTTPException(
                status_code=500,
                detail="Database migration missing: org_members table not found. Run backend/sql/011_multi_tenant_migration.sql on Supabase.",
            )
        raise HTTPException(status_code=500, detail=f"Failed to create organization membership: {member_error}")

    # 3. Update user_profiles.organization_id (backward compat, first org)
    if not user.organization_id:
        try:
            await (
                supabase.table("user_profiles")
                .update({"organization_id": org_id})
                .eq("id", user.id)
            ).execute()
        except Exception as exc:
            logger.warning("Org created but failed to update user_profiles.organization_id (user=%s, org=%s): %s", user.id, org_id, exc)

    logger.info("Org created: %s by user %s", org_id, user.email)

    return OrgResponse(
        id=org_id,
        name=org["name"],
        slug=org.get("slug"),
        status=org.get("status"),
        created_at=org.get("created_at", now_iso),
    )


@router.get("", response_model=list[OrgListItem])
async def list_orgs(
    user: CurrentUser = Depends(require_approved),
):
    """List all organizations the user belongs to."""
    supabase = get_supabase()

    result = await (
        supabase.table("org_members")
        .select("organization_id, org_role, joined_at, organizations(id, name, slug, created_at)")
        .eq("user_id", user.id)
    ).execute()

    items: list[OrgListItem] = []
    for row in result.data or []:
        org = row.get("organizations")
        if not org:
            continue
        items.append(OrgListItem(
            id=org["id"],
            name=org["name"],
            slug=org.get("slug"),
            org_role=row["org_role"],
            created_at=org.get("created_at", ""),
        ))

    return items


@router.get("/invitations", response_model=list[MyInvitationResponse])
async def my_invitations(
    user: CurrentUser = Depends(require_approved),
):
    """List pending invitations for the current user."""
    supabase = get_supabase()

    result = await (
        supabase.table("org_invitations")
        .select("id, organization_id, invited_email, status, created_at, organizations(name)")
        .eq("invited_email", user.email)
        .eq("status", "pending")
    ).execute()

    items: list[MyInvitationResponse] = []
    for row in result.data or []:
        org = row.get("organizations") or {}
        items.append(MyInvitationResponse(
            id=row["id"],
            organization_id=row["organization_id"],
            org_name=org.get("name", ""),
            invited_email=row["invited_email"],
            status=row["status"],
            created_at=row.get("created_at", ""),
        ))

    return items


@router.post("/invitations/{inv_id}/accept", response_model=MessageResponse)
async def accept_invitation(
    inv_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Accept a pending invitation — adds user to org as member."""
    supabase = get_supabase()

    # 1. Fetch invitation
    inv_result = await (
        supabase.table("org_invitations")
        .select("*")
        .eq("id", inv_id)
        .eq("invited_email", user.email)
        .eq("status", "pending")
        .limit(1)
    ).execute()

    if not inv_result.data:
        raise HTTPException(404, "Invitation not found or already used.")

    inv = inv_result.data[0]
    org_id = inv["organization_id"]
    now_iso = datetime.now(timezone.utc).isoformat()

    # 2. Check not already a member
    existing = await (
        supabase.table("org_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()
    if existing.data:
        # Already a member — just mark invitation accepted
        await (
            supabase.table("org_invitations")
            .update({"status": "accepted"})
            .eq("id", inv_id)
        ).execute()
        return MessageResponse(message="You are already a member of this organization.")

    # 3. Add to org_members
    await (
        supabase.table("org_members").insert({
            "user_id": user.id,
            "organization_id": org_id,
            "org_role": "member",
            "joined_at": now_iso,
        })
    ).execute()

    # 4. Mark invitation accepted
    await (
        supabase.table("org_invitations")
        .update({"status": "accepted"})
        .eq("id", inv_id)
    ).execute()

    # 5. Update user_profiles.organization_id if null (first org)
    if not user.organization_id:
        await (
            supabase.table("user_profiles")
            .update({"organization_id": org_id})
            .eq("id", user.id)
        ).execute()

    logger.info("User %s accepted invitation to org %s", user.email, org_id)
    return MessageResponse(message="Invitation accepted. You are now a member.")


@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Get organization details."""
    await verify_organization(user, org_id)

    supabase = get_supabase()
    result = await (
        supabase.table("organizations")
        .select("*")
        .eq("id", org_id)
        .single()
    ).execute()

    if not result.data:
        raise HTTPException(404, "Organization not found.")

    org = result.data
    return OrgResponse(
        id=org["id"],
        name=org["name"],
        slug=org.get("slug"),
        status=org.get("status"),
        created_at=org.get("created_at", ""),
    )


@router.put("/{org_id}", response_model=OrgResponse)
async def update_org(
    org_id: str,
    body: UpdateOrgRequest,
    user: CurrentUser = Depends(require_org_owner),
):
    """Update organization name. Owner only."""
    await verify_organization(user, org_id)

    updates: dict = {}
    if body.name and body.name.strip():
        updates["name"] = body.name.strip()
        updates["slug"] = _slugify(body.name.strip())

    if not updates:
        raise HTTPException(400, "No fields to update.")

    supabase = get_supabase()
    result = await (
        supabase.table("organizations")
        .update(updates)
        .eq("id", org_id)
    ).execute()

    if not result.data:
        raise HTTPException(500, "Failed to update organization.")

    org = result.data[0]
    return OrgResponse(
        id=org["id"],
        name=org["name"],
        slug=org.get("slug"),
        status=org.get("status"),
        created_at=org.get("created_at", ""),
    )


# ── Deletion Flow ────────────────────────────────────────────────

@router.post("/{org_id}/request-deletion", response_model=MessageResponse)
async def request_deletion(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Request org deletion. Owner requests; support/admin confirms."""
    await verify_organization(user, org_id)

    supabase = get_supabase()
    # Policy: only the org owner can request deletion.
    # support/admin accounts cannot request deletion to reduce blast radius.
    if user.role in ("support", "admin"):
        raise HTTPException(403, "Only org owner can request deletion.")

    member = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()
    if not member.data or member.data[0].get("org_role") != "owner":
        raise HTTPException(403, "Only org owner can request deletion.")

    await (
        supabase.table("organizations")
        .update({
            "status": "pending_deletion",
            "deletion_requested_by": user.id,
        })
        .eq("id", org_id)
    ).execute()

    return MessageResponse(message="Deletion requested. Waiting for confirmation.")


@router.post("/{org_id}/confirm-deletion", response_model=MessageResponse)
async def confirm_deletion(
    org_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
):
    """Confirm org deletion. support/admin only."""
    supabase = get_supabase()

    # Fetch org
    org_result = await (
        supabase.table("organizations")
        .select("status, deletion_requested_by")
        .eq("id", org_id)
        .single()
    ).execute()

    if not org_result.data:
        raise HTTPException(404, "Organization not found.")

    org = org_result.data
    if org.get("status") != "pending_deletion":
        raise HTTPException(400, "Organization is not pending deletion.")

    requester = org.get("deletion_requested_by")
    if requester == user.id:
        raise HTTPException(400, "Cannot confirm your own deletion request. Another party must confirm.")

    # Soft delete: set status to 'deleted'
    await (
        supabase.table("organizations")
        .update({"status": "deleted"})
        .eq("id", org_id)
    ).execute()

    # Clean up org_members
    await (
        supabase.table("org_members")
        .delete()
        .eq("organization_id", org_id)
    ).execute()

    logger.info("Org %s deleted, confirmed by %s", org_id, user.email)
    return MessageResponse(message="Organization deleted successfully.")


# ── Members ──────────────────────────────────────────────────────

@router.get("/{org_id}/members", response_model=list[OrgMemberResponse])
async def list_members(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """List members of an organization."""
    await verify_organization(user, org_id)

    supabase = get_supabase()

    # Fetch members (no FK join — org_members.user_id references auth.users, not user_profiles)
    result = await (
        supabase.table("org_members")
        .select("user_id, org_role, joined_at")
        .eq("organization_id", org_id)
    ).execute()

    if not result.data:
        return []

    # Fetch profiles for all member user_ids
    user_ids = [row["user_id"] for row in result.data]
    profiles_result = await (
        supabase.table("user_profiles")
        .select("id, email, full_name")
        .in_("id", user_ids)
    ).execute()

    # Build lookup map
    profile_map = {p["id"]: p for p in (profiles_result.data or [])}

    members: list[OrgMemberResponse] = []
    for row in result.data:
        profile = profile_map.get(row["user_id"], {})
        members.append(OrgMemberResponse(
            user_id=row["user_id"],
            email=profile.get("email", ""),
            full_name=profile.get("full_name"),
            org_role=row["org_role"],
            joined_at=row.get("joined_at"),
        ))

    return members


@router.post("/{org_id}/invite", response_model=InvitationResponse)
async def invite_member(
    org_id: str,
    body: InviteRequest,
    user: CurrentUser = Depends(require_org_owner),
):
    """Invite a user to the organization by email. Owner only."""
    await verify_organization(user, org_id)

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email is required.")

    supabase = get_supabase()

    # Check not already a member
    existing_member = await (
        supabase.table("org_members")
        .select("user_id")
        .eq("organization_id", org_id)
    ).execute()

    if existing_member.data:
        member_ids = [m["user_id"] for m in existing_member.data]
        profiles_check = await (
            supabase.table("user_profiles")
            .select("id, email")
            .in_("id", member_ids)
        ).execute()
        for p in profiles_check.data or []:
            if (p.get("email") or "").lower() == email:
                raise HTTPException(400, f"{email} is already a member of this organization.")

    # Check not already invited (pending)
    existing_inv = await (
        supabase.table("org_invitations")
        .select("id")
        .eq("organization_id", org_id)
        .eq("invited_email", email)
        .eq("status", "pending")
        .limit(1)
    ).execute()
    if existing_inv.data:
        raise HTTPException(400, f"A pending invitation for {email} already exists.")

    # Create invitation
    now_iso = datetime.now(timezone.utc).isoformat()
    inv_result = await (
        supabase.table("org_invitations").insert({
            "organization_id": org_id,
            "invited_email": email,
            "invited_by": user.id,
            "status": "pending",
            "created_at": now_iso,
        })
    ).execute()

    if not inv_result.data:
        raise HTTPException(500, "Failed to create invitation.")

    inv = inv_result.data[0]
    return InvitationResponse(
        id=inv["id"],
        organization_id=inv["organization_id"],
        invited_email=inv["invited_email"],
        invited_by=inv.get("invited_by"),
        status=inv["status"],
        created_at=inv.get("created_at", now_iso),
    )


@router.delete("/{org_id}/members/{member_user_id}", response_model=MessageResponse)
async def remove_member(
    org_id: str,
    member_user_id: str,
    user: CurrentUser = Depends(require_org_owner),
):
    """Remove a member from the organization. Owner only.
    Cannot remove yourself if you are the only owner."""
    await verify_organization(user, org_id)

    if member_user_id == user.id:
        raise HTTPException(400, "Cannot remove yourself. Transfer ownership first.")

    supabase = get_supabase()
    result = await (
        supabase.table("org_members")
        .delete()
        .eq("user_id", member_user_id)
        .eq("organization_id", org_id)
    ).execute()

    if not result.data:
        raise HTTPException(404, "Member not found in this organization.")

    logger.info("Removed user %s from org %s by %s", member_user_id, org_id, user.email)
    return MessageResponse(message="Member removed successfully.")
