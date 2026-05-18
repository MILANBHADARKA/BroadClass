"""
Embedding provider interface.

Implementations:
  - sentence_transformers_local.SentenceTransformersEmbedding — Phase 1
  - fake.FakeEmbedding — tests
"""

from __future__ import annotations

from typing import Protocol, Sequence


class EmbeddingProvider(Protocol):
    """Synchronous-feel embedding interface (implementations may use a thread
    pool internally to avoid blocking asyncio when loading torch on CPU).

    `dimension` must be stable for the lifetime of a deployment; it's stored
    on each chunk row as `embeddingVersion` so we can re-embed safely later.
    """

    @property
    def dimension(self) -> int:
        ...

    @property
    def version(self) -> str:
        """Identifier persisted alongside each chunk. Bumping this triggers
        re-embedding of historical data."""
        ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Return one vector per input text, in the same order."""
        ...
