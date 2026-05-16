"""
SUNDAE Backend — LLM Generation Service (Strict Grounding)

On-premise only — connects to a local Ollama instance.
No external API calls. All data stays on the server.

This module provides:
  1. Context assembly from retrieved parent chunks.
  2. A strictly-grounded generation function that refuses to answer
     if the context does not contain the relevant information.

Model: qwen2.5:3b via Ollama REST API (http://localhost:11434/api/chat)
       (configurable via LLM_MODEL env var — เปลี่ยนได้ตามสเปค RAM)

SECURITY:
    The system prompt explicitly instructs the LLM to:
    - ONLY use the provided [Context] to answer questions.
    - NEVER fabricate information or use prior knowledge.
    - Reply "ไม่พบข้อมูลในเอกสาร" if the answer is not in context.
"""

from __future__ import annotations

import json
import logging
import re
from typing import AsyncIterator, List, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════
# System Prompt (Strict Grounding — Zero Hallucination)
# ═══════════════════════════════════════════════════════════════════

SYSTEM_PROMPT_DIRECT = (
    "คุณคือ SUNDAE ผู้ช่วย AI ตอบคำถามจากเอกสารองค์กร\n"
    "- ใช้ข้อมูลจาก [Context] เท่านั้น ห้ามแต่งเพิ่ม\n"
    "- ตอบภาษาไทย ยกเว้นศัพท์เทคนิค\n"
    "- สรุปกระชับ 2-4 ประโยค ห้ามคัดลอกทั้งก้อน\n"
    "- ไม่ต้องขึ้นต้นด้วย 'จากเอกสาร' หรือ 'ตามเอกสาร'\n"
    "- ถ้าคำถามไม่ตรงกับเนื้อหาใน Context พอดี ให้บอกว่ามีข้อมูลเกี่ยวกับหัวข้ออะไรบ้างใน Context แล้วถามว่าต้องการทราบหัวข้อไหน\n"
)

SYSTEM_PROMPT_TOPICS = (
    "คุณคือ SUNDAE ผู้ช่วย AI ตอบคำถามจากเอกสารองค์กร\n"
    "- ใช้ข้อมูลจาก [Context] เท่านั้น ห้ามแต่งเพิ่ม\n"
    "- ตอบภาษาไทย ยกเว้นศัพท์เทคนิค\n"
    "\n"
    "คำถามนี้เกี่ยวข้องกับหลายหัวข้อ ให้ตอบตามรูปแบบนี้เท่านั้น:\n"
    "\n"
    "มีข้อมูลที่เกี่ยวข้องในหัวข้อต่อไปนี้:\n"
    "1. (ชื่อหัวข้อ)\n"
    "2. (ชื่อหัวข้อ)\n"
    "...\n"
    "\n"
    "สามารถสอบถามหัวข้อที่สนใจเพิ่มเติมได้เลยค่ะ\n"
    "\n"
    "ห้ามอธิบายรายละเอียด ลิสต์ชื่อหัวข้อสั้นๆ เท่านั้น\n"
)

MULTI_CONTEXT_THRESHOLD = 1

SYSTEM_PROMPT = SYSTEM_PROMPT_DIRECT


def _build_topics_response(chunks: List[str]) -> str:
    """Build a topic listing response directly from code — no LLM needed."""
    headings = []
    for i, chunk in enumerate(chunks, start=1):
        heading = _extract_heading(chunk.strip())
        headings.append(f"{i}. {heading}")
    topic_list = "\n".join(headings)

    if len(headings) == 1:
        return (
            f"พบข้อมูลที่เกี่ยวข้องในหัวข้อนี้:\n"
            f"{topic_list}\n\n"
            f"ต้องการทราบรายละเอียดเพิ่มเติมไหมคะ?"
        )
    return (
        f"มีข้อมูลที่เกี่ยวข้องในหัวข้อต่อไปนี้:\n"
        f"{topic_list}\n\n"
        f"สามารถสอบถามหัวข้อที่สนใจเพิ่มเติมได้เลยค่ะ"
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


def _extract_heading(chunk: str) -> str:
    """Extract the first meaningful heading from a chunk."""
    for line in chunk.split("\n"):
        cleaned = line.strip().lstrip("#").strip().strip("-").strip()
        cleaned = re.sub(r"^\d+[\.\)]\s*", "", cleaned).strip()
        if len(cleaned) < 8:
            continue
        if cleaned.endswith(("เท่านั้น", "ห้าม", "ดังนี้", "ต่อไปนี้", "ได้แก่")):
            continue
        if not any(c.isalpha() for c in cleaned):
            continue
        return cleaned[:80]
    words = chunk.strip().split()
    return " ".join(words[:12]) + ("..." if len(words) > 12 else "")


def assemble_context_topics_only(retrieved_contexts: List[str]) -> str:
    """Build a topics-only context — headings without details."""
    valid = [c.strip() for c in retrieved_contexts if c and c.strip()]
    if not valid:
        return ""
    headings = []
    for i, chunk in enumerate(valid, start=1):
        heading = _extract_heading(chunk)
        headings.append(f"{i}. {heading}")
    return "\n".join(headings)


def _build_user_message(query: str, context: str, topics_mode: bool = False) -> str:
    """Build the user message combining context and query.

    Appends /no_think to disable Qwen3 thinking mode — avoids wasting
    tokens on internal reasoning and eliminates the ~2 min delay.
    """
    if context:
        if topics_mode:
            return (
                f"[หัวข้อที่พบในเอกสาร]\n{context}\n\n"
                f"[Question]\n{query}\n/no_think"
            )
        return (
            f"[Context]\n{context}\n\n"
            f"[Question]\n{query}\n/no_think"
        )
    else:
        return (
            "[Context]\n(ไม่มีข้อมูลจากเอกสาร)\n\n"
            f"[Question]\n{query}\n/no_think"
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
    timeout: float = 60.0,
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

    # If many chunks → broad question → return topic list from code (no LLM)
    valid_chunks = [c for c in retrieved_contexts if c and c.strip()]
    if len(valid_chunks) >= MULTI_CONTEXT_THRESHOLD:
        return _build_topics_response(valid_chunks)

    prompt = system_prompt or SYSTEM_PROMPT_DIRECT
    context = assemble_context(retrieved_contexts)
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
            "num_predict": 512,
        },
        "keep_alive": "4h",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()

        try:
            data = response.json()
        except Exception as json_exc:
            logger.error("Ollama response is not valid JSON: %s", json_exc)
            return FALLBACK_MESSAGE

        # Extract the assistant's response (strip Qwen3 <think> blocks)
        raw = data.get("message", {}).get("content", "").strip()
        assistant_message = re.sub(
            r"<think>[\s\S]*?</think>\s*", "", raw
        ).strip()

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

    # If many chunks → broad question → yield topic list from code (no LLM)
    valid_chunks = [c for c in retrieved_contexts if c and c.strip()]
    if len(valid_chunks) >= MULTI_CONTEXT_THRESHOLD:
        yield _build_topics_response(valid_chunks)
        return

    prompt = system_prompt or SYSTEM_PROMPT_DIRECT
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
            "num_predict": 512,
        },
        "keep_alive": "4h",
    }

    try:
        in_think = False
        buf = ""
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
                        buf += token

                        if not in_think and "<think>" in buf:
                            in_think = True
                            buf = ""

                        if in_think:
                            if "</think>" in buf:
                                in_think = False
                                after = buf.split("</think>", 1)[1]
                                buf = ""
                                if after.strip():
                                    yield after
                            continue

                        if buf:
                            yield buf
                            buf = ""

                        if data.get("done", False):
                            return
                    except json.JSONDecodeError:
                        logger.warning("[LLM Stream] Non-JSON line from Ollama (skipped): %s", line[:100])
                        continue

    except httpx.ConnectError as exc:
        logger.error("Streaming LLM ConnectError: Cannot connect to Ollama at %s: %s", base_url, exc)
        yield FALLBACK_MESSAGE

    except httpx.TimeoutException as exc:
        logger.error("Streaming LLM TimeoutException after %.0fs: %s", timeout, exc)
        yield FALLBACK_MESSAGE

    except httpx.HTTPStatusError as exc:
        logger.error("Streaming LLM HTTPStatusError %d: %s", exc.response.status_code, exc.response.text[:500])
        yield FALLBACK_MESSAGE

    except Exception as exc:
        logger.error("Streaming LLM generation failed: %s", exc)
        yield FALLBACK_MESSAGE
