"""
Configuration loaded from environment.

Settings are read once at startup. Anything secret (API keys, internal API
key) must come from env; never a default in code.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Service identity
    service_name: str = "broadclass-ai-service"
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    port: int = Field(default=8080, alias="PORT")

    # Internal-service auth — shared with origin / system-manager
    internal_api_key: str = Field(default="dev-internal-key", alias="INTERNAL_API_KEY")

    # Dependencies
    database_url: str = Field(alias="DATABASE_URL")
    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")

    # Provider API keys. Only the keys for the providers you SELECT below
    # need to be populated; the rest can be left empty.
    deepgram_api_key: str | None = Field(default=None, alias="DEEPGRAM_API_KEY")
    groq_api_key: str | None = Field(default=None, alias="GROQ_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    # ── Provider selection ──────────────────────────────────────────────
    # Each layer (STT / embeddings / LLM answers / moderation) can be
    # swapped independently by changing the env var. Defaults preserve
    # the original Phase 1–3 behavior so existing deployments keep
    # working without any env changes.
    #
    # Supported values:
    #   stt_provider:         "deepgram"
    #   embedding_provider:   "sentence_transformers" | "openai"
    #   answer_provider:      "groq" | "openai" | "anthropic"
    #   moderation_provider:  "groq" | "openai"
    stt_provider: str = Field(default="deepgram", alias="STT_PROVIDER")
    embedding_provider: str = Field(
        default="sentence_transformers", alias="EMBEDDING_PROVIDER"
    )
    answer_provider: str = Field(default="groq", alias="ANSWER_PROVIDER")
    moderation_provider: str = Field(default="groq", alias="MODERATION_PROVIDER")

    # Embedding model — local sentence-transformers, runs on CPU
    embedding_model_name: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
        alias="EMBEDDING_MODEL_NAME",
    )
    # Tag stored on each chunk so we can re-embed safely later.
    embedding_version: str = Field(default="st-MiniLM-L6-v2-v1", alias="EMBEDDING_VERSION")
    # OpenAI embedding model name (only consulted when embedding_provider="openai").
    # text-embedding-3-small supports a `dimensions` param so we can keep
    # the existing pgvector(384) column — see openai_embedding.py.
    openai_embedding_model: str = Field(
        default="text-embedding-3-small", alias="OPENAI_EMBEDDING_MODEL"
    )

    # Retrieval gating (Phase 3)
    retrieval_top_k: int = Field(default=8, alias="RETRIEVAL_TOP_K")
    retrieval_min_top1_cosine: float = Field(default=0.35, alias="RETRIEVAL_MIN_TOP1")
    retrieval_min_mean_top3_cosine: float = Field(default=0.30, alias="RETRIEVAL_MIN_MEAN_TOP3")

    # LLM models (Groq)
    answer_model_primary: str = Field(
        default="llama-3.3-70b-versatile", alias="ANSWER_MODEL_PRIMARY"
    )
    answer_model_fallback: str = Field(
        default="llama-3.1-8b-instant", alias="ANSWER_MODEL_FALLBACK"
    )
    moderation_model: str = Field(default="llama-3.1-8b-instant", alias="MODERATION_MODEL")

    # LLM models (OpenAI). Consulted when ANSWER_PROVIDER=openai /
    # MODERATION_PROVIDER=openai. OpenAI's `/moderations` endpoint has its
    # own dedicated model name; we hardcode the default and expose an
    # override for forward-compat.
    openai_answer_model: str = Field(default="gpt-4o-mini", alias="OPENAI_ANSWER_MODEL")
    openai_moderation_model: str = Field(
        default="omni-moderation-latest", alias="OPENAI_MODERATION_MODEL"
    )

    # LLM models (Anthropic). Consulted when ANSWER_PROVIDER=anthropic.
    anthropic_answer_model: str = Field(
        default="claude-haiku-4-5-20251001", alias="ANTHROPIC_ANSWER_MODEL"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
