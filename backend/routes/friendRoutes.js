import express from "express";
import { activeStatus } from "../utils/profileExtras.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import Activity from "../models/Activity.js";
import FriendRequest from "../models/FriendRequest.js";
import Notification from "../models/Notification.js";
import { createNotification } from "../utils/createNotification.js";
import { createActivity } from "../utils/createActivity.js";
import { emitToUsers } from "../social/realtime.js";
import { presenceOfMany } from "../social/presence.js";
import logger from "../config/logger.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";

/*
 * Friends are mutual and need consent: one user sends a request, the other
 * accepts or declines it. (It used to be an instant, one-sided add.)
 *
 * Every change pushes "friends-changed" to both users over the socket, so
 * open Social pages refresh their friends and request lists straight away.
 */

const router = express.Router();

router.use(requireAuth);

const PUBLIC_USER = { username: 1, displayName: 1, avatar: 1, profilePicture: 1, customStatus: 1 };
const isId = (v) => mongoose.isValidObjectId(v);

const nameOf = (u) => u.displayName || u.username || "Someone";

function friendsChanged(...userIds) {
  emitToUsers(userIds, "friends-changed", {});
}

/** Make two users friends (both sides, idempotent). */
async function befriend(aId, bId) {
  await User.updateOne({ _id: aId }, { $addToSet: { friends: bId } });
  await User.updateOne({ _id: bId }, { $addToSet: { friends: aId } });
}

/**
 * GET /api/friends
 * The signed-in user's friends.
 */
router.get("/", async (req, res) => {
  try {
    const friendIds = req.user.friends || [];
    if (friendIds.length === 0) return res.json([]);

    const friends = await User.find({ _id: { $in: friendIds } }, PUBLIC_USER).lean();

    // Each friend's status (online / idle / offline) and current game, so the
    // list renders complete; later changes arrive as "presence" events.
    const presence = await presenceOfMany(friendIds);
    res.json(friends.map(f => ({
      ...f,
      avatar: f.avatar || f.profilePicture || null,
      customStatus: activeStatus(f.customStatus),
      presence: presence[String(f._id)] ?? null,
    })));
  } catch (e) {
    logger.error({ err: e }, "fetch friends failed");
    res.status(500).json([]);
  }
});

/**
 * GET /api/friends/requests
 * { incoming: [{ _id, from, createdAt }], outgoing: [{ _id, to, createdAt }] }
 */
router.get("/requests", async (req, res) => {
  try {
    const me = req.user._id;
    const [incoming, outgoing] = await Promise.all([
      FriendRequest.find({ to: me }).sort({ createdAt: -1 }).populate("from", PUBLIC_USER).lean(),
      FriendRequest.find({ from: me }).sort({ createdAt: -1 }).populate("to", PUBLIC_USER).lean()
    ]);
    res.json({
      incoming: incoming.filter((r) => r.from),
      outgoing: outgoing.filter((r) => r.to)
    });
  } catch (e) {
    logger.error({ err: e }, "fetch friend requests failed");
    res.status(500).json({ incoming: [], outgoing: [] });
  }
});

/**
 * POST /api/friends/request/:userId
 * Send a friend request. If that user already sent me one, this accepts it
 * instead (both want it, so there's nothing left to ask).
 */
async function sendRequest(req, res) {
  try {
    const { userId } = req.params;
    const me = req.user;

    if (!isId(userId)) return res.status(400).json({ error: "Invalid user" });
    if (me._id.equals(userId)) return res.status(400).json({ error: "Cannot add yourself" });

    const other = await User.findById(userId, PUBLIC_USER).lean();
    if (!other) return res.status(404).json({ error: "User not found" });

    if ((me.friends || []).some((f) => f.equals(userId))) {
      return res.json({ ok: true, status: "friends" });
    }

    const reverse = await FriendRequest.findOneAndDelete({ from: userId, to: me._id });
    if (reverse) {
      await acceptRequest(reverse.from, me);
      return res.json({ ok: true, status: "friends" });
    }

    let request;
    try {
      request = await FriendRequest.create({ from: me._id, to: userId });
    } catch (err) {
      if (err.code === 11000) return res.json({ ok: true, status: "outgoing" });
      throw err;
    }

    await createNotification({
      userId: other._id,
      actorId: me._id,
      type: "friend_request",
      entityId: request._id,
      text: `${nameOf(me)} sent you a friend request`,
      url: "/social"
    });
    friendsChanged(me._id, other._id);

    res.json({ ok: true, status: "outgoing", requestId: request._id });
  } catch (err) {
    logger.error({ err }, "send friend request failed");
    res.status(500).json({ error: "Failed to send friend request" });
  }
}

router.post("/request/:userId", writeLimiter, sendRequest);

// Old endpoint (instant add). Kept so an older frontend still works, but it
// now only sends a request: nobody becomes friends without accepting.
router.post("/add/:userId", writeLimiter, sendRequest);

/** Shared accept: friendship, notification, activity, live refresh. */
async function acceptRequest(fromId, accepter) {
  await befriend(fromId, accepter._id);

  // The request's notification has been dealt with.
  await Notification.updateMany(
    { userId: accepter._id, actorId: fromId, type: "friend_request", read: false },
    { $set: { read: true } }
  );

  const from = await User.findById(fromId, PUBLIC_USER).lean();

  await createNotification({
    userId: fromId,
    actorId: accepter._id,
    type: "friend_accept",
    entityId: accepter._id,
    text: `${nameOf(accepter)} accepted your friend request`,
    url: `/u/${accepter.username}`
  });

  // One entry per side, so each person's friends see the new friendship.
  await createActivity({
    userId: accepter._id,
    type: "friend",
    entityId: fromId,
    text: `is now friends with ${from ? nameOf(from) : "someone"}`,
    url: from?.username ? `/u/${from.username}` : undefined
  });
  await createActivity({
    userId: fromId,
    type: "friend",
    entityId: accepter._id,
    text: `is now friends with ${nameOf(accepter)}`,
    url: `/u/${accepter.username}`
  });

  friendsChanged(fromId, accepter._id);
}

/**
 * POST /api/friends/requests/:id/accept   (recipient only)
 */
router.post("/requests/:id/accept", writeLimiter, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: "Invalid request" });
    const request = await FriendRequest.findOneAndDelete({ _id: req.params.id, to: req.user._id });
    if (!request) return res.status(404).json({ error: "Request not found" });

    await acceptRequest(request.from, req.user);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "accept friend request failed");
    res.status(500).json({ error: "Failed to accept request" });
  }
});

/**
 * POST /api/friends/requests/:id/decline   (recipient only)
 * The sender isn't notified; the request just disappears from their list.
 */
router.post("/requests/:id/decline", writeLimiter, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: "Invalid request" });
    const request = await FriendRequest.findOneAndDelete({ _id: req.params.id, to: req.user._id });
    if (!request) return res.status(404).json({ error: "Request not found" });

    await Notification.updateMany(
      { userId: req.user._id, actorId: request.from, type: "friend_request", read: false },
      { $set: { read: true } }
    );
    friendsChanged(request.from, req.user._id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "decline friend request failed");
    res.status(500).json({ error: "Failed to decline request" });
  }
});

/**
 * DELETE /api/friends/requests/:id   (sender only: cancel)
 */
router.delete("/requests/:id", writeLimiter, async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: "Invalid request" });
    const request = await FriendRequest.findOneAndDelete({ _id: req.params.id, from: req.user._id });
    if (!request) return res.status(404).json({ error: "Request not found" });

    // Take back the unread "sent you a request" notification too.
    await Notification.deleteMany({
      userId: request.to, actorId: req.user._id, type: "friend_request", read: false
    });
    friendsChanged(request.to, req.user._id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "cancel friend request failed");
    res.status(500).json({ error: "Failed to cancel request" });
  }
});

/**
 * GET /api/friends/activity
 * Latest 30 things my friends did (reviews, comments, likes, new friends,
 * library additions, games played, chat). New ones also arrive live as
 * "activity" socket events.
 */
router.get("/activity", async (req, res) => {
  try {
    const friendIds = req.user.friends || [];
    if (friendIds.length === 0) return res.json([]);

    const activity = await Activity.find({ userId: { $in: friendIds } })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("userId", PUBLIC_USER)
      .lean();

    res.json(activity);
  } catch (e) {
    logger.error({ err: e }, "friends activity failed");
    res.status(500).json([]);
  }
});

/**
 * DELETE /api/friends/remove/:userId
 * Unfriend (both sides). The other user isn't notified.
 */
router.delete("/remove/:userId", writeLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isId(userId)) return res.status(400).json({ error: "Invalid user" });

    if (req.user._id.equals(userId)) {
      return res.status(400).json({ error: "Cannot remove yourself" });
    }

    const other = await User.exists({ _id: userId });
    if (!other) return res.status(404).json({ error: "User not found" });

    await User.updateOne({ _id: req.user._id }, { $pull: { friends: userId } });
    await User.updateOne({ _id: userId }, { $pull: { friends: req.user._id } });

    friendsChanged(req.user._id, userId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "remove friend failed");
    res.status(500).json({ error: "Failed to remove friend" });
  }
});

export default router;
