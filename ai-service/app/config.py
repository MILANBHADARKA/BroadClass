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

    # Provider keys (Phase 0 keeps these optional so health checks don't fail
    # before secrets are wired up; Phase 1+ require them at the call site).
    deepgram_api_key: str | None = Field(default=None, alias="DEEPGRAM_API_KEY")
    groq_api_key: str | None = Field(default=None, alias="GROQ_API_KEY")

    # Embedding model — local sentence-transformers, runs on CPU
    embedding_model_name: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
        alias="EMBEDDING_MODEL_NAME",
    )
    # Tag stored on each chunk so we can re-embed safely later.
    embedding_version: str = Field(default="st-MiniLM-L6-v2-v1", alias="EMBEDDING_VERSION")

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
