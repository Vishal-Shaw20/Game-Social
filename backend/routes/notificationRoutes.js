import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

/* GET /api/notifications?limit=30&before=<ISO date>
   Newest first. `before` pages further back (cursor on createdAt, which the
   { userId, createdAt } index serves directly). Also returns the unread
   count, so the bar can show it without counting a partial list. */
router.get("/", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const query = { userId: req.user._id };
  const before = req.query.before ? new Date(req.query.before) : null;
  if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

  const [notifications, unread] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId: req.user._id, read: false })
  ]);

  // An array, as before, with the extras in headers so older clients (and
  // the bar's own code) keep working unchanged.
  res.set("X-Unread-Count", String(unread));
  res.set("X-Has-More", String(notifications.length === limit));
  res.json(notifications);
});

// Registered before /:id/read so "read-all" isn't taken as an id.
router.post("/read-all", async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, read: false },
    { $set: { read: true } }
  );
  res.json({ ok: true });
});

router.post("/:id/read", async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { $set: { read: true } }
  );

  res.json({ ok: true });
});

export default router;
