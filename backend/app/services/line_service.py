"""
SUNDAE Backend — LINE Messaging API Service

Provides helper functions for interacting with the LINE Messaging API:
  - reply_message: Send a reply via the Reply API (within webhook context)
  - push_message: Send a push message via the Push API (any time, e.g. from Inbox)

References:
  - Reply API: https://developers.line.biz/en/reference/messaging-api/#send-reply-message
  - Push API: https://developers.line.biz/en/reference/messaging-api/#send-push-message
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

LINE_API_BASE = "https://api.line.me/v2/bot"


async def reply_message(
    reply_token: str,
    text: str,
    access_token: str,
) -> bool:
    """Send a reply message using the LINE Reply API.

    Must be called within 1 minute of receiving the webhook event.

    Args:
        reply_token: The replyToken from the LINE webhook event.
        text: The message text to send.
        access_token: The LINE Channel Access Token for this bot.

    Returns:
        True if sent successfully, False otherwise.
    """
    if len(text) > 2000:
        text = text[:1997] + "..."

    url = f"{LINE_API_BASE}/message/reply"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": text}],
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)

        if resp.status_code == 200:
            logger.info("[LINE] Reply sent OK (token=%s...)", reply_token[:10])
            return True
        else:
            logger.error(
                "[LINE] Reply API error: %d — %s", resp.status_code, resp.text
            )
            return False
    except Exception as exc:
        logger.error("[LINE] Reply API exception: %s", exc)
        return False


async def push_message(
    user_id: str,
    text: str,
    access_token: str,
) -> bool:
    """Send a push message to a LINE user.

    Used by Inbox when admin replies to a LINE session — pushes the message
    directly to the customer's LINE app.

    Args:
        user_id: The LINE User ID (Uxxxxxxxxx...).
        text: The message text to push.
        access_token: The LINE Channel Access Token for this bot.

    Returns:
        True if sent successfully, False otherwise.
    """
    if len(text) > 2000:
        text = text[:1997] + "..."

    url = f"{LINE_API_BASE}/message/push"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {
        "to": user_id,
        "messages": [{"type": "text", "text": text}],
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload, headers=headers)

        if resp.status_code == 200:
            logger.info("[LINE] Push sent to %s OK", user_id[:10])
            return True
        else:
            logger.error(
                "[LINE] Push API error: %d — %s", resp.status_code, resp.text
            )
            return False
    except Exception as exc:
        logger.error("[LINE] Push API exception: %s", exc)
        return False
