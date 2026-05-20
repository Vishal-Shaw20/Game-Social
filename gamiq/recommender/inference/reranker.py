import threading
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

from recommender.config import ARTIFACTS_DIR

# ---------------- CONFIG ----------------

RERANKER_ONNX_PATH = str(ARTIFACTS_DIR / "bge-reranker-onnx-int8")
TOP_N              = 20    # number of final results to return after re-ranking

# ---------------- LOAD MODEL (lazy) ----------------

_tokenizer    = None
_session      = None
_input_names  = None
_lock         = threading.Lock()


def _ensure_loaded():
    global _tokenizer, _session, _input_names
    if _tokenizer is not None:
        return
    _tokenizer    = AutoTokenizer.from_pretrained(RERANKER_ONNX_PATH)
    _session      = ort.InferenceSession(str(Path(RERANKER_ONNX_PATH) / "model_quantized.onnx"))
    _input_names  = [inp.name for inp in _session.get_inputs()]

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

    _ensure_loaded()

    # Build (query, candidate) pairs for cross-encoder
    pairs = [(query_text, c["text"]) for c in candidates]

    # Score all pairs — lock prevents concurrent predict() calls from corrupting state
    with _lock:
        encoded = _tokenizer(
            pairs, padding=True, truncation=True, max_length=512, return_tensors="np"
        )
        inputs = {k: v for k, v in encoded.items() if k in _input_names}
        logits = _session.run(None, inputs)[0]
        scores = logits[:, 0] if logits.ndim == 2 else logits

    # Attach scores to candidates
    for candidate, score in zip(candidates, scores):
        candidate["reranker_score"] = float(score)

    # Sort by score descending, return top_n
    ranked = sorted(candidates, key=lambda x: x["reranker_score"], reverse=True)

    return ranked[:top_n]