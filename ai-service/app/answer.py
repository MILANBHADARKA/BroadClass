"""
POST /answer — RAG endpoint (Smart Chat Phase 3).

Pipeline:
  1. Embed the question (sentence-transformers).
  2. pgvector top-K similarity search restricted to `broadcastId`.
  3. Cheap retrieval-score gate (top-1 + mean-top-3 cosine thresholds).
  4. If gated: ask Groq with strict JSON output to answer ONLY from chunks.
  5. Hallucination guard: reject if `answerable=true` but `citations=[]`.

Returns the AnswerResult plus enriched citation objects (the rows from
`TranscriptChunk`) so the caller can store the chunk IDs AND surface
clickable snippets/timestamps in the UI without an extra fetch.

Auth: shared INTERNAL_API_KEY via X-Internal-Key header.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings
from .ingest import _get_embedding  # reuse the warmed singleton
from .logging_setup import get_logger
from .providers.answer import AnswerProvider, ContextChunk
from .retrieval import RetrievedChunk, evaluate_gate
from .security import require_internal_key
from .store import chunks as chunks_store

router = APIRouter()
log = get_logger("answer")


# Lazy provider construction — same pattern as moderation/ingest so tests
# can inject fakes without hitting Groq.
_provider_factory = None
_provider_singleton: AnswerProvider | None = None


def _default_provider() -> AnswerProvider:
    """Dispatch on settings.answer_provider. Each branch lazy-imports its
    SDK so a missing optional dep (e.g. `anthropic`) doesn't break startup
    for users on a different provider."""
    global _provider_singleton
    if _provider_singleton is not None:
        return _provider_singleton

    settings = get_settings()
    name = (settings.answer_provider or "groq").lower()

    if name == "groq":
        from .providers.groq_answer import GroqAnswer
        _provider_singleton = GroqAnswer()
    elif name == "openai":
        from .providers.openai_answer import OpenAIAnswer
        _provider_singleton = OpenAIAnswer()
    elif name == "anthropic":
        from .providers.anthropic_answer import AnthropicAnswer
        _provider_singleton = AnthropicAnswer()
    else:
        raise RuntimeError(
            f"Unknown ANSWER_PROVIDER={name!r}. Supported: groq, openai, anthropic"
        )

    log.info("answer.provider.selected", provider=name)
    return _provider_singleton


def configure_answer_provider(factory) -> None:
    """Test hook — pass a callable returning a fake AnswerProvider."""
    global _provider_factory, _provider_singleton
    _provider_factory = factory
    _provider_singleton = None


def _get_provider() -> AnswerProvider:
    return (_provider_factory or _default_provider)()


class AnswerRequest(BaseModel):
    # Phase 8: sessionId is the new primary scope. broadcastId kept for
    # diagnostics / log correlation but no longer used for retrieval.
    sessionId: str = Field(..., min_length=1)
    broadcastId: str | None = Field(default=None)
    content: str = Field(..., min_length=1, max_length=4000)


class CitationOut(BaseModel):
    id: str
    text: str
    startMs: int
    endMs: int


class AnswerResponseModel(BaseModel):
    answerable: bool
    answer: str | None = None
    citations: list[CitationOut] = []
    confidence: str = "low"
    # Diagnostic — useful for tuning thresholds. Not displayed to users.
    gate: dict | None = None


@router.post(
    "/answer",
    response_model=AnswerResponseModel,
    dependencies=[Depends(require_internal_key)],
)
async def answer(req: AnswerRequest) -> AnswerResponseModel:
    settings = get_settings()
    embedder = _get_embedding()

    # 1. Embed the question.
    try:
        [query_vec] = await embedder.embed([req.content])
    except Exception as exc:  # noqa: BLE001
        log.warning("answer.embed.failed", error=str(exc))
        raise HTTPException(status_code=503, detail="embedding unavailable")

    # 2. Retrieve top-K chunks for this SESSION (Phase 8).
    try:
        rows = await chunks_store.search_similar(
            session_id=req.sessionId,
            query_embedding=query_vec,
            top_k=settings.retrieval_top_k,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("answer.retrieve.failed", error=str(exc))
        raise HTTPException(status_code=503, detail="retrieval unavailable")

    # 3. Cheap retrieval gate.
    retrieved = [
        RetrievedChunk(
            chunk_id=r["id"],
            text=r["text"],
            start_ms=r["startMs"],
            end_ms=r["endMs"],
            cosine_similarity=float(r["cosine_similarity"]),
        )
        for r in rows
    ]
    gate = evaluate_gate(
        retrieved,
        min_top1=settings.retrieval_min_top1_cosine,
        min_mean_top3=settings.retrieval_min_mean_top3_cosine,
    )
    gate_info = {
        "passed": gate.passed,
        "reason": gate.reason,
        "top1": round(gate.top1, 3),
        "meanTop3": round(gate.mean_top3, 3),
    }
    if not gate.passed:
        log.info(
            "answer.gate.fell_through",
            sessionId=req.sessionId,
            reason=gate.reason,
            top1=gate.top1,
        )
        return AnswerResponseModel(answerable=False, citations=[], gate=gate_info)

    # 4. Ask Groq with the gated chunks as context.
    provider = _get_provider()
    context_chunks = [
        ContextChunk(chunk_id=c.chunk_id, text=c.text, start_ms=c.start_ms, end_ms=c.end_ms)
        for c in retrieved
    ]
    try:
        result = await provider.answer(question=req.content, context_chunks=context_chunks)
    except Exception as exc:  # noqa: BLE001
        log.warning("answer.llm.failed", error=str(exc))
        raise HTTPException(status_code=502, detail="LLM unavailable")

    # 5. Build enriched citations from the model's chosen ids.
    by_id = {c.chunk_id: c for c in retrieved}
    citations_out = [
        CitationOut(id=cid, text=by_id[cid].text, startMs=by_id[cid].start_ms, endMs=by_id[cid].end_ms)
        for cid in result.citations
        if cid in by_id
    ]

    # 6. Final hallucination guard. Cheap (provider already does this, but
    # belt + suspenders): never let an "answerable=true" with no citations
    # leak through.
    if result.answerable and not citations_out:
        log.warning("answer.no_citations_after_filter", sessionId=req.sessionId)
        return AnswerResponseModel(answerable=False, citations=[], gate=gate_info)

    log.info(
        "answer.ok",
        sessionId=req.sessionId,
        answerable=result.answerable,
        confidence=result.confidence,
        citations=len(citations_out),
    )

    return AnswerResponseModel(
        answerable=result.answerable,
        answer=result.answer,
        citations=citations_out,
        confidence=result.confidence,
        gate=gate_info,
    )
