"""
OpenAI Moderation implementation of `ModerationProvider`.

Uses the dedicated `/moderations` endpoint (free, no token cost) with the
`omni-moderation-latest` model. Returns OpenAI's category booleans as
flat string flags in the same shape the Groq classifier produces, so the
caller doesn't care which provider it's talking to.

Selection: set `MODERATION_PROVIDER=openai` and `OPENAI_API_KEY=sk-...`.
"""

from __future__ import annotations

from openai import AsyncOpenAI  # type: ignore[import-not-found]

from ..config import get_settings
from ..logging_setup import get_logger
from .moderation import ModerationProvider, ModerationVerdict

log = get_logger("provider.moderation.openai")

# OpenAI returns granular categories like `harassment/threatening`; we
# collapse them onto the same vocabulary the Groq classifier emits so the
# downstream UI doesn't need to special-case providers. Any category not
# mapped here is preserved verbatim in `flags` but not treated as hard
# (allowed stays true). Hard categories cause allowed=False.
_HARD_CATEGORY_MAP = {
    "hate": "hate",
    "hate/threatening": "hate",
    "harassment": "harassment",
    "harassment/threatening": "harassment",
    "sexual": "sexual",
    "sexual/minors": "sexual",
    "violence": "violence",
    "violence/graphic": "violence",
    "self-harm": "self_harm",
    "self-harm/intent": "self_harm",
    "self-harm/instructions": "self_harm",
}
_HARD_CATEGORIES = {"hate", "harassment", "sexual", "violence", "self_harm"}


class OpenAIModeration(ModerationProvider):
    def __init__(self, *, model: str | None = None) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = model or settings.openai_moderation_model

    async def check(self, text: str) -> ModerationVerdict:
        try:
            resp = await self._client.moderations.create(model=self._model, input=text)
        except Exception as exc:  # noqa: BLE001
            log.warning("openai.moderation.error", error=str(exc))
            raise

        result = resp.results[0] if resp.results else None
        if result is None:
            return ModerationVerdict(allowed=True, flags=[])

        # `categories` is a Pydantic model in the new SDK; iterate via dict.
        categories = result.categories.model_dump() if hasattr(result.categories, "model_dump") else dict(result.categories)
        triggered_raw = [k for k, v in categories.items() if v]

        # Collapse to the shared vocabulary; preserve unknown ones as-is.
        flags: list[str] = []
        seen: set[str] = set()
        for cat in triggered_raw:
            mapped = _HARD_CATEGORY_MAP.get(cat, cat)
            if mapped not in seen:
                seen.add(mapped)
                flags.append(mapped)

        hard_hit = any(f in _HARD_CATEGORIES for f in flags)
        return ModerationVerdict(allowed=not hard_hit, flags=flags)
