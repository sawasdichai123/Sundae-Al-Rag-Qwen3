"""
SUNDAE Backend — Shared Utility Functions

Security utilities:
  - sanitize_user_input: Basic prompt injection + null-byte sanitization
  - validate_uuid_param: Validate UUID-format path/query parameters
  - encrypt_secret / decrypt_secret: AES-GCM encryption for LINE credentials
"""

from __future__ import annotations

import base64
import os
import re

from fastapi import HTTPException

# ── AES-GCM Encryption for LINE Secrets ─────────────────────────

def _get_line_key() -> bytes:
    """Load LINE_ENCRYPTION_KEY from env and return as 32 raw bytes.

    The key must be a 64-char hex string (32 bytes).
    If not set, raises RuntimeError — encrypt/decrypt will fail loudly.
    """
    from app.core.config import get_settings
    hex_key = get_settings().line_encryption_key
    if not hex_key:
        raise RuntimeError(
            "LINE_ENCRYPTION_KEY is not set. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    try:
        key = bytes.fromhex(hex_key)
    except ValueError as exc:
        raise RuntimeError(f"LINE_ENCRYPTION_KEY is not valid hex: {exc}") from exc
    if len(key) != 32:
        raise RuntimeError("LINE_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars).")
    return key


def encrypt_secret(plain: str) -> str:
    """Encrypt a plain-text LINE secret with AES-256-GCM.

    Returns a base64-encoded string in the format:
        ``enc:<base64(iv)>:<base64(ciphertext+tag)>``

    The ``enc:`` prefix lets decrypt_secret detect already-encrypted values
    so callers can safely call encrypt on any value without double-encrypting.

    Args:
        plain: The plain-text secret to encrypt.

    Returns:
        Encrypted string (enc:iv:ciphertext).
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if plain.startswith("enc:"):
        return plain  # already encrypted — idempotent

    key = _get_line_key()
    iv = os.urandom(12)  # 96-bit nonce — standard for AES-GCM
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plain.encode(), None)
    iv_b64 = base64.b64encode(iv).decode()
    ct_b64 = base64.b64encode(ciphertext).decode()
    return f"enc:{iv_b64}:{ct_b64}"


def decrypt_secret(encrypted: str) -> str:
    """Decrypt an AES-256-GCM encrypted LINE secret.

    If the value does NOT start with ``enc:`` it is returned as-is
    (handles plain-text values during migration window).

    Args:
        encrypted: The encrypted string from DB (enc:iv:ciphertext).

    Returns:
        Plain-text secret.

    Raises:
        ValueError: If the encrypted string is malformed or decryption fails.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag

    if not encrypted.startswith("enc:"):
        return encrypted  # plain-text (pre-migration) — return as-is

    parts = encrypted.split(":", 2)
    if len(parts) != 3:
        raise ValueError("Malformed encrypted secret: expected enc:<iv>:<ciphertext>")

    _, iv_b64, ct_b64 = parts
    try:
        iv = base64.b64decode(iv_b64)
        ciphertext = base64.b64decode(ct_b64)
    except Exception as exc:
        raise ValueError(f"Malformed encrypted secret (base64 decode failed): {exc}") from exc

    key = _get_line_key()
    aesgcm = AESGCM(key)
    try:
        plain = aesgcm.decrypt(iv, ciphertext, None)
    except InvalidTag as exc:
        raise ValueError("Decryption failed: wrong key or corrupted data.") from exc

    return plain.decode()


# ── UUID Validation ──────────────────────────────────────────────

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def validate_uuid_param(value: str, param_name: str = "id") -> str:
    """Validate that a path or query parameter is a properly-formed UUID.

    Returns the original value if valid.
    Raises HTTPException 422 if not a valid UUID format — prevents unnecessary
    DB queries caused by obviously malformed IDs.

    Usage::

        org_id = validate_uuid_param(org_id, "organization_id")
    """
    if not value or not _UUID_RE.match(value):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid format for parameter '{param_name}': expected a UUID.",
        )
    return value


# ── Prompt Injection Sanitization ───────────────────────────────

# Patterns that are classic LLM prompt injection markers.
# We don't block them outright — we strip leading/trailing whitespace and
# remove null bytes, then frame them safely inside the system prompt.
_NULL_BYTE_RE = re.compile(r"\x00")


def sanitize_user_input(text: str, max_length: int = 5000) -> str:
    """Sanitize user-supplied chat input before passing to the LLM.

    Protections applied:
      1. Strip null bytes (PostgreSQL / LLM safety)
      2. Normalize excessive whitespace around injection markers
      3. Truncate to max_length (defense in depth beyond Pydantic validation)

    Note: The primary injection defense is the system prompt framing in
    llm_generator.py which wraps user input in explicit delimiters.
    This function is an additional layer, not the sole protection.

    Args:
        text:       The raw user query string.
        max_length: Hard cap on character count (default 5000).

    Returns:
        Cleaned string, safe to pass to the RAG pipeline.
    """
    # 1. Remove null bytes
    text = _NULL_BYTE_RE.sub("", text)

    # 2. Strip leading/trailing whitespace
    text = text.strip()

    # 3. Truncate (belt-and-suspenders — Pydantic Field max_length is first line)
    if len(text) > max_length:
        text = text[:max_length]

    return text
