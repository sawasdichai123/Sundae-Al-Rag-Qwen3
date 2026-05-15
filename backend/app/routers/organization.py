"""
SUNDAE Backend — Organization Router

Full CRUD for organizations, member management, and invitations.

Endpoints:
    POST   /api/orgs                              → Create org (support/admin only)
    GET    /api/orgs                              → List user's orgs
    GET    /api/orgs/{org_id}                     → Org details
    PUT    /api/orgs/{org_id}                     → Edit org (Org Admin)
    PUT    /api/orgs/{org_id}/logo               → Upload org logo (Org Admin)
    POST   /api/orgs/{org_id}/request-deletion    → Request deletion
    POST   /api/orgs/{org_id}/confirm-deletion    → Confirm deletion
    POST   /api/orgs/{org_id}/leave               → Leave org (admin cannot leave if last admin)
    POST   /api/orgs/{org_id}/members/{user_id}/promote  → Promote member to Org Admin
    POST   /api/orgs/{org_id}/members/{user_id}/demote   → Demote Org Admin to member
    GET    /api/orgs/{org_id}/overview             → Org stats (platform admin/support only)
    POST   /api/orgs/{org_id}/cancel-deletion     → Cancel pending deletion
    GET    /api/orgs/{org_id}/members             → List members
    POST   /api/orgs/{org_id}/invite              → Invite by email
    DELETE /api/orgs/{org_id}/members/{user_id}   → Remove member
    GET    /api/orgs/invitations                  → My pending invitations
    POST   /api/orgs/invitations/{inv_id}/accept  → Accept invitation
    POST   /api/orgs/invitations/{inv_id}/decline → Decline invitation

SECURITY:
    Org creation restricted to support/admin roles.
    Write ops require Org Admin role (via org_members).
    Read ops require org membership (via verify_organization).
"""

from __future__ import annotations

import logging
import random
import re
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel

from app.core.utils import validate_uuid_param, encrypt_secret, decrypt_secret
from app.services.email_service import send_invitation_email
from app.core.auth import (
    CurrentUser,
    require_approved,
    require_platform_admin,
    require_role,
    require_org_admin,
    verify_org_admin,
    verify_organization,
)
from app.core.database import get_supabase
from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Email regex: no leading/trailing dots, no consecutive dots, max 254 chars
EMAIL_RE = re.compile(r'^(?!.*\.\.)(?![.])(?!.*[.]@)[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')

router = APIRouter(prefix="/api/orgs", tags=["Organizations"])


# ── Request / Response Models ────────────────────────────────────

class CreateOrgRequest(BaseModel):
    name: str


class UpdateOrgRequest(BaseModel):
    name: str | None = None


class InviteRequest(BaseModel):
    email: str
    confirm_approve: bool = False


class OrgResponse(BaseModel):
    id: str
    name: str
    slug: str | None = None
    status: str | None = None
    logo_url: str | None = None
    created_at: str


class OrgListItem(BaseModel):
    id: str
    name: str
    slug: str | None = None
    logo_url: str | None = None
    org_role: str
    created_at: str
    is_member: bool = True


class OrgMemberResponse(BaseModel):
    user_id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    avatar_url: str | None = None
    role: str | None = None  # platform role (admin/support/user)
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
    org_logo_url: str | None = None
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
    user: CurrentUser = Depends(require_role("support", "admin")),
):
    """Create a new organization. Support/Admin only.

    The creator (support/admin) is NOT added as Org Admin.
    The first invited user who accepts becomes the first Org Admin.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Organization name is required.")

    supabase = get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    slug = _slugify(name)

    # 1. Create organization — rely on DB UNIQUE constraint instead of pre-check
    # to eliminate slug collision race condition. Retry once with random suffix on duplicate.
    org_result = None
    for attempt in range(2):
        insert_slug = slug if attempt == 0 else f"{slug}-{''.join(random.choices(string.ascii_lowercase, k=6))}"
        try:
            org_result = await (
                supabase.table("organizations").insert({
                    "name": name,
                    "slug": insert_slug,
                    "created_at": now_iso,
                })
            ).execute()
            slug = insert_slug
            break
        except Exception as exc:
            err_str = str(exc).lower()
            if attempt == 0 and ("duplicate" in err_str or "unique" in err_str or "23505" in err_str):
                logger.warning("Slug '%s' collision — retrying with random suffix", slug)
                continue
            logger.error("Org create failed (insert organizations): %s", exc)
            raise HTTPException(status_code=500, detail="Failed to create organization.")

    if org_result is None:
        raise HTTPException(status_code=500, detail="Failed to create organization after retry.")

    org_error = getattr(org_result, "error", None)
    if org_error:
        # org_error can be an Exception-like or dict-like depending on supabase-py version
        logger.error("Org create failed (organizations error): %s", org_error)
        raise HTTPException(status_code=500, detail=f"Failed to create organization: {org_error}")

    if not org_result.data:
        raise HTTPException(status_code=500, detail="Failed to create organization.")

    org = org_result.data[0]
    org_id = org["id"]

    # NOTE: Support/Admin creator is NOT added as org_members admin.
    # The first invited user who accepts the invitation becomes Org Admin.

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
    """List organizations visible to the current user.

    Platform admin/support see ALL active orgs (for OrgSwitcher management).
    The ``is_member`` flag distinguishes real membership from view-only access.
    Regular users see only orgs they belong to.
    """
    supabase = get_supabase()

    if user.role in ("support", "admin"):
        all_orgs_result = await (
            supabase.table("organizations")
            .select("id, name, slug, logo_url, created_at")
            .neq("status", "deleted")
            .order("created_at", desc=False)
        ).execute()

        member_result = await (
            supabase.table("org_members")
            .select("organization_id, org_role")
            .eq("user_id", user.id)
        ).execute()
        member_roles: dict[str, str] = {
            row["organization_id"]: row["org_role"]
            for row in (member_result.data or [])
        }

        items: list[OrgListItem] = []
        for org in all_orgs_result.data or []:
            oid = org["id"]
            actual_role = member_roles.get(oid)
            items.append(OrgListItem(
                id=oid,
                name=org["name"],
                slug=org.get("slug"),
                logo_url=org.get("logo_url"),
                org_role=actual_role or "member",
                created_at=org.get("created_at", ""),
                is_member=actual_role is not None,
            ))
        return items

    result = await (
        supabase.table("org_members")
        .select("organization_id, org_role, joined_at, organizations(id, name, slug, logo_url, created_at)")
        .eq("user_id", user.id)
    ).execute()

    items = []
    for row in result.data or []:
        org = row.get("organizations")
        if not org:
            continue
        items.append(OrgListItem(
            id=org["id"],
            name=org["name"],
            slug=org.get("slug"),
            logo_url=org.get("logo_url"),
            org_role=row["org_role"],
            created_at=org.get("created_at", ""),
        ))

    return items


@router.get("/{org_id}/overview")
async def get_org_overview(
    org_id: str,
    user: CurrentUser = Depends(require_platform_admin),
):
    """Get organization overview stats. Platform support/admin only.

    Returns high-level stats without exposing confidential data.
    """
    validate_uuid_param(org_id, "org_id")
    supabase = get_supabase()

    # Verify org exists
    org_result = await (
        supabase.table("organizations")
        .select("name, status")
        .eq("id", org_id)
        .limit(1)
    ).execute()

    if not org_result.data:
        raise HTTPException(404, "Organization not found.")

    org = org_result.data[0]
    if org.get("status") == "deleted":
        raise HTTPException(404, "Organization has been deleted.")

    # Call the RPC function for stats
    result = await supabase.rpc("get_org_overview", {"target_org_id": org_id}).execute()

    stats = result.data if result.data else {}
    return {
        "org_name": org["name"],
        "org_status": org.get("status", "active"),
        **stats,
    }


@router.get("/invitations", response_model=list[MyInvitationResponse])
async def my_invitations(
    user: CurrentUser = Depends(require_approved),
):
    """List pending invitations for the current user.

    Invitations older than 30 days are automatically expired (marked revoked).
    """
    supabase = get_supabase()

    result = await (
        supabase.table("org_invitations")
        .select("id, organization_id, invited_email, status, created_at, organizations(name, logo_url)")
        .eq("invited_email", user.email)
        .eq("status", "pending")
    ).execute()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    items: list[MyInvitationResponse] = []
    expired_ids: list[str] = []

    for row in result.data or []:
        # Auto-expire invitations older than 30 days
        if row.get("created_at", "") < cutoff:
            expired_ids.append(row["id"])
            continue

        org = row.get("organizations") or {}
        items.append(MyInvitationResponse(
            id=row["id"],
            organization_id=row["organization_id"],
            org_name=org.get("name", ""),
            org_logo_url=org.get("logo_url"),
            invited_email=row["invited_email"],
            status=row["status"],
            created_at=row.get("created_at", ""),
        ))

    # Bulk-expire old invitations in the background
    if expired_ids:
        try:
            await (
                supabase.table("org_invitations")
                .update({"status": "revoked"})
                .in_("id", expired_ids)
            ).execute()
            logger.info("Auto-expired %d old invitations", len(expired_ids))
        except Exception as exc:
            logger.warning("Failed to auto-expire invitations: %s", exc)

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

    # 2. Check invitation not expired (30 days)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    if inv.get("created_at", "") < cutoff:
        await (
            supabase.table("org_invitations")
            .update({"status": "revoked"})
            .eq("id", inv_id)
        ).execute()
        raise HTTPException(400, "This invitation has expired (over 30 days). Please request a new invitation.")

    # 3. Check not already a member
    existing = await (
        supabase.table("org_members")
        .select("user_id")
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

    # 3. Determine role: first member becomes Org Admin, others become member.
    # Rule applies to ALL users including platform admin/support —
    # if no admin exists yet, the accepting user becomes Org Admin.
    admin_check = await (
        supabase.table("org_members")
        .select("user_id")
        .eq("organization_id", org_id)
        .eq("org_role", "admin")
        .limit(1)
    ).execute()
    assigned_role = "admin" if not admin_check.data else "member"

    # Use upsert + ignore_duplicates to prevent duplicate inserts from concurrent accepts
    await (
        supabase.table("org_members").upsert(
            {
                "user_id": user.id,
                "organization_id": org_id,
                "org_role": assigned_role,
                "joined_at": now_iso,
            },
            on_conflict="user_id,organization_id",
            ignore_duplicates=True,
        )
    ).execute()

    logger.info(
        "User %s joined org %s as %s (via invitation %s)",
        user.email, org_id, assigned_role, inv_id,
    )

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


@router.post("/invitations/{inv_id}/decline", response_model=MessageResponse)
async def decline_invitation(
    inv_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Decline a pending invitation."""
    supabase = get_supabase()

    # Fetch invitation — must match user's email and be pending
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

    # Mark as revoked
    await (
        supabase.table("org_invitations")
        .update({"status": "revoked"})
        .eq("id", inv_id)
    ).execute()

    logger.info("User %s declined invitation %s", user.email, inv_id)
    return MessageResponse(message="Invitation declined.")


@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Get organization details.

    Platform support/admin can read any org's basic info (name, status)
    without being a member — needed for DangerZone confirm/cancel deletion.
    Regular users must be org members (verify_organization).
    """
    validate_uuid_param(org_id, "org_id")
    if user.role not in ("support", "admin"):
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
        logo_url=org.get("logo_url"),
        created_at=org.get("created_at", ""),
    )


@router.put("/{org_id}", response_model=OrgResponse)
async def update_org(
    org_id: str,
    body: UpdateOrgRequest,
    user: CurrentUser = Depends(require_approved),
):
    """Update organization name. Org Admin only."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    updates: dict = {}
    if body.name and body.name.strip():
        updates["name"] = body.name.strip()
        updates["slug"] = _slugify(body.name.strip())

    if not updates:
        raise HTTPException(400, "No fields to update.")

    supabase = get_supabase()

    # Retry once on slug duplicate (same pattern as create_org)
    base_slug = updates.get("slug", "")
    for attempt in range(2):
        if attempt == 1 and base_slug:
            updates["slug"] = f"{base_slug}-{''.join(random.choices(string.ascii_lowercase, k=6))}"
        try:
            result = await (
                supabase.table("organizations")
                .update(updates)
                .eq("id", org_id)
            ).execute()
            break
        except Exception as exc:
            err_str = str(exc).lower()
            if attempt == 0 and ("duplicate" in err_str or "unique" in err_str or "23505" in err_str):
                logger.warning("Slug '%s' collision on update — retrying with suffix", base_slug)
                continue
            logger.error("Org update failed: %s", exc)
            raise HTTPException(500, "Failed to update organization.")

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


# ── Org Logo Upload ──────────────────────────────────────────────

_LOGO_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
_LOGO_MAX_SIZE = 2 * 1024 * 1024  # 2MB
_LOGO_MAGIC = {
    "jpg":  (b"\xff\xd8\xff", 3),
    "jpeg": (b"\xff\xd8\xff", 3),
    "png":  (b"\x89PNG",      4),
    "webp": (b"RIFF",         4),
}


@router.put("/{org_id}/logo", response_model=MessageResponse)
async def upload_org_logo(
    org_id: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_approved),
):
    """Upload or replace org logo. Org Admin only. Max 2MB, jpg/png/webp."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in _LOGO_ALLOWED_EXTENSIONS:
        raise HTTPException(400, "Only JPG, PNG, and WebP files are allowed.")

    contents = await file.read()
    if len(contents) > _LOGO_MAX_SIZE:
        raise HTTPException(400, "File too large. Maximum size is 2MB.")

    # Magic bytes validation
    magic, length = _LOGO_MAGIC.get(ext, (b"", 0))
    if magic and contents[:length] != magic:
        raise HTTPException(400, "File content does not match its extension.")

    supabase = get_supabase()
    file_path = f"{org_id}.{ext}"

    # Upload to Supabase Storage bucket "org_logos"
    try:
        await supabase.storage.from_("org_logos").upload(
            file_path, contents,
            {"content-type": file.content_type or "image/jpeg", "upsert": "true"},
        )
    except Exception:
        # Try update (upsert) if upload fails due to existing file
        try:
            await supabase.storage.from_("org_logos").update(
                file_path, contents,
                {"content-type": file.content_type or "image/jpeg"},
            )
        except Exception as exc:
            logger.error("[Org] Logo upload failed for %s: %s", org_id, exc)
            raise HTTPException(500, "Failed to upload logo.")

    # Get public URL
    url_resp = await supabase.storage.from_("org_logos").get_public_url(file_path)
    logo_url = url_resp if isinstance(url_resp, str) else url_resp.get("publicUrl", "")

    # Save logo_url to organizations table
    await (
        supabase.table("organizations")
        .update({"logo_url": logo_url})
        .eq("id", org_id)
    ).execute()

    logger.info("[Org] Logo uploaded for %s by %s", org_id[:8], user.email)
    return MessageResponse(message="Logo updated successfully.")


# ── Deletion Flow ────────────────────────────────────────────────

@router.post("/{org_id}/request-deletion", response_model=MessageResponse)
async def request_deletion(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Request org deletion. Org Admin requests; platform support/admin confirms."""
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    supabase = get_supabase()

    # Block deletion of the platform's own org (any org that is the home org of platform staff)
    protected = await (
        supabase.table("user_profiles")
        .select("id", count="exact")
        .eq("organization_id", org_id)
        .in_("role", ["admin", "support"])
        .limit(1)
    ).execute()
    if protected.count and protected.count > 0:
        raise HTTPException(400, "Cannot delete the platform's root organization.")

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
    if not requester:
        raise HTTPException(400, "No deletion request found for this organization. An Org Admin must submit a request first.")
    if requester == user.id:
        raise HTTPException(400, "Cannot confirm your own deletion request. Another party must confirm.")

    # Soft delete: set status to 'deleted'
    await (
        supabase.table("organizations")
        .update({"status": "deleted"})
        .eq("id", org_id)
    ).execute()

    # Clean up org_members and pending invitations
    await (
        supabase.table("org_members")
        .delete()
        .eq("organization_id", org_id)
    ).execute()
    await (
        supabase.table("org_invitations")
        .update({"status": "revoked"})
        .eq("organization_id", org_id)
        .eq("status", "pending")
    ).execute()

    logger.info("Org %s soft-deleted, confirmed by %s", org_id, user.email)
    return MessageResponse(message="Organization deleted successfully.")


# ── Hard Delete (commented out — enable when needed) ─────────────
#
# Hard delete permanently removes the organization and ALL related data
# from the database. This is irreversible.
#
# Cascade order:
#   1. chat_messages      (via chat_sessions.organization_id)
#   2. chat_sessions      (organization_id)
#   3. document_child_chunks (via document_parent_chunks → documents)
#   4. document_parent_chunks (via documents)
#   5. documents          (organization_id, via bots)
#   6. bots               (organization_id)
#   7. org_invitations    (organization_id)
#   8. org_members        (organization_id)
#   9. organizations      (id)
#
# @router.post("/{org_id}/hard-delete", response_model=MessageResponse)
# async def hard_delete_org(
#     org_id: str,
#     user: CurrentUser = Depends(require_role("admin")),
# ):
#     """Permanently delete org and ALL related data. Admin only.
#
#     WARNING: This is irreversible. All bots, documents, chunks,
#     chat sessions, messages, members, and invitations will be
#     permanently removed from the database.
#     """
#     supabase = get_supabase()
#
#     # Verify org exists
#     org_result = await (
#         supabase.table("organizations")
#         .select("id, name, status")
#         .eq("id", org_id)
#         .single()
#     ).execute()
#
#     if not org_result.data:
#         raise HTTPException(404, "Organization not found.")
#
#     org_name = org_result.data.get("name", org_id)
#
#     # 1. Get all bot IDs for this org (needed for document cascade)
#     bots_result = await (
#         supabase.table("bots")
#         .select("id")
#         .eq("organization_id", org_id)
#     ).execute()
#     bot_ids = [b["id"] for b in (bots_result.data or [])]
#
#     # 2. Get all document IDs for these bots
#     doc_ids: list[str] = []
#     if bot_ids:
#         docs_result = await (
#             supabase.table("documents")
#             .select("id")
#             .in_("bot_id", bot_ids)
#         ).execute()
#         doc_ids = [d["id"] for d in (docs_result.data or [])]
#
#     # 3. Get all parent chunk IDs for these documents
#     parent_chunk_ids: list[str] = []
#     if doc_ids:
#         pc_result = await (
#             supabase.table("document_parent_chunks")
#             .select("id")
#             .in_("document_id", doc_ids)
#         ).execute()
#         parent_chunk_ids = [pc["id"] for pc in (pc_result.data or [])]
#
#     # 4. Delete child chunks
#     if parent_chunk_ids:
#         await (
#             supabase.table("document_child_chunks")
#             .delete()
#             .in_("parent_chunk_id", parent_chunk_ids)
#         ).execute()
#
#     # 5. Delete parent chunks
#     if doc_ids:
#         await (
#             supabase.table("document_parent_chunks")
#             .delete()
#             .in_("document_id", doc_ids)
#         ).execute()
#
#     # 6. Delete documents
#     if bot_ids:
#         await (
#             supabase.table("documents")
#             .delete()
#             .in_("bot_id", bot_ids)
#         ).execute()
#
#     # 7. Delete chat messages (via sessions)
#     sessions_result = await (
#         supabase.table("chat_sessions")
#         .select("id")
#         .eq("organization_id", org_id)
#     ).execute()
#     session_ids = [s["id"] for s in (sessions_result.data or [])]
#     if session_ids:
#         await (
#             supabase.table("chat_messages")
#             .delete()
#             .in_("session_id", session_ids)
#         ).execute()
#
#     # 8. Delete chat sessions
#     await (
#         supabase.table("chat_sessions")
#         .delete()
#         .eq("organization_id", org_id)
#     ).execute()
#
#     # 9. Delete bots
#     await (
#         supabase.table("bots")
#         .delete()
#         .eq("organization_id", org_id)
#     ).execute()
#
#     # 10. Delete invitations
#     await (
#         supabase.table("org_invitations")
#         .delete()
#         .eq("organization_id", org_id)
#     ).execute()
#
#     # 11. Delete members
#     await (
#         supabase.table("org_members")
#         .delete()
#         .eq("organization_id", org_id)
#     ).execute()
#
#     # 12. Delete the organization itself
#     await (
#         supabase.table("organizations")
#         .delete()
#         .eq("id", org_id)
#     ).execute()
#
#     logger.warning(
#         "HARD DELETE: Org '%s' (%s) permanently removed by admin %s",
#         org_name, org_id, user.email,
#     )
#     return MessageResponse(
#         message=f"องค์กร '{org_name}' และข้อมูลทั้งหมดถูกลบถาวรแล้ว",
#     )


# ── Leave Organization ────────────────────────────────────────────

@router.post("/{org_id}/leave", response_model=MessageResponse)
async def leave_organization(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Leave an organization. Last Org Admin cannot leave (must have at least 1 admin)."""
    supabase = get_supabase()

    # Verify user is a member of this org
    member_result = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()

    if not member_result.data:
        raise HTTPException(404, "You are not a member of this organization.")

    # If user is an Org Admin, check they are not the last one
    if member_result.data[0]["org_role"] == "admin":
        admin_count = await (
            supabase.table("org_members")
            .select("user_id", count="exact")
            .eq("organization_id", org_id)
            .eq("org_role", "admin")
        ).execute()
        if (admin_count.count or 0) <= 1:
            # Last Org Admin — must request deletion via Danger Zone instead
            raise HTTPException(400, "LAST_ORG_ADMIN")

    # Remove from org_members
    await (
        supabase.table("org_members")
        .delete()
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
    ).execute()

    # If this was user's active org, clear user_profiles.organization_id
    if user.organization_id == org_id:
        await (
            supabase.table("user_profiles")
            .update({"organization_id": None})
            .eq("id", user.id)
        ).execute()

    logger.info("User %s left org %s", user.email, org_id)
    return MessageResponse(message="You have left the organization.")


# ── Promote / Demote Members ─────────────────────────────────────


@router.post("/{org_id}/members/{target_user_id}/promote", response_model=MessageResponse)
async def promote_member(
    org_id: str,
    target_user_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Promote a member to Org Admin. Requires Org Admin role."""
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    if target_user_id == user.id:
        raise HTTPException(400, "You are already an Org Admin.")

    supabase = get_supabase()

    # Verify target is a member of this org
    target = await (
        supabase.table("org_members")
        .select("user_id, org_role")
        .eq("user_id", target_user_id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()

    if not target.data:
        raise HTTPException(404, "Member not found in this organization.")

    if target.data[0]["org_role"] == "admin":
        raise HTTPException(400, "This member is already an Org Admin.")

    # Promote to admin
    await (
        supabase.table("org_members")
        .update({"org_role": "admin"})
        .eq("user_id", target_user_id)
        .eq("organization_id", org_id)
    ).execute()

    logger.info(
        "Member promoted to admin: org %s, user %s, by %s",
        org_id, target_user_id, user.email,
    )
    return MessageResponse(message="Member promoted to Org Admin successfully.")


@router.post("/{org_id}/members/{target_user_id}/demote", response_model=MessageResponse)
async def demote_admin(
    org_id: str,
    target_user_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Demote an Org Admin to member. Requires Org Admin role.
    Cannot demote if target is the last admin."""
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    supabase = get_supabase()

    # Verify target is an admin of this org
    target = await (
        supabase.table("org_members")
        .select("user_id, org_role")
        .eq("user_id", target_user_id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()

    if not target.data:
        raise HTTPException(404, "Member not found in this organization.")

    if target.data[0]["org_role"] != "admin":
        raise HTTPException(400, "This member is not an Org Admin.")

    # Check not the last admin
    admin_count = await (
        supabase.table("org_members")
        .select("user_id", count="exact")
        .eq("organization_id", org_id)
        .eq("org_role", "admin")
    ).execute()
    if (admin_count.count or 0) <= 1:
        raise HTTPException(400, "Cannot demote: the organization must have at least one Org Admin.")

    # Demote to member
    await (
        supabase.table("org_members")
        .update({"org_role": "member"})
        .eq("user_id", target_user_id)
        .eq("organization_id", org_id)
    ).execute()

    logger.info(
        "Admin demoted to member: org %s, user %s, by %s",
        org_id, target_user_id, user.email,
    )
    return MessageResponse(message="Admin demoted to member successfully.")


# ── Cancel Pending Deletion ──────────────────────────────────────

@router.post("/{org_id}/cancel-deletion", response_model=MessageResponse)
async def cancel_deletion(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Cancel a pending org deletion. Owner or support/admin."""
    supabase = get_supabase()

    # Fetch org status
    org_result = await (
        supabase.table("organizations")
        .select("status")
        .eq("id", org_id)
        .single()
    ).execute()

    if not org_result.data:
        raise HTTPException(404, "Organization not found.")

    if org_result.data.get("status") != "pending_deletion":
        raise HTTPException(400, "This organization is not pending deletion.")

    # Only Org Admin or platform support/admin can cancel
    if user.role not in ("admin", "support"):
        member = await (
            supabase.table("org_members")
            .select("org_role")
            .eq("user_id", user.id)
            .eq("organization_id", org_id)
            .limit(1)
        ).execute()
        if not member.data or member.data[0].get("org_role") != "admin":
            raise HTTPException(403, "เฉพาะ Org Admin หรือ Support/Admin เท่านั้นที่ยกเลิกได้")

    await (
        supabase.table("organizations")
        .update({
            "status": "active",
            "deletion_requested_by": None,
            "deletion_requested_at": None,
        })
        .eq("id", org_id)
    ).execute()

    logger.info("Deletion cancelled for org %s by %s", org_id, user.email)
    return MessageResponse(message="ยกเลิกคำขอลบองค์กรสำเร็จ")


# ── Members ──────────────────────────────────────────────────────

@router.get("/{org_id}/members", response_model=list[OrgMemberResponse])
async def list_members(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """List members of an organization.

    Platform support/admin can list members of any org without membership
    so they can manage orgs they created (invite, promote, etc.).
    """
    if user.role not in ("support", "admin"):
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
        .select("id, email, first_name, last_name, avatar_url, role")
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
            first_name=profile.get("first_name"),
            last_name=profile.get("last_name"),
            avatar_url=profile.get("avatar_url"),
            role=profile.get("role"),
            org_role=row["org_role"],
            joined_at=row.get("joined_at"),
        ))

    return members


# ── Org Invitations List ────────────────────────────────────────

class OrgInvitationItem(BaseModel):
    id: str
    invited_email: str
    invited_by: str | None = None
    invited_by_email: str | None = None
    status: str
    created_at: str


@router.get("/{org_id}/invitations", response_model=list[OrgInvitationItem])
async def list_org_invitations(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """List all invitations for this org (Org Admin or platform staff)."""
    supabase = get_supabase()
    if user.role in ("support", "admin"):
        pass  # platform staff can view
    else:
        await verify_organization(user, org_id)
        await verify_org_admin(user, org_id)

    result = await (
        supabase.table("org_invitations")
        .select("id, invited_email, invited_by, status, created_at")
        .eq("organization_id", org_id)
        .order("created_at", desc=True)
        .limit(100)
    ).execute()

    rows = result.data or []

    # Auto-expire old invitations (30 days)
    now = datetime.now(timezone.utc)
    expired_ids = []
    for row in rows:
        if row["status"] == "pending":
            created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            if (now - created).days > 30:
                row["status"] = "expired"
                expired_ids.append(row["id"])

    if expired_ids:
        try:
            await (
                supabase.table("org_invitations")
                .update({"status": "expired"})
                .in_("id", expired_ids)
            ).execute()
        except Exception as exc:
            logger.warning("Failed to auto-expire invitations: %s", exc)

    # Resolve invited_by user emails
    by_ids = list({r["invited_by"] for r in rows if r.get("invited_by")})
    email_map: dict[str, str] = {}
    if by_ids:
        try:
            profiles = await (
                supabase.table("user_profiles")
                .select("id, email")
                .in_("id", by_ids)
            ).execute()
            email_map = {p["id"]: p["email"] for p in (profiles.data or [])}
        except Exception:
            pass

    return [
        OrgInvitationItem(
            id=r["id"],
            invited_email=r["invited_email"],
            invited_by=r.get("invited_by"),
            invited_by_email=email_map.get(r.get("invited_by", ""), None),
            status=r["status"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/{org_id}/invite", response_model=InvitationResponse)
async def invite_member(
    org_id: str,
    body: InviteRequest,
    user: CurrentUser = Depends(require_approved),
):
    """Invite a user to the organization by email.

    Org Admin OR platform support/admin can invite.
    Platform support/admin bypass membership check so they can invite
    into orgs they created (before any member exists).
    """
    supabase = get_supabase()
    if user.role in ("support", "admin"):
        # Verify org exists and is active — no membership required for platform staff
        _org_check = await (
            supabase.table("organizations")
            .select("status")
            .eq("id", org_id)
            .limit(1)
        ).execute()
        if not _org_check.data:
            raise HTTPException(404, "Organization not found.")
        if _org_check.data[0].get("status") == "deleted":
            raise HTTPException(404, "Organization has been deleted.")
    else:
        await verify_organization(user, org_id)
        await verify_org_admin(user, org_id)

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email is required.")
    if len(email) > 254:
        raise HTTPException(400, "Email is too long (max 254 characters).")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email format.")

    # Check if user exists in the system
    profile_result = await (
        supabase.table("user_profiles")
        .select("id, is_approved")
        .eq("email", email)
        .limit(1)
    ).execute()

    user_exists = bool(profile_result.data)
    invited_user_id = profile_result.data[0]["id"] if user_exists else None
    user_is_approved = profile_result.data[0].get("is_approved", False) if user_exists else False

    # Case 1: Email not registered yet — ask to confirm pre-invite
    if not user_exists and not body.confirm_approve:
        raise HTTPException(
            status_code=409,
            detail="USER_NOT_REGISTERED",
        )

    # Case 2: Registered but pending approval — ask to confirm + approve
    if user_exists and not user_is_approved and not body.confirm_approve:
        raise HTTPException(
            status_code=409,
            detail="USER_PENDING_APPROVAL",
        )

    # Check not already a member (only if user exists)
    if invited_user_id:
        member_check = await (
            supabase.table("org_members")
            .select("user_id")
            .eq("organization_id", org_id)
            .eq("user_id", invited_user_id)
            .limit(1)
        ).execute()
        if member_check.data:
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
        raise HTTPException(400, f"A pending invitation already exists for {email}.")

    now_iso = datetime.now(timezone.utc).isoformat()

    # Case 2 confirmed: auto-approve + add to org immediately
    if user_exists and not user_is_approved and body.confirm_approve:
        await (
            supabase.table("user_profiles")
            .update({
                "is_approved": True,
                "approved_by": user.id,
                "approved_at": now_iso,
            })
            .eq("id", invited_user_id)
        ).execute()

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
                    "user_id": invited_user_id,
                    "organization_id": org_id,
                    "org_role": assigned_role,
                    "joined_at": now_iso,
                },
                on_conflict="user_id,organization_id",
                ignore_duplicates=True,
            )
        ).execute()

        inv_result = await (
            supabase.table("org_invitations").insert({
                "organization_id": org_id,
                "invited_email": email,
                "invited_by": user.id,
                "status": "accepted",
                "created_at": now_iso,
            })
        ).execute()

        profile_org = await (
            supabase.table("user_profiles")
            .select("organization_id")
            .eq("id", invited_user_id)
            .single()
        ).execute()
        if profile_org.data and not profile_org.data.get("organization_id"):
            await (
                supabase.table("user_profiles")
                .update({"organization_id": org_id})
                .eq("id", invited_user_id)
            ).execute()

        try:
            from app.core.auth import get_profile_cache
            cache = await get_profile_cache()
            await cache.invalidate(invited_user_id)
        except Exception:
            pass

        logger.info(
            "User %s auto-approved via invitation by %s (org %s)",
            invited_user_id, user.email, org_id,
        )

        inv = inv_result.data[0] if inv_result.data else {}
        return InvitationResponse(
            id=inv.get("id", ""),
            organization_id=org_id,
            invited_email=email,
            invited_by=user.id,
            status="accepted",
            created_at=now_iso,
        )

    # Normal flow: create pending invitation (approved user OR pre-invite for unregistered)
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

    # Send invitation email (non-blocking)
    org_result = await (
        supabase.table("organizations")
        .select("name")
        .eq("id", org_id)
        .limit(1)
    ).execute()
    org_name = org_result.data[0]["name"] if org_result.data else "องค์กร"
    try:
        await send_invitation_email(
            invited_email=email,
            org_name=org_name,
            invited_by_email=user.email,
            invitation_id=inv["id"],
        )
    except Exception as exc:
        logger.warning("[Invite] Email send failed (non-critical): %s", exc)

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
    user: CurrentUser = Depends(require_approved),
):
    """Remove a member from the organization. Org Admin only.
    Cannot remove yourself."""
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    if member_user_id == user.id:
        raise HTTPException(400, "Cannot remove yourself. Use the Leave endpoint instead.")

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


@router.post("/{org_id}/invitations/{inv_id}/revoke", response_model=MessageResponse)
async def revoke_invitation(
    org_id: str,
    inv_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Revoke a pending invitation. Org Admin only."""
    await verify_organization(user, org_id)
    await verify_org_admin(user, org_id)

    supabase = get_supabase()
    result = await (
        supabase.table("org_invitations")
        .update({"status": "revoked"})
        .eq("id", inv_id)
        .eq("organization_id", org_id)
        .eq("status", "pending")
    ).execute()

    if not result.data:
        raise HTTPException(404, "Pending invitation not found.")

    logger.info("Revoked invitation %s in org %s by %s", inv_id, org_id, user.email)
    return MessageResponse(message="Invitation revoked.")


# ── Update Profile ──────────────────────────────────────────────


class UpdateProfileRequest(BaseModel):
    """Request body for updating user profile."""

    first_name: str
    last_name: str
    avatar_url: str | None = None


class ProfileResponse(BaseModel):
    """Response after updating profile."""

    first_name: str | None
    last_name: str | None
    avatar_url: str | None = None
    email: str


@router.put("/profile/me", response_model=ProfileResponse)
async def update_my_profile(
    body: UpdateProfileRequest,
    user: CurrentUser = Depends(require_approved),
) -> ProfileResponse:
    """Update current user's first_name and last_name. User role only."""
    if user.role in ("admin", "support"):
        raise HTTPException(400, "Admin/Support ไม่สามารถเปลี่ยนชื่อผ่านหน้านี้ได้")

    first_name = body.first_name.strip()
    last_name = body.last_name.strip()

    if not first_name:
        raise HTTPException(400, "กรุณาระบุชื่อ")
    if len(first_name) > 100 or len(last_name) > 100:
        raise HTTPException(400, "ชื่อหรือนามสกุลยาวเกินไป (สูงสุด 100 ตัวอักษร)")

    update_data: dict = {"first_name": first_name, "last_name": last_name or None}
    if body.avatar_url is not None:
        update_data["avatar_url"] = body.avatar_url or None

    supabase = get_supabase()
    await (
        supabase.table("user_profiles")
        .update(update_data)
        .eq("id", user.id)
    ).execute()

    logger.info("User %s updated profile: %s %s", user.email, first_name, last_name)

    return ProfileResponse(
        first_name=first_name,
        last_name=last_name or None,
        avatar_url=body.avatar_url,
        email=user.email,
    )


# ── LINE Integration Config ──────────────────────────────────────


class LineConfigRequest(BaseModel):
    """Request body for updating LINE integration settings."""

    line_channel_secret: str | None = None
    line_access_token: str | None = None
    is_line_enabled: bool | None = None


class LineConfigResponse(BaseModel):
    """Response for LINE integration config (credentials are never returned)."""

    is_line_enabled: bool
    has_credentials: bool
    webhook_url: str


@router.get("/{org_id}/line-config", response_model=LineConfigResponse)
async def get_line_config(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
) -> LineConfigResponse:
    """Get LINE integration status for an org (Org Admin only)."""
    await verify_org_admin(user, org_id)

    supabase = get_supabase()
    result = await (
        supabase.table("organizations")
        .select("is_line_enabled, line_access_token, line_channel_secret")
        .eq("id", org_id)
        .limit(1)
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Organization not found.")

    org = result.data[0]
    settings = get_settings()
    base_url = settings.public_api_url.rstrip("/") if settings.public_api_url else ""
    webhook_url = (
        f"{base_url}/api/webhook/line/{org_id}"
        if base_url
        else f"/api/webhook/line/{org_id} (ตั้งค่า PUBLIC_API_URL ใน .env เพื่อแสดง URL เต็ม)"
    )

    return LineConfigResponse(
        is_line_enabled=org.get("is_line_enabled") or False,
        has_credentials=bool(org.get("line_access_token") and org.get("line_channel_secret")),
        webhook_url=webhook_url,
    )


@router.put("/{org_id}/line-config", response_model=LineConfigResponse)
async def update_line_config(
    org_id: str,
    body: LineConfigRequest,
    user: CurrentUser = Depends(require_approved),
) -> LineConfigResponse:
    """Update LINE integration credentials and toggle (Org Admin only)."""
    await verify_org_admin(user, org_id)

    updates: dict = {}
    if body.line_channel_secret is not None:
        updates["line_channel_secret"] = encrypt_secret(body.line_channel_secret) if body.line_channel_secret else None
    if body.line_access_token is not None:
        updates["line_access_token"] = encrypt_secret(body.line_access_token) if body.line_access_token else None
    if body.is_line_enabled is not None:
        updates["is_line_enabled"] = body.is_line_enabled

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    supabase = get_supabase()
    await (
        supabase.table("organizations")
        .update(updates)
        .eq("id", org_id)
    ).execute()

    org_result = await (
        supabase.table("organizations")
        .select("is_line_enabled, line_access_token, line_channel_secret")
        .eq("id", org_id)
        .limit(1)
    ).execute()

    if not org_result.data:
        raise HTTPException(status_code=404, detail="Organization not found.")

    org = org_result.data[0]
    settings = get_settings()
    base_url = settings.public_api_url.rstrip("/") if settings.public_api_url else ""
    webhook_url = (
        f"{base_url}/api/webhook/line/{org_id}"
        if base_url
        else f"/api/webhook/line/{org_id} (ตั้งค่า PUBLIC_API_URL ใน .env เพื่อแสดง URL เต็ม)"
    )

    logger.info("[LINE] Org %s LINE config updated by %s", org_id[:8], user.email)

    return LineConfigResponse(
        is_line_enabled=org.get("is_line_enabled") or False,
        has_credentials=bool(org.get("line_access_token") and org.get("line_channel_secret")),
        webhook_url=webhook_url,
    )


# ── LINE Binding (link LINE UID to org member) ────────────────────

_pending_bindings: dict[str, dict] = {}


class BindingCodeResponse(BaseModel):
    code: str
    expires_in: int


class BindingStatusResponse(BaseModel):
    is_linked: bool
    line_user_id: str | None = None


@router.post("/{org_id}/line-binding/code", response_model=BindingCodeResponse)
async def create_binding_code(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
) -> BindingCodeResponse:
    """Generate a 6-digit code for the user to type in LINE to link their account."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)

    for code, info in list(_pending_bindings.items()):
        if info["user_id"] == user.id and info["organization_id"] == org_id:
            del _pending_bindings[code]

    code = "".join(random.choices(string.digits, k=6))
    while code in _pending_bindings:
        code = "".join(random.choices(string.digits, k=6))

    _pending_bindings[code] = {
        "user_id": user.id,
        "organization_id": org_id,
        "created_at": datetime.now(timezone.utc),
    }

    return BindingCodeResponse(code=code, expires_in=300)


@router.get("/{org_id}/line-binding", response_model=BindingStatusResponse)
async def get_binding_status(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
) -> BindingStatusResponse:
    """Check if the current user has linked their LINE account."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    result = await (
        supabase.table("org_members")
        .select("line_user_id")
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
        .limit(1)
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found.")

    line_uid = result.data[0].get("line_user_id")
    return BindingStatusResponse(is_linked=bool(line_uid), line_user_id=line_uid)


@router.delete("/{org_id}/line-binding")
async def unbind_line(
    org_id: str,
    user: CurrentUser = Depends(require_approved),
):
    """Remove LINE binding for the current user."""
    validate_uuid_param(org_id, "org_id")
    await verify_organization(user, org_id)
    supabase = get_supabase()

    await (
        supabase.table("org_members")
        .update({"line_user_id": None})
        .eq("user_id", user.id)
        .eq("organization_id", org_id)
    ).execute()

    logger.info("[LINE] User %s unlinked LINE from org %s", user.email, org_id[:8])
    return {"success": True}


async def try_bind_line_account(
    code: str, line_user_id: str, organization_id: str
) -> bool:
    """Attempt to bind a LINE user ID using a pending binding code.

    Called from webhook_line.py when user sends a 6-digit code.
    Returns True if binding succeeded.
    """
    info = _pending_bindings.get(code)
    if not info:
        return False

    if info["organization_id"] != organization_id:
        return False

    elapsed = (datetime.now(timezone.utc) - info["created_at"]).total_seconds()
    if elapsed > 300:
        del _pending_bindings[code]
        return False

    supabase = get_supabase()
    try:
        await (
            supabase.table("org_members")
            .update({"line_user_id": line_user_id})
            .eq("user_id", info["user_id"])
            .eq("organization_id", organization_id)
        ).execute()
    except Exception as exc:
        logger.error("[LINE] Failed to bind LINE UID: %s", exc)
        return False

    del _pending_bindings[code]
    logger.info("[LINE] Bound LINE UID %s to user %s in org %s",
                line_user_id[:10], info["user_id"][:8], organization_id[:8])
    return True
