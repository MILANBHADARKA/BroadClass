"""
CRUD + similarity search for TranscriptChunk rows.

The embedding column is pgvector(384). Vectors are passed as Python lists
or numpy arrays; the pgvector codec (registered in db._init_connection)
handles serialization.
"""

from __future__ import annotations

import uuid
from typing import Any, Sequence

from ..db import get_pool


async def insert_many(
    *,
    transcript_id: str,
    broadcast_id: str,
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
                    "id", "transcriptId", "broadcastId", "chunkIndex",
                    "text", "startMs", "endMs",
                    "embedding", "embeddingVersion", "speakerLabel"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                rows,
            )
    return ids


async def search_similar(
    *,
    broadcast_id: str,
    query_embedding: Sequence[float],
    top_k: int = 8,
) -> list[dict[str, Any]]:
    """
    Cosine-similarity search restricted to a single broadcast's chunks.

    Returns rows including a `cosine_similarity` field (1.0 - cosine_distance).
    Uses the ivfflat index created in the migration.
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                "id", "transcriptId", "chunkIndex", "text", "startMs", "endMs",
                "speakerLabel",
                1 - ("embedding" <=> $1) AS "cosine_similarity"
            FROM "TranscriptChunk"
            WHERE "broadcastId" = $2 AND "embedding" IS NOT NULL
            ORDER BY "embedding" <=> $1
            LIMIT $3
            """,
            list(query_embedding),
            broadcast_id,
            top_k,
        )
    return [dict(r) for r in rows]


async def count_for_broadcast(broadcast_id: str) -> int:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            'SELECT COUNT(*) AS n FROM "TranscriptChunk" WHERE "broadcastId" = $1',
            broadcast_id,
        )
    return int(row["n"]) if row else 0
