"""
SUNDAE Backend — Inbox Router

Provides chat session management for Org Admins.
Authorized users can view sessions, read messages, change session status,
and send replies to escalated sessions.

Endpoints:
    GET  /api/inbox/sessions                            → List chat sessions (support/admin/owner)
    GET  /api/inbox/my-sessions                         → List current user's own sessions
    GET  /api/inbox/sessions/{session_id}/messages       → Get messages in a session
    GET  /api/inbox/sessions/{session_id}/messages/new   → Poll new messages after timestamp
    PUT  /api/inbox/sessions/{session_id}/status          → Update session status (support/admin/owner)
    POST /api/inbox/sessions/{session_id}/messages        → Send reply (support/admin/owner)

SECURITY:
    Session management requires support/admin role OR org owner.
    Every query MUST include organization_id filtering.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_approved, verify_organization, verify_session_access
from app.core.database import get_supabase

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inbox", tags=["Inbox"])

# ── Response Models ──────────────────────────────────────────────


class SessionResponse(BaseModel):
    """Chat session summary."""

    id: str
    organization_id: str
    bot_id: Optional[str] = None
    platform_user_id: Optional[str] = None
    platform_source: str = "web"
    status: str = "active"
    started_at: Optional[str] = None
    last_message_at: Optional[str] = None
    user_name: Optional[str] = None


class MessageResponse(BaseModel):
    """Single chat message."""

    id: str
    session_id: str
    organization_id: str
    role: str
    content: str
    metadata: Optional[dict] = None
    created_at: str


class StatusUpdateRequest(BaseModel):
    """Request body for status change."""

    status: str  # active | human_takeover | helped | resolved


class StatusUpdateResponse(BaseModel):
    """Response for status change."""

    message: str
    session_id: str
    new_status: str


class AdminMessageRequest(BaseModel):
    """Request body for admin sending a message."""

    content: str


class PollResponse(BaseModel):
    """Response for polling new messages — includes session status for sync."""

    messages: list[MessageResponse] = []
    session_status: str = "active"


# ── Helpers ──────────────────────────────────────────────────────


async def _require_inbox_manager(
    user: CurrentUser, organization_id: str
) -> None:
    """Verify the user belongs to the org AND can manage inbox sessions.

    Access is granted if:
      - User is an Org Admin (org_members.org_role == 'admin')

    Platform support/admin has NO bypass — they must be org members.
    Regular members and non-members are denied.
    """
    supabase = get_supabase()
    result = await (
        supabase.table("org_members")
        .select("org_role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .limit(1)
    ).execute()

    if not result.data:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Access denied. You do not belong to this organization.",
        )

    if result.data[0].get("org_role") != "admin":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Access denied. Org Admin role required.",
        )


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[SessionResponse]:
    """List all chat sessions for an organization.

    Accessible by support, admin, or org owner.
    Sessions are ordered by last_message_at (newest first).
    """
    await _require_inbox_manager(user, organization_id)
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("chat_sessions")
            .select("*")
            .eq("organization_id", organization_id)
            .order("last_message_at", desc=True)
        ).execute()

        sessions = result.data or []

        # Resolve user names from user_profiles
        all_user_ids = {s["platform_user_id"] for s in sessions if s.get("platform_user_id")}
        uuid_ids = [uid for uid in all_user_ids if UUID_RE.match(uid)]
        name_map: dict[str, str] = {}
        if uuid_ids:
            try:
                profiles = await (
                    supabase.table("user_profiles")
                    .select("id, first_name, last_name, email")
                    .in_("id", uuid_ids)
                ).execute()
                for p in (profiles.data or []):
                    name = None
                    if p.get("first_name"):
                        name = p["first_name"]
                        if p.get("last_name"):
                            name += f" {p['last_name']}"
                    name_map[str(p["id"])] = name or p.get("email") or "Anonymous"
            except Exception as exc:
                logger.warning("Failed to resolve user names: %s", exc)

        return [
            SessionResponse(**s, user_name=name_map.get(s.get("platform_user_id", ""), None))
            for s in sessions
        ]

    except Exception as exc:
        logger.error("Failed to list sessions (org=%s): %s", organization_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list sessions.")


class MySessionResponse(BaseModel):
    """Chat session summary for the current user (includes bot name)."""

    id: str
    organization_id: str
    bot_id: Optional[str] = None
    bot_name: Optional[str] = None
    status: str = "active"
    last_message_at: Optional[str] = None
    started_at: Optional[str] = None


@router.get("/my-sessions", response_model=list[MySessionResponse])
async def list_my_sessions(
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[MySessionResponse]:
    """List chat sessions belonging to the current user.

    Any approved user can call this endpoint — returns only their own sessions
    (filtered by platform_user_id = user.id).
    """
    await verify_organization(user, organization_id)
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("chat_sessions")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("platform_user_id", user.id)
            .order("last_message_at", desc=True)
        ).execute()

        sessions = result.data or []

        # Resolve bot names
        bot_ids = list({s["bot_id"] for s in sessions if s.get("bot_id")})
        bot_map: dict[str, str] = {}
        if bot_ids:
            try:
                bots = await (
                    supabase.table("bots")
                    .select("id, name")
                    .in_("id", bot_ids)
                ).execute()
                for b in (bots.data or []):
                    bot_map[str(b["id"])] = b.get("name", "Bot")
            except Exception as exc:
                logger.warning("Failed to resolve bot names: %s", exc)

        return [
            MySessionResponse(
                id=s["id"],
                organization_id=s["organization_id"],
                bot_id=s.get("bot_id"),
                bot_name=bot_map.get(s.get("bot_id", ""), None),
                status=s.get("status", "active"),
                last_message_at=s.get("last_message_at"),
                started_at=s.get("started_at"),
            )
            for s in sessions
        ]

    except Exception as exc:
        logger.error("Failed to list user sessions (user=%s, org=%s): %s", user.id, organization_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list sessions.")


@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def get_session_messages(
    session_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[MessageResponse]:
    """Get all messages in a chat session, ordered by creation time."""
    await verify_organization(user, organization_id)
    await verify_session_access(user, session_id, organization_id)
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("chat_messages")
            .select("*")
            .eq("session_id", session_id)
            .eq("organization_id", organization_id)
            .order("created_at", desc=False)
        ).execute()

        return [MessageResponse(**m) for m in (result.data or [])]

    except Exception as exc:
        logger.error("Failed to get messages for session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to get messages.")


@router.put("/sessions/{session_id}/status", response_model=StatusUpdateResponse)
async def update_session_status(
    session_id: str,
    body: StatusUpdateRequest,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> StatusUpdateResponse:
    """Update the status of a chat session.

    Accessible by support, admin, or org owner.

    Valid statuses:
        - active: AI is handling the session
        - human_takeover: A human agent has taken over
        - resolved: The session is closed
    """
    await _require_inbox_manager(user, organization_id)
    valid_statuses = {"active", "human_takeover", "helped", "resolved"}
    if body.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}",
        )

    supabase = get_supabase()

    try:
        result = await (
            supabase.table("chat_sessions")
            .update({"status": body.status})
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found.")

        logger.info("Session %s status → %s", session_id, body.status)

        return StatusUpdateResponse(
            message="Session status updated.",
            session_id=session_id,
            new_status=body.status,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to update session.")


@router.post("/sessions/{session_id}/messages", response_model=MessageResponse)
async def send_admin_message(
    session_id: str,
    body: AdminMessageRequest,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> MessageResponse:
    """Send a message as admin/support/owner into a chat session.

    Accessible by support, admin, or org owner.
    Automatically sets the session status to 'human_takeover' if currently 'active'.
    Updates the session's last_message_at timestamp.
    """
    await _require_inbox_manager(user, organization_id)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content must not be empty.")

    MAX_MSG_LEN = 10_000
    if len(content) > MAX_MSG_LEN:
        raise HTTPException(status_code=400, detail=f"Message too long (max {MAX_MSG_LEN} characters).")

    supabase = get_supabase()

    try:
        # Fetch full session (used for status check + LINE push)
        session_result = await (
            supabase.table("chat_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .limit(1)
        ).execute()

        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found.")

        sess = session_result.data[0]
        current_status = sess.get("status", "active")

        # Auto-escalate to human_takeover if currently active
        update_data: dict = {"last_message_at": datetime.now(timezone.utc).isoformat()}
        if current_status == "active":
            update_data["status"] = "human_takeover"

        await (
            supabase.table("chat_sessions")
            .update(update_data)
            .eq("id", session_id)
            .eq("organization_id", organization_id)
        ).execute()

        # Insert admin message
        msg_id = str(uuid.uuid4())
        msg_row = {
            "id": msg_id,
            "session_id": session_id,
            "organization_id": organization_id,
            "role": "admin",
            "content": content,
            "metadata": {
                "sender_user_id": user.id,
                "sender_email": user.email,
            },
        }
        insert_result = await (
            supabase.table("chat_messages").insert(msg_row)
        ).execute()

        logger.info("Admin message sent to session %s by %s", session_id, user.email)

        # ── LINE Push: if this session is from LINE, push the reply ──
        try:
            if sess.get("platform_source") == "line" and sess.get("platform_user_id"):
                bot_result = await (
                    supabase.table("bots")
                    .select("line_access_token")
                    .eq("id", sess["bot_id"])
                    .limit(1)
                ).execute()
                if bot_result.data and bot_result.data[0].get("line_access_token"):
                    from app.services.line_service import push_message
                    await push_message(
                        user_id=sess["platform_user_id"],
                        text=content,
                        access_token=bot_result.data[0]["line_access_token"],
                    )
                    logger.info("[LINE] Pushed admin reply to user %s", sess["platform_user_id"][:10])
        except Exception as push_exc:
            logger.warning("LINE push failed (non-blocking): %s", push_exc)

        created = insert_result.data[0] if insert_result.data else {
            **msg_row,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return MessageResponse(**created)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to send admin message (session=%s): %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to send message.")


@router.get("/sessions/{session_id}/messages/new", response_model=PollResponse)
async def get_new_messages(
    session_id: str,
    organization_id: str,
    after: str,
    user: CurrentUser = Depends(require_approved),
) -> PollResponse:
    """Poll for new messages created after a given timestamp.

    Used by WebChat to receive admin replies and by Inbox for auto-refresh.
    Also returns the current session status so the frontend can sync
    admin-initiated status changes (e.g., "คืนร่างให้ AI", "ปิดเคส").

    Args:
        after: ISO-8601 timestamp. Only messages with created_at > after are returned.
    """
    await verify_organization(user, organization_id)
    await verify_session_access(user, session_id, organization_id)
    supabase = get_supabase()

    try:
        # Fetch new messages
        messages_result = await (
            supabase.table("chat_messages")
            .select("*")
            .eq("session_id", session_id)
            .eq("organization_id", organization_id)
            .gt("created_at", after)
            .order("created_at", desc=False)
        ).execute()

        # Also fetch current session status for frontend sync
        session_result = await (
            supabase.table("chat_sessions")
            .select("status")
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .limit(1)
        ).execute()

        current_status = (
            session_result.data[0]["status"]
            if session_result.data
            else "active"
        )

        return PollResponse(
            messages=[MessageResponse(**m) for m in (messages_result.data or [])],
            session_status=current_status,
        )

    except Exception as exc:
        logger.error("Failed to poll new messages (session=%s): %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to get new messages.")
