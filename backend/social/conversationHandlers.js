// social/conversationHandlers.js
//
// Live side of DMs and group chats: sending, typing, and the read marker.
// Listing, history and creation are HTTP (routes/conversationRoutes.js).
//
// Each conversation is a socket room, "conv:<id>". A socket joins the rooms
// of every conversation its user belongs to as soon as it connects, so a
// message reaches someone even when they don't have that chat open (which is
// also how the unread badge and the notification are triggered).

import { RateLimiterMemory } from "rate-limiter-flexible";
import Conversation from "../models/Conversation.js";
import ChatMessage from "../models/ChatMessage.js";
import logger from "../config/logger.js";
import { createNotification } from "../utils/createNotification.js";
import { conversationRoom } from "../routes/conversationRoutes.js";
import { touch } from "./presence.js";

const sendLimiter = new RateLimiterMemory({ points: 10, duration: 10 });
const MAX_MESSAGE_LENGTH = 2000;

// Stored as typed: clients render it as text (React escapes), never as HTML.
const sanitize = (raw) => String(raw).trim().slice(0, MAX_MESSAGE_LENGTH);

/** Who is looking at which conversation, so we don't notify for an open chat. */
const viewing = new Map(); // socketId -> conversationId

export async function joinUserConversations(socket) {
  const userId = socket.user?._id;
  if (!userId) return;
  const convs = await Conversation.find({ "members.userId": userId }, { _id: 1 }).lean();
  for (const c of convs) socket.join(conversationRoom(c._id));
}

export function attachConversationHandlers(io, socket) {
  const user = socket.user;
  if (!user?._id) return;
  const me = String(user._id);
  const myName = user.displayName || user.username || "Someone";

  const isMember = async (conversationId) =>
    Conversation.findOne({ _id: conversationId, "members.userId": me }).lean();

  /* The client says which conversation is on screen; messages there don't
     raise a notification, exactly like reading them as they arrive. */
  socket.on("conv-viewing", ({ conversationId } = {}) => {
    if (conversationId) viewing.set(socket.id, String(conversationId));
    else viewing.delete(socket.id);
  });

  socket.on("conv-send", async (payload, cb) => {
    try {
      const { conversationId, text, clientId } = payload || {};
      if (!conversationId || typeof text !== "string") {
        cb?.({ error: "missing_params" });
        return;
      }

      try {
        await sendLimiter.consume(me);
      } catch {
        cb?.({ error: "rate_limited" });
        return;
      }

      const conv = await isMember(conversationId);
      if (!conv) {
        cb?.({ error: "not_a_member" });
        return;
      }

      const clean = sanitize(text);
      if (!clean) {
        cb?.({ error: "empty_message" });
        return;
      }

      const room = conversationRoom(conversationId);
      const saved = await ChatMessage.create({ roomId: room, userId: me, text: clean });

      // The sidebar shows the latest line without reading messages.
      await Conversation.updateOne(
        { _id: conversationId },
        {
          $set: {
            lastMessageAt: saved.createdAt,
            lastMessage: { text: clean, userId: me, at: saved.createdAt },
            // Sending is reading.
            "members.$[mine].lastReadAt": saved.createdAt
          }
        },
        { arrayFilters: [{ "mine.userId": user._id }] }
      );

      const msg = {
        id: String(saved._id),
        conversationId: String(conversationId),
        clientId: clientId ?? null,
        from: { id: me, name: myName, avatar: user.avatar ?? null },
        text: clean,
        ts: saved.createdAt.toISOString()
      };

      io.to(room).emit("conv-message", msg);
      socket.to(room).emit("conv-typing", { conversationId, userId: me, typing: false });
      cb?.({ ok: true, id: msg.id });

      touch(me, socket.id).catch(() => {});
      notifyAbsentMembers(io, conv, msg, conversationId).catch((err) =>
        logger.warn({ err }, "conversation notify failed")
      );
    } catch (err) {
      logger.error({ err }, "conv-send failed");
      cb?.({ error: "send_failed" });
    }
  });

  socket.on("conv-typing", async ({ conversationId, typing } = {}) => {
    if (!conversationId) return;
    if (!(await isMember(conversationId))) return;
    socket.to(conversationRoom(conversationId)).emit("conv-typing", {
      conversationId: String(conversationId),
      userId: me,
      name: myName,
      typing: Boolean(typing)
    });
  });

  socket.on("disconnect", () => viewing.delete(socket.id));
}

/**
 * Notify members who aren't looking at this conversation. Someone with it
 * open sees the message itself, so a notification would only be noise.
 */
async function notifyAbsentMembers(io, conv, msg, conversationId) {
  const sockets = await io.in(conversationRoom(conversationId)).fetchSockets();
  const watching = new Set(
    sockets
      .filter((s) => viewing.get(s.id) === String(conversationId))
      .map((s) => String(s.user?._id))
  );

  const title = conv.type === "group" ? (conv.name || "your group") : msg.from.name;
  for (const member of conv.members) {
    const id = String(member.userId);
    if (id === msg.from.id || watching.has(id)) continue;
    await createNotification({
      userId: id,
      actorId: msg.from.id,
      type: "message",
      entityId: conversationId,
      text:
        conv.type === "group"
          ? `${msg.from.name} in ${title}: ${msg.text.slice(0, 60)}`
          : `${msg.from.name}: ${msg.text.slice(0, 60)}`,
      url: `/social?c=${conversationId}`
    });
  }
}
