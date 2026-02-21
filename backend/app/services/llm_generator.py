"""
SUNDAE Backend — LLM Generation Service (Strict Grounding)

On-premise only — connects to a local Ollama instance.
No external API calls. All data stays on the server.

This module provides:
  1. Context assembly from retrieved parent chunks.
  2. A strictly-grounded generation function that refuses to answer
     if the context does not contain the relevant information.

Model: qwen3:14b via Ollama REST API (http://localhost:11434/api/chat)

SECURITY:
    The system prompt explicitly instructs the LLM to:
    - ONLY use the provided [Context] to answer questions.
    - NEVER fabricate information or use prior knowledge.
    - Reply "ไม่พบข้อมูลในเอกสาร" if the answer is not in context.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator, List, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# System Prompt (Strict Grounding — Zero Hallucination)
# ═══════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = (
    "คุณคือ SUNDAE ผู้ช่วย AI สำหรับตอบคำถามจากเอกสารขององค์กร\n"
    "\n"
    "## กฎเหล็กที่ต้องปฏิบัติอย่างเคร่งครัด:\n"
    "1. ตอบคำถามโดยใช้ข้อมูลจาก [Context] ที่ให้มาเท่านั้น\n"
    "2. ห้ามใช้ความรู้เดิมของคุณ ห้ามแต่งข้อมูลเพิ่มเด็ดขาด\n"
    "3. หากข้อมูลใน [Context] ไม่มีคำตอบสำหรับคำถามนั้น "
    "ให้ตอบสั้นๆ ว่า 'ไม่พบข้อมูลในเอกสาร' เท่านั้น\n"
    "4. ตอบเป็นภาษาไทยเสมอ ยกเว้นชื่อเฉพาะหรือศัพท์เทคนิค\n"
    "5. ตอบให้กระชับ ตรงประเด็น ไม่ต้องทวนคำถาม\n"
    "6. หากมีข้อมูลหลายส่วนที่เกี่ยวข้อง ให้สรุปรวมเป็นคำตอบเดียว\n"
    "7. อ้างอิงเนื้อหาจาก [Context] เท่านั้น ห้ามเพิ่มเติมสิ่งที่ไม่ได้ระบุ\n"
)

# Fallback message when Ollama is unreachable or errors out
FALLBACK_MESSAGE = "ไม่สามารถเชื่อมต่อกับ AI Engine ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"


# ═══════════════════════════════════════════════════════════════════
# Context Assembly
# ═══════════════════════════════════════════════════════════════════


def assemble_context(retrieved_contexts: List[str]) -> str:
    """Concatenate parent chunks into a clean context block for the prompt.

    Each chunk is separated by a numbered divider for clarity.
    Empty or whitespace-only chunks are skipped.

    Args:
        retrieved_contexts: List of parent chunk texts (post-reranking).

    Returns:
        A formatted context string ready for injection into the prompt.
        Returns empty string if no valid contexts are provided.
    """
    # Filter out empty/whitespace chunks
    valid = [c.strip() for c in retrieved_contexts if c and c.strip()]

    if not valid:
        return ""

    sections: List[str] = []
    for i, text in enumerate(valid, start=1):
        sections.append(f"--- เอกสารอ้างอิง {i} ---\n{text}")

    return "\n\n".join(sections)


def _build_user_message(query: str, context: str) -> str:
    """Build the user message combining context and query.

    Args:
        query:   The user's question.
        context: The assembled context block.

    Returns:
        Formatted user message string.
    """
    if context:
        return (
            f"[Context]\n{context}\n\n"
            f"[Question]\n{query}"
        )
    else:
        # No context available — the LLM should respond with the refusal
        return (
            "[Context]\n(ไม่มีข้อมูลจากเอกสาร)\n\n"
            f"[Question]\n{query}"
        )


# ═══════════════════════════════════════════════════════════════════
# LLM Generation
# ═══════════════════════════════════════════════════════════════════


async def generate_response(
    user_query: str,
    retrieved_contexts: List[str],
    *,
    model: Optional[str] = None,
    temperature: float = 0.1,
    ollama_base_url: Optional[str] = None,
    timeout: float = 300.0,
    system_prompt: Optional[str] = None,
) -> str:
    """Generate a grounded response using a local Ollama LLM.

    Sends the user query along with retrieved context to the Ollama
    chat endpoint and returns the generated Thai-language response.

    Args:
        user_query:          The user's question (string).
        retrieved_contexts:  List of parent chunk texts from the reranker.
        model:               Ollama model tag (default from config).
        temperature:         LLM temperature (0.1 = near-deterministic).
        ollama_base_url:     Override Ollama URL (default from config).
        timeout:             HTTP request timeout in seconds.
        system_prompt:       Override system prompt (for testing).

    Returns:
        The generated response text in Thai. On error, returns a
        user-friendly fallback message.
    """
    settings = get_settings()
    target_model = model or settings.llm_model
    base_url = ollama_base_url or settings.ollama_base_url
    prompt = system_prompt or SYSTEM_PROMPT

    # Assemble context from surviving parent chunks
    context = assemble_context(retrieved_contexts)

    # Build the message payload
    user_message = _build_user_message(user_query, context)

    payload = {
        "model": target_model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
        "options": {
            "temperature": temperature,
        },
        "keep_alive": "30m",  # Keep model in RAM for 30 minutes
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()

        data = response.json()

        # Extract the assistant's response
        assistant_message = (
            data.get("message", {}).get("content", "").strip()
        )

        if not assistant_message:
            logger.warning(
                "Ollama returned empty response for model=%s", target_model
            )
            return FALLBACK_MESSAGE

        logger.info(
            "LLM generation complete (model=%s, context_chunks=%d, response_len=%d)",
            target_model,
            len(retrieved_contexts),
            len(assistant_message),
        )
        return assistant_message

    except httpx.ConnectError as exc:
        logger.error(
            "Cannot connect to Ollama at %s: %s", base_url, exc
        )
        return FALLBACK_MESSAGE

    except httpx.TimeoutException as exc:
        logger.error(
            "Ollama request timed out after %.0fs: %s", timeout, exc
        )
        return FALLBACK_MESSAGE

    except httpx.HTTPStatusError as exc:
        logger.error(
            "Ollama returned HTTP %d: %s",
            exc.response.status_code,
            exc.response.text[:500],
        )
        return FALLBACK_MESSAGE

    except Exception as exc:
        logger.error("Unexpected error during LLM generation: %s", exc)
        return FALLBACK_MESSAGE


# ═══════════════════════════════════════════════════════════════════
# Streaming LLM Generation
# ═══════════════════════════════════════════════════════════════════


async def generate_response_stream(
    user_query: str,
    retrieved_contexts: List[str],
    *,
    model: Optional[str] = None,
    temperature: float = 0.1,
    ollama_base_url: Optional[str] = None,
    timeout: float = 300.0,
    system_prompt: Optional[str] = None,
) -> AsyncIterator[str]:
    """Stream tokens from Ollama as they are generated.

    Yields each token (word/character) immediately, so the frontend
    can display the response in real-time (like ChatGPT).
    """
    settings = get_settings()
    target_model = model or settings.llm_model
    base_url = ollama_base_url or settings.ollama_base_url
    prompt = system_prompt or SYSTEM_PROMPT

    context = assemble_context(retrieved_contexts)
    user_message = _build_user_message(user_query, context)

    payload = {
        "model": target_model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message},
        ],
        "stream": True,
        "options": {
            "temperature": temperature,
        },
        "keep_alive": "30m",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/chat",
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        token = data.get("message", {}).get("content", "")
                        if token:
                            yield token
                        if data.get("done", False):
                            return
                    except json.JSONDecodeError:
                        continue

    except Exception as exc:
        logger.error("Streaming LLM generation failed: %s", exc)
        yield FALLBACK_MESSAGE
