"""
OpenAI Embeddings implementation of `EmbeddingProvider`.

Uses `text-embedding-3-small` with the `dimensions` parameter so we keep
the existing pgvector(384) column. Switching from sentence-transformers
to OpenAI does *not* require a schema migration as long as you keep the
default dimension.

Selection: set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY=sk-...`.

Important caveat: if you bump the dimension to anything other than 384,
the `TranscriptChunk.embedding` column needs to be re-typed AND all
existing chunks must be re-embedded. Keep `embedding_version` distinct
per dimension/model so a future re-embed job can target the stale rows.
"""

from __future__ import annotations

from typing import Sequence

from openai import AsyncOpenAI  # type: ignore[import-not-found]

from ..config import get_settings
from ..logging_setup import get_logger
from .embedding import EmbeddingProvider

log = get_logger("provider.embedding.openai")


class OpenAIEmbedding(EmbeddingProvider):
    """text-embedding-3-small @ 384 dim — drop-in for the local
    sentence-transformers provider that keeps the same DB schema."""

    def __init__(
        self,
        *,
        model: str | None = None,
        dimension: int = 384,
        version_tag: str = "openai-text-embedding-3-small-384-v1",
    ) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = model or settings.openai_embedding_model
        self._dimension = dimension
        self._version = version_tag

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def version(self) -> str:
        return self._version

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            resp = await self._client.embeddings.create(
                model=self._model,
                input=list(texts),
                dimensions=self._dimension,
                encoding_format="float",
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("openai.embedding.error", error=str(exc))
            raise
        # Vectors come back in the same order as `input`.
        return [d.embedding for d in resp.data]
