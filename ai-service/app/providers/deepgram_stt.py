"""
Deepgram streaming STT implementation of `STTProvider`.

Uses the official `deepgram-sdk` (installed via the `[stt]` extra). The
SDK speaks WebSocket to Deepgram's live transcription endpoint; we feed it
raw PCM frames as they arrive from Origin and emit `STTEvent`s.

Configuration:
  - DEEPGRAM_API_KEY (required)
  - Model: nova-3 (configurable via the call site if we ever want to A/B)
  - Encoding: linear16 at 16 kHz mono (matches what Origin's FFmpeg
    produces — see backend/src/origin/transcriptionHandler.js)
  - Interim results: enabled so we get latency for live transcript display,
    but the ingest pipeline only persists `is_final=True` events.
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator

from deepgram import (  # type: ignore[import-not-found]
    DeepgramClient,
    LiveOptions,
    LiveTranscriptionEvents,
)

from ..config import get_settings
from ..logging_setup import get_logger
from .stt import STTEvent, STTProvider

log = get_logger("provider.stt.deepgram")

# Deepgram's server-side keepalive timeout is ~10 s. We send a client-side
# KeepAlive message during silence well under that — every 5 s if no audio
# has flowed in the last 3 s. (Opus DTX during silence drops the RTP rate
# to near-zero, so without this our connection dies after ~10 s and never
# recovers when the speaker resumes.)
KEEPALIVE_INTERVAL_S = 5.0
KEEPALIVE_IDLE_THRESHOLD_S = 3.0


class DeepgramSTT(STTProvider):
    def __init__(self, *, model: str = "nova-3") -> None:
        settings = get_settings()
        if not settings.deepgram_api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not configured")
        self._client = DeepgramClient(settings.deepgram_api_key)
        self._model = model

    async def transcribe(
        self,
        *,
        broadcast_id: str,
        audio_frames: AsyncIterator[bytes],
        sample_rate_hz: int = 16000,
        channels: int = 1,
    ) -> AsyncIterator[STTEvent]:
        # Output queue: we put STTEvent objects on it from the SDK's callback
        # threads, and the caller awaits them from this async generator.
        # asyncio.Queue is the right primitive: it's thread-safe via
        # call_soon_threadsafe under the hood.
        loop = asyncio.get_running_loop()
        out: asyncio.Queue[STTEvent | None] = asyncio.Queue(maxsize=512)

        # Deepgram SDK v3 uses callbacks; we marshal them onto the event loop.
        def _push(event: STTEvent | None) -> None:
            try:
                loop.call_soon_threadsafe(out.put_nowait, event)
            except asyncio.QueueFull:
                log.warning("deepgram.queue.full", broadcastId=broadcast_id)

        dg = self._client.listen.asynclive.v("1")

        # The Deepgram SDK invokes these callbacks with whatever keyword
        # args its current version happens to use (`open=`, `close=`,
        # `error=`, …). Locking down signatures broke things on SDK
        # upgrades — accept anything with *args/**kwargs and pull what
        # we actually need by name.

        async def on_open(*_args, **_kwargs):
            log.info("deepgram.open", broadcastId=broadcast_id)

        async def on_message(*_args, **kwargs):
            try:
                result = kwargs.get("result")
                if result is None:
                    # Older SDK positional shape: (self, result)
                    if len(_args) >= 2:
                        result = _args[1]
                if result is None:
                    return
                alt = result.channel.alternatives[0]
                text = (alt.transcript or "").strip()
                if not text:
                    return
                start = float(getattr(result, "start", 0.0))
                duration = float(getattr(result, "duration", 0.0))
                _push(STTEvent(
                    text=text,
                    start_ms=int(start * 1000),
                    end_ms=int((start + duration) * 1000),
                    is_final=bool(getattr(result, "is_final", False)),
                    language=getattr(result.channel, "language", None) or None,
                ))
            except Exception as exc:  # noqa: BLE001
                log.warning("deepgram.message.parse_error", error=str(exc))

        # Shared session state. We use a dict so closures can mutate it
        # without dragging in `nonlocal` declarations everywhere.
        state = {
            "closed": False,
            "last_audio_send": time.monotonic(),
        }

        async def on_close(*_args, **_kwargs):
            log.info("deepgram.close", broadcastId=broadcast_id)
            state["closed"] = True
            _push(None)  # sentinel — terminates iteration

        async def on_error(*_args, **kwargs):
            err = kwargs.get("error") or (_args[1] if len(_args) >= 2 else None)
            log.error("deepgram.error", broadcastId=broadcast_id, error=str(err))
            state["closed"] = True
            _push(None)

        dg.on(LiveTranscriptionEvents.Open, on_open)
        dg.on(LiveTranscriptionEvents.Transcript, on_message)
        dg.on(LiveTranscriptionEvents.Close, on_close)
        dg.on(LiveTranscriptionEvents.Error, on_error)

        options = LiveOptions(
            model=self._model,
            language="multi",            # Deepgram auto-detects (Nova-3 multilingual)
            encoding="linear16",
            sample_rate=sample_rate_hz,
            channels=channels,
            interim_results=True,
            punctuate=True,
            smart_format=True,
            # Force final segments on silence so we don't wait minutes for a
            # speaker pause.
            endpointing=300,
        )

        if not await dg.start(options):
            raise RuntimeError("Failed to start Deepgram live session")

        # Spawn a task that pulls PCM from the caller and forwards to Deepgram.
        # When `audio_frames` raises StopAsyncIteration we send the finish
        # marker and let on_close push the None sentinel.
        async def _pump() -> None:
            try:
                async for frame in audio_frames:
                    # Once Deepgram has closed on us, dg.send() either
                    # raises or silently swallows the frame — either way
                    # there's no point continuing to push audio. Bail so
                    # we don't flood the log with "send() failed" lines.
                    if state["closed"]:
                        log.info("deepgram.pump.stopping_after_close", broadcastId=broadcast_id)
                        return
                    if frame:
                        await dg.send(frame)
                        state["last_audio_send"] = time.monotonic()
            except Exception as exc:  # noqa: BLE001
                log.warning("deepgram.pump.error", error=str(exc))
            finally:
                try:
                    await dg.finish()
                except Exception:  # noqa: BLE001
                    pass

        # Keepalive task: while the broadcaster is silent, FFmpeg produces
        # no PCM, so the pump's `last_audio_send` clock stops advancing. If
        # we go more than KEEPALIVE_IDLE_THRESHOLD_S without sending audio,
        # we push a {"type":"KeepAlive"} message to Deepgram. This is the
        # documented way to keep a streaming session open across silence.
        async def _keepalive() -> None:
            while not state["closed"]:
                try:
                    await asyncio.sleep(KEEPALIVE_INTERVAL_S)
                except asyncio.CancelledError:
                    return
                if state["closed"]:
                    return
                idle = time.monotonic() - state["last_audio_send"]
                if idle < KEEPALIVE_IDLE_THRESHOLD_S:
                    continue
                # Send the keepalive. The SDK exposes `keep_alive()` in
                # newer versions; fall back to sending the raw JSON via
                # `send()` if not available.
                try:
                    if hasattr(dg, "keep_alive"):
                        await dg.keep_alive()
                    elif hasattr(dg, "send_text"):
                        await dg.send_text('{"type":"KeepAlive"}')
                    else:
                        # Last resort: send the JSON as a text frame
                        # through `send()`. Some SDK builds dispatch
                        # text/bytes by type.
                        await dg.send('{"type":"KeepAlive"}')
                    log.debug(
                        "deepgram.keepalive.sent",
                        broadcastId=broadcast_id,
                        idleSeconds=round(idle, 2),
                    )
                except Exception as exc:  # noqa: BLE001
                    # If keepalive fails the connection is probably dead —
                    # the pump's error handler / on_close will tear us down.
                    log.warning("deepgram.keepalive.failed", error=str(exc))
                    return

        pump_task = asyncio.create_task(_pump(), name=f"dg-pump-{broadcast_id}")
        keepalive_task = asyncio.create_task(_keepalive(), name=f"dg-keepalive-{broadcast_id}")

        try:
            while True:
                evt = await out.get()
                if evt is None:
                    return
                yield evt
        finally:
            for t in (pump_task, keepalive_task):
                t.cancel()
            for t in (pump_task, keepalive_task):
                try:
                    await t
                except asyncio.CancelledError:
                    pass
                except Exception:  # noqa: BLE001
                    pass
