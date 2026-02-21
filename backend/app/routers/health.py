"""
Health-check router.

Returns overall status plus per-service connectivity flags:
  - backend:  always true (if this responds, the server is up)
  - ollama:   reachable via httpx GET to /api/tags
  - supabase: reachable via a lightweight table query
"""

import httpx
from fastapi import APIRouter

from app.core.config import get_settings
from app.core.database import get_supabase

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check() -> dict:
    settings = get_settings()

    # ── Ollama check ─────────────────────────────────────────────
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            ollama_ok = resp.status_code == 200
    except Exception:
        ollama_ok = False

    # ── Supabase check ───────────────────────────────────────────
    supabase_ok = False
    try:
        sb = get_supabase()
        await (sb.table("organizations").select("id").limit(1)).execute()
        supabase_ok = True
    except Exception:
        supabase_ok = False

    overall = "ok" if (ollama_ok and supabase_ok) else "degraded"

    return {
        "status": overall,
        "services": {
            "backend": True,
            "ollama": ollama_ok,
            "supabase": supabase_ok,
        },
    }
