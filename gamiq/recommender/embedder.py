import logging
import time
import requests
import numpy as np
from recommender.config import HF_TOKENS

logger = logging.getLogger(__name__)

API_URL = "https://router.huggingface.co/hf-inference/models/BAAI/bge-large-en-v1.5/pipeline/feature-extraction"
BATCH_SIZE = 32
MAX_RETRIES = 5

_current_token_index = 0


def _call_api(texts: list[str]) -> list[list[float]]:
    global _current_token_index
    if not HF_TOKENS:
        raise RuntimeError("No HF tokens configured (set HF_TOKEN)")

    n = len(HF_TOKENS)
    for token_attempt in range(n):
        idx = (_current_token_index + token_attempt) % n
        headers = {"Authorization": f"Bearer {HF_TOKENS[idx]}"}

        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.post(API_URL, headers=headers, json={"inputs": texts}, timeout=10)
            except requests.exceptions.Timeout:
                logger.warning("HF timeout on token %d/%d, rotating...", idx + 1, n)
                break
            if resp.status_code == 200:
                _current_token_index = (idx + 1) % n
                return resp.json()
            if resp.status_code == 503:
                wait = min(2 ** attempt, 30)
                logger.info("HF model loading, retrying in %ds", wait)
                time.sleep(wait)
                continue
            if resp.status_code == 429:
                logger.warning("HF rate limit on token %d/%d, rotating...", idx + 1, n)
                break
            resp.raise_for_status()
        else:
            logger.warning("HF token %d/%d exhausted retries", idx + 1, n)

    raise RuntimeError("All HF tokens exhausted")


def encode_texts(texts: list[str]) -> np.ndarray:
    all_embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        embeddings = _call_api(batch)
        all_embeddings.extend(embeddings)
    return np.array(all_embeddings, dtype="float32")
