"""
/ingest/{broadcastId} WebSocket endpoint — Smart Chat Phase 1.

Origin opens a WebSocket here for each live broadcast and streams raw
PCM frames (16-bit signed LE, 16 kHz, mono) until the broadcast ends.

Pipeline:
    Origin (WS)  ──PCM frames──▶  this endpoint
                                      │
                                      ├─ STT provider (Deepgram) ──▶ STTEvent stream
                                      │     │  (only is_final events persist)
                                      │     ▼
                                      ├─ accumulator buffers final text
                                      │     │  (flush every ~1200 chars or 10s idle)
                                      │     ▼
                                      ├─ chunker.chunk_text ──▶ chunks
                                      │     ▼
                                      ├─ embedder.embed ──▶ vectors
                                      │     ▼
                                      └─ store.chunks.insert_many

The first frame creates a Transcript row; on disconnect we mark it ended.

Embedding is offloaded via an in-memory asyncio.Queue so that slow
embedding (50–200ms on CPU) does not block ingest. The plan calls for
Redis Streams (`transcription:embed-queue`) for multi-instance scaling;
we use an in-process queue here because we only ever run one ai-service
container per Origin in Phase 1. Swapping to a Redis Stream consumer is
a localised change in `_drain_pending` only.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import AsyncIterator

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, status

from .chunker import chunk_text
from .config import get_settings
from .logging_setup import get_logger
from .providers.embedding import EmbeddingProvider
from .providers.stt import STTEvent, STTProvider
from .redis_client import CHANNEL_TRANSCRIPTION_CHUNK, get_redis
from .store import chunks as chunks_store
from .store import transcripts as transcripts_store

router = APIRouter()
log = get_logger("ingest")


# ─── Provider wiring ─────────────────────────────────────────────────────
# The endpoint takes its providers via factory functions so tests can swap
# in fakes. Defaults wire up Deepgram + sentence-transformers.

_stt_factory: callable | None = None
_embedding_factory: callable | None = None
_embedding_singleton: EmbeddingProvider | None = None


def _default_stt() -> STTProvider:
    # Import lazily so the deepgram SDK isn't required at module load
    # (it's an optional extra; absence shouldn't break tests).
    from .providers.deepgram_stt import DeepgramSTT
    return DeepgramSTT()


def _default_embedding() -> EmbeddingProvider:
    global _embedding_singleton
    if _embedding_singleton is None:
        from .providers.sentence_transformers_local import SentenceTransformersEmbedding
        _embedding_singleton = SentenceTransformersEmbedding()
    return _embedding_singleton


def configure_providers(*, stt: callable | None = None, embedding: callable | None = None) -> None:
    """Override the default factories (used by tests and dev scripts)."""
    global _stt_factory, _embedding_factory, _embedding_singleton
    if stt is not None:
        _stt_factory = stt
    if embedding is not None:
        _embedding_factory = embedding
        _embedding_singleton = None  # force re-creation next call


def _get_stt() -> STTProvider:
    return (_stt_factory or _default_stt)()


def _get_embedding() -> EmbeddingProvider:
    return (_embedding_factory or _default_embedding)()


async def warm_up_embedding() -> None:
    """Force the embedding provider to load its model now (at startup),
    instead of lazily on the first call after a broadcast ends. Without
    this, the first embed() pays a 1-2s model-load cost on warm caches and
    10-30s on cold ones — bad enough to risk hitting the drain timeout
    after the WebSocket closes."""
    embedder = _get_embedding()
    # Single-item warm pass — exercises model load and the asyncio.to_thread
    # path. Result is discarded.
    await embedder.embed(["warmup"])


# ─── Per-session state ───────────────────────────────────────────────────


@dataclass
class _Session:
    broadcast_id: str
    classroom_id: str
    started_at_monotonic: float
    transcript_id: str | None = None
    # Accumulated final-segment text awaiting chunking.
    buffer: str = ""
    # Earliest-final-segment timestamps inside buffer (ms from session start).
    buffer_start_ms: int = 0
    buffer_last_event_ms: int = 0
    # Running chunk index across this transcript.
    next_chunk_index: int = 0
    # Last language seen — set on first event.
    language: str | None = None


# Tuneable thresholds. Plan recommends ~300 tokens (≈1200 chars) per chunk
# with 60-token overlap; we flush whenever the accumulator exceeds the
# target, or when no new finals have arrived for IDLE_FLUSH_MS.
_FLUSH_AT_CHARS = 1200
_IDLE_FLUSH_MS = 10_000


# ─── WebSocket endpoint ──────────────────────────────────────────────────


@router.websocket("/ingest/{broadcast_id}")
async def ingest(
    websocket: WebSocket,
    broadcast_id: str,
    classroomId: str = "",
    sampleRate: int = 16000,
    channels: int = 1,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> None:
    settings = get_settings()

    # Internal-only endpoint. Reject anything without the shared key.
    if not x_internal_key or x_internal_key != settings.internal_api_key:
        # Per the spec, we must accept before closing with a code.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        log.warning("ingest.auth_failed", broadcastId=broadcast_id)
        return

    await websocket.accept()
    log.info(
        "ingest.connected",
        broadcastId=broadcast_id,
        classroomId=classroomId,
        sampleRate=sampleRate,
        channels=channels,
    )

    session = _Session(
        broadcast_id=broadcast_id,
        classroom_id=classroomId or broadcast_id,
        started_at_monotonic=time.monotonic(),
    )

    # Audio queue feeds the STT provider's async iterator.
    audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=512)

    async def _audio_iter() -> AsyncIterator[bytes]:
        while True:
            frame = await audio_queue.get()
            if frame is None:
                return
            yield frame

    # Embedding queue: STTEvent finals go in, the drainer pulls them out.
    embed_queue: asyncio.Queue[STTEvent | None] = asyncio.Queue()

    stt = _get_stt()
    embedder = _get_embedding()

    # Spin up the three concurrent workers:
    #   stt_task: consumes audio_queue, yields STTEvents
    #   drain_task: consumes embed_queue → chunks → DB
    drain_task = asyncio.create_task(
        _drain_pending(session, embed_queue, embedder),
        name=f"ingest-drain-{broadcast_id}",
    )

    redis = get_redis()

    async def _publish_chunk(*, text: str, is_final: bool, start_ms: int, end_ms: int) -> None:
        # Phase 5: live transcript feed for the UI. Fire-and-forget; failing
        # to publish a chunk shouldn't break ingest.
        payload = {
            "broadcastId": broadcast_id,
            "classroomId": session.classroom_id,
            "text": text,
            "isFinal": is_final,
            "startMs": start_ms,
            "endMs": end_ms,
            "ts": int(time.time() * 1000),
        }
        try:
            await redis.publish(CHANNEL_TRANSCRIPTION_CHUNK, json.dumps(payload))
        except Exception as exc:  # noqa: BLE001
            log.debug("transcript.publish.failed", error=str(exc))

    async def _consume_stt() -> None:
        try:
            async for evt in stt.transcribe(
                broadcast_id=broadcast_id,
                audio_frames=_audio_iter(),
                sample_rate_hz=sampleRate,
                channels=channels,
            ):
                # Stream both interim and final to the live-transcript panel.
                # The UI replaces the in-progress line on each new interim
                # for the same start_ms range and commits on `isFinal=true`.
                await _publish_chunk(
                    text=evt.text,
                    is_final=evt.is_final,
                    start_ms=evt.start_ms,
                    end_ms=evt.end_ms,
                )

                if not evt.is_final:
                    continue
                # First final event → create the Transcript row.
                if session.transcript_id is None:
                    session.language = evt.language
                    session.transcript_id = await transcripts_store.create(
                        classroom_id=session.classroom_id,
                        broadcast_id=session.broadcast_id,
                        language=evt.language,
                    )
                    log.info(
                        "ingest.transcript.created",
                        broadcastId=broadcast_id,
                        transcriptId=session.transcript_id,
                    )
                await embed_queue.put(evt)
        except Exception as exc:  # noqa: BLE001
            log.error("ingest.stt.crash", broadcastId=broadcast_id, error=str(exc))
        finally:
            await embed_queue.put(None)

    stt_task = asyncio.create_task(_consume_stt(), name=f"ingest-stt-{broadcast_id}")

    try:
        # Main loop: pull binary frames off the WebSocket and shove them at
        # the STT provider via the audio_queue.
        while True:
            try:
                msg = await websocket.receive()
            except WebSocketDisconnect:
                break
            # FastAPI's WebSocket.receive returns a dict with either "bytes"
            # or "text"; we only handle bytes.
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data is None:
                # text frame — ignore for now (could be control messages later)
                continue
            try:
                audio_queue.put_nowait(data)
            except asyncio.QueueFull:
                # Backpressure: if STT is slow, drop the oldest frame. Better
                # to lose 20ms of audio than to OOM.
                try:
                    audio_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    audio_queue.put_nowait(data)
                except asyncio.QueueFull:
                    pass
    finally:
        log.info("ingest.disconnecting", broadcastId=broadcast_id)
        # Tell STT the audio stream is finished.
        try:
            audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass

        # Wait for STT to drain and signal end-of-stream.
        try:
            await asyncio.wait_for(stt_task, timeout=5.0)
        except asyncio.TimeoutError:
            stt_task.cancel()
        # Drainer terminates after seeing the None sentinel from STT.
        try:
            await asyncio.wait_for(drain_task, timeout=15.0)
        except asyncio.TimeoutError:
            drain_task.cancel()

        # Mark Transcript as ended (if we got far enough to create one).
        if session.transcript_id:
            try:
                await transcripts_store.mark_ended(session.transcript_id)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "ingest.transcript.mark_ended_failed",
                    broadcastId=broadcast_id,
                    error=str(exc),
                )
        log.info("ingest.disconnected", broadcastId=broadcast_id)


# ─── Drain worker ────────────────────────────────────────────────────────


async def _drain_pending(
    session: _Session,
    queue: asyncio.Queue[STTEvent | None],
    embedder: EmbeddingProvider,
) -> None:
    """
    Pull STTEvents off the queue, accumulate text, chunk + embed + persist
    when threshold or idle timer hits, and flush remaining buffer on EOS.
    """
    while True:
        # Use a timeout so we can fire an idle-flush even when no events come.
        try:
            evt = await asyncio.wait_for(queue.get(), timeout=_IDLE_FLUSH_MS / 1000)
        except asyncio.TimeoutError:
            await _flush(session, embedder, reason="idle")
            continue

        if evt is None:
            # End-of-stream → flush whatever's left and exit.
            await _flush(session, embedder, reason="eos")
            return

        # Append text to the buffer, normalising whitespace.
        text = evt.text.strip()
        if not text:
            continue
        if session.buffer:
            session.buffer += " " + text
        else:
            session.buffer = text
            session.buffer_start_ms = evt.start_ms
        session.buffer_last_event_ms = evt.end_ms

        if len(session.buffer) >= _FLUSH_AT_CHARS:
            await _flush(session, embedder, reason="size")


async def _flush(session: _Session, embedder: EmbeddingProvider, *, reason: str) -> None:
    if not session.buffer or not session.transcript_id:
        return
    buffer = session.buffer
    buffer_start = session.buffer_start_ms
    buffer_end = session.buffer_last_event_ms or buffer_start
    session.buffer = ""

    chunks = chunk_text(buffer)
    if not chunks:
        return

    # Map char offsets within the buffer onto millisecond offsets via linear
    # interpolation. This is approximate (speech rate isn't constant) but
    # good enough for "seek to citation" UX in Phase 5.
    span_ms = max(1, buffer_end - buffer_start)
    char_span = max(1, len(buffer))

    def interp(char_pos: int) -> int:
        return buffer_start + int(char_pos / char_span * span_ms)

    texts = [c.text for c in chunks]
    try:
        vectors = await embedder.embed(texts)
    except Exception as exc:  # noqa: BLE001
        log.error("ingest.embed.failed", broadcastId=session.broadcast_id, error=str(exc))
        return

    items = []
    for chunk, vec in zip(chunks, vectors):
        items.append({
            "text": chunk.text,
            "startMs": interp(chunk.char_start),
            "endMs": interp(chunk.char_end),
            "embedding": vec,
        })

    try:
        inserted = await chunks_store.insert_many(
            transcript_id=session.transcript_id,
            broadcast_id=session.broadcast_id,
            starting_index=session.next_chunk_index,
            items=items,
            embedding_version=embedder.version,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("ingest.persist.failed", broadcastId=session.broadcast_id, error=str(exc))
        return

    session.next_chunk_index += len(inserted)
    log.info(
        "ingest.chunks.persisted",
        broadcastId=session.broadcast_id,
        count=len(inserted),
        reason=reason,
        spanMs=span_ms,
    )
