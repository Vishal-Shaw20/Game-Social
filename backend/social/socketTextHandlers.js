// social/socketTextHandlers.js
import logger from "../config/logger.js";
import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import User from "../models/User.js";
import { getPG } from "../config/db.js";
import Activity from "../models/Activity.js";
import { createActivity } from "../utils/createActivity.js";
import { createNotification } from "../utils/createNotification.js";
import { extractMentions } from "../utils/parseMentions.js";
import { cached } from "../utils/pageCache.js";
import { RateLimiterMemory } from "rate-limiter-flexible";

const socketLimiter = new RateLimiterMemory({ points: 10, duration: 10 });
// Reactions, edits, deletes and group joins: cheap, but not unlimited.
const actionLimiter = new RateLimiterMemory({ points: 30, duration: 10 });

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_PAGE = 50;
const HISTORY_MAX = 100;
const EXCERPT_LENGTH = 140;
const SEARCH_LIMIT = 25;
const MAX_MENTIONS = 5;
// Reactions: any one standard emoji (the picker offers the Unicode set), as
// a single character or a sequence: skin tones, ZWJ combinations, flags,
// keycaps, subdivision flags. Nothing else (text, custom images).
const EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*[\u{E0020}-\u{E007F}]*)$/u;
const isEmoji = (s) => typeof s === "string" && s.length <= 32 && EMOJI.test(s);
const MAX_REACTION_KINDS = 20; // different emojis on one message
const LFG_PLATFORMS = ["Any", "PC", "PlayStation", "Xbox", "Switch", "Mobile"];
const LFG_MAX_SLOTS = 10;

// The only rooms these handlers serve: a game's public chat. DMs and groups
// ("conv:<id>") have their own members-only handlers
// (conversationHandlers.js); without this check anyone could join a
// conversation's socket room here and read it.
const GAME_ROOM = /^game:\d{1,10}$/;

// Stored as typed: clients render it as text (React escapes), never as HTML.
function sanitizeText(raw) {
  return raw.trim().slice(0, MAX_MESSAGE_LENGTH);
}

/* ---------------- Shape ----------------
   The sender's current name and picture come from their user record, not
   the message, so a rename shows everywhere; messages whose author is gone
   are skipped. The same goes for a quoted author and people who joined a
   group. */
const AUTHOR_FIELDS = "displayName username profilePicture linkedAccounts.avatar";
const POPULATE = [
  { path: "userId", select: AUTHOR_FIELDS },
  { path: "replyTo.userId", select: AUTHOR_FIELDS },
  { path: "lfg.joined", select: AUTHOR_FIELDS }
];

function authorOf(u) {
  return {
    id: String(u._id),
    name: u.displayName || u.username || "Unknown user",
    username: u.username ?? null,
    avatar: u.profilePicture || u.linkedAccounts?.find(a => a.avatar)?.avatar || null
  };
}

/** A stored (populated, lean) message as the client gets it. */
function shapeMessage(m, clientId = null) {
  const deleted = Boolean(m.deletedAt);
  return {
    id: String(m._id),
    clientId,
    roomId: m.roomId,
    from: authorOf(m.userId),
    kind: m.kind || "text",
    text: deleted ? "" : m.text,
    ts: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deleted,
    replyTo: m.replyTo?.id
      ? {
          id: String(m.replyTo.id),
          from: m.replyTo.userId?._id ? authorOf(m.replyTo.userId) : null,
          excerpt: m.replyTo.excerpt || ""
        }
      : null,
    reactions: deleted
      ? []
      : (m.reactions ?? [])
          .filter(r => r.userIds?.length)
          .map(r => ({ emoji: r.emoji, userIds: r.userIds.map(String) })),
    lfg: m.kind === "lfg" && m.lfg && !deleted
      ? {
          platform: m.lfg.platform || "Any",
          slots: m.lfg.slots || 1,
          joined: (m.lfg.joined ?? []).filter(u => u?._id).map(authorOf)
        }
      : null
  };
}

async function loadShaped(id, clientId = null) {
  const m = await ChatMessage.findById(id).populate(POPULATE).lean();
  return m && m.userId ? shapeMessage(m, clientId) : null;
}

/**
 * One page of a room's messages, oldest first. Without `before` it is the
 * newest page; with it ({ ts, id } of the oldest message the client has),
 * the page just before that one. hasMore says whether older ones exist.
 */
async function loadHistory(roomId, { limit = HISTORY_PAGE, before = null } = {}) {
  const q = { roomId };
  const beforeDate = before?.ts ? new Date(before.ts) : null;
  if (beforeDate && !Number.isNaN(beforeDate.getTime())) {
    // createdAt, then _id to break ties between messages sent in the same
    // millisecond (the order the index sorts them in).
    q.$or = [{ createdAt: { $lt: beforeDate } }];
    if (mongoose.isValidObjectId(before.id)) {
      q.$or.push({ createdAt: beforeDate, _id: { $lt: before.id } });
    }
  }

  const docs = await ChatMessage.find(q)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate(POPULATE)
    .lean();

  const hasMore = docs.length > limit;
  const messages = docs
    .slice(0, limit)
    .reverse()
    .filter(m => m.userId)
    .map(m => shapeMessage(m));
  return { messages, hasMore };
}

/* ---------------- Presence ----------------
   Who is in a game room right now: one entry per user however many tabs
   they have open, read from every pod's sockets (socket.data, set in
   socketServer.js, survives the Redis adapter). */
async function roomPeople(io, roomId) {
  let sockets = [];
  try {
    sockets = await io.in(roomId).timeout(2000).fetchSockets();
  } catch {
    return null; // a slow adapter: skip this update rather than send a wrong list
  }
  const people = new Map();
  for (const s of sockets) {
    const d = s.data ?? {};
    if (d.userId && !people.has(d.userId)) {
      people.set(d.userId, { id: d.userId, name: d.name || "Someone", avatar: d.avatar ?? null });
    }
  }
  return [...people.values()];
}

async function broadcastPresence(io, roomId) {
  const users = await roomPeople(io, roomId);
  if (users) io.to(roomId).emit("room-presence", { roomId, users });
  return users;
}

/* ---------------- User helpers ---------------- */

function getUserFromSocket(socket) {
  const user = socket.user;

  if (user && typeof user === "object") {
    return {
      id: user._id?.toString() ?? user.id ?? null,
      name:
        user.displayName ??
        user.username ??
        `User-${socket.id.slice(0, 6)}`
    };
  }

  return {
    id: null,
    name: `Anon-${socket.id.slice(0, 6)}`
  };
}

/* ---------------- Game names ----------------
   The games catalogue itself stays in Postgres; only social data moved. */
const gameIdOf = (roomId) => Number(/^game:(\d+)$/.exec(roomId)?.[1]);

function gameName(gameId) {
  return cached(`gamename:${gameId}`, 24 * 60 * 60, async () => {
    const { rows } = await getPG().query("SELECT name FROM games WHERE id = $1", [gameId]);
    return rows[0]?.name ?? null;
  }).catch(() => null);
}

/* ---------------- Friend activity ---------------- */

// One "chatting" entry per user per game room per window, however many
// messages they send, so a conversation doesn't flood friends' feeds.
const CHAT_ACTIVITY_WINDOW_MS = 6 * 60 * 60 * 1000;

async function recordChatActivity(userId, roomId) {
  const gameId = gameIdOf(roomId);
  if (!userId || !gameId) return;

  const recent = await Activity.exists({
    userId,
    type: "chat",
    gameId,
    createdAt: { $gte: new Date(Date.now() - CHAT_ACTIVITY_WINDOW_MS) }
  });
  if (recent) return;

  const name = (await gameName(gameId)) ?? "a game";

  await createActivity({
    userId,
    type: "chat",
    gameId,
    gameName: name,
    text: `is chatting in the ${name} room`,
    url: `/game/${gameId}`
  });
}

/* ---------------- Notifications ----------------
   @mentions, replies to you, and people joining your group. The model has
   no chat-specific types, so all three use "mention" (someone addressed
   you in a room); the text says which. Everyone is notified at most once
   per message. */
async function notifyForMessage({ msg, senderId, senderName, roomId, repliedToUserId }) {
  const gameId = gameIdOf(roomId);
  const room = `the ${(await gameName(gameId)) ?? "game"} room`;
  const url = `/game/${gameId}`;
  const told = new Set([String(senderId)]);

  if (repliedToUserId && !told.has(String(repliedToUserId))) {
    told.add(String(repliedToUserId));
    await createNotification({
      userId: repliedToUserId,
      type: "mention",
      actorId: senderId,
      entityId: msg._id,
      text: `${senderName} replied to you in ${room}`,
      url
    });
  }

  const names = extractMentions(msg.text).slice(0, MAX_MENTIONS);
  if (!names.length) return;
  const users = await User.find({ username: { $in: names } }, { _id: 1 }).lean();
  for (const u of users) {
    if (told.has(String(u._id))) continue;
    told.add(String(u._id));
    await createNotification({
      userId: u._id,
      type: "mention",
      actorId: senderId,
      entityId: msg._id,
      text: `${senderName} mentioned you in ${room}`,
      url
    });
  }
}

/* ---------------- Socket handlers ---------------- */

export function attachTextHandlers(io, socket) {
  const user = getUserFromSocket(socket);
  // Game rooms this socket is in, so a disconnect can update their lists.
  const joinedRooms = new Set();

  const inRoom = (roomId) => GAME_ROOM.test(roomId ?? "") && socket.rooms.has(roomId);

  // For edits, deletes, reactions and group joins: the message must be a
  // live one in a room this socket is in. Returns the lean doc or null.
  async function roomMessage(roomId, id) {
    if (!inRoom(roomId) || !mongoose.isValidObjectId(id)) return null;
    return ChatMessage.findOne({ _id: id, roomId, deletedAt: null }).lean();
  }

  async function limited(cb) {
    try {
      await actionLimiter.consume(user.id || socket.id);
      return false;
    } catch {
      cb?.({ error: "rate_limited" });
      return true;
    }
  }

  async function broadcastUpdate(roomId, id) {
    const shaped = await loadShaped(id);
    if (shaped) io.to(roomId).emit("message-updated", shaped);
    return shaped;
  }

  /* join-room: enter a game's chat. The ack carries the newest page of
     history and who's here; everyone in the room gets the new list. */
  socket.on("join-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!GAME_ROOM.test(roomId ?? "")) {
        cb?.({ error: "invalid_room" });
        return;
      }

      await socket.join(roomId);
      joinedRooms.add(roomId);

      const [{ messages, hasMore }, users] = await Promise.all([
        loadHistory(roomId),
        broadcastPresence(io, roomId)
      ]);

      cb?.({ ok: true, messages, hasMore, users: users ?? [] });
    } catch (err) {
      logger.error({ err }, "join-room error");
      cb?.({ error: "join_failed" });
    }
  });

  /* leave-room: leaving the game page. */
  socket.on("leave-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!joinedRooms.has(roomId)) {
        cb?.({ ok: true });
        return;
      }

      await socket.leave(roomId);
      joinedRooms.delete(roomId);
      socket.to(roomId).emit("room-typing", { roomId, user: { id: user.id, name: user.name }, typing: false });
      await broadcastPresence(io, roomId);

      cb?.({ ok: true });
    } catch (err) {
      logger.error({ err }, "leave-room error");
      cb?.({ error: "leave_failed" });
    }
  });

  /* send-msg: only into a game room this socket has joined. Optional:
     replyTo (id of a message in the same room) and lfg ({ platform, slots })
     to post a "looking for group" card, whose note is the text. */
  socket.on("send-msg", async (payload, cb) => {
    try {
      try {
        await socketLimiter.consume(user.id || socket.id);
      } catch {
        cb?.({ error: "rate_limited" });
        return;
      }

      const { roomId, text, clientId, replyTo = null, lfg = null } = payload || {};
      if (!roomId || !text) {
        cb?.({ error: "missing_params" });
        return;
      }
      if (!inRoom(roomId)) {
        cb?.({ error: "not_in_room" });
        return;
      }

      if (typeof text !== "string") {
        cb?.({ error: "invalid_text" });
        return;
      }

      const clean = sanitizeText(text);
      if (clean.length === 0) {
        cb?.({ error: "empty_message" });
        return;
      }

      const doc = { roomId, userId: user.id, text: clean };

      // Quoting: only a live message of this same room.
      let repliedToUserId = null;
      if (replyTo) {
        const quoted = await roomMessage(roomId, replyTo);
        if (!quoted) {
          cb?.({ error: "reply_not_found" });
          return;
        }
        repliedToUserId = quoted.userId;
        doc.replyTo = {
          id: quoted._id,
          userId: quoted.userId,
          excerpt: (quoted.kind === "lfg" ? `Looking for group: ${quoted.text}` : quoted.text).slice(0, EXCERPT_LENGTH)
        };
      }

      if (lfg) {
        const slots = Math.round(Number(lfg.slots));
        const platform = LFG_PLATFORMS.includes(lfg.platform) ? lfg.platform : "Any";
        if (!(slots >= 1 && slots <= LFG_MAX_SLOTS)) {
          cb?.({ error: "invalid_lfg" });
          return;
        }
        doc.kind = "lfg";
        doc.lfg = { platform, slots, joined: [] };
      }

      const saved = await ChatMessage.create(doc);
      const msg = await loadShaped(saved._id, clientId ?? null);
      if (!msg) {
        cb?.({ error: "send_failed" });
        return;
      }

      io.to(roomId).emit("message", msg);
      socket.to(roomId).emit("room-typing", { roomId, user: { id: user.id, name: user.name }, typing: false });
      cb?.({ ok: true, id: msg.id });

      // Side effects, not awaited, so they never slow the message down:
      // the friend feed ("X is chatting in the <game> room") and
      // notifications for mentions and replies.
      recordChatActivity(user.id, roomId)
        .catch(err => logger.warn({ err }, "chat activity failed"));
      notifyForMessage({ msg: saved, senderId: user.id, senderName: user.name, roomId, repliedToUserId })
        .catch(err => logger.warn({ err }, "chat notifications failed"));
    } catch (err) {
      logger.error({ err }, "send-msg error");
      cb?.({ error: "send_failed" });
    }
  });

  /* edit-msg: your own live message; everyone gets the new version. */
  socket.on("edit-msg", async (payload, cb) => {
    try {
      if (await limited(cb)) return;
      const { roomId, id, text } = payload || {};
      const m = await roomMessage(roomId, id);
      if (!m) return cb?.({ error: "not_found" });
      if (String(m.userId) !== String(user.id)) return cb?.({ error: "forbidden" });
      if (typeof text !== "string" || !sanitizeText(text)) return cb?.({ error: "empty_message" });

      const clean = sanitizeText(text);
      if (clean !== m.text) {
        await ChatMessage.updateOne({ _id: m._id }, { $set: { text: clean, editedAt: new Date() } });
      }
      await broadcastUpdate(roomId, m._id);
      cb?.({ ok: true });
    } catch (err) {
      logger.error({ err }, "edit-msg error");
      cb?.({ error: "edit_failed" });
    }
  });

  /* delete-msg: your own message. It stays as a "message deleted"
     placeholder (replies to it keep their place), with the text, reactions
     and group emptied. */
  socket.on("delete-msg", async (payload, cb) => {
    try {
      if (await limited(cb)) return;
      const { roomId, id } = payload || {};
      const m = await roomMessage(roomId, id);
      if (!m) return cb?.({ error: "not_found" });
      if (String(m.userId) !== String(user.id)) return cb?.({ error: "forbidden" });

      await ChatMessage.updateOne(
        { _id: m._id },
        { $set: { text: "", deletedAt: new Date() }, $unset: { reactions: "", lfg: "" } }
      );
      await broadcastUpdate(roomId, m._id);
      cb?.({ ok: true });
    } catch (err) {
      logger.error({ err }, "delete-msg error");
      cb?.({ error: "delete_failed" });
    }
  });

  /* react-msg: toggle an emoji reaction on a live message, or with
     remove: true only take yours off (clicking your own reaction chip: it
     must never add it back, even if the chip was out of date). The ack says
     whether you now have it (reacted: true/false). */
  socket.on("react-msg", async (payload, cb) => {
    try {
      if (await limited(cb)) return;
      const { roomId, id, emoji, remove = false } = payload || {};
      if (!isEmoji(emoji)) return cb?.({ error: "invalid_reaction" });
      const m = await roomMessage(roomId, id);
      if (!m) return cb?.({ error: "not_found" });

      const me = new mongoose.Types.ObjectId(user.id);
      const kinds = (m.reactions ?? []).filter(r => r.userIds?.length);
      if (!remove && kinds.length >= MAX_REACTION_KINDS && !kinds.some(r => r.emoji === emoji)) {
        return cb?.({ error: "too_many_reactions" });
      }

      // The whole toggle is one update, decided inside MongoDB from the
      // message as it is at that moment: two clicks (or two tabs) at once
      // can't both "add", and only this emoji's entry is ever touched.
      // Emptied entries are dropped; a new emoji is appended only while the
      // message has room for another kind.
      const e = { $literal: emoji };
      const updated = await ChatMessage.findOneAndUpdate(
        { _id: m._id, roomId, deletedAt: null },
        [{
          $set: {
            reactions: {
              $let: {
                vars: { rs: { $ifNull: ["$reactions", []] } },
                in: {
                  $cond: [
                    { $in: [e, "$$rs.emoji"] },
                    {
                      $filter: {
                        input: {
                          $map: {
                            input: "$$rs",
                            as: "r",
                            in: {
                              $cond: [
                                { $eq: ["$$r.emoji", e] },
                                {
                                  emoji: "$$r.emoji",
                                  userIds: {
                                    $cond: [
                                      remove ? true : { $in: [me, "$$r.userIds"] },
                                      { $setDifference: ["$$r.userIds", [me]] },
                                      { $concatArrays: ["$$r.userIds", [me]] }
                                    ]
                                  }
                                },
                                "$$r"
                              ]
                            }
                          }
                        },
                        as: "r",
                        cond: { $gt: [{ $size: "$$r.userIds" }, 0] }
                      }
                    },
                    {
                      $cond: [
                        // (removing an emoji that isn't there: no change)
                        { $and: [!remove, { $lt: [{ $size: "$$rs" }, MAX_REACTION_KINDS] }] },
                        { $concatArrays: ["$$rs", [{ emoji: e, userIds: [me] }]] },
                        "$$rs"
                      ]
                    }
                  ]
                }
              }
            }
          }
        }],
        { new: true, lean: true }
      );
      if (!updated) return cb?.({ error: "not_found" });

      const reacted = (updated.reactions ?? []).some(
        r => r.emoji === emoji && r.userIds.some(u => String(u) === String(user.id))
      );
      await broadcastUpdate(roomId, m._id);
      cb?.({ ok: true, reacted });
    } catch (err) {
      logger.error({ err }, "react-msg error");
      cb?.({ error: "react_failed" });
    }
  });

  /* lfg-join: join or leave someone's "looking for group" card. Joining is
     refused once it's full (checked inside the update, so two last-slot
     joins can't both get in). The poster is told who joined. */
  socket.on("lfg-join", async (payload, cb) => {
    try {
      if (await limited(cb)) return;
      const { roomId, id } = payload || {};
      const m = await roomMessage(roomId, id);
      if (!m || m.kind !== "lfg" || !m.lfg) return cb?.({ error: "not_found" });
      if (String(m.userId) === String(user.id)) return cb?.({ error: "own_group" });

      const me = new mongoose.Types.ObjectId(user.id);
      const isIn = (m.lfg.joined ?? []).some(u => String(u) === String(user.id));

      if (isIn) {
        await ChatMessage.updateOne({ _id: m._id }, { $pull: { "lfg.joined": me } });
      } else {
        const r = await ChatMessage.updateOne(
          {
            _id: m._id,
            deletedAt: null,
            "lfg.joined": { $ne: me },
            $expr: { $lt: [{ $size: { $ifNull: ["$lfg.joined", []] } }, "$lfg.slots"] }
          },
          { $addToSet: { "lfg.joined": me } }
        );
        if (!r.modifiedCount) {
          await broadcastUpdate(roomId, m._id);
          return cb?.({ error: "full" });
        }
        const gameId = gameIdOf(roomId);
        createNotification({
          userId: m.userId,
          type: "mention",
          actorId: user.id,
          entityId: m._id,
          text: `${user.name} joined your group in the ${(await gameName(gameId)) ?? "game"} room`,
          url: `/game/${gameId}`
        }).catch(() => {});
      }

      await broadcastUpdate(roomId, m._id);
      cb?.({ ok: true, joined: !isIn });
    } catch (err) {
      logger.error({ err }, "lfg-join error");
      cb?.({ error: "lfg_failed" });
    }
  });

  /* typing: "X is typing…" for the others in the room. Clients send true
     while typing (throttled) and false when they stop or send. */
  socket.on("typing", (payload) => {
    const { roomId, typing } = payload || {};
    if (!inRoom(roomId) || !user.id) return;
    socket.to(roomId).emit("room-typing", {
      roomId,
      user: { id: user.id, name: user.name },
      typing: Boolean(typing)
    });
  });

  /* get-history: older messages, a page at a time ("load older" in the
     chat). Members of the room only; the page comes back in the ack. */
  socket.on("get-history", async (payload, cb) => {
    try {
      const { roomId, before = null, limit = HISTORY_PAGE } = payload || {};
      if (!inRoom(roomId)) {
        cb?.({ error: "not_in_room" });
        return;
      }

      const page = await loadHistory(roomId, {
        before,
        limit: Math.min(Math.max(Number(limit) || HISTORY_PAGE, 1), HISTORY_MAX)
      });
      cb?.({ ok: true, ...page });
    } catch (err) {
      logger.error({ err }, "get-history error");
      cb?.({ error: "history_failed" });
    }
  });

  /* search-msgs: find messages in the room by their text (the chat's
     search box). Plain substring match, case-insensitive, newest first;
     deleted messages don't count. Members of the room only. */
  socket.on("search-msgs", async (payload, cb) => {
    try {
      if (await limited(cb)) return;
      const { roomId, q } = payload || {};
      if (!inRoom(roomId)) return cb?.({ error: "not_in_room" });
      const query = typeof q === "string" ? q.trim().slice(0, 80) : "";
      if (query.length < 2) return cb?.({ ok: true, results: [] });

      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const docs = await ChatMessage.find(
        { roomId, deletedAt: null, text: { $regex: escaped, $options: "i" } },
        { text: 1, userId: 1, createdAt: 1 }
      )
        .sort({ createdAt: -1 })
        .limit(SEARCH_LIMIT)
        .populate("userId", AUTHOR_FIELDS)
        .lean();

      cb?.({
        ok: true,
        results: docs.filter(m => m.userId).map(m => ({
          id: String(m._id),
          from: authorOf(m.userId),
          text: m.text.slice(0, 300),
          ts: m.createdAt.toISOString()
        }))
      });
    } catch (err) {
      logger.error({ err }, "search-msgs error");
      cb?.({ error: "search_failed" });
    }
  });

  /* disconnect: the socket has already left its rooms; tell each game room
     it was in. */
  socket.on("disconnect", () => {
    for (const roomId of joinedRooms) {
      io.to(roomId).emit("room-typing", { roomId, user: { id: user.id, name: user.name }, typing: false });
      broadcastPresence(io, roomId).catch(() => {});
    }
    joinedRooms.clear();
    logger.debug("Text socket disconnected: %s", socket.id);
  });
}
