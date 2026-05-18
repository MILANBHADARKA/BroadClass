"""
POST /moderate — content moderation endpoint (Smart Chat Phase 2).

Called inline by System-Manager before persisting a chat message. The
caller treats this as best-effort: timeouts or 5xx → allow (chat stays
working when ai-service is sad).

Auth: shared INTERNAL_API_KEY via X-Internal-Key header.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .logging_setup import get_logger
from .providers.moderation import ModerationProvider
from .security import require_internal_key

router = APIRouter()
log = get_logger("moderate")


# Lazy provider construction: same pattern as ingest.py, so tests can inject
# a fake without touching Groq.
_provider_factory = None
_provider_singleton: ModerationProvider | None = None


def _default_provider() -> ModerationProvider:
    global _provider_singleton
    if _provider_singleton is None:
        from .providers.groq_moderation import GroqModeration
        _provider_singleton = GroqModeration()
    return _provider_singleton


def configure_moderation_provider(factory) -> None:
    """Test hook — pass a callable returning a fake ModerationProvider."""
    global _provider_factory, _provider_singleton
    _provider_factory = factory
    _provider_singleton = None


def _get_provider() -> ModerationProvider:
    return (_provider_factory or _default_provider)()


class ModerationRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class ModerationResponse(BaseModel):
    allowed: bool
    flags: list[str]


@router.post(
    "/moderate",
    response_model=ModerationResponse,
    dependencies=[Depends(require_internal_key)],
)
async def moderate(req: ModerationRequest) -> ModerationResponse:
    """Classify a chat message. Returns `{allowed, flags}`.

    Failure modes:
      - 503 if GROQ_API_KEY isn't configured (caller's circuit breaker will
        open after a few of these).
      - 502 if the underlying classifier errored (Groq down, rate-limited).
        Caller treats both as "allow" so chat stays usable.
    """
    try:
        provider = _get_provider()
    except RuntimeError as exc:
        log.warning("moderate.unconfigured", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc))

    try:
        verdict = await provider.check(req.content)
    except Exception as exc:  # noqa: BLE001
        log.warning("moderate.upstream_error", error=str(exc))
        raise HTTPException(status_code=502, detail="moderation classifier failed")

    if verdict.flags:
        log.info("moderate.flagged", allowed=verdict.allowed, flags=verdict.flags)
    return ModerationResponse(allowed=verdict.allowed, flags=verdict.flags)
