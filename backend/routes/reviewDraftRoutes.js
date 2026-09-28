// routes/reviewDraftRoutes.js
//
// Auto-saved review drafts (models/ReviewDraft.js), for the game page's
// bottom dock. Only ever the signed-in user's own draft; never public.
//
//   GET    /api/review-drafts/:rawgId   -> the draft, or null
//   PUT    /api/review-drafts/:rawgId   -> save (upsert) it
//   DELETE /api/review-drafts/:rawgId   -> discard it (auto-save switched off)
//
// Posting or updating the review itself deletes the draft (reviewRoutes.js).

import express from "express";
import mongoose from "mongoose";
import ReviewDraft from "../models/ReviewDraft.js";
import GameReview from "../models/GameReview.js";
import { normalizeTags } from "../shared/reviewTags.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { draftLimiter } from "../middleware/rateLimiter.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(requireAuth);

const VERDICTS = ["awful_fun", "subpar", "almost_good", "perfection"];

const shape = (d) =>
  d && {
    rawgId: d.rawgId,
    reviewId: d.reviewId ? String(d.reviewId) : null,
    verdict: d.verdict ?? null,
    body: d.body ?? "",
    pros: normalizeTags(d.pros, "pros"),
    cons: normalizeTags(d.cons, "cons"),
    updatedAt: d.updatedAt,
  };

function validRawgId(req, res) {
  if (!/^\d{1,10}$/.test(req.params.rawgId)) {
    res.status(400).json({ error: "rawgId must be numeric" });
    return false;
  }
  return true;
}

router.get("/:rawgId", async (req, res) => {
  if (!validRawgId(req, res)) return;
  try {
    const d = await ReviewDraft.findOne({ userId: req.user._id, rawgId: req.params.rawgId }).lean();
    res.json(shape(d) ?? null);
  } catch (err) {
    logger.error({ err }, "get review draft failed");
    res.status(500).json({ error: "draft_load_failed" });
  }
});

router.put("/:rawgId", draftLimiter, async (req, res) => {
  if (!validRawgId(req, res)) return;
  try {
    const { verdict, body, pros, cons, reviewId } = req.body ?? {};

    // A draft of an edit must point at the user's own review of this game.
    let ownReviewId = null;
    if (reviewId) {
      if (!mongoose.isValidObjectId(reviewId)) return res.status(400).json({ error: "bad reviewId" });
      const own = await GameReview.exists({ _id: reviewId, userId: req.user._id, rawgId: req.params.rawgId });
      if (!own) return res.status(403).json({ error: "not your review" });
      ownReviewId = reviewId;
    }

    const d = await ReviewDraft.findOneAndUpdate(
      { userId: req.user._id, rawgId: req.params.rawgId },
      {
        reviewId: ownReviewId,
        verdict: VERDICTS.includes(verdict) ? verdict : null,
        body: typeof body === "string" ? body.slice(0, 5000) : "",
        pros: normalizeTags(pros, "pros"),
        cons: normalizeTags(cons, "cons"),
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.json(shape(d));
  } catch (err) {
    logger.error({ err }, "save review draft failed");
    res.status(500).json({ error: "draft_save_failed" });
  }
});

router.delete("/:rawgId", async (req, res) => {
  if (!validRawgId(req, res)) return;
  try {
    await ReviewDraft.deleteOne({ userId: req.user._id, rawgId: req.params.rawgId });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete review draft failed");
    res.status(500).json({ error: "draft_delete_failed" });
  }
});

export default router;
