"""
CRUD + similarity search for TranscriptChunk rows.

The embedding column is pgvector(384). Vectors are passed as Python lists
or numpy arrays; the pgvector codec (registered in db._init_connection)
handles serialization.

Phase 8: `sessionId` is the primary scoping key for all queries here.
`broadcastId` remains on the row for media-plane traceability but isn't
the hot query column anymore.
"""

from __future__ import annotations

import uuid
from typing import Any, Sequence

from ..db import get_pool


async def insert_many(
    *,
    transcript_id: str,
    broadcast_id: str,
    session_id: str,
    starting_index: int,
    items: Sequence[dict[str, Any]],
    embedding_version: str,
) -> list[str]:
    """
    Insert a batch of chunks (typically 1-100) in a single transaction.

    `items` is a sequence of dicts with keys: text, startMs, endMs, embedding
    (a list[float] of length 384). speakerLabel is optional.

    Returns the inserted ids in the same order as `items`.
    """
    if not items:
        return []

    ids: list[str] = []
    rows: list[tuple] = []
    for offset, item in enumerate(items):
        new_id = str(uuid.uuid4())
        ids.append(new_id)
        rows.append(
            (
                new_id,
                transcript_id,
                broadcast_id,
                session_id,
                starting_index + offset,
                item["text"],
                int(item["startMs"]),
                int(item["endMs"]),
                item["embedding"],
                embedding_version,
                item.get("speakerLabel"),
            )
        )

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO "TranscriptChunk" (
                    "id", "transcriptId", "broadcastId", "sessionId", "chunkIndex",
                    "text", "startMs", "endMs",
                    "embedding", "embeddingVersion", "speakerLabel"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """,
                rows,
            )
    return ids


async def search_similar(
    *,
    session_id: str,
    query_embedding: Sequence[float],
    top_k: int = 8,
) -> list[dict[str, Any]]:
    """
    Cosine-similarity search restricted to a single SESSION's chunks.

    Returns rows including a `cosine_similarity` field (1.0 - cosine_distance).
    Uses the ivfflat index on `embedding` and the `(sessionId)` filter
    index for efficient session-scoped retrieval.
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                "id", "transcriptId", "chunkIndex", "text", "startMs", "endMs",
                "speakerLabel",
                1 - ("embedding" <=> $1) AS "cosine_similarity"
            FROM "TranscriptChunk"
            WHERE "sessionId" = $2 AND "embedding" IS NOT NULL
            ORDER BY "embedding" <=> $1
            LIMIT $3
            """,
            list(query_embedding),
            session_id,
            top_k,
        )
    return [dict(r) for r in rows]


async def count_for_session(session_id: str) -> int:
    """Return the number of chunks accumulated for a session — used by the
    cold-start banner UX (Phase 8.6)."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            'SELECT COUNT(*) AS n FROM "TranscriptChunk" WHERE "sessionId" = $1',
            session_id,
        )
    return int(row["n"]) if row else 0
