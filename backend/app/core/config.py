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
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:5173",
        description="Comma-separated allowed CORS origins",
    )

    # ── Supabase (Self-Hosted) ───────────────────────────────────
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_service_role_key: str = Field(
        ..., description="Service-role key (bypasses RLS — use with caution)"
    )
    supabase_jwt_secret: str = Field(
        ..., description="JWT secret for local token verification (Dashboard → Settings → API)"
    )
    supabase_db_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/postgres",
        description="Direct PostgreSQL connection string (for migrations)",
    )

    # ── Email (Resend) ───────────────────────────────────────────
    resend_api_key: str = Field(
        default="",
        description="Resend API key for transactional emails (re_xxxxx). Get from resend.com",
    )
    email_from: str = Field(
        default="onboarding@resend.dev",
        description="Sender address shown in outgoing emails",
    )
    frontend_url: str = Field(
        default="http://localhost:5173",
        description="Public-facing frontend URL used in invitation email links",
    )

    # ── LINE Platform ────────────────────────────────────────────
    line_channel_secret: str = Field(
        default="", description="LINE Channel Secret for webhook signature verification"
    )
    line_encryption_key: str = Field(
        default="",
        description="32-byte hex key for AES-GCM encryption of LINE secrets in DB. "
                    "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\"",
    )
    public_api_url: str = Field(
        default="",
        description="Public-facing API base URL used to generate LINE webhook URLs (e.g. https://api.example.com)",
    )

    # ── Ollama / LLM ────────────────────────────────────────────
    ollama_base_url: str = Field(
        default="http://localhost:11434",
        description="Ollama HTTP API base URL",
    )
    llm_model: str = Field(
        default="qwen2.5:3b",
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
        ge=0.0,
        le=1.0,
        description="Minimum reranker score to keep a parent chunk",
    )

    # ── Chunking (Parent-Child) ──────────────────────────────────
    parent_chunk_size: int = 1500
    parent_chunk_overlap: int = 200
    child_chunk_size: int = 400
    child_chunk_overlap: int = 50

    # ── Vector Search ────────────────────────────────────────────
    vector_search_top_k: int = 20

    # ── Chunk Insert Batch Sizes ─────────────────────────────────
    parent_chunk_batch_size: int = Field(default=100, description="DB insert batch size for parent chunks")
    child_chunk_batch_size: int = Field(default=50, description="DB insert batch size for child chunks (smaller due to embedding vectors)")

    # ── Auth Cache ───────────────────────────────────────────────
    redis_url: str | None = Field(
        default=None,
        description="Redis URL for distributed auth profile cache (e.g. redis://localhost:6379/0). "
                    "Required for multi-worker deployments. Falls back to in-memory cache if not set.",
    )
    cache_ttl_seconds: int = Field(
        default=300,
        description="Auth profile cache TTL in seconds (default 5 min)",
    )

    model_config = {
        "env_file": ("../.env", ".env"),
        "env_file_encoding": "utf-8",
    }


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

