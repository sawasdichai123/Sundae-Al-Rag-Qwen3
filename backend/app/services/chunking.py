"""
Parent-Child Chunking Service

Implements the Small-to-Big chunking strategy:
  1. Split document text into large **Parent Chunks** (context for LLM).
  2. For each parent, split into small **Child Chunks** (for vector search).
  3. Return structured data ready for database insertion.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import List

from app.utils.thai_text_splitter import ThaiTextSplitter


@dataclass
class ChildChunk:
    """A small chunk used for high-precision vector similarity search."""

    id: str
    parent_id: str
    text: str
    chunk_index: int


@dataclass
class ParentChunk:
    """A large chunk providing full context to the LLM."""

    id: str
    document_id: str
    text: str
    chunk_index: int
    children: List[ChildChunk] = field(default_factory=list)


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

    Args:
        text:                 Full document text.
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

        # Split each parent into child chunks.
        child_texts = child_splitter.split_text(parent_text)
        children = [
            ChildChunk(
                id=str(uuid.uuid4()),
                parent_id=parent_id,
                text=child_text,
                chunk_index=c_idx,
            )
            for c_idx, child_text in enumerate(child_texts)
        ]

        parent_chunks.append(
            ParentChunk(
                id=parent_id,
                document_id=document_id,
                text=parent_text,
                chunk_index=p_idx,
                children=children,
            )
        )

    return parent_chunks
