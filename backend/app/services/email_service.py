"""
SUNDAE Backend — Email Service (Resend)

Handles transactional emails via Resend API.
Currently supports:
  - send_invitation_email(): Notify invited user about org invitation
"""

from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


async def send_invitation_email(
    invited_email: str,
    org_name: str,
    invited_by_email: str,
    invitation_id: str,
) -> bool:
    """Send an invitation email to the invited user via Resend.

    Args:
        invited_email:    Recipient email address.
        org_name:         Organization name (shown in email).
        invited_by_email: Email of the admin who sent the invite.
        invitation_id:    UUID of the invitation (for Accept/Decline links).

    Returns:
        True if sent successfully, False otherwise.
    """
    settings = get_settings()
    api_key = settings.resend_api_key
    email_from = settings.email_from
    app_url = settings.frontend_url.rstrip("/") if settings.frontend_url else "http://localhost:5173"

    if not api_key:
        logger.warning("[Email] RESEND_API_KEY not set — skipping invitation email to %s", invited_email)
        return False

    accept_url = f"{app_url}/invitations"

    html_body = f"""
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>คำเชิญเข้าร่วมองค์กร</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#ffd100;padding:32px 40px;text-align:center;">
              <div style="width:48px;height:48px;background:#1a1a1a;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
                <span style="color:#ffd100;font-size:22px;font-weight:900;line-height:48px;display:block;">S</span>
              </div>
              <h1 style="margin:0;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.5px;">SUNDAE</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;">
                คุณได้รับคำเชิญเข้าร่วมองค์กร
              </h2>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
                <strong style="color:#111827;">{invited_by_email}</strong>
                ได้เชิญคุณเข้าร่วมองค์กร
                <strong style="color:#111827;">{org_name}</strong>
                บนแพลตฟอร์ม SUNDAE
              </p>

              <!-- Org Card -->
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">องค์กร</p>
                <p style="margin:0;font-size:18px;font-weight:700;color:#111827;">{org_name}</p>
              </div>

              <!-- CTA Button -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="{accept_url}"
                   style="display:inline-block;background-color:#ffd100;color:#1a1a1a;font-size:15px;font-weight:700;
                          text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.01em;">
                  ดูคำเชิญ
                </a>
              </div>

              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
                หากปุ่มด้านบนใช้งานไม่ได้ คัดลอก URL นี้ไปวางในเบราว์เซอร์:<br>
                <a href="{accept_url}" style="color:#6b7280;word-break:break-all;">{accept_url}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                อีเมลนี้ถูกส่งโดยอัตโนมัติจากระบบ SUNDAE<br>
                หากคุณไม่ได้คาดหวังอีเมลนี้ สามารถเพิกเฉยได้
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""

    payload = {
        "from": f"SUNDAE <{email_from}>",
        "to": [invited_email],
        "subject": f"คุณได้รับคำเชิญเข้าร่วมองค์กร {org_name} บน SUNDAE",
        "html": html_body,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                RESEND_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
        if resp.status_code in (200, 201):
            logger.info("[Email] Invitation sent to %s for org %s", invited_email, org_name)
            return True
        else:
            logger.warning("[Email] Resend returned %d: %s", resp.status_code, resp.text)
            return False
    except Exception as exc:
        logger.error("[Email] Failed to send invitation email: %s", exc)
        return False
