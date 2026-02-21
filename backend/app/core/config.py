"""
SUNDAE Backend — Application Settings

All configuration is loaded from environment variables via pydantic-settings.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Central configuration loaded from .env or environment variables."""

    # ── Application ──────────────────────────────────────────────
    app_name: str = "SUNDAE API"
    debug: bool = False

    # ── Supabase (Self-Hosted) ───────────────────────────────────
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_service_role_key: str = Field(
        ..., description="Service-role key (bypasses RLS — use with caution)"
    )
    supabase_db_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/postgres",
        description="Direct PostgreSQL connection string (for migrations)",
    )

    # ── Ollama / LLM ────────────────────────────────────────────
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Ollama HTTP API base URL",
    )
    llm_model: str = Field(
        default="qwen3:14b",
        description="Ollama model tag for generation",
    )

    # ── Embedding ────────────────────────────────────────────────
    embedding_model: str = Field(
        default="BAAI/bge-m3",
        description="Sentence-Transformers model used for embedding",
    )
    embedding_dimension: int = 1024

    # ── Reranker ─────────────────────────────────────────────────
    reranker_model: str = Field(
        default="BAAI/bge-reranker-v2-m3",
        description="Cross-encoder model used for reranking",
    )
    reranker_score_threshold: float = Field(
        default=0.5,
        description="Minimum reranker score to keep a parent chunk",
    )

    # ── Chunking (Parent-Child) ──────────────────────────────────
    parent_chunk_size: int = 1500
    parent_chunk_overlap: int = 200
    child_chunk_size: int = 400
    child_chunk_overlap: int = 50

    # ── Vector Search ────────────────────────────────────────────
    vector_search_top_k: int = 20

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


# ── Lazy singleton ───────────────────────────────────────────────
_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the cached Settings instance, creating it on first call.

    Using a function (instead of a module-level instance) avoids import-time
    errors in test environments where env vars may not be set.
    """
    global _settings
    if _settings is None:
        _settings = Settings()  # type: ignore[call-arg]
    return _settings

