"""
Health-check router.

Returns overall status plus per-service connectivity flags:
  - backend:  always true (if this responds, the server is up)
  - ollama:   reachable via httpx GET to /api/tags
  - supabase: reachable via a lightweight table query

Also provides /health/metrics for system resource monitoring
(CPU, RAM, Disk, GPU).
"""

import logging

import httpx
import psutil
from fastapi import APIRouter

from app.core.config import get_settings
from app.core.database import get_supabase

try:
    import GPUtil
    _HAS_GPU = True
except (ImportError, Exception):
    _HAS_GPU = False

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check() -> dict:
    settings = get_settings()

    # ── Ollama check ─────────────────────────────────────────────
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            ollama_ok = resp.status_code == 200
    except Exception as e:
        logger.warning("Ollama health check failed: %s", e)
        ollama_ok = False

    # ── Supabase check ───────────────────────────────────────────
    supabase_ok = False
    try:
        sb = get_supabase()
        await (sb.table("organizations").select("id").limit(1)).execute()
        supabase_ok = True
    except Exception as e:
        logger.warning("Supabase health check failed: %s", e)
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


@router.get("/health/metrics")
async def system_metrics() -> dict:
    """Return current CPU / RAM / Disk / GPU usage."""

    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.5)

    # RAM
    mem = psutil.virtual_memory()
    ram_total_gb = round(mem.total / (1024 ** 3), 2)
    ram_used_gb = round(mem.used / (1024 ** 3), 2)
    ram_percent = mem.percent

    # Disk (root partition)
    disk = psutil.disk_usage("/")
    disk_total_gb = round(disk.total / (1024 ** 3), 2)
    disk_used_gb = round(disk.used / (1024 ** 3), 2)
    disk_percent = disk.percent

    # GPU (optional)
    gpu_list: list[dict] = []
    if _HAS_GPU:
        try:
            for g in GPUtil.getGPUs():
                gpu_list.append({
                    "id": g.id,
                    "name": g.name,
                    "load_percent": round(g.load * 100, 1),
                    "memory_used_mb": round(g.memoryUsed),
                    "memory_total_mb": round(g.memoryTotal),
                    "temperature": g.temperature,
                })
        except Exception:
            pass

    # Network I/O (cumulative bytes since boot)
    net = psutil.net_io_counters()
    net_sent_mb = round(net.bytes_sent / (1024 ** 2), 2)
    net_recv_mb = round(net.bytes_recv / (1024 ** 2), 2)

    return {
        "cpu_percent": cpu_percent,
        "ram_total_gb": ram_total_gb,
        "ram_used_gb": ram_used_gb,
        "ram_percent": ram_percent,
        "disk_total_gb": disk_total_gb,
        "disk_used_gb": disk_used_gb,
        "disk_percent": disk_percent,
        "gpu": gpu_list,
        "net_sent_mb": net_sent_mb,
        "net_recv_mb": net_recv_mb,
    }
