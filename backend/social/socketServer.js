// social/socketServer.js

import { attachTextHandlers } from "./socketTextHandlers.js";
import { attachConversationHandlers, joinUserConversations } from "./conversationHandlers.js";
import { initRealtime, userRoom, emitToUsers } from "./realtime.js";
import { initPresence, addSocket, removeSocket, touch, statusOf } from "./presence.js";
import { startSteamPresence } from "./steamPresence.js";
import { attachVoiceHandlers } from "./voiceHandlers.js";
import { initVoiceRooms } from "./voiceRooms.js";
import { VOICE_ENABLED } from "../config/env.js";
import logger from "../config/logger.js";

/* Tell a user's friends (and their own other tabs) that their status
   changed, but only when it actually changed: opening a second tab doesn't
   make someone "more online". */
async function broadcastStatus(socket) {
  const user = socket.user;
  if (!user?._id) return;
  const status = await statusOf(user._id);
  emitToUsers([...(user.friends ?? []), user._id], "presence", {
    userId: String(user._id),
    status
  });
}
// Voice chat fully removed

/**
 * Register socket handlers when the io server is created
 */
export default function socketServer(io) {
  initRealtime(io);
  initPresence();
  startSteamPresence();
  if (VOICE_ENABLED) {
    initVoiceRooms();
    logger.info("Voice chat is ENABLED");
  }

  io.on("connection", (socket) => {
    // Private room for server pushes to this user (realtime.js). Every
    // socket here is authenticated (the io.use guard in server.js).
    if (socket.user?._id) socket.join(userRoom(String(socket.user._id)));
    // socket.data survives the Redis adapter, so other pods can tell who is
    // in a room (the game page's "in chat now" count).
    if (socket.user?._id) socket.data.userId = String(socket.user._id);
    // Name and picture too, so a game room can list who's in it (the
    // "here now" list in the game page's chat).
    if (socket.user?._id) {
      socket.data.name = socket.user.displayName || socket.user.username || "Someone";
      socket.data.avatar = socket.user.avatar ?? null;
    }

    // Online/idle + the rooms of every conversation this user is in, so a
    // message reaches them whether or not they have that chat open.
    if (socket.user?._id) {
      addSocket(socket.user._id, socket.id)
        .then(() => broadcastStatus(socket))
        .catch(err => logger.warn("presence add failed: %s", err.message));
      joinUserConversations(socket).catch(err =>
        logger.warn("joining conversations failed: %s", err.message)
      );
    }

    // Any sign of life keeps the user "online" rather than "idle".
    socket.on("active", () => {
      if (socket.user?._id) {
        touch(socket.user._id, socket.id)
          .then(() => broadcastStatus(socket))
          .catch(() => {});
      }
    });

    // Game rooms, then DMs and groups.
    attachTextHandlers(io, socket);
    attachConversationHandlers(io, socket);
    // Off unless VOICE_ENABLED: with voice off these events don't exist, so
    // an old tab can't start a call.
    if (VOICE_ENABLED) attachVoiceHandlers(io, socket);

    logger.debug("Socket connected: %s", socket.id);

    socket.on("disconnect", () => {
      if (socket.user?._id) {
        removeSocket(socket.user._id, socket.id)
          .then(() => broadcastStatus(socket))
          .catch(() => {});
      }
      logger.debug("Socket disconnected: %s", socket.id);
    });
  });
}
