import faiss
import requests
import os
import psycopg2
import numpy as np
from psycopg2.pool import ThreadedConnectionPool
from concurrent.futures import ThreadPoolExecutor
import math
import time

from recommender.config import DB_CONFIG, ARTIFACTS_DIR
from recommender.inference.reranker import rerank
from recommender.text_builder import clean_field, build_structured_text

# -------------------- ENV --------------------

API_KEY = os.getenv("RAWG_API_KEY")

# -------------------- DB CONNECTION POOL --------------------

db_pool = ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
    **DB_CONFIG
)

# -------------------- FAISS --------------------

index = faiss.read_index(str(ARTIFACTS_DIR / "faiss_index.ivf"))

try:
    ivf_index        = faiss.downcast_index(index.index)
    ivf_index.nprobe = 256
except Exception as e:
    print(f"Warning: could not set nprobe: {e}")


# -------------------- TEXT BUILD --------------------

def row_to_structured_text(row):
    name        = row[0] or ""
    genres      = clean_field(row[1])
    tags        = clean_field(row[2])
    esrb        = clean_field(row[3])
    developers  = clean_field(row[4])
    publishers  = clean_field(row[5])
    description = (row[6] or "")[:800]

    return build_structured_text(name, genres, tags, esrb, developers, publishers, description)


# -------------------- DB FETCH FUNCTIONS --------------------

def fetch_embedding_from_db(game_id: int):
    conn = db_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT embedding FROM content_embeddings WHERE game_id = %s;",
            (game_id,)
        )
        row = cur.fetchone()
        cur.close()
    finally:
        db_pool.putconn(conn)

    if not row:
        return None

    emb = np.array(row[0], dtype="float32").reshape(1, -1)
    faiss.normalize_L2(emb)
    return emb


def fetch_game_text(game_id: int) -> str | None:
    conn = db_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute("""
                    SELECT name, genres, tags, esrb_rating,
                           developers, publishers, description
                    FROM games
                    WHERE id = %s;
                    """, (game_id,))
        row = cur.fetchone()
        cur.close()
    finally:
        db_pool.putconn(conn)

    if not row:
        return None
    return row_to_structured_text(row)


def fetch_candidate_texts(game_ids: list[int]) -> dict[int, str]:
    conn = db_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute("""
                    SELECT id, name, genres, tags, esrb_rating,
                           developers, publishers, description
                    FROM games
                    WHERE id = ANY(%s);
                    """, (game_ids,))
        rows = cur.fetchall()
        cur.close()
    finally:
        db_pool.putconn(conn)

    result = {}
    for row in rows:
        result[row[0]] = row_to_structured_text(row[1:])
    return result


# -------------------- RAWG SERIES --------------------

def fetch_series_ids(game_id: int) -> set:
    series_ids = set()
    url = f"https://api.rawg.io/api/games/{game_id}/game-series?key={API_KEY}"

    while url:
        try:
            response = requests.get(url, timeout=5)
            if response.status_code != 200:
                break
            data = response.json()
            for g in data.get("results", []):
                series_ids.add(g["id"])
            url = data.get("next")
        except Exception:
            break

    return series_ids


# -------------------- RECOMMENDATION --------------------

def get_recommendations(game_id: int, k: int = 10, max_per_series: int = 3):

    # ---- STAGE 1: FAISS retrieval ----

    t0 = time.perf_counter()

    query = fetch_embedding_from_db(game_id)
    if query is None:
        return []

    scores, returned_ids = index.search(query, 500)

    candidate_ids = [int(x) for x in returned_ids[0] if int(x) != game_id]

    t1 = time.perf_counter()
    print(f"[TIMING] FAISS search: {t1 - t0:.2f}s")

    # ---- QUALITY FILTER + METADATA (single query) ----

    conn = db_pool.getconn()
    try:
        cur = conn.cursor()

        # Fetch query game's name and genres for DLC filter + genre scoring
        cur.execute("SELECT name, genres FROM games WHERE id = %s;", (game_id,))
        query_row = cur.fetchone()
        if not query_row:
            return []
        query_name   = (query_row[0] or "").lower()
        query_genres = set(query_row[1]) if query_row[1] else set()

        cur.execute("""
                    SELECT id, rating, ratings_count, metacritic, developers, name, genres
                    FROM games
                    WHERE id = ANY(%s)
                      AND ratings_count > 5
                    """, (candidate_ids,))
        game_meta = {}
        for row in cur.fetchall():
            game_meta[row[0]] = {
                "rating":        row[1],
                "ratings_count": row[2],
                "metacritic":    row[3],
                "developers":    row[4],
                "name":          row[5],
                "genres":        row[6],
            }
        cur.close()
    finally:
        db_pool.putconn(conn)

    candidate_ids = [cid for cid in candidate_ids if cid in game_meta]
    candidate_ids = candidate_ids[:100]  # cap to keep reranker time consistent

    t2 = time.perf_counter()
    print(f"[TIMING] Quality filter DB: {t2 - t1:.2f}s | candidates: {len(candidate_ids)}")

    if not candidate_ids:
        return []

    # ---- STAGE 2: RERANK + SERIES FETCH IN PARALLEL ----

    query_text = fetch_game_text(game_id)
    if query_text is None:
        return []

    candidate_texts = fetch_candidate_texts(candidate_ids)

    candidates = [
        {"game_id": cid, "text": candidate_texts[cid]}
        for cid in candidate_ids
        if cid in candidate_texts
    ]

    t3 = time.perf_counter()
    print(f"[TIMING] Text fetch: {t3 - t2:.2f}s | pairs for reranker: {len(candidates)}")

    # Run reranker and RAWG series fetch simultaneously
    with ThreadPoolExecutor(max_workers=2) as executor:
        rerank_future = executor.submit(rerank, query_text, candidates, 50)
        series_future = executor.submit(fetch_series_ids, game_id)

        reranked = rerank_future.result()

        try:
            series_ids = series_future.result(timeout=10)
        except Exception:
            series_ids = set()  # RAWG failed — skip series filter gracefully

    t4 = time.perf_counter()
    print(f"[TIMING] Reranker + series: {t4 - t3:.2f}s")

    reranked_ids = [c["game_id"] for c in reranked]

    # ---- QUALITY SCORING (uses game_meta from above) ----

    reranker_scores = {c["game_id"]: c["reranker_score"] for c in reranked}
    faiss_scores    = {
        int(cid): float(score)
        for cid, score in zip(returned_ids[0], scores[0])
        if int(cid) != game_id
    }

    ranked = []

    for cand_id in reranked_ids:
        if cand_id not in game_meta:
            continue

        m = game_meta[cand_id]

        rating     = m["rating"]       or 0
        count      = m["ratings_count"] or 0
        meta_score = m["metacritic"]   or 0

        rating_norm    = rating / 5
        meta_norm      = meta_score / 100
        count_score    = min(math.log10(count + 1) / math.log10(1_000_000), 1.0)
        raw_reranker   = reranker_scores.get(cand_id, 0.0)
        reranker_score = 1 / (1 + math.exp(-raw_reranker))   # sigmoid → [0, 1]

        # Genre overlap: ratio of shared genres between query and candidate
        cand_genres = set(m.get("genres") or [])
        if query_genres:
            genre_overlap = len(query_genres & cand_genres) / len(query_genres)
        else:
            genre_overlap = 0.0

        final_score = (
                0.45 * reranker_score +
                0.25 * faiss_scores.get(cand_id, 0.0) +
                0.10 * genre_overlap +
                0.10 * rating_norm +
                0.05 * meta_norm +
                0.05 * count_score
        )

        ranked.append((cand_id, final_score))

    ranked.sort(key=lambda x: x[1], reverse=True)
    ranked_ids = [x[0] for x in ranked]

    # ---- SERIES FILTER + DEVELOPER CAP (uses game_meta from above) ----

    result       = []
    seen         = set()
    series_taken = 0
    dev_counts   = {}
    max_per_dev  = 2

    for cand_id in ranked_ids:

        if cand_id in seen:
            continue

        # DLC/remaster filter: skip if candidate name contains query name or vice versa
        cand_name = (game_meta.get(cand_id, {}).get("name") or "").lower()
        if query_name and cand_name:
            if query_name in cand_name or cand_name in query_name:
                continue

        if cand_id in series_ids:
            if series_taken >= max_per_series:
                continue
            series_taken += 1

        developers = game_meta.get(cand_id, {}).get("developers")
        if isinstance(developers, list) and developers:
            dev = developers[0].strip().lower()
        elif isinstance(developers, str) and developers:
            dev = developers.strip().lower()
        else:
            dev = "unknown"
        dev = dev.split()[0] if dev != "unknown" else "unknown"

        if dev != "unknown":
            if dev_counts.get(dev, 0) >= max_per_dev:
                continue
            dev_counts[dev] = dev_counts.get(dev, 0) + 1

        result.append(cand_id)
        seen.add(cand_id)

        if len(result) == k:
            break

    t5 = time.perf_counter()
    print(f"[TIMING] Scoring + filter: {t5 - t4:.2f}s")
    print(f"[TIMING] TOTAL: {t5 - t0:.2f}s")

    return result