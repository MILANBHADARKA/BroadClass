"""
Anthropic Claude implementation of `AnswerProvider`.

Talks to the Messages API. Anthropic doesn't expose a "JSON mode" flag
like OpenAI/Groq do, so we coerce JSON output two ways:
  1. Explicit instruction in the system prompt ("Respond with a single
     JSON object only, no surrounding prose").
  2. Strip any leading non-`{` prose before parsing.

Selection: set `ANSWER_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=sk-ant-...`.
Model is configurable via `ANTHROPIC_ANSWER_MODEL` (default Claude Haiku).
"""

from __future__ import annotations

import json
from typing import Sequence

from anthropic import AsyncAnthropic  # type: ignore[import-not-found]

from ..config import get_settings
from ..logging_setup import get_logger
from ._prompts import ANSWER_MAX_TOKENS, RAG_TUTOR_SYSTEM_PROMPT
from .answer import AnswerProvider, AnswerResult, ContextChunk

log = get_logger("provider.answer.anthropic")


class AnthropicAnswer(AnswerProvider):
    def __init__(self, *, model: str | None = None) -> None:
        settings = get_settings()
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._model = model or settings.anthropic_answer_model

    async def answer(
        self,
        *,
        question: str,
        context_chunks: Sequence[ContextChunk],
    ) -> AnswerResult:
        if not context_chunks:
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        context_lines = []
        for c in context_chunks:
            t = f"[{c.start_ms / 1000:.1f}s-{c.end_ms / 1000:.1f}s]"
            context_lines.append(f"<chunk id=\"{c.chunk_id}\" time=\"{t}\">\n{c.text}\n</chunk>")
        context_block = "<CONTEXT>\n" + "\n".join(context_lines) + "\n</CONTEXT>"
        user_block = f"{context_block}\n\n<USER_QUESTION>\n{question}\n</USER_QUESTION>"

        try:
            resp = await self._client.messages.create(
                model=self._model,
                max_tokens=ANSWER_MAX_TOKENS,
                temperature=0.2,
                system=RAG_TUTOR_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_block}],
            )
        except Exception as exc:  # noqa: BLE001 — let the caller's breaker handle it
            log.warning("anthropic.answer.error", error=str(exc))
            raise

        # Anthropic returns a list of content blocks; concat the text ones.
        raw = "".join(
            getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text"
        ).strip()

        # Claude sometimes prefixes the JSON with a sentence. Strip prefix
        # up to the first `{` and suffix after the matching last `}`.
        if "{" in raw:
            raw = raw[raw.index("{") : raw.rindex("}") + 1]

        return self._parse(raw, allowed_ids={c.chunk_id for c in context_chunks})

    def _parse(self, raw: str, *, allowed_ids: set[str]) -> AnswerResult:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("anthropic.answer.bad_json", raw=raw[:200])
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        answerable = bool(data.get("answerable"))
        answer = data.get("answer")
        if isinstance(answer, str):
            answer = answer.strip() or None
        else:
            answer = None
        confidence = data.get("confidence") if data.get("confidence") in ("high", "low") else "low"

        raw_citations = data.get("citations") or []
        citations = [c for c in raw_citations if isinstance(c, str) and c in allowed_ids]

        if answerable and not citations:
            log.warning("anthropic.answer.no_citations_but_answerable")
            return AnswerResult(answerable=False, answer=None, citations=[], confidence="low")

        return AnswerResult(
            answerable=answerable,
            answer=answer if answerable else None,
            citations=citations,
            confidence=confidence,
        )
