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

@router.post("/recommend", response_model=RecommendationResponse)
def recommend(payload: RecommendationRequest):

    # 1️⃣ Use at most 3 RAWG IDs
    rawg_ids = payload.rawg_ids[:3]
    n = len(rawg_ids)

    if n == 0:
        return {"rawg_ids": []}

    # 2️⃣ Decide quotas + number of rows
    if n == 1:
        quotas = [5]
        max_rows = 2
    elif n == 2:
        quotas = [3, 2]
        max_rows = 3
    else:  # n == 3
        quotas = [2, 2, 1]
        max_rows = 3

    # 3️⃣ Fetch recommendations ONCE per game (parallel)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {gid: executor.submit(get_recommendations, game_id=gid, k=50) for gid in rawg_ids}
        recs: Dict[int, List[int]] = {gid: f.result() for gid, f in futures.items()}

    # 4️⃣ Track how many we have already used per game
    pointers = {gid: 0 for gid in rawg_ids}

    result: List[List[int]] = []

    # 5️⃣ Build rows
    for _ in range(max_rows):
        row: List[int] = []

        for gid, quota in zip(rawg_ids, quotas):
            start = pointers[gid]
            end = start + quota

            # Take whatever is left if not enough recommendations remain
            available = recs[gid][start:]
            row.extend(available[:quota])   # take whatever is left
            pointers[gid] = start + min(quota, len(available))

        if row:
            result.append(row)

    return {"rawg_ids": result}
