import Redis from "ioredis";
import { redisUrl, DEV_MODE } from "./env.js";
import logger from "./logger.js";

const OTP_TTL = 300;

function buildRedisStore() {
  const redis = new Redis(redisUrl(), {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });

  redis.on("error", (err) => {
    logger.warn({ err: err.message }, "Redis unavailable for OTP store");
  });

  return {
    async setOtp(email, data) {
      await redis.set(`otp:${email}`, JSON.stringify(data), "EX", OTP_TTL);
    },
    async getOtp(email) {
      const raw = await redis.get(`otp:${email}`);
      return raw ? JSON.parse(raw) : null;
    },
    async deleteOtp(email) {
      await redis.del(`otp:${email}`);
    },
  };
}

// DEV_MODE substitute so signup and password reset work locally without a
// Redis server. Single-process and lost on restart — unlike the rate limiters,
// the Redis store has no automatic fallback, so without this a missing Redis
// breaks OTP entirely.
function buildMemoryStore() {
  const store = new Map();

  return {
    async setOtp(email, data) {
      // Round-tripped so callers get the same copy semantics as the Redis path.
      store.set(email, { raw: JSON.stringify(data), expiresAt: Date.now() + OTP_TTL * 1000 });
    },
    async getOtp(email) {
      const entry = store.get(email);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(email);
        return null;
      }
      return JSON.parse(entry.raw);
    },
    async deleteOtp(email) {
      store.delete(email);
    },
  };
}

if (DEV_MODE) {
  const msg = "DEV_MODE is on — OTP store is in-memory, not Redis";
  if (process.env.NODE_ENV === "production") {
    logger.error({ NODE_ENV: process.env.NODE_ENV }, msg);
  } else {
    logger.warn(msg);
  }
}

export const { setOtp, getOtp, deleteOtp } = DEV_MODE
  ? buildMemoryStore()
  : buildRedisStore();
