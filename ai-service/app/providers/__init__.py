"""
Vendor provider interfaces.

Every vendor SDK MUST be imported only inside its concrete provider module
in this package. Application code depends on the Protocols / dataclasses
exported here, never on the SDK directly. Swapping Deepgram for
faster-whisper later must be a one-file change.
"""

from .answer import AnswerProvider, AnswerResult, ContextChunk
from .embedding import EmbeddingProvider
from .moderation import ModerationProvider, ModerationVerdict
from .stt import STTEvent, STTProvider

__all__ = [
    "AnswerProvider",
    "AnswerResult",
    "ContextChunk",
    "EmbeddingProvider",
    "ModerationProvider",
    "ModerationVerdict",
    "STTEvent",
    "STTProvider",
]
