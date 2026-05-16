"""
SUNDAE Backend — LINE Webhook Router (Per-Org)

Per-Org Design:
    1 Organization = 1 LINE OA = 1 set of credentials
    Webhook URL: POST /api/webhook/line/{org_id}

Bot Selection Flow:
    - Org with 1 bot  → auto-select, no menu shown
    - Org with N bots → Quick Reply menu on first message
    - Switch keywords (เปลี่ยนบอท / สลับบอท / เมนู / menu) → resolve session + show menu
    - Bot selection response "bot:{bot_id}" → create session + send greeting

SECURITY:
    No JWT auth — LINE servers don't send Supabase tokens.
    Authentication is via HMAC-SHA256 signature verification (per-org secret).
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from app.core.database import get_supabase
from app.core.line_auth import verify_line_signature_with_secret
from app.core.utils import decrypt_secret
from app.services.line_service import reply_message, reply_with_quick_reply, reply_flex_message
from app.services.ai_models import get_embedding_service, get_reranker_service
from app.services.llm_generator import generate_response
from app.services.vector_search import search_parent_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook", tags=["LINE Webhook"])

SESSION_IDLE_MINUTES = 5   # auto-expire session หลังจาก idle กี่นาที

SWITCH_KEYWORDS     = {"เปลี่ยนบอท", "สลับบอท", "เมนู", "/menu", "menu"}
END_KEYWORDS        = {"จบการสนทนา", "ปิดการสนทนา", "end", "/end"}
AGENT_KEYWORDS      = {"ติดต่อเจ้าหน้าที่", "คุยกับเจ้าหน้าที่", "agent", "/agent"}
HELP_KEYWORDS       = {"ช่วยเหลือ", "วิธีใช้", "help", "/help", "?", "คำสั่ง"}


# ── Helpers: Session management ──────────────────────────────────


async def _get_active_session(line_user_id: str, organization_id: str) -> dict | None:
    """Return the most recent active or human_takeover session for this LINE user.

    Auto-expires sessions idle for more than SESSION_IDLE_MINUTES minutes —
    marks them resolved and returns None so the caller starts a fresh session.
    """
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("chat_sessions")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("platform_user_id", line_user_id)
            .eq("platform_source", "line")
            .in_("status", ["active", "human_takeover"])
            .order("last_message_at", desc=True)
            .limit(1)
        ).execute()

        if not result.data:
            return None

        session = result.data[0]

        # ── Auto-expire: resolve session if idle too long ─────────
        last_msg_str = session.get("last_message_at")
        if last_msg_str:
            try:
                last_msg = datetime.fromisoformat(last_msg_str.replace("Z", "+00:00"))
                idle_minutes = (datetime.now(timezone.utc) - last_msg).total_seconds() / 60
                if idle_minutes >= SESSION_IDLE_MINUTES:
                    await (
                        supabase.table("chat_sessions")
                        .update({"status": "resolved"})
                        .eq("id", session["id"])
                    ).execute()
                    logger.info("[LINE] Session %s auto-expired (idle %.1fm)", session["id"][:8], idle_minutes)
                    return None
            except Exception:
                pass  # ถ้า parse ไม่ได้ใช้ session ปกติ

        return session
    except Exception as exc:
        logger.warning("[LINE] Failed to get active session: %s", exc)
        return None


async def _resolve_active_sessions(line_user_id: str, organization_id: str) -> None:
    """Mark all active sessions for this LINE user as resolved."""
    supabase = get_supabase()
    try:
        await (
            supabase.table("chat_sessions")
            .update({"status": "resolved"})
            .eq("organization_id", organization_id)
            .eq("platform_user_id", line_user_id)
            .eq("platform_source", "line")
            .in_("status", ["active", "human_takeover"])
        ).execute()
    except Exception as exc:
        logger.warning("[LINE] Failed to resolve sessions: %s", exc)


async def _create_line_session(
    line_user_id: str,
    bot_id: str,
    organization_id: str,
) -> dict:
    """Create a new LINE chat session for the given user + bot."""
    supabase = get_supabase()
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
        result = await (supabase.table("chat_sessions").insert(new_session)).execute()
        logger.info("[LINE] Session created: %s → bot %s", new_session["id"][:8], bot_id[:8])
        return result.data[0] if result.data else new_session
    except Exception as exc:
        logger.error("[LINE] Failed to create session: %s", exc)
        return new_session


# ── Helper: Save message ─────────────────────────────────────────


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
        await (supabase.table("chat_messages").insert({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "organization_id": organization_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
        })).execute()
        await (
            supabase.table("chat_sessions")
            .update({"last_message_at": "now()"})
            .eq("id", session_id)
        ).execute()
    except Exception as exc:
        logger.warning("[LINE] Failed to save message (session=%s): %s", session_id, exc)


# ── Helper: Lookup member by LINE UID ────────────────────────────


async def _lookup_member_by_line(organization_id: str, line_user_id: str) -> dict | None:
    """Find org member by their linked LINE User ID."""
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("org_members")
            .select("user_id, org_role")
            .eq("organization_id", organization_id)
            .eq("line_user_id", line_user_id)
            .limit(1)
        ).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.warning("[LINE] Failed to lookup member by LINE UID: %s", exc)
        return None


# ── Helper: Bot list (visibility-filtered) ───────────────────────


async def _get_visible_bots(organization_id: str, line_user_id: str) -> list[dict]:
    """Return active bots filtered by LINE user's visibility permissions.

    Bots without any linked documents are excluded — they have nothing to
    answer from, so showing them would only confuse users.
    """
    supabase = get_supabase()
    try:
        result = await (
            supabase.table("bots")
            .select("id, name, visibility, visible_to")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .order("created_at", desc=False)
        ).execute()
        all_bots = result.data or []
    except Exception as exc:
        logger.error("[LINE] Failed to load bots for org %s: %s", organization_id, exc)
        return []

    # Filter out bots that have no documents linked
    try:
        docs_result = await (
            supabase.table("documents")
            .select("bot_ids")
            .eq("organization_id", organization_id)
        ).execute()
        bots_with_docs: set[str] = set()
        for doc in (docs_result.data or []):
            for bid in (doc.get("bot_ids") or []):
                bots_with_docs.add(bid)
        all_bots = [b for b in all_bots if b["id"] in bots_with_docs]
    except Exception as exc:
        logger.warning("[LINE] Could not filter bots by documents: %s", exc)

    member = await _lookup_member_by_line(organization_id, line_user_id)

    if member:
        user_id = member["user_id"]
        is_admin = member.get("org_role") == "admin"
        return [
            b for b in all_bots
            if b.get("visibility", "all") == "all"
            or is_admin
            or user_id in (b.get("visible_to") or [])
        ]
    else:
        return [b for b in all_bots if b.get("visibility", "all") == "all"]


# ── Helper: Send bot selection Quick Reply ───────────────────────


async def _send_bot_selection(
    reply_token: str,
    bots: list[dict],
    access_token: str,
) -> None:
    """Send a Flex Message card for bot selection."""
    bot_buttons = []
    for i, bot in enumerate(bots):
        if i > 0:
            bot_buttons.append({"type": "separator", "margin": "sm"})
        bot_buttons.append({
            "type": "box",
            "layout": "horizontal",
            "action": {
                "type": "postback",
                "label": bot["name"][:40],
                "data": f"bot:{bot['id']}",
                "displayText": f"เลือก: {bot['name'][:20]}",
            },
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {
                            "type": "text",
                            "text": "📋",
                            "size": "xl",
                            "align": "center",
                        }
                    ],
                    "width": "40px",
                    "justifyContent": "center",
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {
                            "type": "text",
                            "text": bot["name"][:30],
                            "weight": "bold",
                            "size": "sm",
                            "color": "#333333",
                            "wrap": True,
                        }
                    ],
                    "flex": 1,
                    "justifyContent": "center",
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {
                            "type": "text",
                            "text": "เลือก ›",
                            "size": "xs",
                            "color": "#4A90D9",
                            "align": "end",
                            "weight": "bold",
                        }
                    ],
                    "justifyContent": "center",
                },
            ],
            "paddingAll": "12px",
            "cornerRadius": "lg",
            "backgroundColor": "#F7F8FA",
            "margin": "sm",
        })

    flex_content = {
        "type": "bubble",
        "size": "mega",
        "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": "🤖 SUNDAE",
                    "weight": "bold",
                    "size": "lg",
                    "color": "#333333",
                },
                {
                    "type": "text",
                    "text": "กรุณาเลือกบริการที่ต้องการ",
                    "size": "sm",
                    "color": "#888888",
                    "margin": "sm",
                },
            ],
            "paddingAll": "16px",
            "backgroundColor": "#FFD100",
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": bot_buttons,
            "paddingAll": "12px",
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "text",
                    "text": "พิมพ์ 'เปลี่ยนบอท' เพื่อเลือกใหม่",
                    "size": "xxs",
                    "color": "#AAAAAA",
                    "align": "center",
                }
            ],
            "paddingAll": "10px",
        },
        "styles": {
            "footer": {"separator": True},
        },
    }

    await reply_flex_message(
        reply_token=reply_token,
        flex_content=flex_content,
        alt_text="กรุณาเลือกบริการที่ต้องการ",
        access_token=access_token,
    )


# ── Helper: Handle bot selection response ────────────────────────


async def _handle_bot_selection(
    text: str,
    reply_token: str,
    line_user_id: str,
    organization_id: str,
    access_token: str,
    bots: list[dict],
) -> bool:
    """Handle 'bot:{bot_id}' Quick Reply selection. Returns True if handled."""
    if not text.startswith("bot:"):
        return False

    selected_bot_id = text[4:].strip()
    bot = next((b for b in bots if b["id"] == selected_bot_id), None)
    if not bot:
        return False

    session = await _create_line_session(line_user_id, selected_bot_id, organization_id)
    greeting = f"คุณกำลังพูดคุยกับ {bot['name']} พิมพ์คำถามได้เลยค่ะ"
    await reply_message(reply_token, greeting, access_token)
    await _save_message(session["id"], organization_id, "assistant", greeting)

    logger.info("[LINE] User %s selected bot %s", line_user_id[:10], bot["name"])
    return True


# ── Helper: Human takeover ──────────────────────────────────────


async def _request_human_takeover(session_id: str) -> None:
    """Set session status to human_takeover."""
    supabase = get_supabase()
    try:
        await (
            supabase.table("chat_sessions")
            .update({"status": "human_takeover"})
            .eq("id", session_id)
        ).execute()
    except Exception as exc:
        logger.warning("[LINE] Failed to set human_takeover for session %s: %s", session_id, exc)


# ── Helper: RAG pipeline ─────────────────────────────────────────


async def _process_line_message(
    user_text: str,
    reply_token: str,
    line_user_id: str,
    session: dict,
    access_token: str,
) -> None:
    """Full RAG pipeline for a single LINE message, then reply."""
    bot_id = session["bot_id"]
    organization_id = session["organization_id"]
    session_id = session["id"]
    t0 = time.time()

    await _save_message(session_id, organization_id, "user", user_text)

    if session.get("status") == "human_takeover":
        logger.info("[LINE] Session %s is human_takeover — skipping AI", session_id)
        return

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
            rerank_results = await reranker.rerank(
                query=user_text,
                passages=[p.text for p in parent_results],
            )
            surviving_texts = [r.text for r in rerank_results]
        elif parent_results:
            surviving_texts = [p.text for p in parent_results]
        else:
            surviving_texts = []

        answer = await generate_response(
            user_query=user_text,
            retrieved_contexts=surviving_texts,
        )
        logger.info("[LINE] RAG: %.1fs (org=%s, bot=%s)", time.time() - t0, organization_id[:8], bot_id[:8])

    except Exception as exc:
        logger.error("[LINE] RAG pipeline failed: %s", exc)
        answer = "ขออภัยค่ะ ระบบไม่สามารถประมวลผลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"

    await _save_message(session_id, organization_id, "assistant", answer)
    await reply_message(reply_token, answer, access_token)


# ── Webhook Endpoint ─────────────────────────────────────────────


@router.post("/line/{org_id}")
async def line_webhook(
    org_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict:
    """Receive LINE webhook events for an organization.

    1. Look up org → get credentials + verify is_line_enabled
    2. Verify HMAC-SHA256 signature
    3. Load active bots for org
    4. Per event: route based on bot selection flow
    5. Return 200 OK immediately
    """
    supabase = get_supabase()

    # ── 1. Look up org ───────────────────────────────────────────
    try:
        result = await (
            supabase.table("organizations")
            .select("id, line_access_token, line_channel_secret, is_line_enabled")
            .eq("id", org_id)
            .limit(1)
        ).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Organization not found.")
        org = result.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[LINE] Failed to look up org %s: %s", org_id, exc)
        raise HTTPException(status_code=500, detail="Failed to look up organization.")

    if not org.get("is_line_enabled"):
        return {"status": "ignored", "reason": "line_disabled"}

    access_token = decrypt_secret(org.get("line_access_token") or "")
    channel_secret = decrypt_secret(org.get("line_channel_secret") or "")

    if not access_token or not channel_secret:
        logger.error("[LINE] Org %s missing LINE credentials", org_id)
        raise HTTPException(
            status_code=500,
            detail="LINE credentials not configured. Set both Channel Access Token and Channel Secret.",
        )

    # ── 2. Verify signature ──────────────────────────────────────
    try:
        body = await request.body()
    except Exception:
        # LINE may disconnect before body is fully sent (timeout/verify ping)
        return {"status": "ok"}
    signature = request.headers.get("X-Line-Signature")
    verify_line_signature_with_secret(body, signature, channel_secret)

    # ── 3. Parse events ──────────────────────────────────────────
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    events = payload.get("events", [])
    if not events:
        logger.debug("[LINE] Verification ping from org %s", org_id)
        return {"status": "ok", "events": 0}

    # ── 4–5. Process each event (message or postback) ─────────────
    processed = 0
    for event in events:
        event_type = event.get("type")

        # Postback events — bot selection via Quick Reply (no visible text in chat)
        if event_type == "postback":
            postback_data = event.get("postback", {}).get("data", "").strip()
            if not postback_data.startswith("bot:"):
                continue
            reply_token = event.get("replyToken", "")
            line_user_id = event.get("source", {}).get("userId", "unknown")
            bots = await _get_visible_bots(org_id, line_user_id)
            if not bots:
                continue
            background_tasks.add_task(
                _handle_bot_selection, postback_data, reply_token, line_user_id, org_id, access_token, bots
            )
            processed += 1
            continue

        if event_type != "message":
            continue
        if event.get("message", {}).get("type") != "text":
            continue

        user_text = event.get("message", {}).get("text", "").strip()
        if not user_text:
            continue

        reply_token = event.get("replyToken", "")
        line_user_id = event.get("source", {}).get("userId", "unknown")

        # 5-bind. Binding code (6 digits) → link LINE to org member
        if user_text.isdigit() and len(user_text) == 6:
            from app.routers.organization import try_bind_line_account
            bound = await try_bind_line_account(user_text, line_user_id, org_id)
            if bound:
                bind_text = "✅ ผูกบัญชีสำเร็จ! ตอนนี้คุณสามารถเข้าถึงบอทที่จำกัดสิทธิ์ได้แล้ว"
                background_tasks.add_task(reply_message, reply_token, bind_text, access_token)
                processed += 1
                continue
            else:
                bind_fail_text = "❌ รหัสไม่ถูกต้องหรือหมดอายุ กรุณาสร้างรหัสใหม่จากหน้าโปรไฟล์"
                background_tasks.add_task(reply_message, reply_token, bind_fail_text, access_token)
                processed += 1
                continue

        # Load bots filtered by this user's visibility
        bots = await _get_visible_bots(org_id, line_user_id)

        # 5a. Help keyword → แสดงคำสั่งที่ใช้ได้
        if user_text.lower() in HELP_KEYWORDS:
            help_text = (
                "📋 คำสั่งที่ใช้ได้:\n"
                "• พิมพ์คำถามได้เลย — AI จะตอบจากเอกสาร\n"
                "• เปลี่ยนบอท — เลือกบริการใหม่\n"
                "• ติดต่อเจ้าหน้าที่ — ขอคุยกับเจ้าหน้าที่\n"
                "• จบการสนทนา — ปิดการสนทนาปัจจุบัน\n"
                "• ช่วยเหลือ — แสดงคำสั่งนี้"
            )
            background_tasks.add_task(reply_message, reply_token, help_text, access_token)
            processed += 1
            continue

        # 5b. End keyword → resolve session
        if user_text.lower() in END_KEYWORDS:
            await _resolve_active_sessions(line_user_id, org_id)
            end_text = "ขอบคุณที่ใช้บริการค่ะ หากต้องการความช่วยเหลืออีกครั้ง พิมพ์ข้อความมาได้เลยค่ะ 😊"
            background_tasks.add_task(reply_message, reply_token, end_text, access_token)
            processed += 1
            continue

        # 5c. Agent keyword → human takeover
        if user_text.lower() in AGENT_KEYWORDS:
            session = await _get_active_session(line_user_id, org_id)
            if session:
                await _request_human_takeover(session["id"])
                agent_text = "รับทราบค่ะ กรุณารอสักครู่ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุดค่ะ 🙏"
                background_tasks.add_task(reply_message, reply_token, agent_text, access_token)
                background_tasks.add_task(_save_message, session["id"], org_id, "assistant", agent_text)
            else:
                # ไม่มี session — สร้างใหม่แล้ว takeover ทันที
                if bots:
                    session = await _create_line_session(line_user_id, bots[0]["id"], org_id)
                    await _request_human_takeover(session["id"])
                    agent_text = "รับทราบค่ะ กรุณารอสักครู่ เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุดค่ะ 🙏"
                    background_tasks.add_task(reply_message, reply_token, agent_text, access_token)
                    background_tasks.add_task(_save_message, session["id"], org_id, "assistant", agent_text)
            processed += 1
            continue

        # No visible bots for this user → skip bot-dependent actions
        if not bots:
            no_bot_text = "ขออภัยค่ะ ไม่มีบอทที่คุณสามารถเข้าถึงได้ในขณะนี้"
            background_tasks.add_task(reply_message, reply_token, no_bot_text, access_token)
            processed += 1
            continue

        # 5e. Switch keyword → reset session + show bot selection
        if user_text.lower() in SWITCH_KEYWORDS:
            await _resolve_active_sessions(line_user_id, org_id)
            if len(bots) == 1:
                session = await _create_line_session(line_user_id, bots[0]["id"], org_id)
                greeting = f"คุณกำลังพูดคุยกับ {bots[0]['name']} พิมพ์คำถามได้เลยค่ะ"
                background_tasks.add_task(reply_message, reply_token, greeting, access_token)
                background_tasks.add_task(_save_message, session["id"], org_id, "assistant", greeting)
            else:
                background_tasks.add_task(_send_bot_selection, reply_token, bots, access_token)
            processed += 1
            continue

        # 5f. Bot selection from Quick Reply "bot:{bot_id}"
        if user_text.startswith("bot:"):
            handled = await _handle_bot_selection(
                text=user_text,
                reply_token=reply_token,
                line_user_id=line_user_id,
                organization_id=org_id,
                access_token=access_token,
                bots=bots,
            )
            if handled:
                processed += 1
                continue

        # 5g. Existing active session → RAG with that bot
        session = await _get_active_session(line_user_id, org_id)
        if session:
            background_tasks.add_task(
                _process_line_message,
                user_text=user_text,
                reply_token=reply_token,
                line_user_id=line_user_id,
                session=session,
                access_token=access_token,
            )
            processed += 1
            continue

        # 5h. No session + single bot → auto-select + RAG
        if len(bots) == 1:
            session = await _create_line_session(line_user_id, bots[0]["id"], org_id)
            background_tasks.add_task(
                _process_line_message,
                user_text=user_text,
                reply_token=reply_token,
                line_user_id=line_user_id,
                session=session,
                access_token=access_token,
            )
            processed += 1
            continue

        # 5i. No session + multiple bots → show selection menu
        background_tasks.add_task(_send_bot_selection, reply_token, bots, access_token)
        processed += 1

    logger.info("[LINE] Webhook: %d events processed for org %s", processed, org_id[:8])
    return {"status": "ok", "events": processed}
