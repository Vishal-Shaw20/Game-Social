import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict

from recommender.inference.query_faiss import get_recommendations

router = APIRouter()


# -------------------- Schemas --------------------

class ScoreWeights(BaseModel):
    faiss: float
    tag_overlap: float
    genre: float
    rating: float
    metacritic: float
    popularity: float
    developer: float
    publisher: float


class ScoreBreakdown(BaseModel):
    faiss_score: float
    tag_overlap: float
    genre_overlap: float
    dev_match: float
    pub_match: float
    final_score: float
    weights: ScoreWeights

class RecommendationRequest(BaseModel):
    rawg_ids: List[int]
    include_scores: bool = False


class RecommendationResponse(BaseModel):
    rawg_ids: List[List[int]]
    scores: Dict[int, ScoreBreakdown] | None = None


# -------------------- Endpoint --------------------

def _build_response(rawg_ids_input: List[int], include_scores: bool = False) -> dict:

    rawg_ids = rawg_ids_input[:3]
    n = len(rawg_ids)

    if n == 0:
        return {"rawg_ids": []}

    if n == 1:
        quotas = [5]
        max_rows = 2
    elif n == 2:
        quotas = [3, 2]
        max_rows = 3
    else:
        quotas = [2, 2, 1]
        max_rows = 3

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {gid: executor.submit(get_recommendations, game_id=gid, k=50, include_scores=include_scores) for gid in rawg_ids}
        recs_raw: Dict = {gid: f.result() for gid, f in futures.items()}

    if include_scores:
        recs: Dict[int, List[int]] = {}
        all_scores: Dict[int, Dict] = {}
        for gid, result in recs_raw.items():
            if isinstance(result, dict):
                recs[gid] = result["ids"]
                all_scores.update(result.get("scores", {}))
            else:
                recs[gid] = result
    else:
        recs = recs_raw
        all_scores = None

    pointers = {gid: 0 for gid in rawg_ids}
    result: List[List[int]] = []

    for _ in range(max_rows):
        row: List[int] = []

        for gid, quota in zip(rawg_ids, quotas):
            start = pointers[gid]
            available = recs[gid][start:]
            row.extend(available[:quota])
            pointers[gid] = start + min(quota, len(available))

        if row:
            result.append(row)

    resp = {"rawg_ids": result}
    if include_scores and all_scores:
        flat_ids = {gid for row in result for gid in row}
        resp["scores"] = {gid: all_scores[gid] for gid in flat_ids if gid in all_scores}
    return resp


@router.post("/recommend", response_model=RecommendationResponse)
async def recommend(payload: RecommendationRequest):
    return await asyncio.get_event_loop().run_in_executor(
        None, _build_response, payload.rawg_ids, payload.include_scores
    )
