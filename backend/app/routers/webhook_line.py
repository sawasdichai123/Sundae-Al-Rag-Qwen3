"""
SUNDAE Backend — LINE Webhook Router

Receives webhook events from LINE, processes them through the RAG pipeline,
and replies via the LINE Reply API.

Multi-Tenant:
    Each bot has its own line_channel_secret + line_access_token stored in DB.
    The webhook URL is: POST /api/webhook/line/{bot_id}

Flow:
    1. LINE sends webhook → this router
    2. Look up bot from DB → get channel_secret + access_token
    3. Verify signature using bot's own channel_secret
    4. For each text message event:
       a. Find or create a chat_session (channel='line')
       b. If session is 'human_takeover' → save message only (no AI)
       c. Otherwise → run RAG pipeline → reply via LINE Reply API
    5. Return 200 OK immediately (processing in background)

SECURITY:
    No JWT auth — LINE servers don't send Supabase tokens.
    Authentication is via HMAC-SHA256 signature verification.
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from app.core.database import get_supabase
from app.core.line_auth import verify_line_signature_with_secret
from app.services.line_service import reply_message
from app.services.ai_models import get_embedding_service, get_reranker_service
from app.services.llm_generator import generate_response
from app.services.vector_search import search_parent_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["LINE Webhook"])


# ── Helper: Get or create LINE chat session ──────────────────────


async def _get_or_create_line_session(
    line_user_id: str,
    bot_id: str,
    organization_id: str,
) -> dict:
    """Find an active/human_takeover LINE session or create a new one."""
    supabase = get_supabase()

    # Look for existing active or human_takeover session
    try:
        result = await (
            supabase.table("chat_sessions")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("bot_id", bot_id)
            .eq("platform_user_id", line_user_id)
            .eq("platform_source", "line")
            .in_("status", ["active", "human_takeover"])
            .order("last_message_at", desc=True)
            .limit(1)
        ).execute()

        if result.data:
            return result.data[0]
    except Exception as exc:
        logger.warning("Failed to find existing LINE session: %s", exc)

    # Create new session
    new_session = {
        "id": str(uuid.uuid4()),
        "organization_id": organization_id,
        "bot_id": bot_id,
        "channel": "line",
        "platform_source": "line",
        "platform_user_id": line_user_id,
        "external_user_id": line_user_id,
        "status": "active",
        "last_message_at": "now()",
    }

    try:
        result = await (
            supabase.table("chat_sessions")
            .insert(new_session)
        ).execute()
        logger.info("[LINE] New session created: %s for user %s", new_session["id"], line_user_id[:10])
        return result.data[0] if result.data else new_session
    except Exception as exc:
        logger.error("Failed to create LINE session: %s", exc)
        return new_session


# ── Helper: Save message to DB ───────────────────────────────────


async def _save_message(
    session_id: str,
    organization_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    """Insert a message into chat_messages and update session timestamp."""
    supabase = get_supabase()
    try:
        msg = {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "organization_id": organization_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
        }
        await (supabase.table("chat_messages").insert(msg)).execute()

        await (
            supabase.table("chat_sessions")
            .update({"last_message_at": "now()"})
            .eq("id", session_id)
        ).execute()
    except Exception as exc:
        logger.warning("Failed to save message (session=%s): %s", session_id, exc)


# ── Helper: Process single LINE message through RAG ──────────────


async def _process_line_message(
    user_text: str,
    reply_token: str,
    line_user_id: str,
    bot_id: str,
    organization_id: str,
    access_token: str,
) -> None:
    """Full RAG pipeline for a single LINE message, then reply."""

    t0 = time.time()

    # 1. Get or create session
    session = await _get_or_create_line_session(line_user_id, bot_id, organization_id)
    session_id = session["id"]

    # 2. Save user message
    await _save_message(session_id, organization_id, "user", user_text)

    # 3. If human_takeover — don't let AI respond, just save message
    if session.get("status") == "human_takeover":
        logger.info("[LINE] Session %s is in human_takeover — skipping AI reply", session_id)
        return

    # 4. Run RAG pipeline
    try:
        # Embed
        embedder = get_embedding_service()
        query_embedding = await embedder.embed_query(user_text)

        # Vector search
        parent_results = await search_parent_chunks(
            query_embedding=query_embedding,
            organization_id=organization_id,
            bot_id=bot_id,
            top_k=3,
        )

        # Rerank (skip for ≤2 results)
        if parent_results and len(parent_results) > 2:
            reranker = get_reranker_service()
            parent_texts = [p.text for p in parent_results]
            rerank_results = await reranker.rerank(
                query=user_text,
                passages=parent_texts,
            )
            surviving_texts = [r.text for r in rerank_results]
        elif parent_results:
            surviving_texts = [p.text for p in parent_results]
        else:
            surviving_texts = []

        # Generate LLM response
        answer = await generate_response(
            user_query=user_text,
            retrieved_contexts=surviving_texts,
        )

        t1 = time.time()
        logger.info("[LINE] RAG pipeline: %.1fs (org=%s, session=%s)", t1 - t0, organization_id, session_id)

    except Exception as exc:
        logger.error("[LINE] RAG pipeline failed: %s", exc)
        answer = "ขออภัยค่ะ ระบบไม่สามารถประมวลผลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"

    # 5. Save assistant message
    await _save_message(session_id, organization_id, "assistant", answer)

    # 6. Reply via LINE
    await reply_message(reply_token, answer, access_token)


# ── Webhook Endpoint ─────────────────────────────────────────────


@router.post("/line/{bot_id}")
async def line_webhook(
    bot_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """Receive LINE webhook events for a specific bot.

    1. Look up bot → get channel_secret + access_token from DB
    2. Verify webhook signature
    3. Process text messages via RAG pipeline (background)
    4. Return 200 OK immediately (LINE requires response within seconds)
    """
    supabase = get_supabase()

    # ── 1. Look up bot ──────────────────────────────────────────
    try:
        result = await (
            supabase.table("bots")
            .select("id, organization_id, line_access_token, line_channel_secret, is_active")
            .eq("id", bot_id)
            .limit(1)
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Bot not found.")

        bot = result.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to look up bot %s: %s", bot_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to look up bot: {exc}")

    if not bot.get("is_active", True):
        logger.info("[LINE] Bot %s is inactive — ignoring webhook", bot_id)
        return {"status": "ignored", "reason": "bot_inactive"}

    access_token = bot.get("line_access_token")
    channel_secret = bot.get("line_channel_secret")

    if not access_token or not channel_secret:
        logger.error("[LINE] Bot %s missing LINE credentials", bot_id)
        raise HTTPException(
            status_code=500,
            detail="Bot LINE credentials not configured. Set both Channel Access Token and Channel Secret.",
        )

    organization_id = bot["organization_id"]

    # ── 2. Verify signature ─────────────────────────────────────
    body = await request.body()
    signature = request.headers.get("X-Line-Signature")
    verify_line_signature_with_secret(body, signature, channel_secret)

    # ── 3. Parse events ─────────────────────────────────────────
    import json
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    events = payload.get("events", [])
    if not events:
        logger.debug("[LINE] Webhook received with no events (verification ping)")
        return {"status": "ok", "events": 0}

    # ── 4. Process each text message event in background ────────
    processed = 0
    for event in events:
        if event.get("type") != "message":
            continue
        if event.get("message", {}).get("type") != "text":
            continue

        user_text = event.get("message", {}).get("text", "").strip()
        if not user_text:
            continue  # Skip non-text messages
        reply_token = event.get("replyToken", "")
        line_user_id = event.get("source", {}).get("userId", "unknown")

        background_tasks.add_task(
            _process_line_message,
            user_text=user_text,
            reply_token=reply_token,
            line_user_id=line_user_id,
            bot_id=bot_id,
            organization_id=organization_id,
            access_token=access_token,
        )
        processed += 1

    logger.info("[LINE] Webhook: %d text events queued for bot %s", processed, bot_id)

    return {"status": "ok", "events": processed}
