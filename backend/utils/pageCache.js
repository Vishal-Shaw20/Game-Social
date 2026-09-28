// utils/pageCache.js
//
// Small read-through cache for the game page's outside data (Steam, RAWG,
// SteamSpy). Redis when REDIS_URL is set, so every pod shares one copy and
// a game's Steam data is fetched once per TTL instead of once per view;
// in-process memory otherwise (local dev).
//
// cached(key, ttlSeconds, fn): fn's result is stored and returned. A null
// result (Steam has nothing for that app) is remembered for NULL_TTL, so it
// isn't asked again on every view. A throw (a timeout, a failed DNS lookup,
// an API that's down) is remembered only for ERROR_TTL: long enough not to
// hammer a struggling API, short enough that one network blip doesn't hide
// a section for half an hour.

import Redis from "ioredis";
import logger from "../config/logger.js";

const PREFIX = "gamepage:";
const NULL_TTL = 30 * 60;
const ERROR_TTL = 60;
const MEMORY_MAX = 2000;

let redis = null;
const memory = new Map(); // key -> { value, expires }

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
  redis.on("error", (err) => logger.warn("Game page cache Redis: %s", err.message));
}

async function get(key) {
  if (redis) {
    const raw = await redis.get(PREFIX + key).catch(() => null);
    return raw == null ? undefined : JSON.parse(raw);
  }
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
}

async function set(key, value, ttl) {
  if (redis) {
    await redis.set(PREFIX + key, JSON.stringify(value), "EX", ttl).catch(() => {});
    return;
  }
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
  memory.set(key, { value, expires: Date.now() + ttl * 1000 });
}

/* Concurrent misses for the same key share one fetch. */
const inflight = new Map();

export async function cached(key, ttl, fn) {
  const hit = await get(key);
  if (hit !== undefined) return hit;

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = (await fn()) ?? null;
      await set(key, value, value === null ? Math.min(NULL_TTL, ttl) : ttl);
      return value;
    } catch (err) {
      logger.warn("Game page fetch %s failed: %s", key, err.message);
      await set(key, null, Math.min(ERROR_TTL, ttl));
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export const cacheSet = set;
export const cacheGet = get;
