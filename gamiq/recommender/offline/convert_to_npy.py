import logging
import numpy as np
import pickle
import os
from recommender.config import ARTIFACTS_DIR

logger = logging.getLogger(__name__)

EMB_DIM = 1024    # changed from 384 — bge-large-en-v1.5 is 1024 dims


def main():
    emb_path = str(ARTIFACTS_DIR / "embeddings.memmap")
    ids_path = str(ARTIFACTS_DIR / "ids.memmap")

    # -------- DETECT ROW COUNT FROM FILE SIZE --------

    file_size = os.path.getsize(emb_path)

    # float32 = 4 bytes
    TOTAL_ROWS = file_size // (4 * EMB_DIM)

    logger.info("Detected rows: %d", TOTAL_ROWS)

    # -------- LOAD MEMMAP FILES --------

    emb = np.memmap(
        emb_path,
        dtype="float32",
        mode="r",
        shape=(TOTAL_ROWS, EMB_DIM)
    )

    ids = np.memmap(
        ids_path,
        dtype="int64",    # changed from int32 — matches export_embeddings.py
        mode="r",
        shape=(TOTAL_ROWS,)
    )

    # -------- SAVE DIRECTLY (NO FULL RAM COPY) --------

    np.save(str(ARTIFACTS_DIR / "embeddings.npy"), emb)
    np.save(str(ARTIFACTS_DIR / "ids.npy"), ids)

    # -------- SAVE TITLES --------

    with open(str(ARTIFACTS_DIR / "titles.pkl"), "rb") as f:
        titles = pickle.load(f)

    np.save(str(ARTIFACTS_DIR / "titles.npy"), np.array(titles, dtype=object))

    logger.info("Conversion to NPY completed.")


if __name__ == "__main__":
    main()