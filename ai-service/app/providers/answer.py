"""
Answer (LLM) provider interface.

Implementations:
  - groq.GroqAnswer — Phase 3 (llama-3.3-70b-versatile primary, 8b fallback)
  - fake.FakeAnswer — tests
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol, Sequence


@dataclass(frozen=True, slots=True)
class ContextChunk:
    """One retrieved transcript chunk passed as grounding to the LLM."""

    chunk_id: str
    text: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class AnswerResult:
    """Structured output enforced via the LLM's JSON mode / function call.

    - `answerable=False` → the LLM declined; the question falls through to
      the teacher. `answer` is None in that case.
    - `answerable=True` with `citations=[]` → hallucination guard MUST treat
      this as fall-through (the caller should never display it).
    """

    answerable: bool
    answer: str | None = None
    citations: list[str] = field(default_factory=list)  # TranscriptChunk.id values
    confidence: Literal["high", "low"] = "low"


class AnswerProvider(Protocol):
    async def answer(
        self,
        *,
        question: str,
        context_chunks: Sequence[ContextChunk],
    ) -> AnswerResult:
        ...
