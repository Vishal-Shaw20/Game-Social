import psycopg2
from psycopg2.extras import execute_values
from recommender.config import DB_CONFIG
from recommender.rawg_client import rawg_get, fetch_series_for_game

BATCH_SIZE = 50

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
