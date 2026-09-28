// social/realtime.js
//
// Server-initiated pushes over the Socket.IO connection the client already
// keeps open for chat: notifications, friend-list changes and friend activity
// arrive instantly instead of on the next poll.
//
// Every authenticated socket joins a private room, "user:<id>" (see
// socketServer.js), so emitting to a user reaches all of their open tabs.
//
// The backend runs as several pods, and a user's socket lives on only one of
// them. The Redis adapter relays each emit to every pod, so a notification
// created by pod A still reaches a user connected to pod B. Without Redis
// (DEV_MODE, single local process) emits stay in-process, which is all a
// single process needs.

import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { DEV_MODE } from "../config/env.js";
import logger from "../config/logger.js";

let io = null;

export const userRoom = (userId) => `user:${userId}`;

export function initRealtime(ioServer) {
  io = ioServer;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (!DEV_MODE) {
      logger.warn("REDIS_URL not set: realtime events only reach sockets on this pod");
    }
    return;
  }

  const pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  const onError = (err) => logger.warn("Socket.IO Redis adapter: %s", err.message);
  pub.on("error", onError);
  sub.on("error", onError);
  io.adapter(createAdapter(pub, sub));
  logger.info("Socket.IO Redis adapter enabled");
}

/** Push an event to every open socket of one user. No-op before init. */
export function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(userRoom(String(userId))).emit(event, payload);
}

/** Push an event to many users at once (one emit, deduplicated rooms). */
export function emitToUsers(userIds, event, payload) {
  if (!io || !userIds?.length) return;
  const rooms = [...new Set(userIds.map((id) => userRoom(String(id))))];
  io.to(rooms).emit(event, payload);
}

/**
 * Distinct users with a socket in a room, across every pod (the Redis
 * adapter answers for the others). [] before init or on a slow adapter.
 */
export async function usersInRoom(room) {
  if (!io) return [];
  try {
    const sockets = await io.in(room).timeout(2000).fetchSockets();
    return [...new Set(sockets.map((s) => s.data?.userId).filter(Boolean))];
  } catch {
    return [];
  }
}
