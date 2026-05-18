from app.retrieval import RetrievedChunk, evaluate_gate


def _chunk(score: float, cid: str = "c") -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=cid, text="t", start_ms=0, end_ms=1000, cosine_similarity=score
    )


def test_empty_results_fail():
    decision = evaluate_gate([], min_top1=0.35, min_mean_top3=0.30)
    assert decision.passed is False
    assert decision.reason == "no_chunks"


def test_top1_below_threshold_fails():
    # Top is 0.30, but threshold is 0.35
    results = [_chunk(0.30), _chunk(0.25), _chunk(0.20)]
    decision = evaluate_gate(results, min_top1=0.35, min_mean_top3=0.20)
    assert decision.passed is False
    assert "top1" in decision.reason
    assert abs(decision.top1 - 0.30) < 1e-6


def test_top1_passes_but_mean_top3_fails():
    # Top is 0.50, but the next two are very low → mean drags below threshold
    results = [_chunk(0.50), _chunk(0.10), _chunk(0.05)]
    decision = evaluate_gate(results, min_top1=0.35, min_mean_top3=0.30)
    assert decision.passed is False
    assert "mean_top3" in decision.reason


def test_both_thresholds_passed():
    results = [_chunk(0.60), _chunk(0.45), _chunk(0.35)]
    decision = evaluate_gate(results, min_top1=0.35, min_mean_top3=0.30)
    assert decision.passed is True
    assert decision.reason == "ok"
    assert decision.top1 > decision.mean_top3


def test_fewer_than_three_results_still_evaluated():
    # With only 2 chunks, mean_top3 is mean over those 2 (not zero-padded).
    results = [_chunk(0.40), _chunk(0.35)]
    decision = evaluate_gate(results, min_top1=0.35, min_mean_top3=0.30)
    assert decision.passed is True
    assert abs(decision.mean_top3 - 0.375) < 1e-6


def test_results_are_sorted_internally():
    # Even if caller passes unsorted, top1 should reflect the actual maximum.
    results = [_chunk(0.10), _chunk(0.50), _chunk(0.30)]
    decision = evaluate_gate(results, min_top1=0.35, min_mean_top3=0.20)
    assert abs(decision.top1 - 0.50) < 1e-6
    assert decision.passed is True
