"""
Groq implementation of `AnswerProvider`.

Strict-RAG semantics:
  - System prompt locks the model to "answer ONLY from the provided <CONTEXT>".
  - Question is wrapped in <USER_QUESTION> tags so prompt-injection attempts
    ("ignore previous instructions") are visibly user-supplied content.
  - Structured JSON output via Groq's `response_format={"type":"json_object"}`.
  - Falls back from llama-3.3-70b-versatile → llama-3.1-8b-instant on rate-limit
    errors so transient 429s don't take down chat entirely.
"""

from __future__ import annotations

import json
from typing import Sequence

from groq import AsyncGroq  # type: ignore[import-not-found]

from ..config import get_settings
from ..logging_setup import get_logger
from ._prompts import ANSWER_MAX_TOKENS, RAG_TUTOR_SYSTEM_PROMPT
from .answer import AnswerProvider, AnswerResult, ContextChunk

log = get_logger("provider.answer.groq")


class GroqAnswer(AnswerProvider):
    def __init__(self, *, model: str | None = None, fallback_model: str | None = None) -> None:
        settings = get_settings()
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        self._client = AsyncGroq(api_key=settings.groq_api_key)
        self._model = model or settings.answer_model_primary
        self._fallback = fallback_model or settings.answer_model_fallback

    async def answer(
        self,
        *,
        question: str,
        context_chunks: Sequence[ContextChunk],
    ) -> AnswerResult:
        if not context_chunks:
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        # Build the <CONTEXT> block. Each chunk gets an id the model can cite.
        context_lines = []
        for c in context_chunks:
            # Time range as a hint — sometimes useful for the model to
            # disambiguate "the part where the teacher said X" type questions.
            t = f"[{c.start_ms / 1000:.1f}s-{c.end_ms / 1000:.1f}s]"
            context_lines.append(f"<chunk id=\"{c.chunk_id}\" time=\"{t}\">\n{c.text}\n</chunk>")
        context_block = "<CONTEXT>\n" + "\n".join(context_lines) + "\n</CONTEXT>"

        user_block = f"{context_block}\n\n<USER_QUESTION>\n{question}\n</USER_QUESTION>"

        # Try primary, fall back on rate-limit / 5xx.
        try:
            response = await self._invoke(self._model, user_block)
        except _RetryableGroqError as exc:
            log.info("groq.answer.fallback", reason=str(exc), to=self._fallback)
            response = await self._invoke(self._fallback, user_block)
        except Exception as exc:  # noqa: BLE001 — re-raise so caller's circuit breaker fires
            log.warning("groq.answer.error", error=str(exc))
            raise

        return self._parse(response, allowed_ids={c.chunk_id for c in context_chunks})

    async def _invoke(self, model: str, user_block: str) -> str:
        try:
            resp = await self._client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": RAG_TUTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": user_block},
                ],
                response_format={"type": "json_object"},
                # Slightly higher than strict-RAG (0.1) because the tutor
                # mode wants a touch more variation in phrasing for the
                # elaboration. Still low enough to keep answers grounded.
                temperature=0.2,
                max_tokens=ANSWER_MAX_TOKENS,
            )
            return resp.choices[0].message.content or "{}"
        except Exception as exc:  # noqa: BLE001
            # Groq SDK raises various exception types — we coarse-classify
            # rate-limit/timeout/5xx as retryable, everything else as fatal
            # to the caller (the circuit breaker will pick it up).
            msg = str(exc).lower()
            if any(s in msg for s in ("rate", "429", "503", "timeout", "overloaded")):
                raise _RetryableGroqError(str(exc)) from exc
            raise

    def _parse(self, raw: str, *, allowed_ids: set[str]) -> AnswerResult:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("groq.answer.bad_json", raw=raw[:200])
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        answerable = bool(data.get("answerable"))
        answer = data.get("answer")
        if isinstance(answer, str):
            answer = answer.strip() or None
        else:
            answer = None
        confidence = data.get("confidence")
        confidence = confidence if confidence in ("high", "low") else "low"

        # Filter citations to chunks we actually provided. The model
        # sometimes fabricates IDs; we reject those defensively.
        raw_citations = data.get("citations") or []
        citations = [c for c in raw_citations if isinstance(c, str) and c in allowed_ids]

        # Hallucination guard: claiming answerable=True with zero valid
        # citations means the model invented context. Treat as fall-through.
        if answerable and not citations:
            log.warning("groq.answer.no_citations_but_answerable")
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        return AnswerResult(
            answerable=answerable,
            answer=answer if answerable else None,
            citations=citations,
            confidence=confidence,
        )


class _RetryableGroqError(Exception):
    """Internal marker for errors worth retrying on the fallback model."""
