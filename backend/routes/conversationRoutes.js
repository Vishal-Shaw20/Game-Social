import express from "express";
import mongoose from "mongoose";
import Conversation, { dmKeyFor } from "../models/Conversation.js";
import ChatMessage from "../models/ChatMessage.js";
import User from "../models/User.js";
import logger from "../config/logger.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { emitToUsers } from "../social/realtime.js";
import { presenceOfMany } from "../social/presence.js";

/*
 * Direct messages and group chats (MongoDB: Conversation + ChatMessage).
 *
 * Rules: you can only message friends, and only add friends to a group, so
 * a conversation can't be used to reach a stranger. Groups are capped at
 * MAX_GROUP_MEMBERS.
 *
 * Messages are sent over the socket (social/conversationHandlers.js); this
 * router covers listing, creating, history and read state.
 */

const router = express.Router();
router.use(requireAuth);

export const MAX_GROUP_MEMBERS = 10;
const PUBLIC_USER = { username: 1, displayName: 1, avatar: 1 };
const isId = (v) => mongoose.isValidObjectId(v);

export const conversationRoom = (id) => `conv:${id}`;

const memberIds = (conv) => conv.members.map((m) => String(m.userId));

/** Shape one conversation for the client, with members, unread and presence. */
async function present(conv, meId, { presence = null } = {}) {
  const ids = memberIds(conv);
  const users = await User.find({ _id: { $in: ids } }, PUBLIC_USER).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const me = conv.members.find((m) => String(m.userId) === String(meId));

  const unread = await ChatMessage.countDocuments({
    roomId: conversationRoom(conv._id),
    userId: { $ne: meId },
    createdAt: { $gt: me?.lastReadAt ?? new Date(0) }
  });

  const others = ids.filter((id) => id !== String(meId));
  return {
    _id: String(conv._id),
    type: conv.type,
    name: conv.name ?? null,
    members: ids.map((id) => ({
      ...(byId.get(id) ?? { _id: id }),
      presence: presence?.[id] ?? null
    })),
    // A DM is shown as the other person.
    other: conv.type === "dm" ? byId.get(others[0]) ?? null : null,
    lastMessage: conv.lastMessage?.text
      ? { text: conv.lastMessage.text, userId: String(conv.lastMessage.userId), at: conv.lastMessage.at }
      : null,
    lastMessageAt: conv.lastMessageAt,
    unread
  };
}

async function requireMember(id, userId) {
  if (!isId(id)) return null;
  return Conversation.findOne({ _id: id, "members.userId": userId });
}

/** GET /api/conversations — my conversations, most recent first. */
router.get("/", async (req, res) => {
  try {
    const convs = await Conversation.find({ "members.userId": req.user._id })
      .sort({ lastMessageAt: -1 })
      .limit(50)
      .lean();

    const everyone = [...new Set(convs.flatMap(memberIds))];
    const presence = await presenceOfMany(everyone);

    res.json(await Promise.all(convs.map((c) => present(c, req.user._id, { presence }))));
  } catch (err) {
    logger.error({ err }, "list conversations failed");
    res.status(500).json([]);
  }
});

/** POST /api/conversations/dm/:userId — open (or create) a DM with a friend. */
router.post("/dm/:userId", writeLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isId(userId) || req.user._id.equals(userId)) {
      return res.status(400).json({ error: "Invalid user" });
    }
    if (!(req.user.friends ?? []).some((f) => f.equals(userId))) {
      return res.status(403).json({ error: "You can only message friends" });
    }

    const dmKey = dmKeyFor(req.user._id, userId);
    // Upsert: whoever opens it first creates it, and the unique dmKey means
    // two simultaneous opens still end up with one conversation.
    const conv = await Conversation.findOneAndUpdate(
      { dmKey },
      {
        $setOnInsert: {
          type: "dm",
          dmKey,
          createdBy: req.user._id,
          members: [{ userId: req.user._id }, { userId }],
          lastMessageAt: new Date()
        }
      },
      { new: true, upsert: true }
    ).lean();

    emitToUsers(memberIds(conv), "conversation-changed", { conversationId: String(conv._id) });
    res.json(await present(conv, req.user._id));
  } catch (err) {
    logger.error({ err }, "open dm failed");
    res.status(500).json({ error: "Failed to open conversation" });
  }
});

/** POST /api/conversations/group { name, memberIds } — new group chat. */
router.post("/group", writeLimiter, async (req, res) => {
  try {
    const { name, memberIds: ids } = req.body ?? {};
    const wanted = [...new Set((ids ?? []).map(String))].filter(isId);

    if (wanted.length === 0) return res.status(400).json({ error: "Pick at least one friend" });
    if (wanted.length + 1 > MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Groups are limited to ${MAX_GROUP_MEMBERS} people` });
    }
    const friends = new Set((req.user.friends ?? []).map(String));
    if (wanted.some((id) => !friends.has(id))) {
      return res.status(403).json({ error: "You can only add friends" });
    }

    const conv = await Conversation.create({
      type: "group",
      name: (name ?? "").trim().slice(0, 60) || null,
      createdBy: req.user._id,
      members: [{ userId: req.user._id }, ...wanted.map((userId) => ({ userId }))],
      lastMessageAt: new Date()
    });

    const lean = conv.toObject();
    emitToUsers(memberIds(lean), "conversation-changed", { conversationId: String(conv._id) });
    res.json(await present(lean, req.user._id));
  } catch (err) {
    logger.error({ err }, "create group failed");
    res.status(500).json({ error: "Failed to create group" });
  }
});

/** PATCH /api/conversations/:id { name } — rename a group. */
router.patch("/:id", writeLimiter, async (req, res) => {
  try {
    const conv = await requireMember(req.params.id, req.user._id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (conv.type !== "group") return res.status(400).json({ error: "Only groups can be renamed" });

    conv.name = String(req.body?.name ?? "").trim().slice(0, 60) || null;
    await conv.save();

    emitToUsers(memberIds(conv), "conversation-changed", { conversationId: String(conv._id) });
    res.json(await present(conv.toObject(), req.user._id));
  } catch (err) {
    logger.error({ err }, "rename group failed");
    res.status(500).json({ error: "Failed to rename group" });
  }
});

/** POST /api/conversations/:id/members { memberIds } — add friends to a group. */
router.post("/:id/members", writeLimiter, async (req, res) => {
  try {
    const conv = await requireMember(req.params.id, req.user._id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (conv.type !== "group") return res.status(400).json({ error: "Not a group" });

    const friends = new Set((req.user.friends ?? []).map(String));
    const existing = new Set(memberIds(conv));
    const toAdd = [...new Set((req.body?.memberIds ?? []).map(String))]
      .filter((id) => isId(id) && !existing.has(id));

    if (toAdd.some((id) => !friends.has(id))) {
      return res.status(403).json({ error: "You can only add friends" });
    }
    if (existing.size + toAdd.length > MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Groups are limited to ${MAX_GROUP_MEMBERS} people` });
    }

    conv.members.push(...toAdd.map((userId) => ({ userId })));
    await conv.save();

    emitToUsers(memberIds(conv), "conversation-changed", { conversationId: String(conv._id) });
    res.json(await present(conv.toObject(), req.user._id));
  } catch (err) {
    logger.error({ err }, "add members failed");
    res.status(500).json({ error: "Failed to add members" });
  }
});

/**
 * DELETE /api/conversations/:id/members/:userId
 * Leave a group yourself, or (as its creator) remove someone.
 */
router.delete("/:id/members/:userId", writeLimiter, async (req, res) => {
  try {
    const conv = await requireMember(req.params.id, req.user._id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (conv.type !== "group") return res.status(400).json({ error: "Not a group" });

    const target = req.params.userId;
    const isSelf = req.user._id.equals(target);
    if (!isSelf && !conv.createdBy?.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the group's creator can remove members" });
    }

    const before = memberIds(conv);
    conv.members = conv.members.filter((m) => String(m.userId) !== String(target));
    // An empty group serves no one.
    if (conv.members.length === 0) await Conversation.deleteOne({ _id: conv._id });
    else await conv.save();

    emitToUsers(before, "conversation-changed", { conversationId: String(conv._id) });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "leave group failed");
    res.status(500).json({ error: "Failed to update members" });
  }
});

/**
 * GET /api/conversations/:id/messages?before=<ISO>&limit=50
 * Oldest-first page of history; `before` walks further back.
 */
router.get("/:id/messages", async (req, res) => {
  try {
    const conv = await requireMember(req.params.id, req.user._id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const query = { roomId: conversationRoom(conv._id) };
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    const docs = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("userId", PUBLIC_USER)
      .lean();

    res.set("X-Has-More", String(docs.length === limit));
    res.json(
      docs
        .reverse()
        .filter((m) => m.userId)
        .map((m) => ({
          id: String(m._id),
          from: { id: String(m.userId._id), name: m.userId.displayName || m.userId.username, avatar: m.userId.avatar ?? null },
          text: m.text,
          ts: m.createdAt
        }))
    );
  } catch (err) {
    logger.error({ err }, "conversation history failed");
    res.status(500).json([]);
  }
});

/** POST /api/conversations/:id/read — everything up to now has been seen. */
router.post("/:id/read", async (req, res) => {
  try {
    const now = new Date();
    const result = await Conversation.updateOne(
      { _id: req.params.id, "members.userId": req.user._id },
      { $set: { "members.$.lastReadAt": now } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Conversation not found" });

    // Other tabs of mine clear the badge too.
    emitToUsers([req.user._id], "conversation-read", {
      conversationId: String(req.params.id),
      at: now
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "mark conversation read failed");
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

export default router;
