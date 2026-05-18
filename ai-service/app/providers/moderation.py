"""
Moderation provider interface.

Implementations:
  - groq_classifier.GroqModeration — Phase 2 (llama-3.1-8b-instant prompted as classifier)
  - fake.FakeModeration — tests
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ModerationVerdict:
    """Outcome of a moderation check.

    `flags` is a free-form list of category labels (e.g. `["harassment",
    "profanity"]`) that the provider attaches; the chat layer stores it on
    ChatMessage.moderationFlags for audit.

    `allowed=False` causes the message to be persisted with status
    HIDDEN_BY_MODERATION.
    """

    allowed: bool
    flags: list[str] = field(default_factory=list)


class ModerationProvider(Protocol):
    async def check(self, text: str) -> ModerationVerdict:
        ...
