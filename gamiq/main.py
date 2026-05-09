import logging
import os

from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from recommender.api import router as recommender_router
from recommender.daily_pipeline import run_daily_pipeline, ensure_game

logger = logging.getLogger("gamiq")

app = FastAPI()

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
PIPELINE_API_KEY = os.getenv("PIPELINE_API_KEY")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


@app.get("/health")
def health():
    return {"status": "ok"}


_pipeline_running = False

@app.post("/pipeline/run")
async def trigger_pipeline(request: Request, background_tasks: BackgroundTasks):
    if not PIPELINE_API_KEY:
        return JSONResponse(status_code=503, content={"error": "Pipeline auth not configured"})

    auth = request.headers.get("Authorization")
    if auth != f"Bearer {PIPELINE_API_KEY}":
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    global _pipeline_running
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


app.include_router(recommender_router)
