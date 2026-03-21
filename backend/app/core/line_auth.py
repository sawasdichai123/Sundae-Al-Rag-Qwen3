"""
SUNDAE Backend — LINE Webhook Authentication

Provides functions for verifying LINE webhook requests:
  - verify_line_signature_with_secret: Validates using a provided channel secret
  - verify_line_signature: FastAPI dependency using .env fallback (legacy)

LINE Platform sends webhook events with:
  - Body: JSON payload with events
  - Header X-Line-Signature: HMAC-SHA256(body, channel_secret) encoded as Base64

This module does NOT use Supabase Auth (no JWT involved).
Authentication is purely based on the shared channel secret.

Usage in routers::

    # Dynamic (Multi-Tenant) — preferred for per-bot secrets
    secret = bot_record["line_channel_secret"]
    body = await request.body()
    verify_line_signature_with_secret(body, request.headers.get("X-Line-Signature"), secret)

    # Legacy dependency (uses .env LINE_CHANNEL_SECRET)
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


def verify_line_signature_with_secret(
    body: bytes,
    signature: str | None,
    channel_secret: str,
) -> None:
    """Verify a LINE webhook request using a specific channel secret.

    This is the Multi-Tenant version — each bot has its own secret stored in DB.

    Args:
        body: Raw request body bytes.
        signature: Value of the X-Line-Signature header.
        channel_secret: The LINE Channel Secret for this specific bot/OA.

    Raises:
        HTTPException 400: Missing X-Line-Signature header.
        HTTPException 401: Invalid signature (request not from LINE).
    """
    if not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Line-Signature header.",
        )

    # Compute expected signature
    hash_digest = hmac.new(
        channel_secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).digest()
    expected_signature = base64.b64encode(hash_digest).decode("utf-8")

    # Constant-time comparison
    if not hmac.compare_digest(signature, expected_signature):
        logger.warning("LINE webhook signature mismatch — possible forgery")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid LINE signature. Request rejected.",
        )

    logger.debug("[LINE Auth] Signature verified OK (dynamic secret)")


async def verify_line_signature(request: Request) -> None:
    """Legacy FastAPI dependency — uses LINE_CHANNEL_SECRET from .env.

    For Multi-Tenant setups, use verify_line_signature_with_secret() instead.
    """
    settings = get_settings()

    if not settings.line_channel_secret:
        logger.error("LINE_CHANNEL_SECRET is not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LINE webhook is not configured on this server.",
        )

    body = await request.body()
    signature = request.headers.get("X-Line-Signature")

    verify_line_signature_with_secret(body, signature, settings.line_channel_secret)
