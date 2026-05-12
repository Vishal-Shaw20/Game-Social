import { RateLimiterRedis, RateLimiterMemory, BurstyRateLimiter } from "rate-limiter-flexible";
import Redis from "ioredis";
import logger from "../config/logger.js";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on("error", (err) => {
  logger.warn({ err: err.message }, "Redis unavailable — rate limiting falling back to in-memory");
});

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

const strictAuthInstance = new SlidingWindowLog(redis, {
  keyPrefix: "rl_auth_strict",
  points: 5,
  duration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({ points: 5, duration: 15 * 60 }),
});

const emailInstance = new SlidingWindowLog(redis, {
  keyPrefix: "rl_auth_email",
  points: 3,
  duration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({ points: 3, duration: 15 * 60 }),
});

// ── TIER 2: Token Bucket (reads) ─────────────────────────────────

const apiInstance = new BurstyRateLimiter(
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_api",
    points: 80,
    duration: 15 * 60,
    insuranceLimiter: new RateLimiterMemory({ points: 80, duration: 15 * 60 }),
  }),
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_api_burst",
    points: 20,
    duration: 15 * 60,
  })
);

const searchInstance = new BurstyRateLimiter(
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_search",
    points: 20,
    duration: 60,
    insuranceLimiter: new RateLimiterMemory({ points: 20, duration: 60 }),
  }),
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_search_burst",
    points: 10,
    duration: 60,
  })
);

// ── TIER 2: Sliding Window Counter (writes) ──────────────────────

const writeInstance = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl_write",
  points: 10,
  duration: 15 * 60,
  insuranceLimiter: new RateLimiterMemory({ points: 10, duration: 15 * 60 }),
});

// ── TIER 3: Token Bucket (public) ────────────────────────────────

const publicInstance = new BurstyRateLimiter(
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_public",
    points: 150,
    duration: 15 * 60,
    insuranceLimiter: new RateLimiterMemory({ points: 150, duration: 15 * 60 }),
  }),
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl_public_burst",
    points: 50,
    duration: 15 * 60,
  })
);

// ── Express middleware wrappers ──────────────────────────────────

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

export const strictAuthLimiter = createMiddleware(strictAuthInstance, "Too many attempts, please try again in 15 minutes");
export const emailLimiter      = createMiddleware(emailInstance, "Too many requests, please try again in 15 minutes");
export const apiLimiter        = createMiddleware(apiInstance, "Too many requests, please slow down");
export const searchLimiter     = createMiddleware(searchInstance, "Too many search requests, please slow down");
export const writeLimiter      = createMiddleware(writeInstance, "Too many requests, please slow down");
export const publicLimiter     = createMiddleware(publicInstance, "Rate limit exceeded");
