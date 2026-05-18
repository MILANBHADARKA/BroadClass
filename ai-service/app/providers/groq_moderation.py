"""
Groq-backed implementation of `ModerationProvider`.

Uses `llama-3.1-8b-instant` with a tight classifier prompt. Returns a
structured JSON verdict via Groq's `response_format={"type":"json_object"}`
so we don't have to fragile-regex parse the answer.

Categories we surface in `flags`:
  - "hate"       — slurs, discriminatory speech
  - "harassment" — targeted insults / threats
  - "sexual"    — explicit sexual content
  - "violence"  — graphic violence / threats of harm
  - "self_harm" — suicide / self-harm content
  - "spam"      — repeated links, advertising, scams

A message is `allowed=False` if ANY hard category fires. "spam" alone
gets a flag but isn't hidden — the teacher can choose to hide on review.
"""

from __future__ import annotations

import json

from groq import AsyncGroq  # type: ignore[import-not-found]

from ..config import get_settings
from ..logging_setup import get_logger
from .moderation import ModerationProvider, ModerationVerdict

log = get_logger("provider.moderation.groq")

# Categories that cause a hard hide (allowed=False).
HARD_CATEGORIES = ("hate", "harassment", "sexual", "violence", "self_harm")

_SYSTEM_PROMPT = """You are a content-moderation classifier for a live online classroom chat.
Classify the user message into zero or more of these categories:
  hate, harassment, sexual, violence, self_harm, spam

Rules:
- "hate" = slurs or content attacking a protected class.
- "harassment" = targeted insults, threats, or bullying.
- "sexual" = explicit sexual content (not mere mentions).
- "violence" = graphic violence or credible threats of harm.
- "self_harm" = suicide ideation or encouragement of self-harm.
- "spam" = advertising, scams, repeated links/promo, off-topic flooding.

A simple question or strong opinion is NOT a violation. Be permissive: students
are allowed to disagree, criticize, complain, and ask blunt questions. Only flag
content that would clearly violate a classroom code of conduct.

Respond with a JSON object:
{"flags": ["..."]}    // empty array if clean
"""


class GroqModeration(ModerationProvider):
    def __init__(self, *, model: str | None = None) -> None:
        settings = get_settings()
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        self._client = AsyncGroq(api_key=settings.groq_api_key)
        self._model = model or settings.moderation_model

    async def check(self, text: str) -> ModerationVerdict:
        # Wrap student content in clearly delimited block so the classifier
        # can't be tricked by "ignore previous instructions" attempts.
        user_block = f"<MESSAGE>\n{text}\n</MESSAGE>"
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_block},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                max_tokens=80,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("groq.moderation.error", error=str(exc))
            # Re-raise so caller can decide; system-manager treats failure
            # as "allow" (best-effort moderation).
            raise

        raw = response.choices[0].message.content or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("groq.moderation.bad_json", raw=raw[:200])
            return ModerationVerdict(allowed=True, flags=[])

        flags_raw = parsed.get("flags") or []
        # Normalize: lowercase + restrict to known categories.
        known = {"hate", "harassment", "sexual", "violence", "self_harm", "spam"}
        flags = [f.lower() for f in flags_raw if isinstance(f, str) and f.lower() in known]

        hard_hit = any(f in HARD_CATEGORIES for f in flags)
        return ModerationVerdict(allowed=not hard_hit, flags=flags)
