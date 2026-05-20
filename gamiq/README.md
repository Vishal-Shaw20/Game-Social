# Gamiq

Game recommendation engine powering [GameSocial](https://github.com/Vishal-Shaw20). Uses FAISS vector similarity search with cross-encoder reranking to find games similar to ones you already like.

Built with FastAPI, PostgreSQL (pgvector), and Redis.

## How It Works

```
User picks up to 3 games
        │
        ▼
  ┌─────────────┐
  │ Redis Cache │──── HIT ──→ Return cached results
  └─────┬───────┘
        │ MISS
        ▼
  ┌─────────────┐
  │    FAISS    │  Top-500 nearest neighbors (IVFFlat, inner product)
  └─────┬───────┘
        │
        ├── Inject franchise/series games from DB
        │
        ▼
  ┌─────────────┐
  │  Reranker   │  ONNX INT8 cross-encoder scores top-100
  └─────┬───────┘
        │
        ▼
  ┌─────────────┐
  │   Scoring   │  Weighted blend: FAISS (0.35) + Reranker (0.35)
  │  & Filters  │  + Genre (0.10) + Rating (0.10) + Meta (0.05) + Pop (0.05)
  └─────┬───────┘
        │
        ├── DLC/remaster filter, developer cap (2), series cap (3)
        │
        ▼
  Return top-K game IDs
```

Embeddings are **name-free** (built from genres, tags, description, developers — no game title) to prevent name-similarity contamination. The reranker sees game names for franchise matching.

## Quick Start

### Prerequisites

- Python 3.10+
- PostgreSQL with [pgvector](https://github.com/pgvector/pgvector)
- Redis (optional — API works without it, caching disabled)
- FAISS index + ONNX reranker model in `recommender/artifacts/`

### Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Create a .env file with the required environment variables (see table below)

# Run offline scripts to build artifacts (required before starting the server)
python -m recommender.offline.export_embeddings
python -m recommender.offline.convert_to_npy
python -m recommender.offline.train_faiss
python -m recommender.offline.export_reranker_onnx

# Start the server
uvicorn main:app --reload
```

The API runs on `http://localhost:8000`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | Yes | PostgreSQL port |
| `DB_NAME` | Yes | PostgreSQL database name |
| `DB_USER` | Yes | PostgreSQL user |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `RAWG_API_KEY` | Yes | Primary RAWG API key |
| `RAWG_API_KEY_1`..`_15` | Yes | Additional keys for rate limit rotation |
| `PIPELINE_API_KEY` | Yes | Shared secret for `/pipeline/run` and `/games/ensure` endpoints |
| `HF_TOKEN` | Yes | HuggingFace Inference API token (for embeddings) |
| `REDIS_URL` | No | Redis connection URL (default: `redis://localhost:6379/0`) |

## API

### `POST /recommend`

Returns game recommendations for up to 3 input games.

**Request:**
```json
{
  "rawg_ids": [3498, 3328]
}
```

**Response:**
```json
{
  "rawg_ids": [
    [416, 4459, 378578, 17822, 10389],
    [28478, 442855, 1024, 18726, 28172],
    [426096, 17462, 19286, 494382, 16944]
  ]
}
```

Each inner array is a row of recommended RAWG game IDs. The number of rows and games per row scales with the number of input games (1 game = 2 rows of 5, 2 games = 3 rows of 5, 3 games = 3 rows of 5).

### `POST /pipeline/run`

Triggers the daily ingestion pipeline as a background task. Fetches new and updated games from RAWG, embeds them, and updates the FAISS index. Requires `Authorization: Bearer {PIPELINE_API_KEY}` header.

**Response:** `{"status": "started"}`

### `POST /games/ensure/{rawg_id}`

Ensures a single game exists in the database with full pipeline processing (fetch from RAWG, embed, add to FAISS). Used by the backend's trending route for on-demand game ingestion. Requires `Authorization: Bearer {PIPELINE_API_KEY}` header.

### `GET /health`

Returns `{"status": "ok"}`.

## Project Structure

```
gamiq/
├── main.py                          # FastAPI app, CORS, error handling
├── recommender/
│   ├── config.py                    # DB config, paths, env loading
│   ├── api.py                       # POST /recommend endpoint
│   ├── cache.py                     # Redis cache (24h TTL, graceful fallback)
│   ├── text_builder.py              # Structured text for embeddings/reranker
│   ├── daily_pipeline.py            # RAWG ingestion + embedding + FAISS update
│   ├── eval.py                      # 36-case evaluation suite
│   ├── inference/
│   │   ├── query_faiss.py           # FAISS search, scoring, filtering
│   │   └── reranker.py              # ONNX cross-encoder wrapper
│   ├── offline/
│   │   ├── rebuild_embeddings.py    # Full re-embed (local/Kaggle/Colab)
│   │   ├── export_embeddings.py     # Export vectors from DB
│   │   ├── convert_to_npy.py        # CSV → NumPy for FAISS training
│   │   ├── train_faiss.py           # Build IVFFlat index from scratch
│   │   ├── export_reranker_onnx.py  # PyTorch → ONNX INT8 conversion
│   │   └── backfill_series.py       # Populate game_series table from RAWG
│   └── artifacts/                   # FAISS index, ONNX model, checkpoints
├── tests/
│   ├── test_api.py                  # API shape tests
│   ├── test_api_logic.py            # Quota distribution logic
│   ├── test_query_faiss.py          # Scoring, filtering, imputation (18 tests)
│   ├── test_cache.py                # Redis cache behavior (8 tests)
│   └── test_text_builder.py         # Text template invariants
├── docs/                            # Eval outputs, priorities
├── notebooks/                       # ETL and exploration notebooks
└── dataset/                         # Raw RAWG CSV datasets
```

## Key Commands

```bash
# Run tests
pytest tests/ -v

# Run the daily pipeline (fetch new games, embed, update FAISS)
python -m recommender.daily_pipeline

# Run evaluation suite (requires API server running)
python -m recommender.eval

# Full index rebuild (in order)
python -m recommender.offline.export_embeddings
python -m recommender.offline.convert_to_npy
python -m recommender.offline.train_faiss
```

## Models

| Model | Purpose | Format |
|-------|---------|--------|
| `BAAI/bge-large-en-v1.5` | Text embeddings (1024-dim) | PyTorch (sentence-transformers) |
| `BAAI/bge-reranker-base` | Cross-encoder reranking | ONNX INT8 (optimum) |

## Database

PostgreSQL with pgvector. Two main tables:

- **`games`** — Game metadata from RAWG (~868k games): name, genres, tags, rating, developers, metacritic, etc.
- **`content_embeddings`** — 1024-dim vectors keyed by `game_id`, encoded by `bge-large-en-v1.5`
- **`game_series`** — Franchise mappings (`game_id` → `series_game_id`) for series injection

## Architecture Notes

- The daily pipeline is **checkpoint-based** — safe to restart after crashes. New-game pass resumes from the last processed RAWG game ID stored in `artifacts/checkpoint.txt`. Updated-game pass resumes from the last date in `artifacts/updated_checkpoint.txt`.
- RAWG API key rotation distributes requests across up to 16 keys to avoid rate limits.
- Series games injected into FAISS candidates get **imputed scores** (batch minimum) so they aren't penalized by a raw `0.0` FAISS distance.
- The reranker uses a `threading.Lock` to serialize concurrent inference calls — safe for multi-threaded use.
- Redis cache is **best-effort** — if Redis is down, the API runs the full pipeline and returns results normally.

## Deployment

Docker container using Python 3.13 slim:

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

FAISS index and ONNX reranker artifacts are mounted via a Kubernetes PersistentVolume (hostPath on the Oracle instance). No local ML model download at runtime — embeddings use the HuggingFace Inference API, and the reranker runs via ONNX.

Deployed alongside frontend, backend, and Redis via Kubernetes on Oracle Cloud ARM64. See `k8s/gamiq.yaml` for the deployment manifest.

## Part of GameSocial

Gamiq is the ML backend of [GameSocial](https://github.com/Vishal-Shaw20), a gaming social platform. The web backend (Node.js/Express) calls `POST /recommend` internally and enriches the returned game IDs with metadata before serving them to the React frontend.
