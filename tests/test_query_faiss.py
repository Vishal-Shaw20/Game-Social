import math
import sys
from unittest.mock import MagicMock, patch

# Mock heavy modules before importing query_faiss (prevents DB/FAISS/ONNX init)
sys.modules['faiss'] = MagicMock()
sys.modules['recommender.inference.reranker'] = MagicMock()

with patch('psycopg2.pool.ThreadedConnectionPool'):
    from recommender.inference.query_faiss import score_candidates, apply_filters


# -------------------- Helpers --------------------

def make_meta(name="Game", genres=None, rating=4.0, ratings_count=1000,
              metacritic=80, developers=None):
    return {
        "name": name,
        "genres": ["Action"] if genres is None else genres,
        "rating": rating,
        "ratings_count": ratings_count,
        "metacritic": metacritic,
        "developers": ["Unknown Studio"] if developers is None else developers,
    }


# -------------------- Scoring Formula --------------------

def test_scoring_formula_exact():
    game_meta = {1: make_meta(rating=4.0, ratings_count=1000, metacritic=80,
                              genres=["Action", "RPG"])}
    reranked = [{"game_id": 1, "reranker_score": 2.0}]
    faiss_scores = {1: 0.85}
    query_genres = {"Action", "RPG"}
    weights = {"reranker": 0.45, "faiss": 0.25, "genre": 0.10,
               "rating": 0.10, "metacritic": 0.05, "popularity": 0.05}

    ranked = score_candidates(reranked, game_meta, faiss_scores, set(), query_genres, weights=weights)

    reranker = 1 / (1 + math.exp(-2.0))
    expected = (0.45 * reranker +
                0.25 * 0.85 +
                0.10 * 1.0 +
                0.10 * (4.0 / 5) +
                0.05 * (80 / 100) +
                0.05 * min(math.log10(1001) / math.log10(1_000_000), 1.0))

    assert len(ranked) == 1
    assert ranked[0][0] == 1
    assert abs(ranked[0][1] - expected) < 1e-9


def test_scoring_sorts_descending():
    game_meta = {
        1: make_meta(rating=5.0, metacritic=95),
        2: make_meta(rating=2.0, metacritic=40),
    }
    reranked = [
        {"game_id": 1, "reranker_score": 3.0},
        {"game_id": 2, "reranker_score": -1.0},
    ]
    faiss_scores = {1: 0.9, 2: 0.3}

    ranked = score_candidates(reranked, game_meta, faiss_scores, set(), set())

    assert ranked[0][0] == 1
    assert ranked[1][0] == 2
    assert ranked[0][1] > ranked[1][1]


def test_scoring_skips_missing_game_meta():
    game_meta = {1: make_meta()}
    reranked = [
        {"game_id": 1, "reranker_score": 1.0},
        {"game_id": 999, "reranker_score": 5.0},
    ]

    ranked = score_candidates(reranked, game_meta, {1: 0.5}, set(), set())

    assert len(ranked) == 1
    assert ranked[0][0] == 1


# -------------------- FAISS Imputation --------------------

def test_faiss_imputation_series_gets_batch_min():
    game_meta = {
        1: make_meta(),
        2: make_meta(),
    }
    reranked = [
        {"game_id": 1, "reranker_score": 1.0},
        {"game_id": 2, "reranker_score": 1.0},
    ]
    faiss_scores = {1: 0.7}
    series_ids = {2}

    ranked = score_candidates(reranked, game_meta, faiss_scores, series_ids, set())

    scores = {r[0]: r[1] for r in ranked}
    assert abs(scores[1] - scores[2]) < 1e-9


def test_faiss_imputation_non_series_gets_zero():
    game_meta = {
        1: make_meta(),
        2: make_meta(),
    }
    reranked = [
        {"game_id": 1, "reranker_score": 1.0},
        {"game_id": 2, "reranker_score": 1.0},
    ]
    faiss_scores = {1: 0.7}
    weights = {"reranker": 0.45, "faiss": 0.25, "genre": 0.10,
               "rating": 0.10, "metacritic": 0.05, "popularity": 0.05}

    ranked = score_candidates(reranked, game_meta, faiss_scores, set(), set(), weights=weights)

    scores = {r[0]: r[1] for r in ranked}
    assert scores[1] > scores[2]
    assert abs((scores[1] - scores[2]) - 0.25 * 0.7) < 1e-9


# -------------------- DLC Filter --------------------

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
    ranked = [(100, 0.9), (200, 0.8), (300, 0.7), (400, 0.6)]
    game_meta = {
        100: make_meta(name="Game A", developers=["Rockstar Games"]),
        200: make_meta(name="Game B", developers=["Rockstar Games"]),
        300: make_meta(name="Game C", developers=["Rockstar Games"]),
        400: make_meta(name="Game D", developers=["Ubisoft"]),
    }

    result = apply_filters(ranked, game_meta, set(), "some query", set(), k=10)

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

    result = apply_filters(ranked, game_meta, set(), "some query", set(), k=10)

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

def test_series_cap_max_three():
    ranked = [(100, 0.9), (200, 0.85), (300, 0.8), (400, 0.75), (500, 0.7)]
    series_ids = {100, 200, 300, 400}
    game_meta = {
        100: make_meta(name="Forza Horizon 5", developers=["Studio A"]),
        200: make_meta(name="Forza Horizon 4", developers=["Studio B"]),
        300: make_meta(name="Forza Horizon 3", developers=["Studio C"]),
        400: make_meta(name="Forza Horizon 2", developers=["Studio D"]),
        500: make_meta(name="Need for Speed Heat", developers=["Studio E"]),
    }

    result = apply_filters(ranked, game_meta, series_ids, "forza motorsport", set(), k=10)

    series_in_result = [r for r in result if r in series_ids]
    assert len(series_in_result) == 3
    assert 400 not in result
    assert 500 in result


def test_k_limits_output():
    ranked = [(i, 1.0 - i * 0.01) for i in range(1, 20)]
    game_meta = {i: make_meta(name=f"Title {i}", developers=[f"Studio {i}"])
                 for i in range(1, 20)}

    result = apply_filters(ranked, game_meta, set(), "query", set(), k=5)

    assert len(result) == 5
