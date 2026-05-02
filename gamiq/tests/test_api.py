from unittest.mock import patch
from fastapi.testclient import TestClient


# Mock must be active DURING request processing, not just during import.
# Using @patch decorator ensures the mock is live for the full test body.

_mock_return = list(range(100, 150))  # 50 fake IDs — enough for any quota


def _get_client():
    """Import app once (reused across tests)."""
    with patch("recommender.api.get_recommendations", return_value=_mock_return):
        from main import app
    return TestClient(app)


client = _get_client()


# -------------------- Level 1: Shape Tests --------------------

@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_single_game(mock_rec):
    response = client.post("/recommend", json={"rawg_ids": [3498]})
    assert response.status_code == 200
    data = response.json()
    assert "rawg_ids" in data
    assert isinstance(data["rawg_ids"], list)
    assert len(data["rawg_ids"]) == 2  # 1 game → 2 rows
    for row in data["rawg_ids"]:
        assert isinstance(row, list)
        assert all(isinstance(x, int) for x in row)


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_two_games(mock_rec):
    response = client.post("/recommend", json={"rawg_ids": [3498, 28]})
    assert response.status_code == 200
    data = response.json()
    assert len(data["rawg_ids"]) == 3  # 2 games → 3 rows


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_three_games(mock_rec):
    response = client.post("/recommend", json={"rawg_ids": [3498, 28, 58175]})
    assert response.status_code == 200
    data = response.json()
    assert len(data["rawg_ids"]) == 3  # 3 games → 3 rows


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_empty_input(mock_rec):
    response = client.post("/recommend", json={"rawg_ids": []})
    assert response.status_code == 200
    assert response.json() == {"rawg_ids": []}


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_caps_at_three_games(mock_rec):
    """Even if 5 IDs are sent, only first 3 are used."""
    response = client.post("/recommend", json={"rawg_ids": [1, 2, 3, 4, 5]})
    assert response.status_code == 200
    data = response.json()
    assert len(data["rawg_ids"]) == 3  # capped to 3 games → 3 rows
    assert mock_rec.call_count == 3


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_invalid_body(mock_rec):
    response = client.post("/recommend", json={})
    assert response.status_code == 422  # pydantic validation error


@patch("recommender.api.get_recommendations", return_value=_mock_return)
def test_recommend_wrong_type(mock_rec):
    response = client.post("/recommend", json={"rawg_ids": "not_a_list"})
    assert response.status_code == 422
