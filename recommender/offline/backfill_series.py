import os
import time
import requests
import psycopg2
from psycopg2.extras import execute_values
from recommender.config import DB_CONFIG, ARTIFACTS_DIR

# -------------------- ENV CONFIG --------------------

RAWG_API_KEYS = [
    os.getenv("RAWG_API_KEY"),
    os.getenv("RAWG_API_KEY_1"),
    os.getenv("RAWG_API_KEY_2"),
    os.getenv("RAWG_API_KEY_3"),
    os.getenv("RAWG_API_KEY_4"),
    os.getenv("RAWG_API_KEY_5"),
    os.getenv("RAWG_API_KEY_6"),
    os.getenv("RAWG_API_KEY_7"),
    os.getenv("RAWG_API_KEY_8"),
    os.getenv("RAWG_API_KEY_9"),
    os.getenv("RAWG_API_KEY_10"),
    os.getenv("RAWG_API_KEY_11"),
    os.getenv("RAWG_API_KEY_12"),
    os.getenv("RAWG_API_KEY_13"),
    os.getenv("RAWG_API_KEY_14"),
    os.getenv("RAWG_API_KEY_15"),
]
RAWG_API_KEYS = [k for k in RAWG_API_KEYS if k]
current_key_index = 0

BATCH_SIZE = 50

# -------------------- API KEY ROTATION --------------------

def rawg_get(url: str, timeout: int = 10):
    global current_key_index

    for attempt in range(len(RAWG_API_KEYS)):
        key      = RAWG_API_KEYS[current_key_index]
        sep      = "&" if "?" in url else "?"
        full_url = f"{url}{sep}key={key}"

        try:
            response = requests.get(full_url, timeout=timeout)
        except Exception as e:
            print(f"Request error: {e}")
            return None

        if response.status_code == 429:
            print(f"Rate limit hit on key {current_key_index + 1}, switching...")
            current_key_index = (current_key_index + 1) % len(RAWG_API_KEYS)
            time.sleep(1)
            continue

        return response

    print("All API keys exhausted.")
    return None

# -------------------- SERIES FETCH --------------------

def fetch_series_for_game(game_id: int) -> list[int]:
    series_ids = []
    page = 1

    while True:
        url = f"https://api.rawg.io/api/games/{game_id}/game-series?page={page}"
        response = rawg_get(url)

        if response is None or response.status_code != 200:
            break

        data = response.json()
        for g in data.get("results", []):
            series_ids.append(g["id"])

        if not data.get("next"):
            break
        page += 1

    return series_ids

# -------------------- MAIN --------------------

def run_backfill():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Find games that have series but haven't been processed yet
    cur.execute("""
        SELECT g.id FROM games g
        WHERE g.game_series_count > 0
          AND NOT EXISTS (
              SELECT 1 FROM game_series gs WHERE gs.game_id = g.id
          )
        ORDER BY g.id;
    """)
    game_ids = [row[0] for row in cur.fetchall()]

    print(f"Games to process: {len(game_ids)}")

    batch_rows = []
    processed = 0

    for gid in game_ids:
        series_ids = fetch_series_for_game(gid)

        if series_ids:
            for sid in series_ids:
                batch_rows.append((gid, sid))
        else:
            # Mark as processed even if RAWG returned no series
            batch_rows.append((gid, gid))

        processed += 1

        if processed % BATCH_SIZE == 0 or processed == len(game_ids):
            if batch_rows:
                execute_values(
                    cur,
                    "INSERT INTO game_series (game_id, series_game_id) VALUES %s ON CONFLICT DO NOTHING;",
                    batch_rows,
                )
                conn.commit()
                batch_rows = []

            print(f"Progress: {processed}/{len(game_ids)} | last: {gid}")

    cur.close()
    conn.close()
    print("Backfill complete.")


if __name__ == "__main__":
    run_backfill()
