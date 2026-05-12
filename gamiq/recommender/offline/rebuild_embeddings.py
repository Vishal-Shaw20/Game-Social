# ================================================================
# REBUILD EMBEDDINGS
# ================================================================
# This file contains 3 complete scripts: LOCAL, KAGGLE, COLAB.
# LOCAL is active. To use Kaggle/Colab, comment out LOCAL entirely
# and uncomment the one you need.
# ================================================================


# ================================================================
# === LOCAL (active) ===
# ================================================================

import os
import logging
import psycopg2
from sentence_transformers import SentenceTransformer
from psycopg2.extras import execute_values
from tqdm import tqdm
from datetime import datetime, UTC
import torch

from recommender.config import DB_CONFIG
from recommender.text_builder import clean_field, build_structured_text as _build_text

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-large-en-v1.5"
END_ID = 1100000

DEVICE = "cpu"
torch.set_num_threads(os.cpu_count())

FETCH_BATCH  = 2000
ENCODE_BATCH = 64
INSERT_BATCH = 2000


def row_to_structured_text(row):
    genres      = clean_field(row[2])
    tags        = clean_field(row[3])
    esrb        = clean_field(row[4])
    developers  = clean_field(row[5])
    publishers  = clean_field(row[6])
    description = (row[7] or "")[:800]
    return _build_text("", genres, tags, esrb, developers, publishers, description)


def main():

    logger.info("Device: %s | Encode batch: %d | Fetch batch: %d", DEVICE, ENCODE_BATCH, FETCH_BATCH)
    logger.info("Connecting to database...")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    cur.execute("SELECT COALESCE(MAX(game_id), 0) FROM content_embeddings;")
    max_embedded = cur.fetchone()[0]

    cur.execute("SELECT MAX(id) FROM games WHERE id <= %s;", (END_ID,))
    max_game = cur.fetchone()[0] or 0

    if max_embedded >= max_game:
        logger.info("Truncating content_embeddings for fresh rebuild...")
        cur.execute("TRUNCATE content_embeddings;")
        conn.commit()
        start_id = 0
    elif max_embedded > 0:
        start_id = max_embedded
        logger.info("Resuming from game_id > %d", start_id)
    else:
        start_id = 0
        logger.info("Starting fresh (empty table)")

    cur.close()
    conn.close()

    logger.info("Loading model...")
    model = SentenceTransformer(MODEL_NAME, device=DEVICE)

    logger.info("Connecting to database...")
    read_conn = psycopg2.connect(**DB_CONFIG)
    write_conn = psycopg2.connect(**DB_CONFIG)

    write_cur = write_conn.cursor()
    write_cur.execute("SET synchronous_commit TO OFF;")

    count_cur = read_conn.cursor()
    count_cur.execute(
        "SELECT COUNT(*) FROM games WHERE id > %s AND id <= %s;",
        (start_id, END_ID)
    )
    total_rows = count_cur.fetchone()[0]
    count_cur.close()

    logger.info("Rows to process: %d", total_rows)

    progress = tqdm(total=total_rows, desc="Processing")

    last_id = start_id
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

        write_conn.commit()

        progress.update(len(rows))

    progress.close()

    write_conn.commit()

    write_cur.close()
    read_conn.close()
    write_conn.close()

    logger.info("\n==============================")
    logger.info("Embedding rebuild finished")
    logger.info("Rows inserted in this run: %d", inserted_total)
    logger.info("Last processed id: %d", last_id)
    logger.info("==============================")

if __name__ == "__main__":
    main()


# ================================================================
# === KAGGLE (uncomment this entire block, comment LOCAL above) ===
# ================================================================

# import os
# import psycopg2
# from sentence_transformers import SentenceTransformer
# from psycopg2.extras import execute_values
# from tqdm import tqdm
# from datetime import datetime, UTC
# import torch
# from kaggle_secrets import UserSecretsClient
#
# MODEL_NAME = "BAAI/bge-large-en-v1.5"
# END_ID = 1100000
#
# DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# if DEVICE == "cuda":
#     try:
#         torch.zeros(1).to("cuda")
#     except Exception:
#         print("WARNING: CUDA available but not functional, falling back to CPU")
#         DEVICE = "cpu"
#
# if DEVICE == "cuda":
#     FETCH_BATCH  = 5000
#     ENCODE_BATCH = 256
#     INSERT_BATCH = 5000
# else:
#     FETCH_BATCH  = 2000
#     ENCODE_BATCH = 64
#     INSERT_BATCH = 2000
#     torch.set_num_threads(os.cpu_count())
#
# user_secrets = UserSecretsClient()
# DB_CONFIG = {
#     "host":     user_secrets.get_secret("DB_HOST"),
#     "port":     user_secrets.get_secret("DB_PORT"),
#     "dbname":   user_secrets.get_secret("DB_NAME"),
#     "user":     user_secrets.get_secret("DB_USER"),
#     "password": user_secrets.get_secret("DB_PASSWORD"),
# }
#
#
# def clean_field(field):
#     if isinstance(field, list):
#         return ", ".join(field)
#     if isinstance(field, dict):
#         return field.get("name", "")
#     return field or ""
#
#
# def build_structured_text(genres, tags, esrb, developers, publishers, description):
#     text = (
#         f"CORE IDENTITY: An {genres} title. "
#         f"GAMEPLAY MECHANICS: {genres} gameplay involving {tags}. "
#         f"NARRATIVE THEME: The setting and story involve {description}. "
#         f"AUDIENCE: Rated {esrb} by ESRB. "
#         f"STUDIO: Developed by {developers}, published by {publishers}."
#     )
#     return f"Represent this game for retrieving similar gameplay experiences: {text}"
#
#
# def row_to_structured_text(row):
#     genres      = clean_field(row[2])
#     tags        = clean_field(row[3])
#     esrb        = clean_field(row[4])
#     developers  = clean_field(row[5])
#     publishers  = clean_field(row[6])
#     description = (row[7] or "")[:800]
#     return build_structured_text(genres, tags, esrb, developers, publishers, description)
#
#
# def main():
#
#     print(f"Device: {DEVICE} | Encode batch: {ENCODE_BATCH} | Fetch batch: {FETCH_BATCH}")
#     logger.info("Connecting to database...")
#     conn = psycopg2.connect(**DB_CONFIG)
#     cur = conn.cursor()
#
#     cur.execute("SELECT COALESCE(MAX(game_id), 0) FROM content_embeddings;")
#     max_embedded = cur.fetchone()[0]
#
#     cur.execute("SELECT MAX(id) FROM games WHERE id <= %s;", (END_ID,))
#     max_game = cur.fetchone()[0] or 0
#
#     if max_embedded >= max_game:
#         logger.info("Truncating content_embeddings for fresh rebuild...")
#         cur.execute("TRUNCATE content_embeddings;")
#         conn.commit()
#         start_id = 0
#     elif max_embedded > 0:
#         start_id = max_embedded
#         logger.info("Resuming from game_id > %d", start_id)
#     else:
#         start_id = 0
#         logger.info("Starting fresh (empty table)")
#
#     cur.close()
#     conn.close()
#
#     logger.info("Loading model...")
#     model = SentenceTransformer(MODEL_NAME, device=DEVICE)
#
#     logger.info("Connecting to database...")
#     read_conn = psycopg2.connect(**DB_CONFIG)
#     write_conn = psycopg2.connect(**DB_CONFIG)
#
#     write_cur = write_conn.cursor()
#     write_cur.execute("SET synchronous_commit TO OFF;")
#
#     count_cur = read_conn.cursor()
#     count_cur.execute(
#         "SELECT COUNT(*) FROM games WHERE id > %s AND id <= %s;",
#         (start_id, END_ID)
#     )
#     total_rows = count_cur.fetchone()[0]
#     count_cur.close()
#
#     logger.info("Rows to process: %d", total_rows)
#
#     progress = tqdm(total=total_rows, desc="Processing")
#
#     last_id = start_id
#     inserted_total = 0
#
#     while True:
#
#         read_cur = read_conn.cursor()
#
#         read_cur.execute("""
#                          SELECT id, name, genres, tags,
#                                 esrb_rating, developers, publishers, description
#                          FROM games
#                          WHERE id > %s AND id <= %s
#                          ORDER BY id
#                              LIMIT %s
#                          """, (last_id, END_ID, FETCH_BATCH))
#
#         rows = read_cur.fetchall()
#         read_cur.close()
#
#         if not rows:
#             break
#
#         ids = [row[0] for row in rows]
#         texts = [row_to_structured_text(row) for row in rows]
#
#         embeddings = model.encode(
#             texts,
#             batch_size=ENCODE_BATCH,
#             convert_to_numpy=True,
#             show_progress_bar=False
#         ).astype("float32")
#
#         now = datetime.now(UTC)
#
#         insert_data = [
#             (gid, emb.tolist(), now)
#             for gid, emb in zip(ids, embeddings)
#         ]
#
#         execute_values(
#             write_cur,
#             """
#             INSERT INTO content_embeddings (game_id, embedding, updated_at)
#             VALUES %s
#             ON CONFLICT (game_id)
#             DO UPDATE SET embedding  = EXCLUDED.embedding,
#                           updated_at = EXCLUDED.updated_at
#             """,
#             insert_data,
#             page_size=INSERT_BATCH
#         )
#
#         inserted_total += len(insert_data)
#
#         last_id = rows[-1][0]
#
#         write_conn.commit()
#
#         progress.update(len(rows))
#
#     progress.close()
#
#     write_conn.commit()
#
#     write_cur.close()
#     read_conn.close()
#     write_conn.close()
#
#     print("\n==============================")
#     print("Embedding rebuild finished")
#     print(f"Rows inserted in this run: {inserted_total}")
#     print(f"Last processed id: {last_id}")
#     print("==============================")
#
# if __name__ == "__main__":
#     main()


# ================================================================
# === COLAB (uncomment this entire block, comment LOCAL above) ===
# ================================================================

# import os
# import psycopg2
# from sentence_transformers import SentenceTransformer
# from psycopg2.extras import execute_values
# from tqdm import tqdm
# from datetime import datetime, UTC
# import torch
# from google.colab import userdata
#
# MODEL_NAME = "BAAI/bge-large-en-v1.5"
# END_ID = 1100000
#
# DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# if DEVICE == "cuda":
#     try:
#         torch.zeros(1).to("cuda")
#     except Exception:
#         print("WARNING: CUDA available but not functional, falling back to CPU")
#         DEVICE = "cpu"
#
# if DEVICE == "cuda":
#     FETCH_BATCH  = 5000
#     ENCODE_BATCH = 256
#     INSERT_BATCH = 5000
# else:
#     FETCH_BATCH  = 2000
#     ENCODE_BATCH = 64
#     INSERT_BATCH = 2000
#     torch.set_num_threads(os.cpu_count())
#
# DB_CONFIG = {
#     "host":     userdata.get("DB_HOST"),
#     "port":     userdata.get("DB_PORT"),
#     "dbname":   userdata.get("DB_NAME"),
#     "user":     userdata.get("DB_USER"),
#     "password": userdata.get("DB_PASSWORD"),
# }
#
#
# def clean_field(field):
#     if isinstance(field, list):
#         return ", ".join(field)
#     if isinstance(field, dict):
#         return field.get("name", "")
#     return field or ""
#
#
# def build_structured_text(genres, tags, esrb, developers, publishers, description):
#     text = (
#         f"CORE IDENTITY: An {genres} title. "
#         f"GAMEPLAY MECHANICS: {genres} gameplay involving {tags}. "
#         f"NARRATIVE THEME: The setting and story involve {description}. "
#         f"AUDIENCE: Rated {esrb} by ESRB. "
#         f"STUDIO: Developed by {developers}, published by {publishers}."
#     )
#     return f"Represent this game for retrieving similar gameplay experiences: {text}"
#
#
# def row_to_structured_text(row):
#     genres      = clean_field(row[2])
#     tags        = clean_field(row[3])
#     esrb        = clean_field(row[4])
#     developers  = clean_field(row[5])
#     publishers  = clean_field(row[6])
#     description = (row[7] or "")[:800]
#     return build_structured_text(genres, tags, esrb, developers, publishers, description)
#
#
# def main():
#
#     print(f"Device: {DEVICE} | Encode batch: {ENCODE_BATCH} | Fetch batch: {FETCH_BATCH}")
#     logger.info("Connecting to database...")
#     conn = psycopg2.connect(**DB_CONFIG)
#     cur = conn.cursor()
#
#     cur.execute("SELECT COALESCE(MAX(game_id), 0) FROM content_embeddings;")
#     max_embedded = cur.fetchone()[0]
#
#     cur.execute("SELECT MAX(id) FROM games WHERE id <= %s;", (END_ID,))
#     max_game = cur.fetchone()[0] or 0
#
#     if max_embedded >= max_game:
#         logger.info("Truncating content_embeddings for fresh rebuild...")
#         cur.execute("TRUNCATE content_embeddings;")
#         conn.commit()
#         start_id = 0
#     elif max_embedded > 0:
#         start_id = max_embedded
#         logger.info("Resuming from game_id > %d", start_id)
#     else:
#         start_id = 0
#         logger.info("Starting fresh (empty table)")
#
#     cur.close()
#     conn.close()
#
#     logger.info("Loading model...")
#     model = SentenceTransformer(MODEL_NAME, device=DEVICE)
#
#     logger.info("Connecting to database...")
#     read_conn = psycopg2.connect(**DB_CONFIG)
#     write_conn = psycopg2.connect(**DB_CONFIG)
#
#     write_cur = write_conn.cursor()
#     write_cur.execute("SET synchronous_commit TO OFF;")
#
#     count_cur = read_conn.cursor()
#     count_cur.execute(
#         "SELECT COUNT(*) FROM games WHERE id > %s AND id <= %s;",
#         (start_id, END_ID)
#     )
#     total_rows = count_cur.fetchone()[0]
#     count_cur.close()
#
#     logger.info("Rows to process: %d", total_rows)
#
#     progress = tqdm(total=total_rows, desc="Processing")
#
#     last_id = start_id
#     inserted_total = 0
#
#     while True:
#
#         read_cur = read_conn.cursor()
#
#         read_cur.execute("""
#                          SELECT id, name, genres, tags,
#                                 esrb_rating, developers, publishers, description
#                          FROM games
#                          WHERE id > %s AND id <= %s
#                          ORDER BY id
#                              LIMIT %s
#                          """, (last_id, END_ID, FETCH_BATCH))
#
#         rows = read_cur.fetchall()
#         read_cur.close()
#
#         if not rows:
#             break
#
#         ids = [row[0] for row in rows]
#         texts = [row_to_structured_text(row) for row in rows]
#
#         embeddings = model.encode(
#             texts,
#             batch_size=ENCODE_BATCH,
#             convert_to_numpy=True,
#             show_progress_bar=False
#         ).astype("float32")
#
#         now = datetime.now(UTC)
#
#         insert_data = [
#             (gid, emb.tolist(), now)
#             for gid, emb in zip(ids, embeddings)
#         ]
#
#         execute_values(
#             write_cur,
#             """
#             INSERT INTO content_embeddings (game_id, embedding, updated_at)
#             VALUES %s
#             ON CONFLICT (game_id)
#             DO UPDATE SET embedding  = EXCLUDED.embedding,
#                           updated_at = EXCLUDED.updated_at
#             """,
#             insert_data,
#             page_size=INSERT_BATCH
#         )
#
#         inserted_total += len(insert_data)
#
#         last_id = rows[-1][0]
#
#         write_conn.commit()
#
#         progress.update(len(rows))
#
#     progress.close()
#
#     write_conn.commit()
#
#     write_cur.close()
#     read_conn.close()
#     write_conn.close()
#
#     print("\n==============================")
#     print("Embedding rebuild finished")
#     print(f"Rows inserted in this run: {inserted_total}")
#     print(f"Last processed id: {last_id}")
#     print("==============================")
#
# if __name__ == "__main__":
#     main()
