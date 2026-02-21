"""
SUNDAE Backend — Bot Management Router

Full CRUD for chatbot configurations.
Each bot defines a persona (system_prompt), knowledge links, and channel settings.

Endpoints:
    POST   /api/bots                    → Create a new bot
    GET    /api/bots?organization_id    → List bots by org
    GET    /api/bots/{bot_id}           → Get single bot
    PUT    /api/bots/{bot_id}           → Update bot fields
    DELETE /api/bots/{bot_id}           → Delete bot

SECURITY:
    Every query MUST include organization_id filtering.
    Backend uses Service Role Key (bypasses RLS).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import CurrentUser, require_approved
from app.core.database import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bots", tags=["Bots"])

# ── Default System Prompt ────────────────────────────────────────

DEFAULT_SYSTEM_PROMPT = (
    "คุณคือผู้ช่วย AI ขององค์กร ตอบเป็นภาษาไทยเท่านั้น "
    "และอ้างอิงข้อมูลจากเอกสารนี้เท่านั้นโดยไม่หาจากแหล่งอื่น "
    "หากไม่มีข้อมูลเพียงพอให้ตอบว่า 'ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร'"
)

# ── Request / Response Models ────────────────────────────────────


class BotCreateRequest(BaseModel):
    """Schema for creating a new bot."""

    name: str
    organization_id: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    is_web_enabled: bool = True


class BotUpdateRequest(BaseModel):
    """Schema for updating a bot (all fields optional)."""

    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    line_access_token: Optional[str] = None
    is_active: Optional[bool] = None
    is_web_enabled: Optional[bool] = None


class BotResponse(BaseModel):
    """Response schema for a single bot."""

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    line_access_token: Optional[str] = None
    is_active: bool = True
    is_web_enabled: bool = True
    created_at: str
    updated_at: str


class BotDeleteResponse(BaseModel):
    """Response schema for bot deletion."""

    message: str
    bot_id: str


# ── Endpoints ────────────────────────────────────────────────────


@router.post("", response_model=BotResponse, status_code=201)
async def create_bot(
    body: BotCreateRequest,
    user: CurrentUser = Depends(require_approved),
) -> BotResponse:
    """Create a new bot for an organization.

    If no system_prompt is provided, a sensible Thai-language default is used.
    """
    supabase = get_supabase()

    row = {
        "organization_id": body.organization_id,
        "name": body.name,
        "description": body.description or "",
        "system_prompt": body.system_prompt or DEFAULT_SYSTEM_PROMPT,
        "is_active": True,
        "is_web_enabled": body.is_web_enabled,
    }

    try:
        result = await (
            supabase.table("bots").insert(row).execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create bot.")

        bot = result.data[0]
        logger.info("Bot created: %s (org=%s)", bot["id"], body.organization_id)

        return BotResponse(**bot)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to create bot: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to create bot: {exc}")


@router.get("", response_model=list[BotResponse])
async def list_bots(
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> list[BotResponse]:
    """List all bots for an organization, ordered by creation date."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("bots")
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
        ).execute()

        return [BotResponse(**bot) for bot in (result.data or [])]

    except Exception as exc:
        logger.error("Failed to list bots (org=%s): %s", organization_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to list bots: {exc}")


@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(
    bot_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> BotResponse:
    """Get a single bot by ID (with org isolation)."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("bots")
            .select("*")
            .eq("id", bot_id)
            .eq("organization_id", organization_id)
            .single()
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Bot not found.")

        return BotResponse(**result.data)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get bot %s: %s", bot_id, exc)
        raise HTTPException(status_code=404, detail="Bot not found.")


@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(
    bot_id: str,
    body: BotUpdateRequest,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> BotResponse:
    """Update bot fields. Only non-null fields are applied."""
    supabase = get_supabase()

    # Build update payload (only provided fields)
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description
    if body.system_prompt is not None:
        updates["system_prompt"] = body.system_prompt
    if body.line_access_token is not None:
        updates["line_access_token"] = body.line_access_token
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.is_web_enabled is not None:
        updates["is_web_enabled"] = body.is_web_enabled

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = await (
            supabase.table("bots")
            .update(updates)
            .eq("id", bot_id)
            .eq("organization_id", organization_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Bot not found.")

        logger.info("Bot updated: %s", bot_id)
        return BotResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update bot %s: %s", bot_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to update bot: {exc}")


@router.delete("/{bot_id}", response_model=BotDeleteResponse)
async def delete_bot(
    bot_id: str,
    organization_id: str,
    user: CurrentUser = Depends(require_approved),
) -> BotDeleteResponse:
    """Delete a bot.

    Documents linked to the bot will have bot_id set to NULL
    (ON DELETE SET NULL).
    """
    supabase = get_supabase()

    # Verify existence
    try:
        check = await (
            supabase.table("bots")
            .select("id")
            .eq("id", bot_id)
            .eq("organization_id", organization_id)
            .single()
        ).execute()

        if not check.data:
            raise HTTPException(status_code=404, detail="Bot not found.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Bot not found.")

    # Delete
    try:
        await (
            supabase.table("bots")
            .delete()
            .eq("id", bot_id)
            .eq("organization_id", organization_id)
        ).execute()

        logger.info("Bot deleted: %s (org=%s)", bot_id, organization_id)

        return BotDeleteResponse(
            message="Bot deleted successfully.",
            bot_id=bot_id,
        )

    except Exception as exc:
        logger.error("Failed to delete bot %s: %s", bot_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to delete bot: {exc}")
