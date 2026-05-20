import express from "express";
import User from "../models/User.js";
import Activity from "../models/Activity.js";
import { createNotification } from "../utils/createNotification.js";
import logger from "../config/logger.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/friends
 * Uses req.user.friends from session
 */
router.get("/", async (req, res) => {
  try {
    const friendIds = req.user.friends || [];

    if (friendIds.length === 0) {
      return res.json([]);
    }

    const friends = await User.find(
      { _id: { $in: friendIds } },
      { username: 1, displayName: 1, avatar: 1 }
    ).lean();

    res.json(friends);
  } catch (e) {
    logger.error({ err: e }, "fetch friends failed");
    res.status(500).json([]);
  }
});

router.post("/add/:userId", writeLimiter, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user._id.equals(userId)) {
      return res.status(400).json({ error: "Cannot add yourself" });
    }

    const me = await User.findById(req.user._id);
    const other = await User.findById(userId);

    if (!other) {
      return res.status(404).json({ error: "User not found" });
    }

    if (me.friends.includes(userId)) {
      return res.json({ ok: true });
    }

    me.friends.push(userId);
    other.friends.push(me._id);

    await me.save();
    await other.save();

    // 🔔 NOTIFICATION: added as friend
    await createNotification({
      userId: other._id,               // who receives it
      actorId: me._id,                 // who did it
      type: "friend_add",
      entityId: me._id,
      text: `${me.displayName} added you as a friend`,
      url: `/u/${me.username}`
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "add friend failed");
    res.status(500).json({ error: "Failed to add friend" });
  }
});


router.get("/activity", async (req, res) => {
  try {
    const friendIds = req.user.friends || [];
    if (friendIds.length === 0) return res.json([]);

    const activity = await Activity.find({
      userId: { $in: friendIds }   // actor is friend
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("userId", "username displayName avatar")
      .lean();

    res.json(activity);
  } catch (e) {
    logger.error({ err: e }, "friends activity failed");
    res.status(500).json([]);
  }
});




router.delete("/remove/:userId", writeLimiter, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user._id.equals(userId)) {
      return res.status(400).json({ error: "Cannot remove yourself" });
    }

    const me = await User.findById(req.user._id);
    const other = await User.findById(userId);

    if (!other) return res.status(404).json({ error: "User not found" });

    me.friends.pull(userId);
    other.friends.pull(me._id);
    await me.save();
    await other.save();

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "remove friend failed");
    res.status(500).json({ error: "Failed to remove friend" });
  }
});



export default router;
