import json
from unittest.mock import patch, MagicMock


def _make_cache_module():
    mock_redis_mod = MagicMock()
    with patch.dict("sys.modules", {"redis": mock_redis_mod}):
        mock_instance = MagicMock()
        mock_redis_mod.Redis.from_url.return_value = mock_instance
        import importlib
        import recommender.cache as cache_mod
        importlib.reload(cache_mod)
    return cache_mod, mock_instance


class TestCacheMiss:
    def test_get_returns_none_on_miss(self):
        cache, mock_r = _make_cache_module()
        mock_r.get.return_value = None

        result = cache.get_cached(3498, 50, 3)

        assert result is None
        mock_r.get.assert_called_once_with("rec:3498:50:3")


class TestCacheHit:
    def test_get_returns_stored_value(self):
        cache, mock_r = _make_cache_module()
        stored = [100, 200, 300]
        mock_r.get.return_value = json.dumps(stored)

        result = cache.get_cached(3498, 50, 3)

        assert result == stored


class TestSetCached:
    def test_set_stores_with_ttl(self):
        cache, mock_r = _make_cache_module()
        ids = [100, 200, 300]

        cache.set_cached(3498, 50, 3, ids)

        mock_r.setex.assert_called_once_with(
            "rec:3498:50:3", 86400, json.dumps(ids)
        )


class TestClearAll:
    def test_clear_calls_flushdb(self):
        cache, mock_r = _make_cache_module()

        cache.clear_all()

        mock_r.flushdb.assert_called_once()


class TestGracefulFallback:
    def test_get_returns_none_on_redis_error(self):
        cache, mock_r = _make_cache_module()
        mock_r.get.side_effect = Exception("Connection refused")

        result = cache.get_cached(3498, 50, 3)

        assert result is None

    def test_set_does_not_raise_on_redis_error(self):
        cache, mock_r = _make_cache_module()
        mock_r.setex.side_effect = Exception("Connection refused")

        cache.set_cached(3498, 50, 3, [100, 200])

    def test_clear_does_not_raise_on_redis_error(self):
        cache, mock_r = _make_cache_module()
        mock_r.flushdb.side_effect = Exception("Connection refused")

        cache.clear_all()


class TestRedisDown:
    def test_all_ops_safe_when_redis_none(self):
        cache, mock_r = _make_cache_module()
        cache._redis = None

        assert cache.get_cached(3498, 50, 3) is None
        cache.set_cached(3498, 50, 3, [1, 2, 3])
        cache.clear_all()
