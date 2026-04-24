import json
import redis

from recommender.config import REDIS_URL

CACHE_TTL = 86400

try:
    _redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    _redis.ping()
except Exception:
    _redis = None


def _key(game_id: int, k: int, max_per_series: int) -> str:
    return f"rec:{game_id}:{k}:{max_per_series}"


def get_cached(game_id: int, k: int, max_per_series: int) -> list[int] | None:
    if _redis is None:
        return None
    try:
        val = _redis.get(_key(game_id, k, max_per_series))
        if val is None:
            return None
        return json.loads(val)
    except Exception:
        return None


def set_cached(game_id: int, k: int, max_per_series: int, result: list[int]) -> None:
    if _redis is None:
        return
    try:
        _redis.setex(_key(game_id, k, max_per_series), CACHE_TTL, json.dumps(result))
    except Exception:
        pass


def clear_all() -> None:
    if _redis is None:
        return
    try:
        _redis.flushdb()
    except Exception:
        pass
