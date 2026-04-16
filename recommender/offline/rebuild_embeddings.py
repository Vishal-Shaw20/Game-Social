import os
import psycopg2
import numpy as np
from sentence_transformers import SentenceTransformer
from psycopg2.extras import execute_values
from tqdm import tqdm
from datetime import datetime, UTC
import torch
from recommender.config import DB_CONFIG
from recommender.text_builder import clean_field, build_structured_text

torch.set_num_threads(os.cpu_count())

# ---------------- CONFIG ----------------

MODEL_NAME = "BAAI/bge-large-en-v1.5"

FETCH_BATCH = 2000
ENCODE_BATCH = 64
INSERT_BATCH = 2000

# RANGE CONTROL
START_ID = 0
END_ID = 1100000   # change this per run

# ---------------- TEXT BUILD ----------------

def row_to_structured_text(row):
    name = row[1] or ""
    genres = clean_field(row[2])
    tags = clean_field(row[3])
    esrb = clean_field(row[4])
    developers = clean_field(row[5])
    publishers = clean_field(row[6])
    description = (row[7] or "")[:800]

    return build_structured_text(name, genres, tags, esrb, developers, publishers, description)

# ---------------- MAIN ----------------

def main():

    print("Loading model...")
    model = SentenceTransformer(MODEL_NAME)

    print("Connecting to database...")
    read_conn = psycopg2.connect(**DB_CONFIG)
    write_conn = psycopg2.connect(**DB_CONFIG)

    write_cur = write_conn.cursor()
    write_cur.execute("SET synchronous_commit TO OFF;")

    # Count rows in this range
    count_cur = read_conn.cursor()
    count_cur.execute(
        "SELECT COUNT(*) FROM games WHERE id > %s AND id <= %s;",
        (START_ID, END_ID)
    )
    total_rows = count_cur.fetchone()[0]
    count_cur.close()

    print(f"Rows to process: {total_rows}")

    progress = tqdm(total=total_rows, desc="Processing")

    processed = 0
    last_id = START_ID
    inserted_total = 0

    while True:

        read_cur = read_conn.cursor()

        read_cur.execute("""
                         SELECT id, name, genres, tags,
                                esrb_rating, developers, publishers, description
                         FROM games
                         WHERE id > %s AND id <= %s
                         ORDER BY id
                             LIMIT %s
                         """, (last_id, END_ID, FETCH_BATCH))

        rows = read_cur.fetchall()
        read_cur.close()

        if not rows:
            break

        ids = [row[0] for row in rows]
        texts = [row_to_structured_text(row) for row in rows]

        embeddings = model.encode(
            texts,
            batch_size=ENCODE_BATCH,
            convert_to_numpy=True,
            show_progress_bar=False
        ).astype("float32")

        now = datetime.now(UTC)

        insert_data = [
            (gid, emb.tolist(), now)
            for gid, emb in zip(ids, embeddings)
        ]

        execute_values(
            write_cur,
            """
            INSERT INTO content_embeddings (game_id, embedding, updated_at)
            VALUES %s
            ON CONFLICT (game_id)
            DO UPDATE SET embedding  = EXCLUDED.embedding,
                          updated_at = EXCLUDED.updated_at
            """,
            insert_data,
            page_size=INSERT_BATCH
        )

        inserted_total += len(insert_data)

        last_id = rows[-1][0]

        processed += len(rows)
        progress.update(len(rows))

        # if processed % 10000 == 0:
        #     write_conn.commit()

        write_conn.commit()

    progress.close()

    write_conn.commit()

    write_cur.close()
    read_conn.close()
    write_conn.close()

    print("\n==============================")
    print("Embedding rebuild finished")
    print(f"Rows inserted in this run: {inserted_total}")
    print(f"Last processed id: {last_id}")
    print("==============================")

if __name__ == "__main__":
    main()