"""
FastAPI app entrypoint. Wires lifespan (DB pool + Redis + lifecycle subscriber)
and mounts routers.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db, lifecycle, redis_client
from .answer import router as answer_router
from .config import get_settings
from .healthcheck import router as health_router
from .ingest import router as ingest_router, warm_up_embedding
from .logging_setup import configure_logging, get_logger
from .moderation import router as moderation_router

settings = get_settings()
configure_logging(settings.log_level)
log = get_logger("main")


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("startup.begin", service=settings.service_name, port=settings.port)
    await db.init_pool()
    await redis_client.init_redis()

    # Pre-load the embedding model BEFORE we accept any /ingest connections.
    # First-time torch + model load is ~1-2 s on a warm HF cache, longer on
    # cold; we don't want that latency landing in the post-broadcast drain
    # window where it can blow the 15 s timeout and lose chunks.
    log.info("startup.embedding.warming")
    try:
        await warm_up_embedding()
        log.info("startup.embedding.ready")
    except Exception as exc:  # noqa: BLE001 — log but don't crash on warm-up
        log.error("startup.embedding.failed", error=str(exc))

    await lifecycle.start()
    log.info("startup.ready")
    try:
        yield
    finally:
        log.info("shutdown.begin")
        await lifecycle.stop()
        await redis_client.close_redis()
        await db.close_pool()
        log.info("shutdown.done")


app = FastAPI(
    title="BroadClass AI Service",
    description="Live transcription, embeddings, and RAG-based Q&A.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(health_router)
app.include_router(ingest_router)
app.include_router(moderation_router)
app.include_router(answer_router)
