import express from "express";
import Redis from "ioredis";
import { getPG } from "../config/db.js";
import { getLibraryForUser } from "../utils/getLibraryForUser.js";
import { DEV_MODE } from "../config/env.js";
import logger from "../config/logger.js";
import { requireAuth } from "../middleware/requireAuth.js";

/*
 * "Because you play …": recommendations for the signed-in user, from their
 * Steam library.
 *
 * The three games they've played most become the seeds for gamiq's
 * /recommend, which answers with similar games. That call is slow (tens of
 * seconds: it reranks candidates through a cross-encoder on CPU), so it is
 * never made while the browser waits:
 *
 *   - a cached answer is returned straight away;
 *   - otherwise the work starts in the background and the response says
 *     "pending"; the row polls until it's ready.
 *
 * The cache key includes the seed games, so a changed library produces fresh
 * recommendations while the old ones keep showing until they arrive.
 */

const router = express.Router();
router.use(requireAuth);

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";
const SEED_COUNT = 3;          // gamiq takes at most 3
const CACHE_TTL_SECONDS = 24 * 60 * 60;
// A failure (gamiq down, no index) is remembered briefly, so the row can say
// so and stop polling instead of waiting forever, and retries stay cheap.
const FAILURE_TTL_SECONDS = 10 * 60;
const GAMIQ_TIMEOUT_MS = 120_000;

/* Redis when it's there (all pods share one answer), memory otherwise. */
let redis = null;
const memory = new Map(); // key -> { value, expires }

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on("error", (err) => logger.warn("Recommendations Redis: %s", err.message));
} else if (!DEV_MODE) {
  logger.warn("REDIS_URL not set: recommendations are cached per pod only");
}

async function cacheGet(key) {
  if (redis) {
    const raw = await redis.get(key).catch(() => null);
    return raw ? JSON.parse(raw) : null;
  }
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

async function cacheSet(key, value, ttl = CACHE_TTL_SECONDS) {
  if (redis) {
    await redis.set(key, JSON.stringify(value), "EX", ttl).catch(() => {});
    return;
  }
  memory.set(key, { value, expires: Date.now() + ttl * 1000 });
}

/** The user's most-played games that we have a RAWG match for. */
function seedsFrom(library) {
  return (library.games ?? [])
    .filter((g) => g.rawg?.id)
    .sort((a, b) => (b.steam?.playtimeForever ?? 0) - (a.steam?.playtimeForever ?? 0))
    .slice(0, SEED_COUNT)
    .map((g) => ({ id: Number(g.rawg.id), name: g.rawg.name }));
}

/* One background job per cache key, however many tabs ask for it. */
const running = new Set();

async function computeRecommendations(key, seeds, ownedIds) {
  if (running.has(key)) return;
  running.add(key);

  try {
    const res = await fetch(`${GAMIQ_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawg_ids: seeds.map((s) => s.id) }),
      signal: AbortSignal.timeout(GAMIQ_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`gamiq /recommend ${res.status}`);

    // gamiq answers with rows of ids; flatten, keeping its order, and drop
    // anything the user already owns or that repeats.
    const { rawg_ids: rows } = await res.json();
    const seen = new Set(ownedIds);
    const ids = [];
    for (const row of rows ?? []) {
      for (const id of row) {
        if (!seen.has(Number(id))) {
          seen.add(Number(id));
          ids.push(Number(id));
        }
      }
    }

    await cacheSet(key, { seeds, ids });
    logger.info("Recommendations ready for %s: %d games", key, ids.length);
  } catch (err) {
    logger.warn("Recommendations failed for %s: %s", key, err.message);
    // Remembered briefly so the row stops polling and hides itself.
    await cacheSet(key, { seeds, ids: [], failed: true }, FAILURE_TTL_SECONDS);
  } finally {
    running.delete(key);
  }
}

/** The card fields for a list of RAWG ids, in the order given. */
async function gamesByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await getPG().query(
    `SELECT id, name, background_image, released, genres, platforms, metacritic, rating
     FROM games
     WHERE id = ANY($1) AND background_image IS NOT NULL`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids
    .map((id) => byId.get(Number(id)))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      title: r.name,
      background_image: r.background_image,
      released: r.released,
      genres: r.genres,
      platforms: r.platforms,
      metacritic: r.metacritic,
      rating: r.rating
    }));
}

/**
 * GET /api/recommended?limit=10
 * { status: "ready" | "pending" | "unavailable", games, seeds }
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 20);

    const library = await getLibraryForUser(req.user._id);
    const seeds = seedsFrom(library);

    // No Steam account, or nothing we can match: the row hides itself.
    if (seeds.length === 0) {
      return res.json({ status: "unavailable", games: [], seeds: [] });
    }

    const key = `rec:user:${req.user._id}:${seeds.map((s) => s.id).join("-")}`;
    const cached = await cacheGet(key);

    if (cached?.failed) {
      return res.json({ status: "unavailable", games: [], seeds });
    }

    if (cached) {
      return res.json({
        status: "ready",
        seeds: cached.seeds,
        games: await gamesByIds(cached.ids.slice(0, limit))
      });
    }

    // Not waiting on gamiq: start it and tell the client to check back.
    computeRecommendations(
      key,
      seeds,
      (library.games ?? []).map((g) => Number(g.rawg?.id)).filter(Boolean)
    );

    res.status(202).json({ status: "pending", games: [], seeds });
  } catch (err) {
    logger.error({ err }, "recommendations failed");
    res.status(500).json({ status: "unavailable", games: [], seeds: [] });
  }
});

export default router;
