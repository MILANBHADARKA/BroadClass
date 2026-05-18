"""
Transcription lifecycle subscriber.

Listens on Redis `transcription:control` for `{ type: 'start'|'stop',
broadcastId, classroomId }` events. Phase 0 just logs them and confirms the
subscription works; Phase 1 fills in the actual session bookkeeping.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .logging_setup import get_logger
from .redis_client import CHANNEL_TRANSCRIPTION_CONTROL, get_redis

log = get_logger("lifecycle")

# broadcastId → in-memory session record (Phase 1 populates this)
_sessions: dict[str, dict[str, Any]] = {}


async def _handle(event: dict[str, Any]) -> None:
    event_type = event.get("type")
    broadcast_id = event.get("broadcastId")
    if not broadcast_id:
        log.warning("lifecycle.event.missing_broadcast_id", event=event)
        return

    if event_type == "start":
        if broadcast_id in _sessions:
            log.info("lifecycle.start.duplicate", broadcastId=broadcast_id)
            return
        _sessions[broadcast_id] = {"classroomId": event.get("classroomId")}
        log.info("lifecycle.start", broadcastId=broadcast_id)
        # Phase 1 hook: spin up Deepgram session, prepare ingest WS receiver
    elif event_type == "stop":
        if _sessions.pop(broadcast_id, None) is None:
            log.info("lifecycle.stop.unknown", broadcastId=broadcast_id)
        else:
            log.info("lifecycle.stop", broadcastId=broadcast_id)
        # Phase 1 hook: close Deepgram session, flush buffer, mark Transcript.endedAt
    else:
        log.warning("lifecycle.event.unknown_type", event=event)


async def _run() -> None:
    """Long-running consumer task. One subscription, restarted on error."""
    redis = get_redis()
    while True:
        try:
            pubsub = redis.pubsub()
            await pubsub.subscribe(CHANNEL_TRANSCRIPTION_CONTROL)
            log.info("lifecycle.subscribed", channel=CHANNEL_TRANSCRIPTION_CONTROL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                try:
                    event = json.loads(raw)
                except (TypeError, ValueError):
                    log.warning("lifecycle.event.malformed", raw=raw)
                    continue
                await _handle(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — keep the subscriber alive
            log.error("lifecycle.subscriber.crash", error=str(exc))
            await asyncio.sleep(1)


_task: asyncio.Task[None] | None = None


async def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_run(), name="transcription-control-subscriber")


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None


def active_session_ids() -> list[str]:
    """Used by tests / future ops endpoint."""
    return list(_sessions.keys())
