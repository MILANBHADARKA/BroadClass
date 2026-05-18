"""
CLI smoke-test for retrieval quality.

Usage (inside the ai-service container or with the env set up):

    python -m scripts.query <broadcastId> "your question here"

Or:

    python ai-service/scripts/query.py <broadcastId> "your question here"

Prints the top-K most-similar transcript chunks for the question, ordered
by descending cosine similarity. Used during Phase 1 to verify the
audio-tap → STT → embedding → DB pipeline is producing useful vectors
before we wire up the chat path.

Reads DATABASE_URL and EMBEDDING_MODEL_NAME from the environment (loads
.env in the current directory if present).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Allow running as `python scripts/query.py` from the ai-service directory by
# making the `app` package importable.
_THIS = Path(__file__).resolve()
_AI_ROOT = _THIS.parent.parent
if str(_AI_ROOT) not in sys.path:
    sys.path.insert(0, str(_AI_ROOT))

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.providers.sentence_transformers_local import (  # noqa: E402
    SentenceTransformersEmbedding,
)
from app.store import chunks as chunks_store  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description="Similarity query over a broadcast transcript.")
    parser.add_argument("broadcast_id", help="The broadcast (room) ID whose transcript to query.")
    parser.add_argument("question", help="The natural-language query.")
    parser.add_argument("-k", "--top-k", type=int, default=8, help="Number of chunks to return.")
    args = parser.parse_args()

    if not os.environ.get("DATABASE_URL"):
        # Allow .env in cwd as a convenience for local dev.
        env_path = Path.cwd() / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))

    _ = get_settings()  # forces validation of required vars

    await db.init_pool()
    try:
        embedder = SentenceTransformersEmbedding()
        [query_vec] = await embedder.embed([args.question])
        rows = await chunks_store.search_similar(
            broadcast_id=args.broadcast_id,
            query_embedding=query_vec,
            top_k=args.top_k,
        )
        if not rows:
            print("(no chunks found — has the broadcast started transcribing?)")
            return 1
        print(f"Top {len(rows)} chunks for broadcastId={args.broadcast_id}:\n")
        for i, row in enumerate(rows, start=1):
            sim = row["cosine_similarity"]
            start_s = row["startMs"] / 1000
            end_s = row["endMs"] / 1000
            print(f"[{i}]  cos={sim:.3f}  t={start_s:.1f}-{end_s:.1f}s  id={row['id']}")
            print(f"     {row['text']}\n")
        return 0
    finally:
        await db.close_pool()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
