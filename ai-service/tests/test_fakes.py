"""
Smoke tests for the in-memory provider fakes.
"""

import pytest

from app.providers import AnswerResult, ContextChunk
from app.providers.fakes import FakeAnswer, FakeEmbedding, FakeModeration


@pytest.mark.asyncio
async def test_fake_embedding_dimension_and_determinism():
    emb = FakeEmbedding(dimension=384, version="fake-v1")
    [vec1] = await emb.embed(["hello"])
    [vec2] = await emb.embed(["hello"])
    assert len(vec1) == 384
    assert vec1 == vec2  # deterministic — same text, same vector
    assert emb.dimension == 384
    assert emb.version == "fake-v1"


@pytest.mark.asyncio
async def test_fake_embedding_different_texts_yield_different_vectors():
    emb = FakeEmbedding()
    [a, b] = await emb.embed(["alpha", "beta"])
    assert a != b


@pytest.mark.asyncio
async def test_fake_answer_returns_prepared_result():
    prepared = AnswerResult(answerable=True, answer="42", citations=["c1"], confidence="high")
    provider = FakeAnswer(prepared)
    out = await provider.answer(
        question="what is the answer",
        context_chunks=[ContextChunk(chunk_id="c1", text="forty two", start_ms=0, end_ms=1000)],
    )
    assert out is prepared


@pytest.mark.asyncio
async def test_fake_moderation_flags_banned_terms():
    mod = FakeModeration(banned=["badword", "slur"])
    allowed = await mod.check("this is fine")
    assert allowed.allowed is True
    assert allowed.flags == []

    blocked = await mod.check("contains BADWORD here")
    assert blocked.allowed is False
    assert "badword" in blocked.flags
