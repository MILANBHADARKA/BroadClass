"""
In-memory provider fakes for tests and local development.

These satisfy the Protocols in this package without importing any vendor SDK
or doing real I/O. They're the simplest possible thing that makes the
plumbing testable end-to-end.
"""

from __future__ import annotations

import hashlib
from typing import AsyncIterator, Sequence

from .answer import AnswerProvider, AnswerResult, ContextChunk
from .embedding import EmbeddingProvider
from .moderation import ModerationProvider, ModerationVerdict
from .stt import STTEvent, STTProvider


class FakeEmbedding(EmbeddingProvider):
    """Deterministic 384-dim vectors derived from text hash. Useful for
    checking serialization and ordering — not semantically meaningful."""

    def __init__(self, dimension: int = 384, version: str = "fake-v1") -> None:
        self._dim = dimension
        self._version = version

    @property
    def dimension(self) -> int:
        return self._dim

    @property
    def version(self) -> str:
        return self._version

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            # Repeat the 32-byte digest to fill `dimension` bytes, scaled to [-1, 1).
            raw = (digest * ((self._dim // 32) + 1))[: self._dim]
            out.append([(b - 128) / 128.0 for b in raw])
        return out


class FakeSTT(STTProvider):
    """Yields a fixed transcript script regardless of input audio. Useful
    for verifying the ingest → chunker → embedder pipeline without burning
    Deepgram minutes."""

    def __init__(self, script: Sequence[STTEvent] | None = None) -> None:
        self._script: tuple[STTEvent, ...] = tuple(script or ())

    async def transcribe(
        self,
        *,
        broadcast_id: str,
        audio_frames: AsyncIterator[bytes],
        sample_rate_hz: int = 16000,
        channels: int = 1,
    ) -> AsyncIterator[STTEvent]:
        # Drain audio frames so the producer doesn't block, but ignore them.
        async def _drain() -> None:
            async for _ in audio_frames:
                pass

        # In a real test, the caller wraps this and races _drain alongside
        # iteration. For simplicity here we just emit the canned script.
        del broadcast_id, sample_rate_hz, channels  # unused in fake
        for event in self._script:
            yield event


class FakeAnswer(AnswerProvider):
    """Always returns the prepared result. Useful for testing the chat-side
    fall-through path independently of any LLM."""

    def __init__(self, result: AnswerResult) -> None:
        self._result = result

    async def answer(
        self,
        *,
        question: str,
        context_chunks: Sequence[ContextChunk],
    ) -> AnswerResult:
        del question, context_chunks
        return self._result


class FakeModeration(ModerationProvider):
    """Flags messages containing any term in `banned`. Case-insensitive."""

    def __init__(self, banned: Sequence[str] = ()) -> None:
        self._banned = tuple(b.lower() for b in banned)

    async def check(self, text: str) -> ModerationVerdict:
        lower = text.lower()
        hits = [b for b in self._banned if b in lower]
        return ModerationVerdict(allowed=not hits, flags=list(hits))
