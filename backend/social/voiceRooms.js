// social/voiceRooms.js
//
// Who is in which voice room. Membership is per socket (one tab = one
// participant) and lives in Redis so every backend pod sees the same room,
// with a short expiry so a crashed tab can't leave a ghost behind. Without
// Redis it falls back to an in-process map, which is right for one pod.
//
// A room exists only while someone is in it: the last person to leave
// removes the key. Nothing is kept warm, and no audio passes through here —
// the server only ever holds the member list (see voiceHandlers.js).

import Redis from "ioredis";
import logger from "../config/logger.js";

const KEY = (roomId) => `voice:${roomId}`;
// Refreshed on every heartbeat; a tab that dies stops refreshing and drops
// out of the room within this window.
const TTL_SECONDS = 90;

let redis = null;
const local = new Map(); // roomId -> Map<socketId, member>

export function initVoiceRooms() {
  const url = process.env.REDIS_URL;
  if (!url) return;
  redis = new Redis(url, { maxRetriesPerRequest: null });
  redis.on("error", (err) => logger.warn("Voice rooms Redis: %s", err.message));
}

export async function addMember(roomId, socketId, member) {
  if (redis) {
    await redis.hset(KEY(roomId), socketId, JSON.stringify(member));
    await redis.expire(KEY(roomId), TTL_SECONDS);
    return;
  }
  if (!local.has(roomId)) local.set(roomId, new Map());
  local.get(roomId).set(socketId, member);
}

export async function removeMember(roomId, socketId) {
  if (redis) {
    await redis.hdel(KEY(roomId), socketId);
    // No members left: the room goes away entirely.
    if ((await redis.hlen(KEY(roomId))) === 0) await redis.del(KEY(roomId));
    return;
  }
  const room = local.get(roomId);
  if (!room) return;
  room.delete(socketId);
  if (room.size === 0) local.delete(roomId);
}

/** Keep this member (and the room) alive. */
export async function heartbeat(roomId, socketId, member) {
  return addMember(roomId, socketId, member);
}

/** [{ socketId, userId, name, avatar, muted }] for a room. */
export async function membersOf(roomId) {
  if (redis) {
    const all = await redis.hgetall(KEY(roomId));
    return Object.entries(all).map(([socketId, json]) => ({ socketId, ...JSON.parse(json) }));
  }
  return [...(local.get(roomId)?.entries() ?? [])].map(([socketId, m]) => ({ socketId, ...m }));
}

export async function countOf(roomId) {
  if (redis) return redis.hlen(KEY(roomId));
  return local.get(roomId)?.size ?? 0;
}

/** Every room this socket is in, so a disconnect can clean them all up. */
const socketRooms = new Map(); // socketId -> Set<roomId>

export function trackSocketRoom(socketId, roomId) {
  if (!socketRooms.has(socketId)) socketRooms.set(socketId, new Set());
  socketRooms.get(socketId).add(roomId);
}

export function untrackSocketRoom(socketId, roomId) {
  socketRooms.get(socketId)?.delete(roomId);
  if (socketRooms.get(socketId)?.size === 0) socketRooms.delete(socketId);
}

export function roomsOfSocket(socketId) {
  return [...(socketRooms.get(socketId) ?? [])];
}
