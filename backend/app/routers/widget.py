"""
SUNDAE Backend — Web Widget Router

Public-facing API for the embeddable chat widget. No JWT auth required —
only the bot_id is needed, and the bot must have is_web_enabled=True.

Anonymous visitors get a session ID stored in their browser's localStorage.

Endpoints:
    POST /api/widget/chat/{bot_id}        → Send message + get AI response (SSE stream)
    GET  /api/widget/history/{session_id}  → Get chat history for a session
    POST /api/widget/session/{bot_id}      → Create a new anonymous session

SECURITY:
    - No JWT auth — this is intentionally public.
    - Bot must have is_web_enabled=True.
    - Rate limiting should be added at the reverse proxy layer (nginx/cloudflare).
    - CORS is handled by the main FastAPI middleware.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_lib
import json
import logging
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.database import get_supabase
from app.core.limiter import limiter
from app.core.utils import sanitize_user_input
from app.services.ai_models import get_embedding_service, get_reranker_service
from app.services.llm_generator import generate_response_stream
from app.services.vector_search import search_parent_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/widget", tags=["Web Widget"])


# ── Session HMAC Helpers ─────────────────────────────────────────


def _sign_session(session_id: str) -> str:
    secret = get_settings().supabase_jwt_secret
    return hmac_lib.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()


def _verify_session_token(session_id: str, token: str) -> bool:
    expected = _sign_session(session_id)
    return hmac_lib.compare_digest(expected, token)


# ── Models ───────────────────────────────────────────────────────


class WidgetChatRequest(BaseModel):
    """Request for sending a chat message from the widget."""

    message: str = Field(..., min_length=1, max_length=5000, description="The visitor's question")
    session_id: Optional[str] = Field(
        None, description="Existing session ID (from localStorage)"
    )
    session_token: Optional[str] = Field(
        None, description="HMAC token for session ownership verification"
    )


class WidgetSessionResponse(BaseModel):
    """Response when creating a new widget session."""

    session_id: str
    session_token: str
    bot_name: str


class WidgetMessageResponse(BaseModel):
    """A single chat message."""

    id: str
    role: str
    content: str
    created_at: str


class SourceChunk(BaseModel):
    """Source reference for the widget."""

    document_id: str
    chunk_index: int
    score: float


# ── Helper: Validate bot for widget ─────────────────────────────


async def _get_widget_bot(bot_id: str) -> dict:
    """Validate that the bot exists and has web chat enabled."""
    supabase = get_supabase()

    try:
        result = await (
            supabase.table("bots")
            .select("id, organization_id, name, system_prompt, is_web_enabled, is_active")
            .eq("id", bot_id)
            .limit(1)
        ).execute()
    except Exception as exc:
        logger.error("Failed to look up bot %s: %s", bot_id, exc)
        raise HTTPException(status_code=500, detail="Failed to look up bot.")

    if not result.data:
        raise HTTPException(status_code=404, detail="Bot not found.")

    bot = result.data[0]

    if not bot.get("is_active", True):
        raise HTTPException(status_code=403, detail="This bot is currently disabled.")

    if not bot.get("is_web_enabled", False):
        raise HTTPException(
            status_code=403,
            detail="Web chat is not enabled for this bot.",
        )

    return bot


# ── Create Session ───────────────────────────────────────────────


@router.post("/session/{bot_id}", response_model=WidgetSessionResponse)
@limiter.limit("20/minute")
async def create_widget_session(request: Request, bot_id: str) -> WidgetSessionResponse:
    """Create a new anonymous chat session for the widget.

    The frontend stores the returned session_id in localStorage
    and sends it with each subsequent message.
    """
    bot = await _get_widget_bot(bot_id)

    session_id = str(uuid.uuid4())
    visitor_id = f"widget_{uuid.uuid4().hex[:12]}"

    supabase = get_supabase()
    try:
        await (
            supabase.table("chat_sessions")
            .insert({
                "id": session_id,
                "organization_id": bot["organization_id"],
                "bot_id": bot_id,
                "channel": "web",
                "platform_source": "web",
                "platform_user_id": visitor_id,
                "external_user_id": visitor_id,
                "status": "active",
                "last_message_at": "now()",
            })
        ).execute()
    except Exception as exc:
        logger.error("Failed to create widget session: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create chat session.")

    logger.info("[Widget] Session created: %s for bot %s", session_id, bot_id)

    return WidgetSessionResponse(
        session_id=session_id,
        session_token=_sign_session(session_id),
        bot_name=bot.get("name", "SUNDAE Bot"),
    )


# ── Chat (SSE Streaming) ────────────────────────────────────────


@router.post("/chat/{bot_id}")
@limiter.limit("30/minute")
async def widget_chat(
    request: Request,
    bot_id: str,
    body: WidgetChatRequest,
) -> StreamingResponse:
    """Process a widget visitor's message through the RAG pipeline (SSE stream).

    The response is streamed as Server-Sent Events:
        data: {"type":"token","content":"..."}
        data: {"type":"sources","sources":[...]}
        data: {"type":"done","session_id":"..."}
    """
    bot = await _get_widget_bot(bot_id)
    organization_id = bot["organization_id"]
    user_text = sanitize_user_input(body.message)

    if not user_text:
        raise HTTPException(status_code=400, detail="Message must not be empty.")

    supabase = get_supabase()

    # ── Resolve or create session ────────────────────────────────
    session_id = body.session_id

    if session_id:
        # Verify HMAC token ownership before trusting session_id
        if not body.session_token or not _verify_session_token(session_id, body.session_token):
            session_id = None

    if session_id:
        # Verify session exists and belongs to this bot
        try:
            sess_result = await (
                supabase.table("chat_sessions")
                .select("id, status")
                .eq("id", session_id)
                .eq("bot_id", bot_id)
                .limit(1)
            ).execute()

            if not sess_result.data:
                # Session not found — create new
                session_id = None
            else:
                session_status = sess_result.data[0].get("status", "active")
                if session_status == "human_takeover":
                    # Save message but don't run AI — admin is handling
                    msg_id = str(uuid.uuid4())
                    await (
                        supabase.table("chat_messages")
                        .insert({
                            "id": msg_id,
                            "session_id": session_id,
                            "organization_id": organization_id,
                            "role": "user",
                            "content": user_text,
                        })
                    ).execute()
                    await (
                        supabase.table("chat_sessions")
                        .update({"last_message_at": "now()"})
                        .eq("id", session_id)
                        .eq("organization_id", organization_id)
                    ).execute()

                    # Return a non-streaming response indicating handoff
                    async def handoff_stream():
                        data = json.dumps(
                            {"type": "token", "content": "กำลังเชื่อมต่อ Admin กรุณารอสักครู่..."},
                        )
                        yield f"data: {data}\n\n"
                        yield f"data: {json.dumps({'type': 'done', 'session_id': session_id, 'session_token': _sign_session(session_id), 'session_status': 'human_takeover'})}\n\n"

                    return StreamingResponse(
                        handoff_stream(),
                        media_type="text/event-stream",
                        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                    )
        except Exception as exc:
            logger.warning("Failed to verify widget session: %s", exc)
            session_id = None

    if not session_id:
        # Create session inline
        session_id = str(uuid.uuid4())
        visitor_id = f"widget_{uuid.uuid4().hex[:12]}"
        try:
            await (
                supabase.table("chat_sessions")
                .insert({
                    "id": session_id,
                    "organization_id": organization_id,
                    "bot_id": bot_id,
                    "channel": "web",
                    "platform_source": "web",
                    "platform_user_id": visitor_id,
                    "external_user_id": visitor_id,
                    "status": "active",
                    "last_message_at": "now()",
                })
            ).execute()
        except Exception as exc:
            logger.warning("Failed to create widget session inline: %s", exc)

    # ── Save user message ────────────────────────────────────────
    try:
        await (
            supabase.table("chat_messages")
            .insert({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "organization_id": organization_id,
                "role": "user",
                "content": user_text,
            })
        ).execute()
    except Exception as exc:
        logger.warning("Failed to save widget user message: %s", exc)

    # ── RAG Pipeline (pre-streaming) ─────────────────────────────
    t0 = time.time()

    try:
        embedder = get_embedding_service()
        query_embedding = await embedder.embed_query(user_text)

        parent_results = await search_parent_chunks(
            query_embedding=query_embedding,
            organization_id=organization_id,
            bot_id=bot_id,
            top_k=3,
        )

        if parent_results and len(parent_results) > 2:
            reranker = get_reranker_service()
            parent_texts = [p.text for p in parent_results]
            rerank_results = await reranker.rerank(
                query=user_text, passages=parent_texts
            )
            surviving_texts = [r.text for r in rerank_results]
            sources = [
                SourceChunk(
                    document_id=parent_results[rr.original_index].document_id,
                    chunk_index=parent_results[rr.original_index].chunk_index,
                    score=round(rr.score, 4),
                )
                for rr in rerank_results
                if rr.original_index < len(parent_results)
            ]
        elif parent_results:
            surviving_texts = [p.text for p in parent_results]
            sources = [
                SourceChunk(
                    document_id=p.document_id,
                    chunk_index=p.chunk_index,
                    score=round(p.best_child_similarity, 4),
                )
                for p in parent_results
            ]
        else:
            surviving_texts = []
            sources = []

    except Exception as exc:
        logger.error("[Widget] RAG pre-processing failed: %s", exc)
        raise HTTPException(status_code=500, detail="Processing failed. Please try again.")

    t_pre = time.time()
    logger.info("[Widget] Pre-processing: %.1fs (bot=%s)", t_pre - t0, bot_id)

    # ── Stream LLM response ──────────────────────────────────────

    async def event_stream():
        # Send sources first
        sources_data = json.dumps(
            {"type": "sources", "sources": [s.model_dump() for s in sources]},
            ensure_ascii=False,
        )
        yield f"data: {sources_data}\n\n"

        # Stream tokens
        full_answer = []
        try:
            async for token in generate_response_stream(
                user_query=user_text,
                retrieved_contexts=surviving_texts,
            ):
                full_answer.append(token)
                token_data = json.dumps(
                    {"type": "token", "content": token},
                    ensure_ascii=False,
                )
                yield f"data: {token_data}\n\n"
        except Exception as stream_exc:
            logger.error("[Widget] LLM streaming failed: %s", stream_exc)
            err = json.dumps(
                {"type": "token", "content": "\n\n(An error occurred while processing your request.)"},
            )
            yield f"data: {err}\n\n"

        # Done signal with session_id, signed token, and current status
        yield f"data: {json.dumps({'type': 'done', 'session_id': session_id, 'session_token': _sign_session(session_id), 'session_status': 'active'})}\n\n"

        # Save assistant message
        answer_text = "".join(full_answer)
        try:
            sb = get_supabase()
            await (
                sb.table("chat_messages")
                .insert({
                    "id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "organization_id": organization_id,
                    "role": "assistant",
                    "content": answer_text,
                    "metadata": {
                        "sources": [s.model_dump() for s in sources],
                        "reranked_count": len(sources),
                    },
                })
            ).execute()
            await (
                sb.table("chat_sessions")
                .update({"last_message_at": "now()"})
                .eq("id", session_id)
                .eq("organization_id", organization_id)
            ).execute()
        except Exception as log_exc:
            logger.warning("[Widget] Failed to save assistant message: %s", log_exc)

        logger.info("[Widget] Stream complete: %.1fs total (bot=%s)", time.time() - t0, bot_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Chat History ─────────────────────────────────────────────────


@router.get("/history/{session_id}", response_model=list[WidgetMessageResponse])
@limiter.limit("30/minute")
async def get_widget_history(
    request: Request,
    session_id: str,
    session_token: str = Query(..., description="HMAC token for session ownership verification"),
) -> list[WidgetMessageResponse]:
    """Get chat history for a widget session.

    Used when the visitor refreshes the page — the widget reloads
    messages from localStorage session_id.
    Requires session_token (HMAC) to prevent session enumeration.
    """
    if not _verify_session_token(session_id, session_token):
        raise HTTPException(status_code=403, detail="Invalid session token.")

    supabase = get_supabase()

    try:
        result = await (
            supabase.table("chat_messages")
            .select("id, role, content, created_at")
            .eq("session_id", session_id)
            .order("created_at", desc=False)
        ).execute()

        return [WidgetMessageResponse(**m) for m in (result.data or [])]

    except Exception as exc:
        logger.error("[Widget] Failed to get history for session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Failed to load chat history.")


# ── List bots in same org ────────────────────────────────────────


@router.get("/bots")
@limiter.limit("30/minute")
async def list_widget_bots(
    request: Request,
    bot_id: str = Query(..., description="Any web-enabled bot in the org"),
) -> list[dict]:
    """Return all web-enabled bots in the same org as the given bot.

    Used by the widget to build the bot selection screen when an org
    has multiple web-enabled bots.
    """
    bot = await _get_widget_bot(bot_id)
    org_id = bot["organization_id"]
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("bots")
            .select("id, name")
            .eq("organization_id", org_id)
            .eq("is_web_enabled", True)
            .eq("is_active", True)
            .order("name")
        ).execute()
        return result.data or []
    except Exception as exc:
        logger.error("[Widget] Failed to list bots for org %s: %s", org_id, exc)
        raise HTTPException(status_code=500, detail="Failed to list bots.")


# ── Poll for admin replies ───────────────────────────────────────


class WidgetPollResponse(BaseModel):
    """Response for widget polling — new messages and session status."""

    messages: list[WidgetMessageResponse] = []
    session_status: str = "active"


@router.get("/poll/{session_id}", response_model=WidgetPollResponse)
@limiter.limit("60/minute")
async def poll_widget_session(
    request: Request,
    session_id: str,
    after: str = Query(..., description="ISO timestamp — return messages created after this"),
    token: str = Query(..., description="HMAC session token for ownership verification"),
) -> WidgetPollResponse:
    """Poll for new messages in a widget session (admin replies).

    Called by the widget every 3–10 seconds when the session is in
    human_takeover status.  Returns:
      - messages: admin replies received since 'after'
      - session_status: current status of the session
    """
    if not _verify_session_token(session_id, token):
        raise HTTPException(status_code=403, detail="Invalid session token.")

    supabase = get_supabase()
    try:
        sess = await (
            supabase.table("chat_sessions")
            .select("status")
            .eq("id", session_id)
            .limit(1)
        ).execute()
        if not sess.data:
            raise HTTPException(status_code=404, detail="Session not found.")

        session_status = sess.data[0].get("status", "active")

        msgs = await (
            supabase.table("chat_messages")
            .select("id, role, content, created_at")
            .eq("session_id", session_id)
            .gt("created_at", after)
            .order("created_at", desc=False)
        ).execute()

        return WidgetPollResponse(
            messages=[WidgetMessageResponse(**m) for m in (msgs.data or [])],
            session_status=session_status,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[Widget] Poll failed for session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail="Poll failed.")
