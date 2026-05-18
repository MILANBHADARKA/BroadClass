"""
Async Redis client used for pub/sub lifecycle signals and (later) the
embed-queue Redis Stream. Mirrors the channel constants in
`backend/src/services/redisClient.js` — keep these in sync.
"""

from __future__ import annotations

from redis.asyncio import Redis

from .config import get_settings
from .logging_setup import get_logger

log = get_logger("redis")

# Channel name constants — DO NOT inline these strings elsewhere; if Node-side
# names change, this file must change in lockstep.
CHANNEL_TRANSCRIPTION_CONTROL = "transcription:control"   # { type: start|stop, broadcastId, classroomId }
CHANNEL_TRANSCRIPTION_CHUNK = "transcription:chunk"       # streamed transcript text (UI consumer)
CHANNEL_CHAT_MESSAGE = "chat:message"                     # fan-out of new chat messages
CHANNEL_CHAT_STATUS = "chat:status-update"                # status change (e.g. AWAITING_TEACHER)

_redis: Redis | None = None


async def init_redis() -> Redis:
    global _redis
    if _redis is not None:
        return _redis
    settings = get_settings()
    _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    # from_url is lazy; force a ping so connection errors surface early.
    await _redis.ping()
    log.info("redis.connected")
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


def get_redis() -> Redis:
    if _redis is None:
        raise RuntimeError("redis not initialized — call init_redis() first")
    return _redis


async def ping() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception as exc:  # noqa: BLE001
        log.warning("redis.ping.failed", error=str(exc))
        return False
