import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict

from recommender.inference.query_faiss import get_recommendations

router = APIRouter()


# -------------------- Schemas --------------------

class RecommendationRequest(BaseModel):
    rawg_ids: List[int]


class RecommendationResponse(BaseModel):
    rawg_ids: List[List[int]]


# -------------------- Endpoint --------------------

def _build_response(rawg_ids_input: List[int]) -> dict:

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
        futures = {gid: executor.submit(get_recommendations, game_id=gid, k=50) for gid in rawg_ids}
        recs: Dict[int, List[int]] = {gid: f.result() for gid, f in futures.items()}

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

    return {"rawg_ids": result}


@router.post("/recommend", response_model=RecommendationResponse)
async def recommend(payload: RecommendationRequest):
    return await asyncio.get_event_loop().run_in_executor(
        None, _build_response, payload.rawg_ids
    )
