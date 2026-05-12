import time
import logging
import requests
from recommender.config import RAWG_API_KEYS

logger = logging.getLogger(__name__)

# ============================================================
# -------------------- API KEY ROTATION ----------------------
# ============================================================

_current_key_index = 0


def rawg_get(url: str, timeout: int = 10):
    global _current_key_index

    for _ in range(len(RAWG_API_KEYS)):
        key      = RAWG_API_KEYS[_current_key_index]
        sep      = "&" if "?" in url else "?"
        full_url = f"{url}{sep}key={key}"

        try:
            response = requests.get(full_url, timeout=timeout)
        except Exception as e:
            logger.error("Request error: %s", e)
            return None

        if response.status_code == 429:
            logger.warn("Rate limit hit on key %d, switching...", _current_key_index + 1)
            _current_key_index = (_current_key_index + 1) % len(RAWG_API_KEYS)
            time.sleep(1)
            continue

        return response

    logger.error("All API keys exhausted.")
    return None

# ============================================================
# -------------------- SERIES FETCH --------------------------
# ============================================================


def fetch_series_for_game(game_id: int) -> list[int]:
    series_ids = []
    page = 1

    while True:
        url = f"https://api.rawg.io/api/games/{game_id}/game-series?page={page}"
        response = rawg_get(url)

        if response is None or response.status_code != 200:
            break

        data = response.json()
        for g in data.get("results", []):
            series_ids.append(g["id"])

        if not data.get("next"):
            break
        page += 1

    return series_ids
