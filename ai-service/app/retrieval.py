"""
Retrieval gating logic.

The actual pgvector query lives in `app/store/chunks.py`. This module owns
the policy that turns retrieval scores into a binary "answerable" decision,
keeping it pure for easy unit testing.

Two-stage gate (from the plan):
  1. Cheap retrieval-score gate (cosine similarity thresholds).
  2. LLM self-assessment via structured output (handled by AnswerProvider).

This file is stage 1 only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    chunk_id: str
    text: str
    start_ms: int
    end_ms: int
    cosine_similarity: float


@dataclass(frozen=True, slots=True)
class GateDecision:
    passed: bool
    reason: str
    top1: float
    mean_top3: float


def evaluate_gate(
    results: Sequence[RetrievedChunk],
    *,
    min_top1: float,
    min_mean_top3: float,
) -> GateDecision:
    """Return whether the retrieval result is strong enough to be worth
    passing to the LLM.

    Thresholds are configured via Settings; defaults from the plan are
    top1 >= 0.35 AND mean(top-3) >= 0.30.
    """
    if not results:
        return GateDecision(passed=False, reason="no_chunks", top1=0.0, mean_top3=0.0)

    sorted_results = sorted(results, key=lambda r: r.cosine_similarity, reverse=True)
    top1 = sorted_results[0].cosine_similarity
    top3 = sorted_results[:3]
    mean_top3 = sum(r.cosine_similarity for r in top3) / len(top3)

    if top1 < min_top1:
        return GateDecision(
            passed=False, reason=f"top1 {top1:.3f} < {min_top1:.3f}",
            top1=top1, mean_top3=mean_top3,
        )
    if mean_top3 < min_mean_top3:
        return GateDecision(
            passed=False, reason=f"mean_top3 {mean_top3:.3f} < {min_mean_top3:.3f}",
            top1=top1, mean_top3=mean_top3,
        )
    return GateDecision(passed=True, reason="ok", top1=top1, mean_top3=mean_top3)
