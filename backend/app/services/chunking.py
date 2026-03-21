"""
Parent-Child Chunking Service

Implements the Small-to-Big chunking strategy:
  1. Split document text into large **Parent Chunks** (context for LLM).
  2. For each parent, split into small **Child Chunks** (for vector search).
  3. Return structured data ready for database insertion.

Page sentinels (``<<<PAGE:N>>>``) injected by ``extract_text_from_pdf``
are parsed to determine which PDF page(s) each chunk originates from,
then stripped before storing the chunk text.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import List, Tuple, Optional

from app.utils.thai_text_splitter import ThaiTextSplitter

# Matches page sentinels injected by extract_text_from_pdf
_PAGE_SENTINEL_RE = re.compile(r"<<<PAGE:(\d+)>>>")


def _extract_pages_from_text(text: str) -> Tuple[Optional[int], Optional[int]]:
    """Find the lowest and highest page numbers cited by sentinels in *text*.

    Returns:
        (page_start, page_end) — both None if no sentinels found.
    """
    found = [int(m) for m in _PAGE_SENTINEL_RE.findall(text)]
    if not found:
        return None, None
    return min(found), max(found)


def _strip_sentinels(text: str) -> str:
    """Remove page sentinel lines from chunk text before storage."""
    cleaned = re.sub(r"\n?<<<PAGE:\d+>>>\n?", "\n", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


@dataclass
class ChildChunk:
    """A small chunk used for high-precision vector similarity search."""

    id: str
    parent_id: str
    text: str
    chunk_index: int
    page_start: Optional[int] = None
    page_end: Optional[int] = None


@dataclass
class ParentChunk:
    """A large chunk providing full context to the LLM."""

    id: str
    document_id: str
    text: str
    chunk_index: int
    children: List[ChildChunk] = field(default_factory=list)
    page_start: Optional[int] = None
    page_end: Optional[int] = None


def create_parent_child_chunks(
    text: str,
    document_id: str,
    *,
    parent_chunk_size: int = 1500,
    parent_chunk_overlap: int = 200,
    child_chunk_size: int = 400,
    child_chunk_overlap: int = 50,
) -> List[ParentChunk]:
    """Split *text* into a Parent-Child chunk hierarchy.

    Page sentinels in the text are used to compute ``page_start`` /
    ``page_end`` for each chunk, then stripped from the stored text.

    Args:
        text:                 Full document text (may contain page sentinels).
        document_id:          ID of the source document.
        parent_chunk_size:    Target size for parent chunks.
        parent_chunk_overlap: Overlap between parent chunks.
        child_chunk_size:     Target size for child chunks.
        child_chunk_overlap:  Overlap between child chunks.

    Returns:
        A list of ``ParentChunk`` objects, each containing its ``ChildChunk``
        children.
    """
    parent_splitter = ThaiTextSplitter.create_parent_splitter(
        chunk_size=parent_chunk_size,
        chunk_overlap=parent_chunk_overlap,
    )
    child_splitter = ThaiTextSplitter.create_child_splitter(
        chunk_size=child_chunk_size,
        chunk_overlap=child_chunk_overlap,
    )

    parent_texts = parent_splitter.split_text(text)
    parent_chunks: List[ParentChunk] = []

    for p_idx, parent_text in enumerate(parent_texts):
        parent_id = str(uuid.uuid4())

        # Extract page range from sentinels BEFORE stripping
        p_start, p_end = _extract_pages_from_text(parent_text)
        clean_parent_text = _strip_sentinels(parent_text)

        # Split each parent into child chunks (use raw text with sentinels
        # so children inherit page context)
        child_texts = child_splitter.split_text(parent_text)
        children = []
        for c_idx, child_text in enumerate(child_texts):
            c_start, c_end = _extract_pages_from_text(child_text)
            clean_child_text = _strip_sentinels(child_text)
            children.append(
                ChildChunk(
                    id=str(uuid.uuid4()),
                    parent_id=parent_id,
                    text=clean_child_text,
                    chunk_index=c_idx,
                    page_start=c_start,
                    page_end=c_end,
                )
            )

        parent_chunks.append(
            ParentChunk(
                id=parent_id,
                document_id=document_id,
                text=clean_parent_text,
                chunk_index=p_idx,
                children=children,
                page_start=p_start,
                page_end=p_end,
            )
        )

    return parent_chunks
