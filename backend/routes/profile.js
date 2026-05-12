import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import User from "../models/User.js";
import { USERNAME_REGEX, MAX_DISPLAY_NAME_LENGTH } from "../utils/validation.js";

const router = express.Router();

router.patch("/", requireAuth, async (req, res) => {
  try {
    const { displayName, username } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (username !== undefined) {
      if (!USERNAME_REGEX.test(username)) {
        return res.status(400).json({
          error: "Username must be 3-20 characters, letters, numbers, underscores, and hyphens only"
        });
      }

      const existing = await User.findOne({
        username,
        _id: { $ne: req.user._id }
      });
      if (existing) {
        return res.status(409).json({ error: "Username already taken" });
      }

      user.username = username;
    }

    if (displayName !== undefined) {
      const trimmed = displayName.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
        return res.status(400).json({
          error: `Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters`
        });
      }
      user.displayName = trimmed;
    }

    await user.save();

    res.json({
      id: user._id,
      displayName: user.displayName,
      username: user.username,
      email: user.email,
      linkedAccounts: user.linkedAccounts
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Username already taken" });
    }
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
