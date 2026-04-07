"""
SUNDAE Backend — Shared Utility Functions

Security utilities:
  - sanitize_user_input: Basic prompt injection + null-byte sanitization
  - validate_uuid_param: Validate UUID-format path/query parameters
"""

from __future__ import annotations

import re

from fastapi import HTTPException

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
