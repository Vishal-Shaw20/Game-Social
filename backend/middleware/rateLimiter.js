// Importing config/env.js first guarantees .env is loaded before the limits
// below are read — this module is evaluated earlier than any dotenv.config()
// call elsewhere in the import graph.
import { envInt, redisUrl, DEV_MODE } from "../config/env.js";
import { RateLimiterRedis, RateLimiterMemory, BurstyRateLimiter } from "rate-limiter-flexible";
import Redis from "ioredis";
import logger from "../config/logger.js";

// ── Limits (env-overridable, durations in seconds) ───────────────

const LIMITS = {
  auth:   { points: envInt("RATE_LIMIT_AUTH_POINTS", 5),     duration: envInt("RATE_LIMIT_AUTH_DURATION", 15 * 60) },
  email:  { points: envInt("RATE_LIMIT_EMAIL_POINTS", 3),    duration: envInt("RATE_LIMIT_EMAIL_DURATION", 15 * 60) },
  api:    { points: envInt("RATE_LIMIT_API_POINTS", 80),     duration: envInt("RATE_LIMIT_API_DURATION", 15 * 60),
            burst:  envInt("RATE_LIMIT_API_BURST", 20) },
  search: { points: envInt("RATE_LIMIT_SEARCH_POINTS", 20),  duration: envInt("RATE_LIMIT_SEARCH_DURATION", 60),
            burst:  envInt("RATE_LIMIT_SEARCH_BURST", 10) },
  write:  { points: envInt("RATE_LIMIT_WRITE_POINTS", 10),   duration: envInt("RATE_LIMIT_WRITE_DURATION", 15 * 60) },
  // Review-draft auto-save: the game page saves a couple of seconds after
  // typing stops, so this has to be far looser than `write`.
  draft:  { points: envInt("RATE_LIMIT_DRAFT_POINTS", 120),  duration: envInt("RATE_LIMIT_DRAFT_DURATION", 10 * 60) },
  public: { points: envInt("RATE_LIMIT_PUBLIC_POINTS", 150), duration: envInt("RATE_LIMIT_PUBLIC_DURATION", 15 * 60),
            burst:  envInt("RATE_LIMIT_PUBLIC_BURST", 50) },
};

// ── TIER 1: Sliding Window Log (auth) ────────────────────────────
// True rolling window via Redis sorted sets.
// Each request timestamp stored individually; old ones age out.

class SlidingWindowLog {
  constructor(redis, { keyPrefix, points, duration, insuranceLimiter }) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
    this.points = points;
    this.duration = duration;
    this.insuranceLimiter = insuranceLimiter;
  }

  async consume(key) {
    const redisKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.duration * 1000;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcard(redisKey);
      const results = await pipeline.exec();
      const count = results[1][1];

      if (count >= this.points) {
        const oldest = await this.redis.zrange(redisKey, 0, 0, "WITHSCORES");
        const msBeforeNext = oldest.length >= 2
          ? parseInt(oldest[1]) + this.duration * 1000 - now
          : this.duration * 1000;
        const err = new Error("Rate limit exceeded");
        err.msBeforeNext = Math.max(msBeforeNext, 0);
        throw err;
      }

      await this.redis.zadd(redisKey, now, `${now}:${Math.random()}`);
      await this.redis.expire(redisKey, this.duration);
    } catch (e) {
      if (e.message === "Rate limit exceeded") throw e;
      if (this.insuranceLimiter) return this.insuranceLimiter.consume(key);
      throw e;
    }
  }
}

// ── Express middleware wrappers ──────────────────────────────────

// Keeps the user-facing "try again in X" text honest when durations are
// overridden via env.
function humanDuration(seconds) {
  if (seconds % 3600 === 0) {
    const h = seconds / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function createMiddleware(instance, message) {
  return (req, res, next) => {
    instance.consume(req.ip)
      .then(() => next())
      .catch((rej) => {
        res.set("Retry-After", String(Math.ceil((rej.msBeforeNext || 0) / 1000)));
        res.status(429).json({ error: message });
      });
  };
}

// ── Limiter construction ─────────────────────────────────────────

function buildLimiters() {
  const redis = new Redis(redisUrl(), {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });

  redis.on("error", (err) => {
    logger.warn({ err: err.message }, "Redis unavailable — rate limiting falling back to in-memory");
  });

  const strictAuthInstance = new SlidingWindowLog(redis, {
    keyPrefix: "rl_auth_strict",
    points: LIMITS.auth.points,
    duration: LIMITS.auth.duration,
    insuranceLimiter: new RateLimiterMemory(LIMITS.auth),
  });

  const emailInstance = new SlidingWindowLog(redis, {
    keyPrefix: "rl_auth_email",
    points: LIMITS.email.points,
    duration: LIMITS.email.duration,
    insuranceLimiter: new RateLimiterMemory(LIMITS.email),
  });

  // ── TIER 2: Token Bucket (reads) ───────────────────────────────

  const apiInstance = new BurstyRateLimiter(
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_api",
      points: LIMITS.api.points,
      duration: LIMITS.api.duration,
      insuranceLimiter: new RateLimiterMemory({ points: LIMITS.api.points, duration: LIMITS.api.duration }),
    }),
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_api_burst",
      points: LIMITS.api.burst,
      duration: LIMITS.api.duration,
    })
  );

  const searchInstance = new BurstyRateLimiter(
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_search",
      points: LIMITS.search.points,
      duration: LIMITS.search.duration,
      insuranceLimiter: new RateLimiterMemory({ points: LIMITS.search.points, duration: LIMITS.search.duration }),
    }),
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_search_burst",
      points: LIMITS.search.burst,
      duration: LIMITS.search.duration,
    })
  );

  // ── TIER 2: Sliding Window Counter (writes) ────────────────────

  const writeInstance = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_write",
    points: LIMITS.write.points,
    duration: LIMITS.write.duration,
    insuranceLimiter: new RateLimiterMemory(LIMITS.write),
  });

  const draftInstance = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_draft",
    points: LIMITS.draft.points,
    duration: LIMITS.draft.duration,
    insuranceLimiter: new RateLimiterMemory(LIMITS.draft),
  });

  // ── TIER 3: Token Bucket (public) ──────────────────────────────

  const publicInstance = new BurstyRateLimiter(
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_public",
      points: LIMITS.public.points,
      duration: LIMITS.public.duration,
      insuranceLimiter: new RateLimiterMemory({ points: LIMITS.public.points, duration: LIMITS.public.duration }),
    }),
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: "rl_public_burst",
      points: LIMITS.public.burst,
      duration: LIMITS.public.duration,
    })
  );

  return {
    strictAuthLimiter: createMiddleware(strictAuthInstance, `Too many attempts, please try again in ${humanDuration(LIMITS.auth.duration)}`),
    emailLimiter:      createMiddleware(emailInstance, `Too many requests, please try again in ${humanDuration(LIMITS.email.duration)}`),
    apiLimiter:        createMiddleware(apiInstance, "Too many requests, please slow down"),
    searchLimiter:     createMiddleware(searchInstance, "Too many search requests, please slow down"),
    writeLimiter:      createMiddleware(writeInstance, "Too many requests, please slow down"),
    draftLimiter:      createMiddleware(draftInstance, "Saving too often, please slow down"),
    publicLimiter:     createMiddleware(publicInstance, "Rate limit exceeded"),
  };
}

// DEV_MODE skips construction entirely, so no Redis connection is opened and
// local dev without a Redis server stops logging connection warnings.
function buildPassthroughs() {
  const passthrough = (req, res, next) => next();

  return {
    strictAuthLimiter: passthrough,
    emailLimiter:      passthrough,
    apiLimiter:        passthrough,
    searchLimiter:     passthrough,
    writeLimiter:      passthrough,
    draftLimiter:      passthrough,
    publicLimiter:     passthrough,
  };
}

if (DEV_MODE) {
  const msg = "DEV_MODE is on — all HTTP rate limiting is DISABLED";
  if (process.env.NODE_ENV === "production") {
    logger.error({ NODE_ENV: process.env.NODE_ENV }, msg);
  } else {
    logger.warn(msg);
  }
}

export const {
  strictAuthLimiter,
  emailLimiter,
  apiLimiter,
  searchLimiter,
  writeLimiter,
  draftLimiter,
  publicLimiter,
} = DEV_MODE ? buildPassthroughs() : buildLimiters();
