import logging
import os
import time

import numpy as np
import requests

logger = logging.getLogger(__name__)

API_URL = os.getenv(
    "EMBED_API_URL",
    "https://vishalshaw-ml-space.hf.space/embed",
).strip()
BATCH_SIZE = 32  # ML-Space accepts at most 32 texts per request.
MAX_RETRIES = 5  # Total attempts per batch, including the first attempt.
EMBEDDING_DIMENSIONS = 1024
MODEL_NAME = "BAAI/bge-large-en-v1.5"
CONNECT_TIMEOUT_SECONDS = 10
READ_TIMEOUT_SECONDS = 300  # Allow for a sleeping Space/cold start.
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _get_api_key() -> str:
    """Read the endpoint secret at request time so env injection is explicit."""
    key = os.getenv("EMBED_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "EMBED_API_KEY is not configured. Add GAMIQ_EMBED_API_KEY to "
            "GitHub Actions secrets and pass it to the Gamiq pod as EMBED_API_KEY."
        )
    return key


def _call_api(texts: list[str]) -> list[list[float]]:
    """Call ML-Space for one batch and validate its response."""
    if not texts:
        return []
    if len(texts) > BATCH_SIZE:
        raise ValueError(f"ML-Space accepts at most {BATCH_SIZE} texts per request")

    headers = {"Authorization": f"Bearer {_get_api_key()}"}
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(
                API_URL,
                headers=headers,
                json={"texts": texts},
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )

            if response.status_code in RETRYABLE_STATUS_CODES:
                last_error = RuntimeError(
                    f"ML-Space returned retryable HTTP {response.status_code}"
                )
                logger.warning(
                    "ML-Space returned HTTP %s for batch (%d/%d attempt)",
                    response.status_code,
                    attempt,
                    MAX_RETRIES,
                )
            elif response.status_code in (401, 403):
                raise RuntimeError(
                    f"ML-Space authentication failed (HTTP {response.status_code}); "
                    "check the EMBED_API_KEY secret."
                )
            else:
                response.raise_for_status()
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise RuntimeError("ML-Space returned invalid JSON") from exc

                if payload.get("model") != MODEL_NAME:
                    raise RuntimeError(
                        "Unexpected embedding model returned by ML-Space: "
                        f"{payload.get('model')!r}"
                    )
                if payload.get("dimensions") != EMBEDDING_DIMENSIONS:
                    raise RuntimeError(
                        "Unexpected embedding dimensions reported by ML-Space: "
                        f"{payload.get('dimensions')!r}"
                    )

                try:
                    embeddings = np.asarray(payload["embeddings"], dtype=np.float32)
                except (KeyError, TypeError, ValueError) as exc:
                    raise RuntimeError(
                        "ML-Space response is missing valid 'embeddings' data"
                    ) from exc

                expected_shape = (len(texts), EMBEDDING_DIMENSIONS)
                if embeddings.shape != expected_shape:
                    raise RuntimeError(
                        "Unexpected embedding shape from ML-Space: "
                        f"got {embeddings.shape}, expected {expected_shape}"
                    )
                if not np.isfinite(embeddings).all():
                    raise RuntimeError("ML-Space returned NaN or infinite embedding values")

                return embeddings.tolist()

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_error = exc
            logger.warning(
                "ML-Space connection/timeout error (attempt %d/%d): %s",
                attempt,
                MAX_RETRIES,
                type(exc).__name__,
            )
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "unknown"
            raise RuntimeError(
                f"ML-Space request failed with HTTP {status}; "
                "check the request and endpoint configuration."
            ) from exc

        if attempt < MAX_RETRIES:
            delay = min(2 ** (attempt - 1), 30)
            logger.info("Retrying ML-Space request in %d second(s)", delay)
            time.sleep(delay)

    raise RuntimeError(
        f"ML-Space embedding request failed after {MAX_RETRIES} attempts"
    ) from last_error


def encode_texts(texts: list[str]) -> np.ndarray:
    """Encode texts in batches, returning a float32 array shaped (N, 1024)."""
    if not texts:
        return np.empty((0, EMBEDDING_DIMENSIONS), dtype=np.float32)

    batches: list[np.ndarray] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        logger.info(
            "Requesting embeddings from ML-Space for texts %d-%d of %d",
            start + 1,
            start + len(batch),
            len(texts),
            )
        result = _call_api(batch)
        batches.append(np.asarray(result, dtype=np.float32))

    return np.concatenate(batches, axis=0)
