import os
import time
import json
import logging
import psycopg2
import numpy as np
import faiss
from datetime import datetime, timedelta, timezone
from recommender.embedder import encode_texts
from psycopg2.extras import execute_values
from pgvector.psycopg2 import register_vector
from concurrent.futures import ThreadPoolExecutor, as_completed
from recommender.config import DB_CONFIG, ARTIFACTS_DIR
from recommender.rawg_client import rawg_get, fetch_series_for_game
from recommender.text_builder import build_structured_text as _build_text
from recommender.cache import clear_all as clear_recommendation_cache

logger = logging.getLogger(__name__)

# ============================================================
# -------------------- ENV CONFIG ----------------------------
# ============================================================

FAISS_INDEX_PATH       = ARTIFACTS_DIR / "faiss_index.ivf"
CHECKPOINT_PATH        = ARTIFACTS_DIR / "checkpoint.txt"
UPDATED_CHECKPOINT_PATH = ARTIFACTS_DIR / "updated_checkpoint.txt"
LOCK_FILE_PATH = ARTIFACTS_DIR / "pipeline.lock"

RAWG_BASE = "https://api.rawg.io/api/games"
MAX_PAGES = 100

# ============================================================
# -------------------- HELPERS -------------------------------
# ============================================================

def clean_text(x):
    return None if not x or str(x).strip() == "" else str(x)

def clean_int(x):
    return None if x is None else int(x)

def extract_names(field):
    if not field:
        return []
    return [item["name"] for item in field if "name" in item]

def extract_platforms(field):
    if not field:
        return []
    return [p["platform"]["name"] for p in field if "platform" in p]

# ============================================================
# -------------------- TEXT BUILD ----------------------------
# ============================================================

def build_structured_text(g: dict) -> str:
    name        = clean_text(g.get("name")) or ""
    genres      = ", ".join(extract_names(g.get("genres")))
    tags        = ", ".join(extract_names(g.get("tags")))
    esrb        = g.get("esrb_rating", {}).get("name", "") if g.get("esrb_rating") else ""
    developers  = ", ".join(extract_names(g.get("developers")))
    publishers  = ", ".join(extract_names(g.get("publishers")))
    description = (g.get("description_raw") or "")[:800]

    return _build_text("", genres, tags, esrb, developers, publishers, description)

# ============================================================
# -------------------- CHECKPOINT ----------------------------
# ============================================================

def load_checkpoint():
    if CHECKPOINT_PATH.exists():
        with open(CHECKPOINT_PATH, "r") as f:
            val = f.read().strip()
            return int(val) if val else None

    logger.info("No checkpoint file. Using MAX(id) from DB as baseline")
    conn = psycopg2.connect(**DB_CONFIG)
    cur  = conn.cursor()
    cur.execute("SELECT COALESCE(MAX(id), 0) FROM games;")
    max_id = cur.fetchone()[0]
    cur.close()
    conn.close()

    save_checkpoint(max_id)
    logger.info("Baseline set to MAX game ID in DB: %s", max_id)
    return max_id

def save_checkpoint(game_id: int):
    try:
        with open(CHECKPOINT_PATH, "w") as f:
            f.write(str(game_id))
        logger.info("Checkpoint saved: %s", game_id)
    except Exception:
        logger.exception("Failed to save checkpoint")
        raise

# ============================================================
# -------------------- UPDATED CHECKPOINT --------------------
# ============================================================

def load_updated_checkpoint():
    if UPDATED_CHECKPOINT_PATH.exists():
        with open(UPDATED_CHECKPOINT_PATH, "r") as f:
            val = f.read().strip()
            if val:
                return val
    return (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")

def save_updated_checkpoint(date_str: str):
    try:
        with open(UPDATED_CHECKPOINT_PATH, "w") as f:
            f.write(date_str)
        logger.info("Updated checkpoint saved: %s", date_str)
    except Exception:
        logger.exception("Failed to save updated checkpoint")
        raise

# ============================================================
# -------------------- DB INSERTS ----------------------------
# ============================================================

def insert_games_batch(conn, rows):
    sql = """
          INSERT INTO games (
              id, slug, name, name_original,
              description, description_raw,
              released,
              background_image, background_image_additional,
              suggestions_count,
              platforms, developers, publishers, genres, tags,
              esrb_rating, website,
              screenshots_count, achievements_count, game_series_count, additions_count,
              parents_count, alternative_names,
              rating, ratings_count, metacritic
          )
          VALUES %s
              ON CONFLICT (id) DO NOTHING; \
          """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


def upsert_games_batch(conn, rows):
    sql = """
          INSERT INTO games (
              id, slug, name, name_original,
              description, description_raw,
              released,
              background_image, background_image_additional,
              suggestions_count,
              platforms, developers, publishers, genres, tags,
              esrb_rating, website,
              screenshots_count, achievements_count, game_series_count, additions_count,
              parents_count, alternative_names,
              rating, ratings_count, metacritic
          )
          VALUES %s
              ON CONFLICT (id) DO UPDATE SET
                  slug = EXCLUDED.slug,
                  name = EXCLUDED.name,
                  name_original = EXCLUDED.name_original,
                  description = EXCLUDED.description,
                  description_raw = EXCLUDED.description_raw,
                  released = EXCLUDED.released,
                  background_image = EXCLUDED.background_image,
                  background_image_additional = EXCLUDED.background_image_additional,
                  suggestions_count = EXCLUDED.suggestions_count,
                  platforms = EXCLUDED.platforms,
                  developers = EXCLUDED.developers,
                  publishers = EXCLUDED.publishers,
                  genres = EXCLUDED.genres,
                  tags = EXCLUDED.tags,
                  esrb_rating = EXCLUDED.esrb_rating,
                  website = EXCLUDED.website,
                  screenshots_count = EXCLUDED.screenshots_count,
                  achievements_count = EXCLUDED.achievements_count,
                  game_series_count = EXCLUDED.game_series_count,
                  additions_count = EXCLUDED.additions_count,
                  parents_count = EXCLUDED.parents_count,
                  alternative_names = EXCLUDED.alternative_names,
                  rating = EXCLUDED.rating,
                  ratings_count = EXCLUDED.ratings_count,
                  metacritic = EXCLUDED.metacritic;
          """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


def insert_embeddings_batch(conn, rows):
    """
    rows: list of (game_id, embedding_list)
    embedding_list: list of 1024 floats — matches bge-large-en-v1.5
    """
    register_vector(conn)
    sql = """
          INSERT INTO content_embeddings (game_id, embedding)
          VALUES %s
              ON CONFLICT (game_id)
        DO UPDATE SET embedding   = EXCLUDED.embedding,
                             updated_at  = NOW(); \
          """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


def insert_series_batch(conn, rows):
    if not rows:
        return
    sql = """
          INSERT INTO game_series (game_id, series_game_id)
          VALUES %s
              ON CONFLICT DO NOTHING;
          """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()

# ============================================================
# -------------------- RAWG FETCHING -------------------------
# ============================================================

def fetch_new_game_ids(checkpoint_id):
    page     = 1
    new_ids  = []
    first_id = None

    while page <= MAX_PAGES:
        logger.info("Fetching RAWG page %d", page)

        url      = f"{RAWG_BASE}?ordering=-created&page={page}"
        response = rawg_get(url)

        if response is None or response.status_code != 200:
            logger.error("RAWG request failed")
            break

        data    = response.json()
        results = data.get("results", [])

        if not results:
            break

        for g in results:
            gid = g["id"]

            if first_id is None:
                first_id = gid

            if gid == checkpoint_id:
                logger.info("Reached checkpoint ID %s. Stop.", checkpoint_id)
                return new_ids, first_id

            new_ids.append(gid)

        page += 1

    if page > MAX_PAGES:
        logger.warning("Hit MAX_PAGES (%d) limit", MAX_PAGES)

    return new_ids, first_id


def fetch_updated_game_ids(since_date: str):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    page = 1
    updated_ids = []

    while page <= MAX_PAGES:
        logger.info("Fetching RAWG updated page %d", page)

        url = f"{RAWG_BASE}?ordering=-updated&dates={since_date},{today}&page={page}"
        response = rawg_get(url)

        if response is None or response.status_code != 200:
            logger.error("RAWG updated request failed")
            break

        data = response.json()
        results = data.get("results", [])

        if not results:
            break

        for g in results:
            updated_ids.append(g["id"])

        if not data.get("next"):
            break

        page += 1

    return updated_ids


def fetch_game_details(game_id):
    url      = f"{RAWG_BASE}/{game_id}"
    response = rawg_get(url)

    if response is None or response.status_code != 200:
        return None

    return response.json()

# ============================================================
# -------------------- FAISS UPDATE --------------------------
# ============================================================

def update_faiss(new_ids: list, new_vectors: list):
    """
    Appends new game vectors to existing FAISS index and npy files.
    Vectors are normalized before adding — matches train_faiss.py behavior.
    Note: vectors added after IVF training go to flat overflow.
    For small daily additions this is acceptable.
    Full rebuild should be triggered periodically via train_faiss.py.
    """

    if not FAISS_INDEX_PATH.exists():
        logger.info("FAISS index missing — skipping FAISS update")
        return

    index = faiss.read_index(str(FAISS_INDEX_PATH))

    logger.info("Updating FAISS index...")
    vectors = np.array(new_vectors, dtype="float32")
    faiss.normalize_L2(vectors)
    ids = np.array(new_ids, dtype="int64")

    # IndexIDMap wraps inner IVFFlat — add_with_ids works correctly on IDMap
    index.add_with_ids(vectors, ids)
    faiss.write_index(index, str(FAISS_INDEX_PATH))
    logger.info("FAISS updated — added %d vectors", len(new_ids))

# ============================================================
# -------------------- SINGLE GAME ENSURE --------------------
# ============================================================

def ensure_game(rawg_id: int) -> dict:
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM games WHERE id = %s", [rawg_id])
            if cur.fetchone():
                return {"status": "exists"}

        g = fetch_game_details(rawg_id)
        if not g:
            return {"status": "not_found_on_rawg"}

        with conn:
            game_row = [(
                clean_int(g.get("id")),
                clean_text(g.get("slug")),
                clean_text(g.get("name")),
                clean_text(g.get("name_original")),
                clean_text(g.get("description")),
                clean_text(g.get("description_raw")),
                clean_text(g.get("released")),
                clean_text(g.get("background_image")),
                clean_text(g.get("background_image_additional")),
                clean_int(g.get("suggestions_count")),
                extract_platforms(g.get("platforms")),
                extract_names(g.get("developers")),
                extract_names(g.get("publishers")),
                extract_names(g.get("genres")),
                extract_names(g.get("tags")),
                json.dumps(g.get("esrb_rating")) if g.get("esrb_rating") else None,
                clean_text(g.get("website")),
                clean_int(g.get("screenshots_count")),
                clean_int(g.get("achievements_count")),
                clean_int(g.get("game_series_count")),
                clean_int(g.get("additions_count")),
                clean_int(g.get("parents_count")),
                extract_names(g.get("alternative_names")),
                g.get("rating") or 0.0,
                clean_int(g.get("ratings_count")),
                clean_int(g.get("metacritic")),
            )]

            insert_games_batch(conn, game_row)

            text = build_structured_text(g)
            embedding = encode_texts([text])

            insert_embeddings_batch(conn, [(rawg_id, embedding[0].tolist())])

            if (g.get("game_series_count") or 0) > 0:
                series_ids = fetch_series_for_game(rawg_id)
                if series_ids:
                    series_rows = []
                    for mid in series_ids:
                        series_rows.append((rawg_id, mid))
                        series_rows.append((mid, rawg_id))
                    insert_series_batch(conn, series_rows)

        update_faiss([rawg_id], [embedding[0]])
        clear_recommendation_cache()
        return {"status": "created", "name": g.get("name")}

    finally:
        conn.close()

# ============================================================
# --------------------- REMOVE LOCK FILE ---------------------
# ============================================================

def remove_lock_file(log_message: str) -> bool:
    try:
        LOCK_FILE_PATH.unlink()
        return True
    except Exception:
        logger.exception(log_message)
        return False

# ============================================================
# -------------------- MAIN DAILY PIPELINE -------------------
# ============================================================

CHUNK_SIZE = 50

def run_daily_pipeline():
    lock_acquired = False
    conn = None

    try:
        if LOCK_FILE_PATH.exists():
            age = time.time() - LOCK_FILE_PATH.stat().st_mtime

            # stale lock > 6 hours
            if age > 21600:
                logger.warning("Removing stale pipeline lock")
                if not remove_lock_file("Failed removing stale lock"):
                    return

        fd = os.open(
            LOCK_FILE_PATH,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY
        )
        os.close(fd)
        lock_acquired = True
    except FileExistsError:
        logger.info("Another pod already running pipeline, skipping")
        return

    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        current_checkpoint = load_updated_checkpoint()

        if current_checkpoint >= today:
            logger.info("Pipeline already ran today (%s), skipping", today)
            return

        logger.info("Starting daily pipeline")

        conn = psycopg2.connect(**DB_CONFIG)

        checkpoint_id = load_checkpoint()
        logger.info("Checkpoint ID: %s", checkpoint_id)

        new_ids, first_id = fetch_new_game_ids(checkpoint_id)

        if not new_ids:
            logger.info("No new games")
        else:
            logger.info("Found %d new games", len(new_ids))

            ordered_ids = list(reversed(new_ids))  # oldest first

            # -------- Parallel fetch all game details --------
            games = {}
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_id = {
                    executor.submit(fetch_game_details, gid): gid
                    for gid in ordered_ids
                }
                for future in as_completed(future_to_id):
                    gid = future_to_id[future]
                    result = future.result()
                    if result:
                        games[gid] = result
                    else:
                        logger.warning("Skipped game %s (fetch failed)", gid)

            logger.info("Fetched %d game details", len(games))

            # -------- Parallel fetch series + insert bidirectional mappings --------
            series_games = [gid for gid in games if (games[gid].get("game_series_count") or 0) > 0]

            if series_games:
                series_map = {}
                with ThreadPoolExecutor(max_workers=5) as executor:
                    future_to_id = {
                        executor.submit(fetch_series_for_game, gid): gid
                        for gid in series_games
                    }
                    for future in as_completed(future_to_id):
                        gid = future_to_id[future]
                        try:
                            series_map[gid] = future.result()
                        except Exception:
                            series_map[gid] = []

                series_rows = []
                for gid, members in series_map.items():
                    if members:
                        for mid in members:
                            series_rows.append((gid, mid))
                            series_rows.append((mid, gid))
                    else:
                        series_rows.append((gid, gid))

                insert_series_batch(conn, series_rows)
                logger.info("Inserted series mappings for %d games", len(series_games))

            # -------- Process in chunks --------
            valid_ids = [gid for gid in ordered_ids if gid in games]

            all_faiss_ids     = []
            all_faiss_vectors = []

            for i in range(0, len(valid_ids), CHUNK_SIZE):
                chunk_ids = valid_ids[i:i + CHUNK_SIZE]

                game_rows      = []
                texts          = []
                chunk_game_ids = []

                for gid in chunk_ids:
                    g = games[gid]

                    game_rows.append((
                        clean_int(g.get("id")),
                        clean_text(g.get("slug")),
                        clean_text(g.get("name")),
                        clean_text(g.get("name_original")),
                        clean_text(g.get("description")),
                        clean_text(g.get("description_raw")),
                        clean_text(g.get("released")),
                        clean_text(g.get("background_image")),
                        clean_text(g.get("background_image_additional")),
                        clean_int(g.get("suggestions_count")),
                        extract_platforms(g.get("platforms")),
                        extract_names(g.get("developers")),
                        extract_names(g.get("publishers")),
                        extract_names(g.get("genres")),
                        extract_names(g.get("tags")),
                        json.dumps(g.get("esrb_rating")) if g.get("esrb_rating") else None,
                        clean_text(g.get("website")),
                        clean_int(g.get("screenshots_count")),
                        clean_int(g.get("achievements_count")),
                        clean_int(g.get("game_series_count")),
                        clean_int(g.get("additions_count")),
                        clean_int(g.get("parents_count")),
                        extract_names(g.get("alternative_names")),
                        g.get("rating") or 0.0,
                        clean_int(g.get("ratings_count")),
                        clean_int(g.get("metacritic")),
                    ))

                    texts.append(build_structured_text(g))
                    chunk_game_ids.append(gid)

                # -------- Batch encode --------
                embeddings = encode_texts(texts)

                embedding_rows = [
                    (gid, emb.tolist())
                    for gid, emb in zip(chunk_game_ids, embeddings)
                ]

                # -------- Insert chunk --------
                if game_rows:
                    insert_games_batch(conn, game_rows)

                if embedding_rows:
                    insert_embeddings_batch(conn, embedding_rows)

                # Accumulate for single FAISS update after all chunks
                if len(chunk_game_ids) > 0:
                    all_faiss_ids.extend(chunk_game_ids)
                    all_faiss_vectors.extend(list(embeddings))

                logger.info("Committed chunk %d: %d games", i // CHUNK_SIZE + 1, len(chunk_ids))

            # -------- Single FAISS update (prevents duplicate IDs on crash) --------
            try:
                if all_faiss_ids:
                    update_faiss(all_faiss_ids, all_faiss_vectors)
            except Exception:
                logger.exception("Pass 1 FAISS update failed")

            if first_id is not None:
                save_checkpoint(first_id)

        # ============================================================
        # -------- PASS 2: Updated games (ordering=-updated) --------
        # ============================================================

        logger.info("--- Pass 2: Checking for updated games ---")

        since_date = load_updated_checkpoint()
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        logger.info("Fetching games updated since %s", since_date)

        updated_ids = fetch_updated_game_ids(since_date)

        if updated_ids:
            logger.info("Found %d updated games", len(updated_ids))

            # Fetch old descriptions to detect changes
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, description_raw FROM games WHERE id = ANY(%s)",
                    [updated_ids]
                )
                old_descriptions = {row[0]: row[1] for row in cur.fetchall()}

            # Parallel fetch details
            updated_games = {}
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_id = {
                    executor.submit(fetch_game_details, gid): gid
                    for gid in updated_ids
                }
                for future in as_completed(future_to_id):
                    gid = future_to_id[future]
                    result = future.result()
                    if result:
                        updated_games[gid] = result

            logger.info("Fetched %d updated game details", len(updated_games))

            upd_faiss_ids = []
            upd_faiss_vectors = []

            for i in range(0, len(updated_ids), CHUNK_SIZE):
                chunk_ids = [gid for gid in updated_ids[i:i + CHUNK_SIZE] if gid in updated_games]

                game_rows = []
                re_embed_texts = []
                re_embed_ids = []

                for gid in chunk_ids:
                    g = updated_games[gid]

                    game_rows.append((
                        clean_int(g.get("id")),
                        clean_text(g.get("slug")),
                        clean_text(g.get("name")),
                        clean_text(g.get("name_original")),
                        clean_text(g.get("description")),
                        clean_text(g.get("description_raw")),
                        clean_text(g.get("released")),
                        clean_text(g.get("background_image")),
                        clean_text(g.get("background_image_additional")),
                        clean_int(g.get("suggestions_count")),
                        extract_platforms(g.get("platforms")),
                        extract_names(g.get("developers")),
                        extract_names(g.get("publishers")),
                        extract_names(g.get("genres")),
                        extract_names(g.get("tags")),
                        json.dumps(g.get("esrb_rating")) if g.get("esrb_rating") else None,
                        clean_text(g.get("website")),
                        clean_int(g.get("screenshots_count")),
                        clean_int(g.get("achievements_count")),
                        clean_int(g.get("game_series_count")),
                        clean_int(g.get("additions_count")),
                        clean_int(g.get("parents_count")),
                        extract_names(g.get("alternative_names")),
                        g.get("rating") or 0.0,
                        clean_int(g.get("ratings_count")),
                        clean_int(g.get("metacritic")),
                    ))

                    old_desc = old_descriptions.get(gid)
                    new_desc = clean_text(g.get("description_raw"))
                    if old_desc != new_desc:
                        re_embed_texts.append(build_structured_text(g))
                        re_embed_ids.append(gid)

                if game_rows:
                    upsert_games_batch(conn, game_rows)

                if re_embed_texts:
                    embeddings = encode_texts(re_embed_texts)

                    embedding_rows = [
                        (gid, emb.tolist())
                        for gid, emb in zip(re_embed_ids, embeddings)
                    ]
                    insert_embeddings_batch(conn, embedding_rows)

                    upd_faiss_ids.extend(re_embed_ids)
                    upd_faiss_vectors.extend(list(embeddings))

                logger.info("Updated chunk %d: %d games, %d re-embedded", i // CHUNK_SIZE + 1, len(chunk_ids), len(re_embed_ids))

            try:
                if upd_faiss_ids:
                    update_faiss(upd_faiss_ids, upd_faiss_vectors)
            except Exception:
                logger.exception("Pass 2 FAISS update failed")

        else:
            logger.info("No updated games found")

        save_updated_checkpoint(today)

        try:
            clear_recommendation_cache()
        except Exception:
            logger.exception("Cache clear failed")

        logger.info("Daily pipeline completed")
    except Exception:
        logger.exception("Daily pipeline crashed")
        raise
    finally:
        if conn:
            conn.close()
        if lock_acquired and LOCK_FILE_PATH.exists():
            remove_lock_file("Failed to remove pipeline lock")
# ============================================================

if __name__ == "__main__":
    run_daily_pipeline()