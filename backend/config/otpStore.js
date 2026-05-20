import Redis from "ioredis";
import logger from "./logger.js";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on("error", (err) => {
  logger.warn({ err: err.message }, "Redis unavailable for OTP store");
});

const OTP_TTL = 300;

export async function setOtp(email, data) {
  await redis.set(`otp:${email}`, JSON.stringify(data), "EX", OTP_TTL);
}

export async function getOtp(email) {
  const raw = await redis.get(`otp:${email}`);
  return raw ? JSON.parse(raw) : null;
}

export async function deleteOtp(email) {
  await redis.del(`otp:${email}`);
}
