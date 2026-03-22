"""
SUNDAE Backend — FastAPI Application Entry Point
"""

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import init_supabase, close_supabase
from app.core.config import get_settings
from app.routers import health, document, chat, bot, inbox, approval, organization, webhook_line, widget
from app.services.ai_models import get_embedding_service, get_reranker_service

logger = logging.getLogger(__name__)


async def _warmup_models() -> None:
    """Preload AI models + warm up Ollama so first request is fast."""
    loop = asyncio.get_running_loop()

    # 1. Load Embedding model (BGE-M3) in background thread
    try:
        logger.info("[Warmup] Loading embedding model...")
        embedder = get_embedding_service()
        await loop.run_in_executor(None, embedder._ensure_loaded)
        logger.info("[Warmup] Embedding model ready.")
    except Exception as exc:
        logger.error("[Warmup] Embedding model failed to load (non-fatal): %s", exc)

    # 2. Load Reranker model (BGE-reranker-v2-m3) in background thread
    try:
        logger.info("[Warmup] Loading reranker model...")
        reranker = get_reranker_service()
        await loop.run_in_executor(None, reranker._ensure_loaded)
        logger.info("[Warmup] Reranker model ready.")
    except Exception as exc:
        logger.error("[Warmup] Reranker model failed to load (non-fatal): %s", exc)

    # 3. Warm up Ollama — load LLM into GPU/RAM
    settings = get_settings()
    try:
        logger.info("[Warmup] Warming up Ollama model: %s ...", settings.llm_model)
        async with httpx.AsyncClient(timeout=120) as client:
            await client.post(
                f"{settings.ollama_base_url}/api/generate",
                json={
                    "model": settings.llm_model,
                    "prompt": "hi",
                    "stream": False,
                    "options": {"num_predict": 1},
                    "keep_alive": "30m",
                },
            )
        logger.info("[Warmup] Ollama model ready.")
    except Exception as exc:
        logger.warning("[Warmup] Ollama warmup failed (non-fatal): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hook."""
    # ── Startup ──────────────────────────────────────────────────
    await init_supabase()
    # Preload models in background so they don't block server start
    asyncio.create_task(_warmup_models())
    yield
    # ── Shutdown ─────────────────────────────────────────────────
    await close_supabase()


app = FastAPI(
    title="SUNDAE API",
    description="On-premise AI Chatbot SaaS Platform for Thai Government & SMEs",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Middleware ───────────────────────────────────────────────────
_settings = get_settings()
_cors_origins = (
    [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    if hasattr(_settings, "cors_origins") and _settings.cors_origins
    else ["http://localhost:3000", "http://localhost:5173"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Active-Org"],
)

# ── Routers ──────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(document.router)
app.include_router(chat.router)
app.include_router(bot.router)
app.include_router(inbox.router)
app.include_router(approval.router)
app.include_router(organization.router)
app.include_router(webhook_line.router)
app.include_router(widget.router)

# ── Static files (widget.js etc.) ────────────────────────────────
import pathlib
from fastapi.staticfiles import StaticFiles

_static_dir = pathlib.Path(__file__).resolve().parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")
