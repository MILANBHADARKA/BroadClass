"""
Streaming speech-to-text provider interface.

Implementations (Phase 1):
  - deepgram.DeepgramSTT — managed, streaming
  - fake.FakeSTT — used by tests
  - (future) faster_whisper.FasterWhisperSTT — self-hosted
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Protocol


@dataclass(frozen=True, slots=True)
class STTEvent:
    """A single transcript event emitted by the streaming STT provider.

    For partial (interim) results, `is_final` is False and the text will be
    superseded by a later event covering the same time range. For final
    results, `is_final` is True and the text is committed.

    `start_ms` / `end_ms` are offsets from the start of the streaming session
    (i.e. from when the audio WebSocket was opened).
    """

    text: str
    start_ms: int
    end_ms: int
    is_final: bool
    language: str | None = None
    speaker_label: str | None = None


class STTProvider(Protocol):
    """Streaming STT provider.

    `transcribe` is an async generator: feed it PCM frames via a sibling
    queue and consume `STTEvent`s as they arrive. Implementations are
    expected to manage the underlying connection (e.g. Deepgram WebSocket)
    internally.
    """

    async def transcribe(
        self,
        *,
        broadcast_id: str,
        audio_frames: AsyncIterator[bytes],
        sample_rate_hz: int = 16000,
        channels: int = 1,
    ) -> AsyncIterator[STTEvent]:
        ...
