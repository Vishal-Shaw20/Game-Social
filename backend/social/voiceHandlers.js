// social/voiceHandlers.js
//
// Voice chat signalling. Audio never reaches the server: browsers connect
// directly to each other (a mesh), and this only relays the "here's how to
// reach me" messages between them, plus who is in which room.
//
// These handlers are registered only when VOICE_ENABLED is on
// (socketServer.js), so with voice off a stale browser tab can't start a
// call: the events simply don't exist.
//
// Rooms:
//   game:<rawgId>   the voice room beside a game's text chat; any signed-in
//                   user may join
//   conv:<id>       a DM or group's voice room; members only
//
// Joining is explicit. Nothing connects on page load, and the room is gone
// as soon as the last person leaves (voiceRooms.js).

import { RateLimiterMemory } from "rate-limiter-flexible";
import Conversation from "../models/Conversation.js";
import logger from "../config/logger.js";
import { userRoom } from "./realtime.js";
import {
  addMember, removeMember, membersOf, countOf, heartbeat,
  trackSocketRoom, untrackSocketRoom, roomsOfSocket
} from "./voiceRooms.js";

// The socket room carrying audio signalling for a voice room.
const voiceRoom = (roomId) => `voice:${roomId}`;
// A second, media-free room: pages showing "N in voice" without joining.
const watchRoom = (roomId) => `voicewatch:${roomId}`;

const joinLimiter = new RateLimiterMemory({ points: 20, duration: 60 });

/** Can this user be in this room? */
async function canJoin(user, roomId) {
  if (/^game:\d+$/.test(roomId)) return true; // any signed-in user
  const conv = /^conv:([0-9a-f]{24})$/i.exec(roomId);
  if (conv) {
    return Boolean(
      await Conversation.exists({ _id: conv[1], "members.userId": user._id })
    );
  }
  return false;
}

/** Who's in a room, one entry per user, for pages that only watch it:
    whether they're muted, and since when they've been in (the earliest of
    their tabs), so a page can show the call's length. */
async function peopleOf(roomId) {
  const people = new Map();
  for (const m of await membersOf(roomId)) {
    const had = people.get(m.userId);
    if (!had) {
      people.set(m.userId, { userId: m.userId, name: m.name, avatar: m.avatar ?? null, muted: Boolean(m.muted), since: m.since ?? null });
    } else if (m.since && (!had.since || m.since < had.since)) {
      had.since = m.since;
    }
  }
  return [...people.values()];
}

async function broadcastCount(io, roomId) {
  const [count, people] = await Promise.all([countOf(roomId), peopleOf(roomId)]);
  io.to(watchRoom(roomId)).emit("voice-count", { roomId, count, people });
  io.to(voiceRoom(roomId)).emit("voice-count", { roomId, count, people });
}

export function attachVoiceHandlers(io, socket) {
  const user = socket.user;
  if (!user?._id) return;

  const me = {
    userId: String(user._id),
    name: user.displayName || user.username || "Someone",
    avatar: user.avatar ?? null,
    muted: false,
    since: null // when this tab joined its current room
  };

  /* Watch a room's participant count without joining it (no microphone, no
     peer connections): what the game page's "2 in voice" badge uses. */
  socket.on("voice-watch", async ({ roomId, watch = true } = {}, cb) => {
    if (!roomId) return cb?.({ error: "missing_room" });
    if (watch) {
      socket.join(watchRoom(roomId));
      const [count, people] = await Promise.all([countOf(roomId), peopleOf(roomId)]);
      cb?.({ ok: true, count, people });
    } else {
      socket.leave(watchRoom(roomId));
      cb?.({ ok: true });
    }
  });

  socket.on("voice-join", async ({ roomId } = {}, cb) => {
    try {
      if (!roomId) return cb?.({ error: "missing_room" });

      try {
        await joinLimiter.consume(me.userId);
      } catch {
        return cb?.({ error: "rate_limited" });
      }

      if (!(await canJoin(user, roomId))) return cb?.({ error: "not_allowed" });

      // The people already here; the newcomer offers to each of them, so
      // only one side starts each connection.
      // One call per user, app-wide: leave whatever room this tab was in,
      // and tell the user's other tabs to hang up theirs (VoiceProvider
      // listens for "voice-moved").
      for (const other of roomsOfSocket(socket.id)) {
        if (other !== roomId) await leave(other);
      }
      socket.to(userRoom(me.userId)).emit("voice-moved", { roomId });

      const existing = await membersOf(roomId);

      me.since = Date.now();
      me.muted = false;
      await addMember(roomId, socket.id, me);
      trackSocketRoom(socket.id, roomId);
      socket.join(voiceRoom(roomId));

      socket.to(voiceRoom(roomId)).emit("voice-peer-joined", {
        roomId,
        peer: { socketId: socket.id, ...me }
      });
      await broadcastCount(io, roomId);

      cb?.({ ok: true, peers: existing.filter((p) => p.socketId !== socket.id) });
    } catch (err) {
      logger.error({ err }, "voice-join failed");
      cb?.({ error: "join_failed" });
    }
  });

  socket.on("voice-leave", async ({ roomId } = {}, cb) => {
    await leave(roomId);
    cb?.({ ok: true });
  });

  /* Relay one peer's offer/answer/ICE candidate to another. The payload is
     passed through untouched; the server never inspects or stores it. */
  socket.on("voice-signal", ({ to, roomId, data } = {}) => {
    if (!to || !data || !roomsOfSocket(socket.id).includes(roomId)) return;
    io.to(to).emit("voice-signal", { from: socket.id, roomId, data });
  });

  /* Mute state is shown to the others (the mic itself is muted locally). */
  socket.on("voice-state", async ({ roomId, muted } = {}) => {
    if (!roomsOfSocket(socket.id).includes(roomId)) return;
    me.muted = Boolean(muted);
    await heartbeat(roomId, socket.id, me);
    socket.to(voiceRoom(roomId)).emit("voice-state", {
      roomId,
      socketId: socket.id,
      muted: me.muted
    });
    // Pages only watching the room show mic-off icons too.
    await broadcastCount(io, roomId);
  });

  /* Keeps this member's slot alive; a tab that dies stops sending these and
     drops out of the room by itself. */
  socket.on("voice-heartbeat", async ({ roomId } = {}) => {
    if (!roomsOfSocket(socket.id).includes(roomId)) return;
    await heartbeat(roomId, socket.id, me);
  });

  socket.on("disconnect", async () => {
    for (const roomId of roomsOfSocket(socket.id)) await leave(roomId);
  });

  async function leave(roomId) {
    if (!roomId || !roomsOfSocket(socket.id).includes(roomId)) return;
    try {
      await removeMember(roomId, socket.id);
      untrackSocketRoom(socket.id, roomId);
      socket.leave(voiceRoom(roomId));
      socket.to(voiceRoom(roomId)).emit("voice-peer-left", { roomId, socketId: socket.id });
      await broadcastCount(io, roomId);
    } catch (err) {
      logger.warn({ err }, "voice leave failed");
    }
  }
}
