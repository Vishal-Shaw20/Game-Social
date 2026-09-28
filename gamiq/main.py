import asyncio
import json
import logging
import os
import sys

from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from recommender.api import router as recommender_router
from recommender.daily_pipeline import run_daily_pipeline, ensure_game, backfill_recent_games
from recommender.inference.query_faiss import reload_index


class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "time": self.formatTime(record, self.datefmt),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info and record.exc_info[0]:
            log_record["error"] = self.formatException(record.exc_info)
        return json.dumps(log_record)


def setup_logging():
    is_dev = os.getenv("ENV", "production") != "production"

    handler = logging.StreamHandler(sys.stdout)
    if is_dev:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
    else:
        handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


setup_logging()

logger = logging.getLogger("gamiq")

app = FastAPI()

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


@app.get("/health")
def health():
    return {"status": "ok"}


_pipeline_lock = asyncio.Lock()
_pipeline_running = False

@app.post("/pipeline/run")
async def trigger_pipeline(request: Request, background_tasks: BackgroundTasks):
    if not PIPELINE_API_KEY:
        return JSONResponse(status_code=503, content={"error": "Pipeline auth not configured"})

    auth = request.headers.get("Authorization")
    if auth != f"Bearer {PIPELINE_API_KEY}":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    global _pipeline_running
    async with _pipeline_lock:
        if _pipeline_running:
            return {"status": "already_running"}
        _pipeline_running = True

    def _run():
        global _pipeline_running
        try:
            run_daily_pipeline()
        finally:
            _pipeline_running = False

    background_tasks.add_task(_run)
    return {"status": "started"}


@app.post("/games/refresh")
async def refresh_games_endpoint(request: Request, background_tasks: BackgroundTasks):
    """One-off backfill: re-fetch stale games from RAWG (backfill_recent_games).

    Body (optional): {"ids": [972995]} to refresh just those games; without it,
    every game releasing in the future or in the last 180 days. Runs in the
    background under the same guard as /pipeline/run.
    """
    if not PIPELINE_API_KEY:
        return JSONResponse(status_code=503, content={"error": "Pipeline auth not configured"})

    auth = request.headers.get("Authorization")
    if auth != f"Bearer {PIPELINE_API_KEY}":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    try:
        body = await request.json()
    except Exception:
        body = {}
    ids = body.get("ids") if isinstance(body, dict) else None
    if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, int) for i in ids)):
        return JSONResponse(status_code=400, content={"error": "ids must be a list of integers"})

    global _pipeline_running
    async with _pipeline_lock:
        if _pipeline_running:
            return {"status": "already_running"}
        _pipeline_running = True

    def _run():
        global _pipeline_running
        try:
            result = backfill_recent_games(ids)
            logger.info("Backfill result: %s", result)
        except Exception:
            logger.exception("Backfill crashed")
        finally:
            _pipeline_running = False

    background_tasks.add_task(_run)
    return {"status": "started", "scope": "ids" if ids else "recent"}


@app.post("/games/ensure/{rawg_id}")
async def ensure_game_endpoint(rawg_id: int, request: Request):
    if not PIPELINE_API_KEY:
        return JSONResponse(status_code=503, content={"error": "Pipeline auth not configured"})

    auth = request.headers.get("Authorization")
    if auth != f"Bearer {PIPELINE_API_KEY}":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    try:
        result = ensure_game(rawg_id)
        return result
    except Exception as e:
        logger.error("ensure_game failed for %s: %s", rawg_id, e)
        return JSONResponse(status_code=500, content={"error": "Failed to ensure game"})


@app.post("/internal/reload-index")
async def reload_index_endpoint(request: Request):
    if not PIPELINE_API_KEY:
        return JSONResponse(status_code=503, content={"error": "Pipeline auth not configured"})

    auth = request.headers.get("Authorization")
    if auth != f"Bearer {PIPELINE_API_KEY}":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    try:
        ntotal = reload_index()
        return {"status": "reloaded", "ntotal": ntotal}
    except Exception as e:
        logger.error("reload_index failed: %s", e)
        return JSONResponse(status_code=500, content={"error": "Failed to reload index"})


app.include_router(recommender_router)
