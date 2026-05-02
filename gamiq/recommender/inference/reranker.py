import threading

from sentence_transformers import CrossEncoder

from recommender.config import ARTIFACTS_DIR

# ---------------- CONFIG ----------------

RERANKER_ONNX_PATH = str(ARTIFACTS_DIR / "bge-reranker-onnx-int8")
TOP_N              = 20    # number of final results to return after re-ranking

# ---------------- LOAD MODEL ----------------

# Load ONNX INT8 model once at module level — not on every request
# Run `python -m recommender.offline.export_reranker_onnx` first to generate the model
reranker = CrossEncoder(RERANKER_ONNX_PATH, backend="onnx", model_kwargs={"file_name": "model_quantized.onnx"})
_lock    = threading.Lock()

# ---------------- RERANK FUNCTION ----------------

def rerank(query_text: str, candidates: list[dict], top_n: int = TOP_N) -> list[dict]:
    """
    Re-ranks FAISS candidates using bge-reranker-base.

    Args:
        query_text : structured text of the query game (from build_structured_text)
        candidates : list of dicts, each with at least a "text" key
                     e.g. [{"game_id": 123, "title": "...", "text": "..."}, ...]
        top_n      : number of results to return after re-ranking

    Returns:
        list of candidate dicts sorted by reranker score, top_n results only
    """

    if not candidates:
        return []

    # Build (query, candidate) pairs for cross-encoder
    pairs = [(query_text, c["text"]) for c in candidates]

    # Score all pairs — lock prevents concurrent predict() calls from corrupting state
    with _lock:
        scores = reranker.predict(pairs)

    # Attach scores to candidates
    for candidate, score in zip(candidates, scores):
        candidate["reranker_score"] = float(score)

    # Sort by score descending, return top_n
    ranked = sorted(candidates, key=lambda x: x["reranker_score"], reverse=True)

    return ranked[:top_n]