"""
CRUD for the Transcript row (parent of TranscriptChunk).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from ..db import get_pool


async def create(
    *,
    classroom_id: str,
    broadcast_id: str,
    session_id: str,
    language: str | None = None,
) -> str:
    """Insert a new Transcript and return its id.

    Phase 8: session_id is the primary scoping key. broadcast_id is retained
    on the row for media-plane traceability but no longer the query target.
    """
    transcript_id = str(uuid.uuid4())
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO "Transcript" ("id", "classroomId", "broadcastId", "sessionId", "language")
            VALUES ($1, $2, $3, $4, $5)
            """,
            transcript_id,
            classroom_id,
            broadcast_id,
            session_id,
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


async def get_by_session(session_id: str) -> dict[str, Any] | None:
    """Return the transcript for a session, if one exists. Sessions are 1:1
    with transcripts in practice (we create one transcript on the first final
    transcript event) so LIMIT 1 is sufficient."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            'SELECT * FROM "Transcript" WHERE "sessionId" = $1 ORDER BY "startedAt" DESC LIMIT 1',
            session_id,
        )
    return dict(row) if row else None
