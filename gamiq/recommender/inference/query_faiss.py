import re

import faiss
import numpy as np
from psycopg2.pool import ThreadedConnectionPool
import time
import logging
import threading

from recommender.config import DB_CONFIG, ARTIFACTS_DIR
from recommender.inference.dynamic_weights import score_candidates_dynamic
from recommender.cache import get_cached, set_cached


logger = logging.getLogger(__name__)

FAISS_INDEX_PATH = str(
    ARTIFACTS_DIR / "faiss_index.ivf"
)

# Initial retrieval is kept small for normal queries.
# Only under-filled recommendation lists trigger expansion.
FAISS_INITIAL_K = 500
FAISS_EXPANDED_K = 1000
FAISS_MAX_EXPANDED_K = 2000

# Expanded candidates must still meet a minimum relevance level.
# This prevents the larger pool from filling the list with weak or
# obviously unrelated games.
EXPANSION_MIN_SCORE = 0.55
EXPANSION_SCORE_RATIO = 0.72

# Obvious cross-domain candidates with both zero genre overlap and
# very low tag overlap are excluded from the final ranking when their
# overall relevance score is also weak.
FINAL_RELEVANCE_MIN_SCORE = 0.58

# Controlled rescue for under-filled lists.
# A third game from an already-used franchise family is allowed only
# when it is clearly stronger than the weakest currently selected game.
RESCUE_MIN_SCORE = 0.60
RESCUE_SCORE_RATIO = 1.10


# -------------------- DB CONNECTION POOL --------------------

_db_pool = None


# -------------------- FAISS --------------------

_index = None
_index_lock = threading.Lock()


def _set_nprobe(index):
    try:
        ivf_index = faiss.downcast_index(index.index)
        ivf_index.nprobe = 256
    except Exception as e:
        logger.warning(
            "Could not set nprobe: %s",
            e
        )


def _ensure_loaded():
    global _db_pool, _index

    if _db_pool is not None:
        return

    _db_pool = ThreadedConnectionPool(
        minconn=1,
        maxconn=10,
        **DB_CONFIG
    )

    _index = faiss.read_index(FAISS_INDEX_PATH)

    _set_nprobe(_index)


def append_and_persist(ids, vectors):
    _ensure_loaded()
    vecs = np.array(vectors, dtype="float32")
    faiss.normalize_L2(vecs)

    # Keep only the latest vector for each game ID.
    latest = {}
    for i, game_id in enumerate(ids):
        latest[int(game_id)] = i

    unique_ids = np.array(
        list(latest.keys()),
        dtype="int64"
    )

    unique_vecs = np.array(
        [vecs[i] for i in latest.values()],
        dtype="float32"
    )

    with _index_lock:
        _index.remove_ids(unique_ids)
        _index.add_with_ids(unique_vecs, unique_ids)
        faiss.write_index(
            _index,
            FAISS_INDEX_PATH
        )

    logger.info(
        "FAISS updated — replaced/added %d unique vectors, total %d",
        len(unique_ids),
        _index.ntotal
    )


def reload_index():
    global _index

    with _index_lock:
        new_index = faiss.read_index(FAISS_INDEX_PATH)
        _set_nprobe(new_index)
        _index = new_index

    ntotal = _index.ntotal

    logger.info("Index reloaded — total vectors: %d", ntotal)

    return ntotal


# -------------------- DB FETCH FUNCTIONS --------------------


def fetch_embedding_from_db(game_id: int):

    _ensure_loaded()
    conn = _db_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT embedding
            FROM content_embeddings
            WHERE game_id = %s;
            """, (game_id,)
        )
        row = cur.fetchone()
        cur.close()
    finally:
        _db_pool.putconn(conn)

    if not row:
        return None

    emb = np.array(
        row[0],
        dtype="float32"
    ).reshape(1, -1)

    faiss.normalize_L2(emb)
    return emb


# -------------------- SERIES LOOKUP --------------------


def fetch_series_ids(game_id: int) -> set:

    _ensure_loaded()
    conn = _db_pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT series_game_id
            FROM game_series
            WHERE game_id = %s
              AND series_game_id != game_id;
            """, (game_id,)
        )

        series_ids = {
            row[0]
            for row in cur.fetchall()
        }
        cur.close()
    finally:
        _db_pool.putconn(conn)

    return series_ids


# -------------------- DIVERSITY HELPERS --------------------


def _normalize_name_for_dedup(name):
    """
    Normalize game names so different editions of the same game
    can be treated as one recommendation family.

    Examples:
        "Grand Theft Auto IV"
        "Grand Theft Auto IV: Complete Edition"

    become the same normalized key.
    """

    if not name:
        return ""

    name = name.lower()

    # Remove common release/edition suffixes.
    edition_patterns = [
        r"\bdefinitive edition\b",
        r"\bcomplete edition\b",
        r"\bremastered\b",
        r"\bremaster\b",
        r"\benhanced edition\b",
        r"\bdirector'?s cut\b",
        r"\bultimate edition\b",
        r"\bdeluxe edition\b",
        r"\bgold edition\b",
        r"\bprepare to die edition\b",
        r"\bgame of the year edition\b",
        r"\bgoty edition\b",
        r"\bgoty\b",
    ]

    for pattern in edition_patterns:
        name = re.sub(
            pattern,
            "",
            name
        )

    # Normalize punctuation.
    name = re.sub(
        r"[^a-z0-9]+",
        " ",
        name
    )

    return " ".join(name.split())



def _normalize_release_variant_for_dedup(name):
    """
    Normalize a game's release-variant title for diversity deduplication.

    In addition to the existing edition normalization, treat a trailing
    parenthesized four-digit release year as a release marker. This is
    intentionally narrow so years elsewhere in a title are preserved.

    Examples:
        "Demon's Souls"
        "Demon's Souls (2020)"

    become the same release-family key.
    """

    if not name:
        return ""

    name = name.lower()

    # Remove only a trailing parenthesized four-digit year.
    name = re.sub(
        r"\s+\(\d{4}\)\s*$",
        "",
        name
    )

    return _normalize_name_for_dedup(name)



def _franchise_family_key(name):
    """
    Build a conservative franchise-family key from the game title.

    This is a diversity signal only. It NEVER contributes to the
    relevance score. The goal is to prevent a recommendation list from
    being dominated by multiple entries that clearly belong to the same
    named franchise, especially when RAWG series relationships are
    incomplete.

    The key keeps the first two meaningful title tokens after removing
    common sequel/version/platform markers. Examples:
        "Gran Turismo 7"             -> "gran turismo"
        "Gran Turismo 5 Prologue"    -> "gran turismo"
        "Grand Theft Auto V"         -> "grand theft"
        "Dark Souls: Remastered"     -> "dark souls"
        "FIFA 23"                    -> "fifa"
        "Portal 2"                   -> "portal"
    """

    normalized = _normalize_name_for_dedup(name)

    if not normalized:
        return ""

    tokens = normalized.split()

    # Remove sequel/version/platform markers. Keep tokens such as "f1"
    # and "40k" because they can be meaningful franchise identifiers.
    remove_patterns = [
        r"^\d{1,4}$",                 # 2, 7, 2019, ...
        r"^[ivxlcdm]{1,6}$",            # I, II, III, IV, ...
        r"^\d+k\d*$",                # 2k, 2k23, ...
        r"^(prologue|online)$",
        r"^(psp|vita|ps[1-5])$",
        r"^(xbox|xbox360|xboxone|seriesx|switch)$",
    ]

    filtered = []

    for token in tokens:
        if token in {"the", "of", "and", "a", "an", "to", "in", "on", "for", "vs", "versus"}:
            continue

        if any(re.match(pattern, token) for pattern in remove_patterns):
            continue

        filtered.append(token)

    if not filtered:
        return ""

    return " ".join(filtered[:2])


def _developer_key(game):
    developers = game.get("developers")

    if isinstance(developers, list) and developers:
        dev = developers[0].strip().lower()
    elif isinstance(developers, str) and developers:
        dev = developers.strip().lower()
    else:
        return "unknown"

    return " ".join(dev.split()[:2])


def _publisher_key(game):
    publishers = game.get("publishers")

    if isinstance(publishers, list) and publishers:
        pub = publishers[0].strip().lower()
    elif isinstance(publishers, str) and publishers:
        pub = publishers.strip().lower()
    else:
        return "unknown"

    return " ".join(pub.split()[:2])


# -------------------- FILTERING --------------------


def _filter_ranked_by_relevance(ranked, score_breakdowns):
    """
    Remove obvious low-relevance candidates before diversity filtering.

    A candidate is rejected only when all three conditions hold:
      - weak final score
      - zero genre overlap
      - very low tag overlap

    This is intentionally narrow so valid cross-genre recommendations
    with meaningful semantic/tag similarity are not removed.
    """

    filtered = []

    for cand_id, score in ranked:

        breakdown = score_breakdowns.get(cand_id, {})

        genre_overlap = breakdown.get("genre_overlap", 0.0)

        tag_overlap = breakdown.get("tag_overlap", 0.0)

        if (
                score < FINAL_RELEVANCE_MIN_SCORE
                and genre_overlap == 0.0
                and tag_overlap < 0.10
        ):
            continue

        filtered.append(
            (cand_id, score)
        )

    return filtered


def _select_with_limits(
        ranked,
        game_meta,
        series_ids,
        query_name,
        query_name_family,
        query_release_family,
        query_genres,
        k,
        max_per_series,
        max_per_dev,
        max_per_publisher,
        max_per_franchise_family=2
):
    """
    Apply one set of diversity limits.

    The limits are intentionally used as hard caps for this pass,
    but the caller can retry with progressively relaxed caps when
    the strict pass cannot fill k recommendations.
    """

    ranked_ids = [
        item[0]
        for item in ranked
    ]

    result = []
    seen = set()

    series_taken = 0
    dev_counts = {}
    pub_counts = {}
    release_family_counts = {}
    franchise_family_counts = {}

    for cand_id in ranked_ids:

        if cand_id in seen:
            continue

        metadata = game_meta.get(cand_id, {})
        cand_name = (metadata.get("name") or "").lower()

        # -----------------------------------------------------
        # Query-title / edition-family exclusion
        #
        # Never recommend another release of the query game itself.
        # This also applies to series candidates.
        # -----------------------------------------------------

        name_family = metadata.get("_name_family", "")
        release_family = metadata.get("_release_family", "")
        franchise_family = metadata.get("_franchise_family", "")

        if (
                query_name_family
                and name_family
                and name_family == query_name_family
        ):
            continue

        if (
                query_release_family
                and release_family
                and release_family == query_release_family
        ):
            continue

        # -----------------------------------------------------
        # Existing query-name / duplicate-title filter
        # -----------------------------------------------------

        if cand_id not in series_ids:

            if query_name and cand_name:

                if (
                        query_name in cand_name
                        or cand_name in query_name
                ):
                    continue

        # -----------------------------------------------------
        # Sports query restriction
        # -----------------------------------------------------

        if "Sports" in query_genres:
            cand_genres = set(metadata.get("genres") or [])
            if not (query_genres & cand_genres):
                continue

        # -----------------------------------------------------
        # Direct-series diversity
        # -----------------------------------------------------

        if cand_id in series_ids:
            if series_taken >= max_per_series:
                continue

        # -----------------------------------------------------
        # Edition / release-variant duplicate-family diversity
        # -----------------------------------------------------

        if release_family:
            if (
                    release_family_counts.get(
                        release_family,
                        0
                    ) >= 1
            ):
                continue

        # -----------------------------------------------------
        # Franchise-family diversity
        #
        # Prevent the result list from being dominated by multiple
        # entries from the same clearly named franchise. This is a
        # diversity constraint only; it never affects relevance scoring.
        # -----------------------------------------------------

        if franchise_family:
            if (
                    franchise_family_counts.get(
                        franchise_family,
                        0
                    ) >= max_per_franchise_family
            ):
                continue

        # -----------------------------------------------------
        # Developer diversity
        # -----------------------------------------------------

        dev = _developer_key(metadata)

        if dev != "unknown":
            if (
                    dev_counts.get(
                        dev,
                        0
                    ) >= max_per_dev
            ):
                continue

        # -----------------------------------------------------
        # Publisher diversity
        # -----------------------------------------------------

        pub = _publisher_key(metadata)

        if pub != "unknown":
            if (
                    pub_counts.get(
                        pub,
                        0
                    ) >= max_per_publisher
            ):
                continue

        # -----------------------------------------------------
        # Accept candidate
        # -----------------------------------------------------

        result.append(cand_id)
        seen.add(cand_id)

        if cand_id in series_ids:
            series_taken += 1

        if release_family:
            release_family_counts[release_family] = (
                    release_family_counts.get(
                        release_family,
                        0
                    ) + 1
            )

        if franchise_family:
            franchise_family_counts[franchise_family] = (
                    franchise_family_counts.get(
                        franchise_family,
                        0
                    ) + 1
            )

        if dev != "unknown":
            dev_counts[dev] = (
                    dev_counts.get(
                        dev,
                        0
                    ) + 1
            )

        if pub != "unknown":
            pub_counts[pub] = (
                    pub_counts.get(
                        pub,
                        0
                    ) + 1
            )

        if len(result) == k:
            break

    return result


def apply_filters(
        ranked,
        game_meta,
        series_ids,
        query_name,
        query_genres,
        k=10,
        max_per_series=2,
        max_per_dev=2,
        max_per_publisher=2,
        max_per_franchise_family=2
):
    """
    Select final recommendations with adaptive diversity limits.

    Pass 1 keeps the strict V2 diversity policy.
    If that cannot fill k results, only the constraints that are
    preventing the list from filling are progressively relaxed.

    Edition-family dedup remains strict in every pass because
    returning multiple releases of the same game is usually less
    useful than returning another distinct game.

    Franchise-family diversity also remains strict at the configured
    cap; unlike developer/publisher/series limits, it is never relaxed
    in later passes.
    """

    query_name_family = _normalize_name_for_dedup(query_name)
    query_release_family = _normalize_release_variant_for_dedup(query_name)

    # Ordered from most diverse to least restrictive.
    # We relax publisher first, then developer, then direct series.
    limit_passes = [
        (
            max_per_series,
            max_per_dev,
            max_per_publisher,
            max_per_franchise_family,
        ),
        (
            max_per_series,
            max_per_dev,
            max_per_publisher + 1,
            max_per_franchise_family,
        ),
        (
            max_per_series,
            max_per_dev + 1,
            max_per_publisher + 1,
            max_per_franchise_family,
        ),
        (
            max_per_series + 1,
            max_per_dev + 1,
            max_per_publisher + 1,
            max_per_franchise_family,
        ),
        (
            max_per_series + 1,
            max_per_dev + 2,
            max_per_publisher + 2,
            max_per_franchise_family,
        ),
    ]

    for (
            pass_series,
            pass_dev,
            pass_publisher,
            pass_franchise_family
    ) in limit_passes:

        result = _select_with_limits(
            ranked,
            game_meta,
            series_ids,
            query_name,
            query_name_family,
            query_release_family,
            query_genres,
            k,
            pass_series,
            pass_dev,
            pass_publisher,
            pass_franchise_family
        )

        if len(result) >= k:
            return result

    # Final fallback: preserve edition-family dedup and the strict
    # franchise-family cap while allowing the ranking itself to
    # determine the remaining slots.
    return _select_with_limits(
        ranked,
        game_meta,
        series_ids,
        query_name,
        query_name_family,
        query_release_family,
        query_genres,
        k,
        max_per_series + 2,
        max_per_dev + 3,
        max_per_publisher + 3,
        max_per_franchise_family
    )


def _apply_controlled_franchise_rescue(
        result,
        ranked,
        game_meta,
        series_ids,
        query_name,
        query_genres,
        k,
        max_per_series,
        max_per_dev=2,
        max_per_publisher=2,
        max_per_franchise_family=2
):
    """
    Allow at most one carefully justified third game from an
    already-used franchise family when the normal filter is under-filled.

    V17 is diagnostic-only: the rescue decision is unchanged from V16,
    but the function reports why otherwise promising rescue candidates
    are rejected. Recommendation behavior must therefore remain identical.
    """

    if len(result) >= k or not result:
        return result, False

    score_by_id = {
        cand_id: score
        for cand_id, score in ranked
    }

    weakest_score = min(
        (
            score_by_id.get(cand_id, 0.0)
            for cand_id in result
        ),
        default=0.0
    )

    rescue_threshold = max(
        RESCUE_MIN_SCORE,
        weakest_score * RESCUE_SCORE_RATIO
    )

    family_counts = {}
    series_taken = 0
    release_family_counts = {}
    dev_counts = {}
    pub_counts = {}

    for cand_id in result:
        metadata = game_meta.get(cand_id, {})
        family = metadata.get("_franchise_family", "")

        if family:
            family_counts[family] = (
                    family_counts.get(family, 0) + 1
            )

        if cand_id in series_ids:
            series_taken += 1

        release_family = metadata.get("_release_family", "")

        if release_family:
            release_family_counts[release_family] = (
                    release_family_counts.get(release_family, 0) + 1
            )

        dev = _developer_key(metadata)
        if dev != "unknown":
            dev_counts[dev] = dev_counts.get(dev, 0) + 1

        pub = _publisher_key(metadata)
        if pub != "unknown":
            pub_counts[pub] = pub_counts.get(pub, 0) + 1

    query_name_family = _normalize_name_for_dedup(query_name)

    query_release_family = _normalize_release_variant_for_dedup(query_name)

    selected_set = set(result)

    # Use the same relaxed non-franchise ceilings available in the final
    # V14/V15 fallback. Only the franchise-family constraint is bypassed
    # for the single rescue candidate.
    rescue_max_series = max_per_series + 2
    rescue_max_dev = max_per_dev + 3
    rescue_max_publisher = max_per_publisher + 3

    for cand_id, candidate_score in ranked:

        if cand_id in selected_set:
            continue

        metadata = game_meta.get(cand_id, {})
        if not metadata:
            continue

        franchise_family = metadata.get("_franchise_family", "")

        # Only diagnose candidates that could create the intended
        # third entry: the family must already be at the strict cap.
        if (
                not franchise_family
                or family_counts.get(franchise_family, 0)
                < max_per_franchise_family
        ):
            continue

        cand_name = (metadata.get("name") or "").lower()
        name_family = metadata.get("_name_family", "")
        release_family = metadata.get("_release_family", "")
        reasons = []

        if candidate_score < rescue_threshold:
            reasons.append(f"score<{rescue_threshold:.4f}")

        if (
                query_name_family
                and name_family
                and name_family == query_name_family
        ):
            reasons.append("query_name_family")

        if (
                query_release_family
                and release_family
                and release_family == query_release_family
        ):
            reasons.append("query_release_family")

        if cand_id not in series_ids:
            if query_name and cand_name:
                if (
                        query_name in cand_name
                        or cand_name in query_name
                ):
                    reasons.append("query_name_substring")

        if "Sports" in query_genres:
            cand_genres = set(metadata.get("genres") or [])

            if not (query_genres & cand_genres):
                reasons.append("sports_genre_mismatch")

        if cand_id in series_ids:
            if series_taken >= rescue_max_series:
                reasons.append("series_limit")

        if release_family and release_family_counts.get(
                release_family,
                0
        ) >= 1:
            reasons.append("release_family_duplicate")

        dev = _developer_key(metadata)
        if dev != "unknown":
            if dev_counts.get(dev, 0) >= rescue_max_dev:
                reasons.append(f"developer_limit:{dev}")

        pub = _publisher_key(metadata)
        if pub != "unknown":
            if pub_counts.get(pub, 0) >= rescue_max_publisher:
                reasons.append(f"publisher_limit:{pub}")

        if reasons:
            continue

        # Candidate is eligible. Because ranked is already sorted by
        # descending relevance score, this is the highest-scoring
        # eligible rescue candidate.
        new_result = list(result)
        new_result.append(cand_id)
        new_result.sort(
            key=lambda gid: score_by_id.get(gid, 0.0),
            reverse=True
        )

        return new_result, True

    return result, False


# -------------------- RECOMMENDATION --------------------


def get_recommendations(
        game_id: int,
        k: int = 10,
        max_per_series: int = 2,
        include_scores: bool = False
):

    cached = get_cached(
        game_id,
        k,
        max_per_series
    )

    if cached is not None:
        logger.info(
            "Cache HIT for game_id=%s",
            game_id
        )

        if include_scores:
            return cached

        return cached["ids"]

    _ensure_loaded()

    t0 = time.perf_counter()

    # ---- STAGE 1: FAISS RETRIEVAL + SERIES LOOKUP ----

    series_ids = fetch_series_ids(game_id)
    query = fetch_embedding_from_db(game_id)

    if query is None:
        return []

    with _index_lock:
        scores, returned_ids = (
            _index.search(
                query,
                FAISS_INITIAL_K
            )
        )

    faiss_candidates = []
    faiss_scores_dict = {}

    for cid, score in zip(
            returned_ids[0],
            scores[0]
    ):
        cid = int(cid)
        if cid != game_id:
            faiss_candidates.append(cid)
            faiss_scores_dict[cid] = (float(score))

    t1 = time.perf_counter()

    logger.info("FAISS search + series lookup: %.2fs", t1 - t0)

    # ---------------------------------------------------------
    # Combine FAISS candidates and series candidates.
    #
    # IMPORTANT:
    # FAISS candidates are kept first.
    # Series candidates are appended instead of being
    # pre-prioritized.
    #
    # Dynamic scoring decides whether they deserve a high rank.
    # ---------------------------------------------------------

    all_to_fetch = list(set(faiss_candidates) | series_ids)

    # ---- QUALITY FILTER + EXPANDED METADATA ----

    conn = _db_pool.getconn()

    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                name,
                genres,
                tags,
                developers,
                publishers
            FROM games
            WHERE id = %s;
            """, (game_id,)
        )

        query_row = cur.fetchone()

        if not query_row:
            return []

        query_name = (query_row[0] or "").lower()
        query_genres = set(query_row[1] if query_row[1] else [])
        query_meta = {
            "name": query_row[0],
            "genres": query_row[1],
            "tags": query_row[2],
            "developers": query_row[3],
            "publishers": query_row[4],
        }

        cur.execute(
            """
            SELECT
                id,
                rating,
                ratings_count,
                metacritic,
                developers,
                publishers,
                name,
                genres,
                tags
            FROM games
            WHERE id = ANY(%s)
              AND ratings_count > 5
            """, (all_to_fetch,)
        )

        game_meta = {}

        for row in cur.fetchall():
            game_meta[row[0]] = {
                "rating": row[1],
                "ratings_count": row[2],
                "metacritic": row[3],
                "developers": row[4],
                "publishers": row[5],
                "name": row[6],
                "genres": row[7],
                "tags": row[8],
                "_name_family": _normalize_name_for_dedup(row[6]),
                "_release_family": _normalize_release_variant_for_dedup(row[6]),
                "_franchise_family": _franchise_family_key(row[6]),
            }
        cur.close()
    finally:
        _db_pool.putconn(conn)

    # ---------------------------------------------------------
    # Candidate construction
    #
    # Do NOT prioritize series candidates.
    # Keep the complete FAISS candidate pool, then append
    # series candidates that were not already retrieved.
    #
    # Dynamic scoring will decide where they belong.
    # ---------------------------------------------------------

    candidate_ids = []
    seen_cands = set()

    for cid in faiss_candidates:
        if (
                cid in game_meta
                and cid != game_id
                and cid not in seen_cands
        ):
            candidate_ids.append(cid)
            seen_cands.add(cid)

    for cid in series_ids:
        if (
                cid in game_meta
                and cid != game_id
                and cid not in seen_cands
        ):
            candidate_ids.append(cid)
            seen_cands.add(cid)

    t2 = time.perf_counter()

    logger.info(
        "Quality filter DB: %.2fs | candidates: %d",
        t2 - t1,
        len(candidate_ids)
    )

    if not candidate_ids:
        return []

    # ---- STAGE 2: DYNAMIC SCORING ----

    ranked, score_breakdowns = (
        score_candidates_dynamic(
            candidate_ids,
            query_meta,
            game_meta,
            faiss_scores_dict,
            series_ids
        )
    )

    # ---- STAGE 3: DIVERSITY FILTER ----

    # Remove only obvious low-relevance noise before diversity filtering.
    # Developer/publisher/series diversity rules remain unchanged.
    ranked_for_filter = _filter_ranked_by_relevance(
        ranked,
        score_breakdowns
    )

    result = apply_filters(
        ranked_for_filter,
        game_meta,
        series_ids,
        query_name,
        query_genres,
        k,
        max_per_series,
        max_per_dev=2,
        max_per_publisher=2
    )

    rescue_used = False

    # ---------------------------------------------------------
    # Adaptive candidate-pool expansion
    #
    # Do not make every query pay the cost of a larger FAISS search.
    # Only expand when the current ranking/filtering pipeline cannot
    # produce k recommendations from the current pool.
    #
    # Expansion happens progressively: 500 -> 1000 -> 2000.
    # The relevance and diversity rules remain unchanged at every
    # stage. This means we search deeper only when more candidates
    # are actually needed, without weakening quality just to fill k.
    # ---------------------------------------------------------

    if len(result) < k:

        # Keep track of every FAISS ID already inspected, including
        # candidates rejected by metadata quality or the expansion
        # relevance gate. This prevents the 2000-result search from
        # re-processing candidates already examined in the 1000-result
        # search.
        retrieved_ids = set(faiss_candidates)
        retrieved_ids.add(game_id)

        for expansion_k in (
                FAISS_EXPANDED_K,
                FAISS_MAX_EXPANDED_K
        ):
            if len(result) >= k:
                break

            logger.info(
                "Only %d/%d recommendations; expanding FAISS search to %d",
                len(result),
                k,
                expansion_k
            )

            with _index_lock:

                expanded_scores, expanded_ids = (
                    _index.search(
                        query,
                        expansion_k
                    )
                )

            extra_candidate_ids = []
            extra_scores = {}

            for cid, score in zip(
                    expanded_ids[0],
                    expanded_scores[0]
            ):
                cid = int(cid)

                if cid < 0:
                    continue

                # Only process candidates that were not already inspected
                # by the initial or previous expansion search.
                if cid in retrieved_ids:
                    continue

                # Mark every new FAISS ID as inspected, not just
                # candidates that survive the quality/relevance gate.
                retrieved_ids.add(cid)

                if cid == game_id:
                    continue

                extra_candidate_ids.append(cid)
                extra_scores[cid] = float(score)

            if not extra_candidate_ids:
                logger.info(
                    "FAISS expansion to %d produced no new candidates",
                    expansion_k
                )
                continue

            conn = _db_pool.getconn()

            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT
                        id,
                        rating,
                        ratings_count,
                        metacritic,
                        developers,
                        publishers,
                        name,
                        genres,
                        tags
                    FROM games
                    WHERE id = ANY(%s)
                      AND ratings_count > 5
                    """, (extra_candidate_ids,)
                )

                for row in cur.fetchall():
                    game_meta[row[0]] = {
                        "rating": row[1],
                        "ratings_count": row[2],
                        "metacritic": row[3],
                        "developers": row[4],
                        "publishers": row[5],
                        "name": row[6],
                        "genres": row[7],
                        "tags": row[8],
                        "_name_family": _normalize_name_for_dedup(row[6]),
                        "_release_family": _normalize_release_variant_for_dedup(row[6]),
                        "_franchise_family": _franchise_family_key(row[6]),
                    }
                cur.close()
            finally:
                _db_pool.putconn(conn)

            extra_candidate_ids = [
                cid
                for cid in extra_candidate_ids
                if cid in game_meta
            ]

            if not extra_candidate_ids:
                logger.info(
                    "FAISS expansion to %d had no candidates passing the DB quality filter",
                    expansion_k
                )
                continue

            extra_ranked, extra_score_breakdowns = (
                score_candidates_dynamic(
                    extra_candidate_ids,
                    query_meta,
                    game_meta,
                    extra_scores,
                    series_ids
                )
            )

            # -----------------------------------------------------
            # Expansion quality gate
            #
            # The expanded pool exists to find additional genuinely
            # similar candidates, not merely to force the recommendation
            # count to k.
            #
            # Use both:
            #   1. an absolute minimum score
            #   2. a ratio relative to the strongest candidate already
            #      selected into the current result
            #
            # Also reject expanded candidates that have neither
            # meaningful genre overlap nor meaningful tag overlap.
            # This protects against obvious cross-domain noise.
            # -----------------------------------------------------

            best_selected_score = max(
                (
                    score_breakdowns.get(cid, {}).get("final_score", 0.0)
                    for cid in result
                ),
                default=0.0
            )

            expansion_score_floor = max(
                EXPANSION_MIN_SCORE,
                best_selected_score * EXPANSION_SCORE_RATIO
            )

            filtered_extra_ranked = []
            filtered_extra_score_breakdowns = {}

            for cid, score in extra_ranked:
                if score < expansion_score_floor:
                    continue

                breakdown = extra_score_breakdowns.get(cid, {})

                genre_overlap = breakdown.get("genre_overlap", 0.0)

                tag_overlap = breakdown.get("tag_overlap", 0.0)

                if (
                        genre_overlap == 0.0
                        and tag_overlap < 0.10
                ):
                    continue

                filtered_extra_ranked.append((cid, score))
                filtered_extra_score_breakdowns[cid] = breakdown

            if filtered_extra_ranked:
                filtered_extra_ids = [
                    cid
                    for cid, _ in filtered_extra_ranked
                ]

                faiss_scores_dict.update({
                    cid: extra_scores[cid]
                    for cid in filtered_extra_ids
                    if cid in extra_scores
                })

                candidate_ids.extend(filtered_extra_ids)
                ranked.extend(filtered_extra_ranked)
                score_breakdowns.update(filtered_extra_score_breakdowns)

                ranked.sort(
                    key=lambda x: x[1],
                    reverse=True
                )

            ranked_for_filter = _filter_ranked_by_relevance(
                ranked,
                score_breakdowns
            )

            result = apply_filters(
                ranked_for_filter,
                game_meta,
                series_ids,
                query_name,
                query_genres,
                k,
                max_per_series,
                max_per_dev=2,
                max_per_publisher=2
            )

            logger.info(
                "Expanded FAISS pool to %d: +%d new candidates | accepted after quality gate: %d | final recommendations: %d/%d",
                expansion_k,
                len(extra_candidate_ids),
                len(filtered_extra_ranked),
                len(result),
                k
            )

    # ---------------------------------------------------------
    # Controlled franchise rescue — FINAL PASS
    #
    # Run this only after all FAISS expansion is complete. Earlier
    # versions attempted the rescue before/within expansion, and a
    # subsequent apply_filters() pass could remove the rescued game
    # again because the strict franchise-family cap was re-applied.
    # Keeping rescue as the final selection step makes the single
    # controlled third-franchise entry persistent in the final result.
    # ---------------------------------------------------------

    if len(result) < k and not rescue_used:
        result, rescue_used = _apply_controlled_franchise_rescue(
            result,
            ranked,
            game_meta,
            series_ids,
            query_name,
            query_genres,
            k,
            max_per_series,
            max_per_dev=2,
            max_per_publisher=2,
            max_per_franchise_family=2
        )

        if rescue_used:
            logger.info(
                "Controlled franchise rescue accepted (final pass) | recommendations: %d/%d",
                len(result),
                k
            )

    t3 = time.perf_counter()

    logger.info("Dynamic scoring + filter: %.2fs", t3 - t2)
    logger.info("TOTAL (dynamic): %.2fs", t3 - t0)

    full = {
        "ids": result,
        "scores": {
            gid: score_breakdowns[gid]
            for gid in result
            if gid in score_breakdowns
        }
    }

    set_cached(
        game_id,
        k,
        max_per_series,
        full
    )

    if include_scores:
        return full

    return result