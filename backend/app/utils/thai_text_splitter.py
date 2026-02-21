"""
Custom Thai Text Splitter for LlamaIndex

Problem:
    Standard text splitters split on character boundaries, which breaks Thai
    words mid-stream (Thai script has no spaces between words). This destroys
    semantic meaning and degrades retrieval quality.

Solution:
    Use PyThaiNLP's ``word_tokenize`` (engine="newmm") to insert zero-width
    markers at word boundaries, then let LlamaIndex's SentenceSplitter cut
    at those safe boundaries. After splitting, the markers are removed.

Usage:
    >>> from app.utils.thai_text_splitter import ThaiTextSplitter
    >>> splitter = ThaiTextSplitter.create_parent_splitter()
    >>> chunks = splitter.split_text(thai_document_text)
"""

from __future__ import annotations

import re
from typing import List

from llama_index.core.node_parser import SentenceSplitter
from pythainlp.tokenize import word_tokenize

# Delimiter injected between Thai words before splitting.
# Using a rare Unicode character that won't appear in real Thai text.
_THAI_WORD_DELIMITER = "‖"

# Regex to detect runs of Thai characters (basic + upper Thai Unicode range).
_THAI_CHAR_PATTERN = re.compile(r"[\u0E00-\u0E7F]+")


def _segment_thai(text: str, engine: str = "newmm") -> str:
    """Insert delimiters at Thai word boundaries while leaving non-Thai
    segments (English, numbers, whitespace, punctuation) untouched.

    This works by:
      1. Finding every contiguous run of Thai characters in the input.
      2. Tokenising that run with PyThaiNLP.
      3. Joining the resulting tokens with ``_THAI_WORD_DELIMITER``.
      4. Replacing the original run in the string.

    Args:
        text:   Raw input text (may be mixed Thai / English).
        engine: PyThaiNLP tokenise engine (default ``"newmm"``).

    Returns:
        The text with Thai word-boundary delimiters inserted.
    """

    def _replace_match(match: re.Match) -> str:
        thai_run = match.group(0)
        tokens = word_tokenize(thai_run, engine=engine, keep_whitespace=True)
        return _THAI_WORD_DELIMITER.join(tokens)

    return _THAI_CHAR_PATTERN.sub(_replace_match, text)


def _remove_delimiters(text: str) -> str:
    """Strip the injected delimiters from the final chunk text."""
    return text.replace(_THAI_WORD_DELIMITER, "")


class ThaiTextSplitter:
    """Split Thai (and mixed Thai/English) text into chunks without breaking
    Thai word boundaries.

    Wraps LlamaIndex's ``SentenceSplitter`` by pre-processing the text with
    PyThaiNLP word segmentation.

    Parameters:
        chunk_size:    Target chunk size in characters.
        chunk_overlap: Number of overlapping characters between chunks.
        engine:        PyThaiNLP tokenise engine (default ``"newmm"``).
    """

    def __init__(
        self,
        chunk_size: int = 1500,
        chunk_overlap: int = 200,
        engine: str = "newmm",
    ) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.engine = engine

        # Build the underlying LlamaIndex splitter.
        # We add _THAI_WORD_DELIMITER to the list of secondary separators so
        # that the splitter prefers to cut at Thai word boundaries.
        self._splitter = SentenceSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separator="\n\n",
            paragraph_separator="\n\n\n",
            secondary_chunking_regex=f"[^{re.escape(_THAI_WORD_DELIMITER)}]+",
        )

    # ── Public API ───────────────────────────────────────────────

    def split_text(self, text: str) -> List[str]:
        """Split *text* into chunks respecting Thai word boundaries.

        Returns:
            A list of chunk strings with delimiters removed.
        """
        if not text or not text.strip():
            return []

        # Step 1 — inject delimiters at Thai word boundaries.
        segmented = _segment_thai(text, engine=self.engine)

        # Step 2 — split with LlamaIndex's sentence splitter.
        raw_chunks = self._splitter.split_text(segmented)

        # Step 3 — clean up: remove delimiter artifacts.
        return [_remove_delimiters(chunk) for chunk in raw_chunks]

    # ── Factory helpers ──────────────────────────────────────────

    @classmethod
    def create_parent_splitter(
        cls,
        chunk_size: int = 1500,
        chunk_overlap: int = 200,
    ) -> "ThaiTextSplitter":
        """Create a splitter for **Parent Chunks** (large context windows).

        Defaults: chunk_size=1500, overlap=200.
        """
        return cls(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    @classmethod
    def create_child_splitter(
        cls,
        chunk_size: int = 400,
        chunk_overlap: int = 50,
    ) -> "ThaiTextSplitter":
        """Create a splitter for **Child Chunks** (small retrieval windows).

        Defaults: chunk_size=400, overlap=50.
        """
        return cls(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
