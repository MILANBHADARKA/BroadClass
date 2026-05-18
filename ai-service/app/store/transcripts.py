"""
CRUD for the Transcript row (parent of TranscriptChunk).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from ..db import get_pool


async def create(*, classroom_id: str, broadcast_id: str, language: str | None = None) -> str:
    """Insert a new Transcript and return its id."""
    transcript_id = str(uuid.uuid4())
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" ("id", "classroomId", "broadcastId", "language")
            VALUES ($1, $2, $3, $4)
            """,
            transcript_id,
            classroom_id,
            broadcast_id,
            language,
        )
    return transcript_id


async def mark_ended(transcript_id: str, *, ended_at: datetime | None = None) -> None:
    async with get_pool().acquire() as conn:
        await conn.execute(
            'UPDATE "Transcript" SET "endedAt" = COALESCE($2, CURRENT_TIMESTAMP) WHERE "id" = $1',
            transcript_id,
            ended_at,
        )


async def get_by_broadcast(broadcast_id: str) -> dict[str, Any] | None:
    """Return the most-recent transcript for a broadcast (a re-broadcast could
    produce more than one; we return the latest)."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            'SELECT * FROM "Transcript" WHERE "broadcastId" = $1 ORDER BY "startedAt" DESC LIMIT 1',
            broadcast_id,
        )
    return dict(row) if row else None
