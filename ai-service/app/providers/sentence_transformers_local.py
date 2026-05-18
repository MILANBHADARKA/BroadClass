"""
Local sentence-transformers implementation of `EmbeddingProvider`.

The model is loaded lazily on the first call to `embed()` so that:
  - Import-time is fast (FastAPI app startup doesn't need torch),
  - Tests that don't need real embeddings don't pay the load cost,
  - Memory is reserved only when actually used.

Encoding is CPU-bound and would block the asyncio event loop, so we run
`model.encode` inside `asyncio.to_thread`. The default model
`all-MiniLM-L6-v2` is ~80 MB and encodes ~150 short sentences/sec on a
modern laptop CPU — adequate for lecture-rate transcripts.

Swapping to OpenAI text-embedding-3-small (1536-dim) later is a matter of
writing a sibling module and pointing app/embed_worker.py at it.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Sequence

from ..config import get_settings
from ..logging_setup import get_logger
from .embedding import EmbeddingProvider

log = get_logger("provider.embedding.st")


class SentenceTransformersEmbedding(EmbeddingProvider):
    """all-MiniLM-L6-v2 by default. Output dimension is fixed at 384 to match
    the pgvector column declared in the Prisma schema."""

    def __init__(
        self,
        *,
        model_name: str | None = None,
        version_tag: str | None = None,
        dimension: int = 384,
    ) -> None:
        settings = get_settings()
        self._model_name = model_name or settings.embedding_model_name
        self._version = version_tag or settings.embedding_version
        self._dimension = dimension
        self._model = None
        self._load_lock = threading.Lock()

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def version(self) -> str:
        return self._version

    def _load_model(self):
        """Synchronous, thread-safe model loader. Called from a worker thread
        the first time embed() runs — protected by a lock so two concurrent
        first-calls only download/load once."""
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:  # double-checked
                return self._model
            log.info("embedding.model.loading", name=self._model_name)
            # Local import so that simply importing this module doesn't drag
            # torch into the process (matters for the FastAPI startup path).
            from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]

            self._model = SentenceTransformer(self._model_name)
            actual_dim = self._model.get_sentence_embedding_dimension()
            if actual_dim != self._dimension:
                # Hard fail rather than silently storing mis-sized vectors.
                raise RuntimeError(
                    f"Model {self._model_name} has dim={actual_dim}, "
                    f"but provider configured for {self._dimension}. "
                    f"Update the pgvector column type before changing models."
                )
            log.info("embedding.model.loaded", name=self._model_name, dim=actual_dim)
        return self._model

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []

        def _encode_sync() -> list[list[float]]:
            model = self._load_model()
            # normalize_embeddings=True so cosine similarity in pgvector
            # behaves as expected (unit vectors → cosine = dot product).
            vectors = model.encode(
                list(texts),
                batch_size=32,
                show_progress_bar=False,
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            return [v.tolist() for v in vectors]

        return await asyncio.to_thread(_encode_sync)
