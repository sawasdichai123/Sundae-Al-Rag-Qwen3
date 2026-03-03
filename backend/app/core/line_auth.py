"""
SUNDAE Backend — LINE Webhook Authentication

Provides FastAPI dependency for verifying LINE webhook requests:
  - verify_line_signature: Validates X-Line-Signature header using HMAC-SHA256

LINE Platform sends webhook events with:
  - Body: JSON payload with events
  - Header X-Line-Signature: HMAC-SHA256(body, channel_secret) encoded as Base64

This module does NOT use Supabase Auth (no JWT involved).
Authentication is purely based on the shared channel secret.

Usage in routers::

    @router.post("/line/webhook")
    async def line_webhook(
        request: Request,
        _: None = Depends(verify_line_signature),
    ):
        ...
"""

from __future__ import annotations

import hashlib
import hmac
import base64
import logging

from fastapi import Depends, HTTPException, Request, status

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def verify_line_signature(request: Request) -> None:
    """Verify that the incoming request is genuinely from the LINE Platform.

    Validates the X-Line-Signature header against the request body using
    HMAC-SHA256 with the LINE Channel Secret.

    This dependency MUST be used instead of Supabase JWT auth for LINE
    webhook endpoints, because LINE servers do not send Supabase tokens.

    Raises:
        HTTPException 400: Missing X-Line-Signature header.
        HTTPException 401: Invalid signature (request not from LINE).
        HTTPException 500: LINE_CHANNEL_SECRET not configured.
    """
    settings = get_settings()

    if not settings.line_channel_secret:
        logger.error("LINE_CHANNEL_SECRET is not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LINE webhook is not configured on this server.",
        )

    # ── 1. Extract signature from header ─────────────────────────
    signature = request.headers.get("X-Line-Signature")
    if not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Line-Signature header.",
        )

    # ── 2. Read request body ─────────────────────────────────────
    body = await request.body()

    # ── 3. Compute expected signature ────────────────────────────
    hash_digest = hmac.new(
        settings.line_channel_secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).digest()
    expected_signature = base64.b64encode(hash_digest).decode("utf-8")

    # ── 4. Constant-time comparison ──────────────────────────────
    if not hmac.compare_digest(signature, expected_signature):
        logger.warning("LINE webhook signature mismatch — possible forgery")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid LINE signature. Request rejected.",
        )

    logger.debug("[LINE Auth] Signature verified OK")
