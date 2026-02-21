"""
SUNDAE Backend — Inbox Router

Provides chat session management for Support/Admin human-in-the-loop.
Support agents can view sessions, read messages, change session status,
and send admin replies to escalated sessions.

Endpoints:
    GET  /api/inbox/sessions                            → List chat sessions (support/admin)
    GET  /api/inbox/sessions/{session_id}/messages       → Get messages in a session
    GET  /api/inbox/sessions/{session_id}/messages/new   → Poll new messages after timestamp
    PUT  /api/inbox/sessions/{session_id}/status          → Update session status
    POST /api/inbox/sessions/{session_id}/messages        → Admin sends reply (support/admin)

SECURITY:
    Session listing requires support/admin role.
    Every query MUST include organization_id filtering.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_approved, require_role
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

    status: str  # active | human_takeover | resolved


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


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    organization_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> list[SessionResponse]:
    """List all chat sessions for an organization.

    Only support and admin roles can access this endpoint.
    Sessions are ordered by last_message_at (newest first).
    """
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
                    .select("id, full_name, email")
                    .in_("id", uuid_ids)
                ).execute()
                for p in (profiles.data or []):
                    name_map[str(p["id"])] = p.get("full_name") or p.get("email") or "Anonymous"
            except Exception as exc:
                logger.warning("Failed to resolve user names: %s", exc)

        return [
            SessionResponse(**s, user_name=name_map.get(s.get("platform_user_id", ""), None))
            for s in sessions
        ]

    except Exception as exc:
        logger.error("Failed to list sessions (org=%s): %s", organization_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to list sessions: {exc}")


@router.get("/sessions/{session_id}/messages", response_model=list[MessageResponse])
async def get_session_messages(
    session_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[MessageResponse]:
    """Get all messages in a chat session, ordered by creation time."""
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
        raise HTTPException(status_code=500, detail=f"Failed to get messages: {exc}")


@router.put("/sessions/{session_id}/status", response_model=StatusUpdateResponse)
async def update_session_status(
    session_id: str,
    body: StatusUpdateRequest,
    organization_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> StatusUpdateResponse:
    """Update the status of a chat session.

    Valid statuses:
        - active: AI is handling the session
        - human_takeover: A human agent has taken over
        - resolved: The session is closed
    """
    valid_statuses = {"active", "human_takeover", "resolved"}
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
        raise HTTPException(status_code=500, detail=f"Failed to update session: {exc}")


@router.post("/sessions/{session_id}/messages", response_model=MessageResponse)
async def send_admin_message(
    session_id: str,
    body: AdminMessageRequest,
    organization_id: str,
    user: CurrentUser = Depends(require_role("support", "admin")),
) -> MessageResponse:
    """Send a message as admin/support into a chat session.

    Automatically sets the session status to 'human_takeover' if currently 'active'.
    Updates the session's last_message_at timestamp.
    """
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content must not be empty.")

    supabase = get_supabase()

    try:
        # Verify session exists and belongs to org
        session_result = await (
            supabase.table("chat_sessions")
            .select("id, status")
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .limit(1)
        ).execute()

        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found.")

        current_status = session_result.data[0].get("status", "active")

        # Auto-escalate to human_takeover if currently active
        update_data: dict = {"last_message_at": "now()"}
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

        created = insert_result.data[0] if insert_result.data else msg_row
        return MessageResponse(**created)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to send admin message (session=%s): %s", session_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to send message: {exc}")


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
        raise HTTPException(status_code=500, detail=f"Failed to get new messages: {exc}")
