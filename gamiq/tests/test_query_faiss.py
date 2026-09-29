import math
import sys
from unittest.mock import MagicMock, patch

sys.modules['faiss'] = MagicMock()

from recommender.inference.dynamic_weights import (
    score_candidates_dynamic,
    compute_dynamic_weights,
)

with patch('psycopg2.pool.ThreadedConnectionPool'):
    from recommender.inference.query_faiss import apply_filters


# -------------------- Helpers --------------------

def make_meta(name="Game", genres=None, rating=4.0, ratings_count=1000,
              metacritic=80, developers=None, tags=None, publishers=None):
    return {
        "name": name,
        "genres": ["Action"] if genres is None else genres,
        "rating": rating,
        "ratings_count": ratings_count,
        "metacritic": metacritic,
        "developers": ["Unknown Studio"] if developers is None else developers,
        "tags": [] if tags is None else tags,
        "publishers": [] if publishers is None else publishers,
    }


def make_query_meta(name="Query Game", genres=None, tags=None,
                    developers=None, publishers=None):
    return {
        "name": name,
        "genres": ["Action"] if genres is None else genres,
        "tags": tags or [],
        "developers": developers or [],
        "publishers": publishers or [],
    }


# -------------------- Dynamic Scoring --------------------

def test_scoring_dynamic_formula():
    query_meta = make_query_meta(
        genres=["Action", "RPG"],
        tags=["Singleplayer", "Open World"],
        developers=["DevCo"],
        publishers=["PubCo"],
    )
    game_meta = {
        1: make_meta(
            rating=4.0, ratings_count=1000, metacritic=80,
            genres=["Action", "RPG"],
            tags=["Singleplayer", "Open World"],
            developers=["DevCo"],
            publishers=["OtherPub"],
        )
    }
    faiss_scores = {1: 0.85}

    ranked, breakdowns = score_candidates_dynamic(
        [1], query_meta, game_meta, faiss_scores, set()
    )

    assert len(ranked) == 1
    assert ranked[0][0] == 1

    faiss_score = 0.85
    genre_overlap = 1.0
    tag_overlap = 1.0
    dev_match = 1.0
    pub_match = 0.0
    rating_norm = 4.0 / 5
    meta_norm = 80 / 100
    count_score = min(math.log10(1001) / math.log10(1_000_000), 1.0)

    w = compute_dynamic_weights(faiss_score, tag_overlap, genre_overlap, dev_match)
    expected = (
        w["faiss"] * faiss_score
        + w["tag_overlap"] * tag_overlap
        + w["genre"] * genre_overlap
        + w["rating"] * rating_norm
        + w["metacritic"] * meta_norm
        + w["popularity"] * count_score
        + w["developer"] * dev_match
        + w["publisher"] * pub_match
    )

    assert abs(ranked[0][1] - expected) < 1e-9


def test_scoring_sorts_descending():
    query_meta = make_query_meta(genres=["Action"])
    game_meta = {
        1: make_meta(rating=5.0, metacritic=95, genres=["Action"]),
        2: make_meta(rating=2.0, metacritic=40, genres=["Action"]),
    }
    faiss_scores = {1: 0.9, 2: 0.3}

    ranked, _ = score_candidates_dynamic(
        [1, 2], query_meta, game_meta, faiss_scores, set()
    )

    assert ranked[0][0] == 1
    assert ranked[1][0] == 2
    assert ranked[0][1] > ranked[1][1]


def test_scoring_skips_missing_game_meta():
    query_meta = make_query_meta()
    game_meta = {1: make_meta()}

    ranked, _ = score_candidates_dynamic(
        [1, 999], query_meta, game_meta, {1: 0.5}, set()
    )

    assert len(ranked) == 1
    assert ranked[0][0] == 1


# -------------------- FAISS Score Handling --------------------

def test_series_candidate_gets_zero_faiss():
    query_meta = make_query_meta(genres=["Action"])
    game_meta = {
        1: make_meta(genres=["Action"]),
        2: make_meta(genres=["Action"]),
    }
    faiss_scores = {1: 0.7}
    series_ids = {2}

    ranked, breakdowns = score_candidates_dynamic(
        [1, 2], query_meta, game_meta, faiss_scores, series_ids
    )

    scores = {r[0]: r[1] for r in ranked}
    assert scores[1] > scores[2]
    assert breakdowns[2]["faiss_score"] == 0.0


def test_non_series_without_faiss_gets_zero():
    query_meta = make_query_meta(genres=["Action"])
    game_meta = {
        1: make_meta(genres=["Action"]),
        2: make_meta(genres=["Action"]),
    }
    faiss_scores = {1: 0.7}

    ranked, breakdowns = score_candidates_dynamic(
        [1, 2], query_meta, game_meta, faiss_scores, set()
    )

    scores = {r[0]: r[1] for r in ranked}
    assert scores[1] > scores[2]
    assert breakdowns[2]["faiss_score"] == 0.0


# -------------------- Dynamic Weights --------------------

def test_high_faiss_increases_faiss_weight():
    w_high = compute_dynamic_weights(0.9, 0.0, 0.0, 0.0)
    w_low = compute_dynamic_weights(0.2, 0.0, 0.0, 0.0)
    assert w_high["faiss"] > w_low["faiss"]


def test_developer_publisher_always_zero():
    w = compute_dynamic_weights(0.5, 0.5, 0.5, 1.0)
    assert w["developer"] == 0.0
    assert w["publisher"] == 0.0


def test_weights_sum_to_one():
    w = compute_dynamic_weights(0.7, 0.4, 0.6, 1.0)
    relevance_keys = ["faiss", "tag_overlap", "genre", "rating", "metacritic", "popularity"]
    total = sum(w[k] for k in relevance_keys)
    assert abs(total - 1.0) < 1e-9


# -------------------- DLC / Name Filter --------------------

def test_dlc_filter_skips_name_substring():
    ranked = [(100, 0.9), (200, 0.8)]
    game_meta = {
        100: make_meta(name="Grand Theft Auto V: Enhanced Edition"),
        200: make_meta(name="Red Dead Redemption 2"),
    }

    result = apply_filters(ranked, game_meta, set(), "grand theft auto v", set())

    assert 100 not in result
    assert 200 in result


def test_dlc_filter_reverse_substring():
    ranked = [(100, 0.9)]
    game_meta = {
        100: make_meta(name="Celeste"),
    }

    result = apply_filters(ranked, game_meta, set(), "celeste: farewell", set())

    assert 100 not in result


def test_dlc_filter_bypass_for_series():
    ranked = [(100, 0.9), (200, 0.8)]
    game_meta = {
        100: make_meta(name="Grand Theft Auto V: Enhanced Edition"),
        200: make_meta(name="Red Dead Redemption 2"),
    }

    result = apply_filters(ranked, game_meta, {100}, "grand theft auto v", set())

    assert 100 in result
    assert 200 in result


# -------------------- Sports Filter --------------------

def test_sports_filter_drops_zero_overlap():
    ranked = [(100, 0.9), (200, 0.8)]
    game_meta = {
        100: make_meta(genres=["Action", "Adventure"]),
        200: make_meta(genres=["Sports", "Racing"]),
    }

    result = apply_filters(ranked, game_meta, set(), "fifa 23", {"Sports"})

    assert 100 not in result
    assert 200 in result


def test_sports_filter_not_applied_for_non_sports():
    ranked = [(100, 0.9)]
    game_meta = {100: make_meta(name="Hades", genres=["Action"])}

    result = apply_filters(ranked, game_meta, set(), "dead cells", {"Action"})

    assert 100 in result


# -------------------- Developer Cap --------------------

def test_developer_cap_max_two():
    ranked = [
        (100, 0.9), (200, 0.8), (300, 0.7),
        (400, 0.6), (500, 0.5), (600, 0.4),
    ]
    game_meta = {
        100: make_meta(name="Game A", developers=["Rockstar Games"]),
        200: make_meta(name="Game B", developers=["Rockstar Games"]),
        300: make_meta(name="Game C", developers=["Rockstar Games"]),
        400: make_meta(name="Game D", developers=["Ubisoft"]),
        500: make_meta(name="Game E", developers=["EA"]),
        600: make_meta(name="Game F", developers=["Valve"]),
    }

    result = apply_filters(ranked, game_meta, set(), "some query", set(), k=5)

    assert 100 in result
    assert 200 in result
    assert 300 not in result
    assert 400 in result


def test_developer_cap_no_false_grouping():
    ranked = [(100, 0.9), (200, 0.8), (300, 0.7)]
    game_meta = {
        100: make_meta(name="Game A", developers=["CD Projekt Red"]),
        200: make_meta(name="Game B", developers=["CD Projekt Red"]),
        300: make_meta(name="Game C", developers=["CD Baby Games"]),
    }

    result = apply_filters(ranked, game_meta, set(), "some query", set(), k=3)

    assert 100 in result
    assert 200 in result
    assert 300 in result


def test_developer_unknown_not_capped():
    ranked = [(100, 0.9), (200, 0.8), (300, 0.7)]
    game_meta = {
        100: make_meta(name="Hades", developers=[]),
        200: make_meta(name="Celeste", developers=[]),
        300: make_meta(name="Hollow Knight", developers=[]),
    }

    result = apply_filters(ranked, game_meta, set(), "dead cells", set(), k=10)

    assert len(result) == 3


# -------------------- Series Cap --------------------

def test_series_cap_max_two():
    ranked = [
        (100, 0.9), (200, 0.85), (300, 0.8), (400, 0.75),
        (500, 0.7), (600, 0.65), (700, 0.6),
    ]
    series_ids = {100, 200, 300, 400}
    game_meta = {
        100: make_meta(name="Forza Horizon 5", developers=["Studio A"]),
        200: make_meta(name="Forza Horizon 4", developers=["Studio B"]),
        300: make_meta(name="Forza Horizon 3", developers=["Studio C"]),
        400: make_meta(name="Forza Horizon 2", developers=["Studio D"]),
        500: make_meta(name="Need for Speed Heat", developers=["Studio E"]),
        600: make_meta(name="Gran Turismo 7", developers=["Studio F"]),
        700: make_meta(name="Burnout Paradise", developers=["Studio G"]),
    }

    result = apply_filters(
        ranked, game_meta, series_ids, "forza motorsport", set(), k=5
    )

    series_in_result = [r for r in result if r in series_ids]
    assert len(series_in_result) == 2
    assert 500 in result


def test_k_limits_output():
    ranked = [(i, 1.0 - i * 0.01) for i in range(1, 20)]
    game_meta = {i: make_meta(name=f"Title {i}", developers=[f"Studio {i}"])
                 for i in range(1, 20)}

    result = apply_filters(ranked, game_meta, set(), "query", set(), k=5)

    assert len(result) == 5
