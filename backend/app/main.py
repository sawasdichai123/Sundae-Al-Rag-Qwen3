"""
SUNDAE Backend — FastAPI Application Entry Point
"""

import asyncio
import logging
import uuid as _uuid_module
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.database import init_supabase, close_supabase
from app.core.config import get_settings
from app.core.limiter import limiter
from app.routers import health, document, chat, bot, inbox, approval, organization, webhook_line, widget
from app.services.ai_models import get_embedding_service, get_reranker_service

logger = logging.getLogger(__name__)


async def _validate_startup_config() -> None:
    """Validate required env vars and check service connectivity on startup."""
    settings = get_settings()

    # ── 1. Required env vars ─────────────────────────────────────
    missing = []
    if not settings.supabase_url:
        missing.append("SUPABASE_URL")
    if not settings.supabase_service_role_key:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not settings.supabase_jwt_secret:
        missing.append("SUPABASE_JWT_SECRET")
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}. "
            "Check your .env file."
        )

    # ── 2. Ollama reachability (non-fatal — just log) ─────────────
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            if resp.status_code == 200:
                logger.info("[Startup] Ollama reachable at %s", settings.ollama_base_url)
            else:
                logger.warning(
                    "[Startup] Ollama returned HTTP %d — AI features may be degraded.",
                    resp.status_code,
                )
    except Exception as exc:
        logger.warning(
            "[Startup] Ollama not reachable at %s (%s) — AI features will be unavailable until Ollama starts.",
            settings.ollama_base_url,
            exc,
        )


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
    await _validate_startup_config()
    await init_supabase()
    # Preload models in background so they don't block server start
    _warmup_task = asyncio.create_task(_warmup_models())
    _warmup_task.add_done_callback(
        lambda t: logger.error("[Warmup] Unhandled exception: %s", t.exception())
        if not t.cancelled() and t.exception()
        else None
    )
    yield
    # ── Shutdown ─────────────────────────────────────────────────
    await close_supabase()


_settings = get_settings()

app = FastAPI(
    title="SUNDAE API",
    description="On-premise AI Chatbot SaaS Platform for Thai Government & SMEs",
    version="0.1.0",
    lifespan=lifespan,
    # MED-04: Disable interactive docs in production to avoid leaking schema
    docs_url="/docs" if _settings.debug else None,
    redoc_url="/redoc" if _settings.debug else None,
    openapi_url="/openapi.json" if _settings.debug else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Middleware ───────────────────────────────────────────────────
_cors_origins = (
    [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    if hasattr(_settings, "cors_origins") and _settings.cors_origins
    else ["http://localhost:3000", "http://localhost:5173"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Active-Org"],
)


# REC-03: Security headers — reduce common browser-based attack surface
@app.middleware("http")
async def security_headers(request: Request, call_next):
    from starlette.requests import ClientDisconnect
    from starlette.responses import Response as _Response
    try:
        response = await call_next(request)
    except ClientDisconnect:
        return _Response(status_code=200)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if not _settings.debug:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# REC-01: Request ID — add X-Request-ID header to every response for tracing
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    from starlette.requests import ClientDisconnect
    from starlette.responses import Response as _Response
    request_id = _uuid_module.uuid4().hex[:8]
    logger.info("[%s] %s %s", request_id, request.method, request.url.path)
    try:
        response = await call_next(request)
    except ClientDisconnect:
        return _Response(status_code=200)
    response.headers["X-Request-ID"] = request_id
    return response

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
