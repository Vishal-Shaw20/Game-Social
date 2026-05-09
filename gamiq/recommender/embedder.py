import time
import requests
import numpy as np
from recommender.config import HF_TOKEN

API_URL = "https://router.huggingface.co/hf-inference/models/BAAI/bge-large-en-v1.5/pipeline/feature-extraction"
HEADERS = {"Authorization": f"Bearer {HF_TOKEN}"}
BATCH_SIZE = 32
MAX_RETRIES = 5


def _call_api(texts: list[str]) -> list[list[float]]:
    for attempt in range(MAX_RETRIES):
        resp = requests.post(API_URL, headers=HEADERS, json={"inputs": texts})
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code == 503:
            wait = min(2 ** attempt, 30)
            print(f"[embedder] Model loading, retrying in {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
    raise RuntimeError(f"HF API failed after {MAX_RETRIES} retries")


def encode_texts(texts: list[str]) -> np.ndarray:
    all_embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        embeddings = _call_api(batch)
        all_embeddings.extend(embeddings)
    return np.array(all_embeddings, dtype="float32")
