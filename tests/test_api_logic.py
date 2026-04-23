from recommender.api import _build_response
from unittest.mock import patch


def mock_recs(game_id, k=50):
    """Return predictable fake IDs: game_id * 1000 + offset."""
    return [game_id * 1000 + i for i in range(k)]


# -------------------- Quota Logic --------------------

@patch("recommender.api.get_recommendations", side_effect=mock_recs)
def test_single_game_quota(mock):
    """1 game → quotas [5], 2 rows → 10 IDs total."""
    result = _build_response([1])
    rows = result["rawg_ids"]
    assert len(rows) == 2
    for row in rows:
        assert len(row) == 5


@patch("recommender.api.get_recommendations", side_effect=mock_recs)
def test_two_games_quota(mock):
    """2 games → quotas [3,2], 3 rows → 15 IDs total."""
    result = _build_response([1, 2])
    rows = result["rawg_ids"]
    assert len(rows) == 3
    for row in rows:
        assert len(row) == 5


@patch("recommender.api.get_recommendations", side_effect=mock_recs)
def test_three_games_quota(mock):
    """3 games → quotas [2,2,1], 3 rows → 15 IDs total."""
    result = _build_response([1, 2, 3])
    rows = result["rawg_ids"]
    assert len(rows) == 3
    for row in rows:
        assert len(row) == 5


@patch("recommender.api.get_recommendations", side_effect=mock_recs)
def test_no_duplicate_ids_within_game(mock):
    """Each game's recommendations should advance the pointer, not repeat."""
    result = _build_response([1])
    all_ids = [gid for row in result["rawg_ids"] for gid in row]
    assert len(all_ids) == len(set(all_ids)), "Duplicate IDs found"


@patch("recommender.api.get_recommendations", side_effect=mock_recs)
def test_caps_to_three_input_games(mock):
    """Even with 5 input IDs, only first 3 are used."""
    result = _build_response([1, 2, 3, 4, 5])
    rows = result["rawg_ids"]
    assert len(rows) == 3
    # Verify mock was called only 3 times (for games 1, 2, 3)
    assert mock.call_count == 3
