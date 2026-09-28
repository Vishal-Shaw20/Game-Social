// social/presence.js
//
// Who is online, and what they're playing.
//
// A user is online while at least one of their sockets is connected. The
// backend runs as several pods and a user's tabs can land on different ones,
// so the connection count lives in Redis (a hash of socketId -> pod), not in
// process memory. Without Redis (DEV_MODE, single process) it falls back to
// an in-process map, which is correct for one pod.
//
// Status:
//   online  at least one connected socket, active recently
//   idle    connected, but every tab reported no activity for IDLE_AFTER_MS
//   offline no connected sockets
//
// "Playing X" comes from Steam, polled only for users who are online and
// have Steam linked (steamPresence.js).

import Redis from "ioredis";
import logger from "../config/logger.js";

const KEY = (userId) => `presence:${userId}`;
const TTL_SECONDS = 60 * 60; // safety net if a disconnect is ever missed

let redis = null;
const local = new Map(); // userId -> Map<socketId, lastActiveMs>   (no-Redis fallback)
// Sockets this pod holds, whatever the store: used to poll Steam only for
// users we're actually serving, and to know who to push updates to.
const localSockets = new Map(); // userId -> Set<socketId>
// userId -> { name } for whoever is in a game right now (steamPresence.js).
const playing = new Map();

export function initPresence() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  redis = new Redis(url, { maxRetriesPerRequest: null });
  redis.on("error", (err) => logger.warn("Presence Redis: %s", err.message));
}

export async function addSocket(userId, socketId) {
  const now = String(Date.now());
  if (!localSockets.has(String(userId))) localSockets.set(String(userId), new Set());
  localSockets.get(String(userId)).add(socketId);
  if (redis) {
    await redis.hset(KEY(userId), socketId, now);
    await redis.expire(KEY(userId), TTL_SECONDS);
    return;
  }
  if (!local.has(String(userId))) local.set(String(userId), new Map());
  local.get(String(userId)).set(socketId, now);
}

export async function removeSocket(userId, socketId) {
  const own = localSockets.get(String(userId));
  if (own) {
    own.delete(socketId);
    if (own.size === 0) {
      localSockets.delete(String(userId));
      playing.delete(String(userId));
    }
  }
  if (redis) {
    await redis.hdel(KEY(userId), socketId);
    return;
  }
  const m = local.get(String(userId));
  if (!m) return;
  m.delete(socketId);
  if (m.size === 0) local.delete(String(userId));
}

/** Mark this socket active now (a message, a click, any sign of life). */
export async function touch(userId, socketId) {
  return addSocket(userId, socketId);
}

const IDLE_AFTER_MS = 10 * 60 * 1000;

async function activityTimes(userId) {
  if (redis) {
    const all = await redis.hgetall(KEY(userId));
    return Object.values(all).map(Number);
  }
  return [...(local.get(String(userId))?.values() ?? [])].map(Number);
}

/** "online" | "idle" | "offline" for one user. */
export async function statusOf(userId) {
  const times = await activityTimes(userId);
  if (times.length === 0) return "offline";
  const newest = Math.max(...times);
  return Date.now() - newest > IDLE_AFTER_MS ? "idle" : "online";
}

/** Statuses for many users at once: { "<id>": "online" | ... }. */
export async function statusOfMany(userIds) {
  const out = {};
  await Promise.all(
    userIds.map(async (id) => {
      out[String(id)] = await statusOf(id);
    })
  );
  return out;
}

/** Everyone holding at least one socket on this pod. */
export function locallyConnectedUserIds() {
  return [...localSockets.keys()];
}

/* ── Now playing (from Steam) ── */

/** Returns true when it changed, so the caller only pushes real changes. */
export function setPlaying(userId, game) {
  const key = String(userId);
  const before = playing.get(key)?.name ?? null;
  const after = game?.name ?? null;
  if (before === after) return false;
  if (after) playing.set(key, { name: after });
  else playing.delete(key);
  return true;
}

export function playingOf(userId) {
  return playing.get(String(userId))?.name ?? null;
}

/** { status, playing } for many users, as the API and socket events send it. */
export async function presenceOfMany(userIds) {
  const statuses = await statusOfMany(userIds);
  const out = {};
  for (const id of userIds) {
    out[String(id)] = { status: statuses[String(id)], playing: playingOf(id) };
  }
  return out;
}
