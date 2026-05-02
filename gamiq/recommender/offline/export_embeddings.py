import psycopg2
import numpy as np
import pickle
from recommender.config import DB_CONFIG, ARTIFACTS_DIR

EMB_DIM = 1024    # changed from 384 — bge-large-en-v1.5 is 1024 dims
BATCH   = 50000


def main():
    # ---------------- DB CONNECT ----------------

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # -------- GET ACTUAL ROW COUNT --------

    cur.execute("SELECT COUNT(*) FROM content_embeddings;")
    TOTAL_ROWS = cur.fetchone()[0]

    print(f"Total embeddings in DB: {TOTAL_ROWS}")

    # -------- CREATE MEMMAP FILES --------

    embeddings = np.memmap(
        str(ARTIFACTS_DIR / "embeddings.memmap"),
        dtype="float32",
        mode="w+",
        shape=(TOTAL_ROWS, EMB_DIM)
    )

    ids = np.memmap(
        str(ARTIFACTS_DIR / "ids.memmap"),
        dtype="int64",    # changed from int32 — game IDs may exceed int32 range
        mode="w+",
        shape=(TOTAL_ROWS,)
    )

    titles = []

    # -------- STREAM BY PRIMARY KEY --------

    last_id = 0
    written = 0

    print("Starting export...")

    while True:

        cur.execute("""
                    SELECT ce.game_id,
                           g.name,
                           ce.embedding
                    FROM content_embeddings ce
                             JOIN games g ON g.id = ce.game_id
                    WHERE ce.game_id > %s
                    ORDER BY ce.game_id
                        LIMIT %s;
                    """, (last_id, BATCH))

        rows = cur.fetchall()

        if not rows:
            break

        for game_id, title, emb in rows:
            embeddings[written] = np.array(emb, dtype="float32")
            ids[written]        = game_id
            titles.append(title)
            written += 1

        last_id = rows[-1][0]

        print(f"Written: {written}/{TOTAL_ROWS}")

    # -------- FLUSH TO DISK --------

    embeddings.flush()
    ids.flush()

    with open(str(ARTIFACTS_DIR / "titles.pkl"), "wb") as f:
        pickle.dump(titles, f)

    print("DONE — Export complete.")
    conn.close()


if __name__ == "__main__":
    main()