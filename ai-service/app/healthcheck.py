"""
Health endpoints.

- /health/live: process is alive (no deps). Used by Docker healthcheck.
- /health: detailed readiness (DB + Redis ping). Returns 200 even if a
  managed provider is unconfigured — we don't block startup on keys.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from . import db, redis_client
from .config import get_settings

router = APIRouter()


class Liveness(BaseModel):
    status: str
    service: str


class Readiness(BaseModel):
    status: str
    db: bool
    redis: bool
    deepgram_configured: bool
    groq_configured: bool


@router.get("/health/live", response_model=Liveness)
async def liveness() -> Liveness:
    return Liveness(status="alive", service=get_settings().service_name)


@router.get("/health", response_model=Readiness)
async def readiness() -> Readiness:
    settings = get_settings()
    db_ok = await db.ping()
    redis_ok = await redis_client.ping()
    overall = "healthy" if (db_ok and redis_ok) else "degraded"
    return Readiness(
        status=overall,
        db=db_ok,
        redis=redis_ok,
        deepgram_configured=bool(settings.deepgram_api_key),
        groq_configured=bool(settings.groq_api_key),
    )
