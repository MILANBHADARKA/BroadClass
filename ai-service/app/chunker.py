"""
Sentence-aware chunking for transcripts.

We don't load a full tokenizer just for chunking — that would force torch
into every code path. Instead we approximate token counts with the
well-known ~4 chars / token heuristic, which is good enough for choosing
chunk boundaries (and exact counts don't matter to retrieval quality).

Algorithm:
  1. Split incoming text into sentences via simple punctuation.
  2. Greedily pack sentences into chunks of ~`target_chars` characters.
  3. Each new chunk re-includes the last `overlap_chars` characters of the
     previous chunk to preserve context across boundaries.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 300 tokens ≈ 1200 chars; 60-token overlap ≈ 240 chars (heuristic from plan).
DEFAULT_TARGET_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 240

# Sentence terminator: . ! ? followed by whitespace OR end of string. We
# tolerate ".." / "..." by treating them as a single terminator.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True, slots=True)
class Chunk:
    text: str
    # Indices into the original full transcript text (not token offsets).
    # The caller (ingest pipeline) maps these to millisecond offsets using
    # Deepgram's word-level timestamps before persisting to TranscriptChunk.
    char_start: int
    char_end: int


def chunk_text(
    text: str,
    *,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[Chunk]:
    """Split `text` into overlapping, sentence-aligned chunks.

    Edge cases:
    - Empty input → returns [].
    - Single very long sentence → one chunk longer than target_chars; we
      don't break mid-sentence (keeping semantic units intact matters more
      than hitting a size target exactly).
    """
    if not text or not text.strip():
        return []
    if target_chars <= 0:
        raise ValueError("target_chars must be > 0")
    if overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("overlap_chars must be in [0, target_chars)")

    # Track each sentence with its character offset so we can build accurate
    # char_start/char_end on output.
    sentences: list[tuple[int, str]] = []
    cursor = 0
    for raw in _SENTENCE_SPLIT.split(text):
        if not raw:
            continue
        # Find where this sentence actually starts in the original text.
        # Walk `cursor` forward through any whitespace separators.
        idx = text.find(raw, cursor)
        if idx == -1:
            # Defensive: shouldn't happen since `raw` came from `text`.
            idx = cursor
        sentences.append((idx, raw))
        cursor = idx + len(raw)

    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_start: int | None = None
    buf_end = 0
    buf_len = 0

    def flush() -> None:
        nonlocal buf, buf_start, buf_end, buf_len
        if not buf or buf_start is None:
            return
        joined = " ".join(buf).strip()
        chunks.append(Chunk(text=joined, char_start=buf_start, char_end=buf_end))
        # Build overlap from the tail of what we just emitted.
        if overlap_chars > 0 and len(joined) > overlap_chars:
            tail = joined[-overlap_chars:]
            buf = [tail]
            # `buf_start` for the next chunk = where the overlap begins.
            buf_start = buf_end - len(tail)
            buf_len = len(tail)
        else:
            buf = []
            buf_start = None
            buf_len = 0

    for idx, sentence in sentences:
        sentence_len = len(sentence)
        if buf_start is None:
            buf_start = idx
        # If adding this sentence would exceed target and we already have
        # content, flush first. (We never split a sentence.)
        if buf_len > 0 and buf_len + 1 + sentence_len > target_chars:
            flush()
            if buf_start is None:
                buf_start = idx
        buf.append(sentence)
        buf_end = idx + sentence_len
        # +1 accounts for the joining space.
        buf_len += (1 if buf_len > 0 else 0) + sentence_len

    # Final partial chunk
    if buf:
        flush()

    return chunks
