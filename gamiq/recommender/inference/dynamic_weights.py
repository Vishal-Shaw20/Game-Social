"""
Dynamic weighting system for game recommendations.

Unlike static weights where each signal has fixed importance,
dynamic weights are interdependent — the value of one signal
modulates the weight of another. Each candidate receives its
own weight vector based on its signal profile.

Relevance signals:
  1. FAISS confidence  → similarity reliability
  2. Genre overlap     → tag discriminative power
  3. Tag overlap       → FAISS reinforcement

Developer and publisher are intentionally NOT relevance signals.
They are retained only as diagnostic signals for later diversity
filtering.
"""

import math


# -------------------- BASE WEIGHTS --------------------

BASE_WEIGHTS = {
    "faiss":       0.40,
    "tag_overlap": 0.18,
    "genre":       0.12,
    "rating":      0.10,
    "metacritic":  0.05,
    "popularity":  0.05,
}


# -------------------- SIMILARITY HELPERS --------------------


def _normalize_field(field):
    if not field:
        return set()

    if isinstance(field, str):
        return {field.strip().lower()}

    if isinstance(field, (list, tuple)):
        return {
            s.strip().lower()
            for s in field
            if isinstance(s, str) and s.strip()
        }

    return set()


def _tag_jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _set_overlap(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return 1.0 if a & b else 0.0


# -------------------- DYNAMIC WEIGHT COMPUTATION --------------------


def compute_dynamic_weights(
        faiss_score,
        tag_overlap,
        genre_overlap,
        dev_match
):
    """
    Compute per-candidate adaptive weights.

    Relevance is determined by:
      - FAISS similarity
      - tag overlap
      - genre overlap
      - rating
      - Metacritic
      - popularity

    Developer and publisher are deliberately excluded from the
    relevance score because matching a developer or publisher should
    not make a game more similar to the query.

    dev_match remains in the function signature for compatibility
    with the existing query_faiss_dynamic_weight.py file.
    """

    w = dict(BASE_WEIGHTS)

    # ---------------------------------------------------------
    # Rule 1: FAISS confidence modulates metadata reliance
    #
    # Center around 0.5:
    #   higher FAISS -> trust FAISS more
    #   lower FAISS  -> allow metadata signals to contribute more
    # ---------------------------------------------------------

    faiss_shift = faiss_score - 0.5

    w["faiss"]       += 0.12 * faiss_shift
    w["tag_overlap"] -= 0.08 * faiss_shift
    w["genre"]       -= 0.04 * faiss_shift

    # ---------------------------------------------------------
    # Rule 2: Genre overlap makes tags more discriminative
    # ---------------------------------------------------------

    w["tag_overlap"] += 0.06 * genre_overlap
    w["genre"]       -= 0.04 * genre_overlap

    # ---------------------------------------------------------
    # Rule 3: Tag overlap reinforces FAISS confidence
    # ---------------------------------------------------------

    w["faiss"] += 0.04 * tag_overlap

    # ---------------------------------------------------------
    # Prevent negative weights
    # ---------------------------------------------------------

    for key in w:
        w[key] = max(w[key], 0.01)

    # ---------------------------------------------------------
    # Normalize active relevance signals to sum to 1.0
    # ---------------------------------------------------------

    total = sum(w.values())

    normalized = {
        key: value / total
        for key, value in w.items()
    }

    # ---------------------------------------------------------
    # Compatibility keys
    #
    # query_faiss_dynamic_weight.py still expects these keys.
    # They are explicitly zero because developer/publisher are
    # diversity signals, not relevance signals.
    # ---------------------------------------------------------

    normalized["developer"] = 0.0
    normalized["publisher"] = 0.0

    return normalized


# -------------------- SCORING --------------------


def score_candidates_dynamic(
        candidate_ids,
        query_meta,
        game_meta,
        faiss_scores_dict,
        series_ids
):
    """
    Score each candidate with dynamically computed weights.

    Each candidate gets a unique weight vector based on:
      - FAISS similarity
      - tag overlap
      - genre overlap

    Developer and publisher are calculated only for diagnostics
    and future diversity filtering.

    IMPORTANT:
    A candidate that is present only because it belongs to the
    query's series does NOT receive a fabricated FAISS score.
    If FAISS did not retrieve it, its FAISS contribution is 0.0.
    """

    query_tags = _normalize_field(query_meta.get("tags"))
    query_genres = set(query_meta.get("genres") or [])
    query_devs = _normalize_field(query_meta.get("developers"))
    query_pubs = _normalize_field(query_meta.get("publishers"))

    ranked = []
    score_breakdowns = {}

    for cand_id in candidate_ids:
        m = game_meta.get(cand_id)

        if not m:
            continue

        # -----------------------------------------------------
        # Quality signals
        # -----------------------------------------------------

        rating = m["rating"] or 0
        count = m["ratings_count"] or 0
        meta_score = m["metacritic"] or 0

        rating_norm = rating / 5
        meta_norm = meta_score / 100

        count_score = min(
            math.log10(count + 1)
            / math.log10(1_000_000),
            1.0
        )

        # -----------------------------------------------------
        # FAISS similarity
        #
        # Only trust an actual FAISS score.
        #
        # Series membership alone must not manufacture
        # similarity.
        # -----------------------------------------------------

        if cand_id in faiss_scores_dict:
            faiss_score = faiss_scores_dict[cand_id]
        else:
            faiss_score = 0.0

        # -----------------------------------------------------
        # Genre overlap
        # -----------------------------------------------------

        cand_genres = set(m.get("genres") or [])

        genre_overlap = (
            len(query_genres & cand_genres)
            / len(query_genres)
            if query_genres
            else 0.0
        )

        # -----------------------------------------------------
        # Tag overlap
        # -----------------------------------------------------

        cand_tags = _normalize_field(m.get("tags"))

        tag_overlap = _tag_jaccard(
            query_tags,
            cand_tags
        )

        # -----------------------------------------------------
        # Developer match
        #
        # Diagnostic only.
        # -----------------------------------------------------

        cand_devs = _normalize_field(m.get("developers"))

        dev_match = _set_overlap(
            query_devs,
            cand_devs
        )

        # -----------------------------------------------------
        # Publisher match
        #
        # Diagnostic only.
        # -----------------------------------------------------

        cand_pubs = _normalize_field(m.get("publishers"))

        pub_match = _set_overlap(
            query_pubs,
            cand_pubs
        )

        # -----------------------------------------------------
        # Per-candidate dynamic weights
        # -----------------------------------------------------

        w = compute_dynamic_weights(
            faiss_score,
            tag_overlap,
            genre_overlap,
            dev_match
        )

        # -----------------------------------------------------
        # Final relevance score
        # -----------------------------------------------------

        final_score = (
                w["faiss"] * faiss_score
                + w["tag_overlap"] * tag_overlap
                + w["genre"] * genre_overlap
                + w["rating"] * rating_norm
                + w["metacritic"] * meta_norm
                + w["popularity"] * count_score
                + w["developer"] * dev_match
                + w["publisher"] * pub_match
        )

        ranked.append(
            (cand_id, final_score)
        )

        score_breakdowns[cand_id] = {
            "faiss_score": round(faiss_score, 4),
            "tag_overlap": round(tag_overlap, 4),
            "genre_overlap": round(genre_overlap, 4),
            "dev_match": round(dev_match, 4),
            "pub_match": round(pub_match, 4),
            "final_score": round(final_score, 4),
            "weights": {
                key: round(value, 4)
                for key, value in w.items()
            },
        }

    ranked.sort(
        key=lambda x: x[1],
        reverse=True
    )

    return ranked, score_breakdowns