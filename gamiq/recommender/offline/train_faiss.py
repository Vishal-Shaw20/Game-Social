import logging
import numpy as np
import faiss
from recommender.config import ARTIFACTS_DIR

logger = logging.getLogger(__name__)


def main():
    embeddings = np.load(str(ARTIFACTS_DIR / "embeddings.npy"))
    ids        = np.load(str(ARTIFACTS_DIR / "ids.npy"))

    logger.info("Loaded embeddings: %s", embeddings.shape)
    logger.info("Loaded ids:        %s", ids.shape)

    # -------- NORMALIZE --------
    # Applied here on the full matrix — normalizes all vectors
    # uniformly in one pass, including the early ones that were
    # embedded without normalize_embeddings=True
    faiss.normalize_L2(embeddings)

    # -------- INDEX CONFIG --------

    dim   = embeddings.shape[1]   # auto-detected — 1024
    nlist = 4096                  # good for ~800k+ vectors

    logger.info("Dimension : %d", dim)
    logger.info("nlist     : %d", nlist)

    # -------- SAMPLE FOR TRAINING --------

    train_size = 200000
    np.random.seed(42)
    sample_idx  = np.random.choice(len(embeddings), train_size, replace=False)
    train_vecs  = embeddings[sample_idx]

    # -------- BUILD INDEX --------

    quantizer  = faiss.IndexFlatIP(dim)
    base_index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)

    logger.info("Training IVF index...")
    base_index.train(train_vecs)

    # Wrap with IDMap to store actual game IDs
    index = faiss.IndexIDMap(base_index)

    logger.info("Adding vectors with IDs...")
    index.add_with_ids(embeddings, ids.astype("int64"))

    faiss.write_index(index, str(ARTIFACTS_DIR / "faiss_index.ivf"))

    logger.info("Index built and saved — total vectors: %d", index.ntotal)


if __name__ == "__main__":
    main()