"""
Unit tests for the Custom Thai Text Splitter and Chunking Service.
"""

import pytest

from app.utils.thai_text_splitter import ThaiTextSplitter, _segment_thai, _remove_delimiters
from app.services.chunking import create_parent_child_chunks


# ── Sample Thai texts ────────────────────────────────────────────

# A well-known Thai sentence (approx. translation: "Eating rice with curry
# is a common Thai meal.")
SAMPLE_SHORT = "สวัสดีครับ ผมชื่อสมชาย ผมเป็นนักพัฒนาซอฟต์แวร์"

# Longer text for chunk-size testing — repeat a paragraph multiple times.
_PARAGRAPH = (
    "ประเทศไทยเป็นประเทศที่มีวัฒนธรรมอันยาวนาน "
    "ภาษาไทยเป็นภาษาที่มีลักษณะเฉพาะตัว "
    "การตัดคำภาษาไทยจำเป็นต้องใช้เครื่องมือทางธรรมชาติภาษา "
    "เนื่องจากภาษาไทยไม่มีช่องว่างระหว่างคำ "
    "ระบบ SUNDAE ใช้ PyThaiNLP ในการตัดคำภาษาไทย "
    "เพื่อให้การแบ่งข้อความเป็นส่วนๆ ไม่ทำลายความหมายของคำ "
    "โมเดล RAG จะทำงานได้อย่างแม่นยำมากขึ้น "
    "เมื่อข้อความถูกแบ่งอย่างถูกต้องตามขอบเขตของคำ\n\n"
)
SAMPLE_LONG = _PARAGRAPH * 30  # ~7,500+ characters


# ═══════════════════════════════════════════════════════════════════
# Tests for low-level segmentation
# ═══════════════════════════════════════════════════════════════════


class TestSegmentation:
    """Tests for the Thai word-segmentation helper."""

    def test_segment_inserts_delimiters(self):
        """Delimiters should appear between Thai words."""
        result = _segment_thai("สวัสดีครับ")
        assert "‖" in result, "Expected delimiter between Thai words"

    def test_segment_preserves_english(self):
        """English words should pass through unchanged."""
        mixed = "Hello สวัสดี World"
        result = _segment_thai(mixed)
        assert "Hello" in result
        assert "World" in result

    def test_remove_delimiters(self):
        """Delimiter removal should produce clean text."""
        assert _remove_delimiters("สวัสดี‖ครับ") == "สวัสดีครับ"
        assert _remove_delimiters("no delimiters") == "no delimiters"


# ═══════════════════════════════════════════════════════════════════
# Tests for ThaiTextSplitter
# ═══════════════════════════════════════════════════════════════════


class TestThaiTextSplitter:
    """Tests for the main ThaiTextSplitter class."""

    # ── Edge cases ───────────────────────────────────────────────

    def test_empty_string_returns_empty(self):
        splitter = ThaiTextSplitter(chunk_size=500)
        assert splitter.split_text("") == []

    def test_whitespace_only_returns_empty(self):
        splitter = ThaiTextSplitter(chunk_size=500)
        assert splitter.split_text("   \n\n  ") == []

    def test_single_word(self):
        splitter = ThaiTextSplitter(chunk_size=500)
        chunks = splitter.split_text("สวัสดี")
        assert len(chunks) == 1
        assert chunks[0] == "สวัสดี"

    # ── Thai word boundary preservation ──────────────────────────

    def test_no_broken_thai_words(self):
        """Every chunk should reconstruct back to valid Thai text
        (no orphaned combining marks at chunk boundaries)."""
        splitter = ThaiTextSplitter(chunk_size=200, chunk_overlap=20)
        chunks = splitter.split_text(SAMPLE_LONG)

        assert len(chunks) > 1, "Expected more than 1 chunk for long text"

        for i, chunk in enumerate(chunks):
            # A broken Thai word would leave a combining character
            # (U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E) at the start of a chunk.
            # This is a heuristic check — not perfect, but catches most breaks.
            first_char = chunk.lstrip()[0] if chunk.strip() else ""
            assert not (
                "\u0E31" <= first_char <= "\u0E3A"
                or "\u0E47" <= first_char <= "\u0E4E"
            ), (
                f"Chunk {i} starts with a Thai combining character '{first_char}', "
                f"indicating a broken word boundary."
            )

    # ── Mixed Thai + English ─────────────────────────────────────

    def test_mixed_language_text(self):
        mixed = "ระบบ SUNDAE ใช้ PyThaiNLP ในการตัดคำภาษาไทย " * 20
        splitter = ThaiTextSplitter(chunk_size=200, chunk_overlap=20)
        chunks = splitter.split_text(mixed)

        assert len(chunks) >= 1
        for chunk in chunks:
            # No delimiter artefacts should remain.
            assert "‖" not in chunk


# ═══════════════════════════════════════════════════════════════════
# Tests for Parent/Child Splitter factories
# ═══════════════════════════════════════════════════════════════════


class TestFactories:
    """Tests for ``create_parent_splitter`` and ``create_child_splitter``."""

    def test_parent_splitter_chunk_size(self):
        splitter = ThaiTextSplitter.create_parent_splitter(
            chunk_size=1500, chunk_overlap=200
        )
        chunks = splitter.split_text(SAMPLE_LONG)
        assert len(chunks) >= 2, "Expected multiple parent chunks"
        for chunk in chunks:
            # Allow a small tolerance above the target chunk size because
            # the splitter may overshoot slightly to avoid breaking words.
            assert len(chunk) <= 1500 * 1.5, (
                f"Parent chunk too large: {len(chunk)} chars"
            )

    def test_child_splitter_chunk_size(self):
        splitter = ThaiTextSplitter.create_child_splitter(
            chunk_size=400, chunk_overlap=50
        )
        chunks = splitter.split_text(SAMPLE_LONG)
        assert len(chunks) >= 2, "Expected multiple child chunks"
        for chunk in chunks:
            assert len(chunk) <= 400 * 1.5, (
                f"Child chunk too large: {len(chunk)} chars"
            )


# ═══════════════════════════════════════════════════════════════════
# Tests for Parent-Child Chunking Service
# ═══════════════════════════════════════════════════════════════════


class TestChunkingService:
    """Tests for ``create_parent_child_chunks``."""

    def test_parent_child_relationship(self):
        """Every child's text must be a substring of its parent's text."""
        parents = create_parent_child_chunks(
            text=SAMPLE_LONG,
            document_id="test-doc-001",
            parent_chunk_size=1500,
            parent_chunk_overlap=200,
            child_chunk_size=400,
            child_chunk_overlap=50,
        )

        assert len(parents) >= 1
        for parent in parents:
            assert parent.document_id == "test-doc-001"
            assert len(parent.children) >= 1, (
                f"Parent chunk {parent.chunk_index} has no children"
            )
            for child in parent.children:
                assert child.parent_id == parent.id
                assert child.text in parent.text, (
                    f"Child chunk text is NOT a substring of parent chunk text.\n"
                    f"Child: {child.text[:80]}…\n"
                    f"Parent: {parent.text[:80]}…"
                )

    def test_unique_ids(self):
        """All parent and child IDs should be unique."""
        parents = create_parent_child_chunks(
            text=SAMPLE_LONG,
            document_id="test-doc-002",
        )
        all_ids = [p.id for p in parents]
        for p in parents:
            all_ids.extend(c.id for c in p.children)

        assert len(all_ids) == len(set(all_ids)), "Duplicate IDs detected"

    def test_empty_text(self):
        parents = create_parent_child_chunks(text="", document_id="empty")
        assert parents == []
