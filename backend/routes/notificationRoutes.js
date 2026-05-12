import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const notifications = await Notification.find({
    userId: req.user._id
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  res.json(notifications);
});

router.post("/:id/read", async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id, userId: req.user._id },
    { $set: { read: true } }
  );

  res.json({ ok: true });
});

export default router;
