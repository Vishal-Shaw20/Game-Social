import express from "express";
import mongoose from "mongoose";
import GameReview from "../models/GameReview.js";
import Notification from "../models/Notification.js";
import Activity from "../models/Activity.js";
import ReviewDraft from "../models/ReviewDraft.js";
import { rawgToSteamAppId } from "../utils/rawgToSteam.js";
import { getPlaytime } from "../utils/getPlaytime.js";
import ReviewComment from "../models/ReviewComment.js";
import { normalizeTags } from "../shared/reviewTags.js";
import User from "../models/User.js";
import { createNotification } from "../utils/createNotification.js";
import { extractMentions } from "../utils/parseMentions.js";
import { deleteNotification } from "../utils/deleteNotification.js";
import { createActivity } from "../utils/createActivity.js";
import { deleteActivity } from "../utils/deleteActivity.js";
import logger from "../config/logger.js";
import { getPG } from "../config/db.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";


const router = express.Router();

// What a review or comment shows about its author. Never the whole
// linkedAccounts entries: those hold each provider's access/refresh tokens.
const REVIEW_AUTHOR = "displayName username profilePicture linkedAccounts.provider linkedAccounts.avatar";

/*
 * Deletes comments together with every reply under them, at any depth, plus
 * the notifications and activity pointing at any of them. `filter` picks the
 * starting comments (one comment, or a whole review's thread).
 *
 * Replies only know their parent, so the tree is walked level by level. It
 * repeats until a pass finds nothing new, which also catches a reply posted
 * to a comment while it was being deleted.
 */
async function deleteCommentTree(filter) {
  let frontier = (await ReviewComment.find(filter, { _id: 1 }).lean()).map((c) => c._id);
  const all = [];
  const seen = new Set();
  while (frontier.length) {
    const fresh = frontier.filter((id) => !seen.has(String(id)));
    if (!fresh.length) break;
    fresh.forEach((id) => seen.add(String(id)));
    all.push(...fresh);
    await ReviewComment.deleteMany({ _id: { $in: fresh } });
    frontier = (await ReviewComment.find({ parentId: { $in: fresh } }, { _id: 1 }).lean()).map((c) => c._id);
  }
  if (all.length) {
    // Mentions and likes leave one notification each: all of them go.
    await Notification.deleteMany({ entityId: { $in: all } });
    await Activity.deleteMany({ entityId: { $in: all } }).catch((err) =>
      logger.error({ err }, "delete comment activity failed")
    );
  }
  return all.length;
}

router.get("/user/:username", async (req, res) => {
  try {
    const user = await User.findOne(
      { usernameLower: req.params.username.toLowerCase() },
      { _id: 1, displayName: 1 }
    );

    if (!user) {
      return res.status(404).json([]);
    }

    const reviews = await GameReview.find({
      userId: user._id,
      visibility: "public"
    })
      .sort({ createdAt: -1 })
      .lean();

    // each review's game (name and art), for the public profile's list
    const ids = [...new Set(reviews.map((r) => Number(r.rawgId)).filter(Number.isFinite))];
    const games = new Map();
    const pg = getPG();
    if (pg && ids.length) {
      const { rows } = await pg
        .query("SELECT id, name, background_image FROM games WHERE id = ANY($1)", [ids])
        .catch(() => ({ rows: [] }));
      for (const g of rows) games.set(String(g.id), { name: g.name, cover: g.background_image || null });
    }
    res.json(reviews.map((r) => ({ ...r, game: games.get(String(r.rawgId)) ?? null })));
  } catch (e) {
    logger.error({ err: e }, "get user reviews failed");
    res.status(500).json([]);
  }
});

/* ===========================
   CREATE / UPDATE REVIEW
=========================== */

/* ===========================
   GET REVIEWS FOR GAME
=========================== */
router.get("/game/:rawgId", async (req, res) => {

  try {
    const reviews = await GameReview.find({
      rawgId: req.params.rawgId,
      visibility: "public"
    })
      .populate({ path: "userId", model: User, select: REVIEW_AUTHOR }) // GameReview.userId has no ref
      .sort({ createdAt: -1 })
      .lean();

    // How many comments each review has (the game page shows the count on a
    // collapsed thread).
    const counts = await ReviewComment.aggregate([
      { $match: { reviewId: { $in: reviews.map((r) => r._id) } } },
      { $group: { _id: "$reviewId", n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    for (const r of reviews) r.commentCount = byId.get(String(r._id)) ?? 0;

    res.json(reviews);
  } catch (e) {
    logger.error({ err: e }, "get reviews failed");
    res.status(500).json([]);
  }
});
// UPDATE REVIEW
router.put("/:id", requireAuth, writeLimiter, async (req, res) => {
  try {
    const review = await GameReview.findById(req.params.id);
    if (!review) return res.status(404).json({});

    if (String(review.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    const {
      verdict,
      title,
      body,
      pros,
      cons,
      completed
    } = req.body;

    review.verdict = verdict;
    review.title = title;
    review.body = body;
    review.pros = normalizeTags(pros, "pros");
    review.cons = normalizeTags(cons, "cons");
    review.completed = completed;
    review.edited = true;

    await review.save();
    await ReviewDraft.deleteOne({ userId: req.user._id, rawgId: review.rawgId }).catch(() => {});

    res.json(review);
  } catch (e) {
    logger.error({ err: e }, "update review failed");
    res.status(500).json({});
  }
});

/* ===========================
   LIKE REVIEW
=========================== */


router.post("/:id/unlike", requireAuth, writeLimiter, async (req, res) => {

  try {
    // Remove like
    const review = await GameReview.findByIdAndUpdate(
      req.params.id,
      { $pull: { likes: req.user._id } },
      { new: true, lean: true }
    );

    if (review && String(review.userId) !== String(req.user._id)) {

      // 🔔 DELETE notification
      await deleteNotification({
        userId: review.userId,
        type: "review_like",
        actorId: req.user._id,
        entityId: review._id
      });

      // The matching entry from the like above: the actor owns it, and its
      // type is "like". This used to pass the review's owner and a type that
      // is never written, so the entry stayed in friends' feeds forever.
      await deleteActivity({
        userId: req.user._id,
        type: "like",
        entityId: review._id
      });
    }

    res.json({ ok: true });

  } catch (e) {
    logger.error({ err: e }, "unlike review failed");
    res.status(500).json({ ok: false });
  }
});



router.get("/:reviewId/comments", async (req, res) => {
  try {
    const comments = await ReviewComment.find({
      reviewId: req.params.reviewId
    })
      .populate("userId", REVIEW_AUTHOR)
      .sort({ createdAt: 1 })
      .lean();

    res.json(comments);
  } catch (e) {
    logger.error({ err: e }, "get comments failed");
    res.status(500).json([]);
  }
});

router.post("/:reviewId/comments", requireAuth, writeLimiter, async (req, res) => {


  try {
    const { body, parentId } = req.body;

    if (!body?.trim()) {
      logger.warn("post comment: empty body");
      return res.status(400).json({ error: "empty_body" });
    }

    // Only on a review that exists, and a reply only to a comment of that
    // same review: otherwise the comment would be an orphan from the start.
    if (!mongoose.isValidObjectId(req.params.reviewId) || !(await GameReview.exists({ _id: req.params.reviewId }))) {
      return res.status(404).json({ error: "review_not_found" });
    }
    if (parentId) {
      const parentOk =
        mongoose.isValidObjectId(parentId) &&
        (await ReviewComment.exists({ _id: parentId, reviewId: req.params.reviewId }));
      if (!parentOk) return res.status(404).json({ error: "parent_not_found" });
    }


    const comment = await ReviewComment.create({
      reviewId: req.params.reviewId,
      userId: req.user._id,
      parentId: parentId || null,
      body
    });


    await comment.populate("userId", REVIEW_AUTHOR);
// 🔔 Mentions in comment
const mentions = extractMentions(body);

if (mentions.length) {
  const users = await User.find({
    username: { $in: mentions }
  }).select("_id");

  for (const u of users) {
    if (String(u._id) === String(req.user._id)) continue;

    await createNotification({
      userId: u._id,
      type: "mention",
      actorId: req.user._id,
      entityId: comment._id,
      text: `${req.user.displayName} mentioned you in a comment`,
      url: `/reviews/${req.params.reviewId}`
    });
  }
}

    // One activity entry per comment, mentions or not.
    await createActivity({
      userId: req.user._id,
      type: "comment",
      entityId: comment._id,
      text: "commented on a review",
      url: `/reviews/${req.params.reviewId}`
    });

  
    res.json(comment);
  } catch (e) {
    logger.error({ err: e }, "post comment failed");
    res.status(500).json({ error: "comment_create_failed" });
  } 
});

router.post("/comments/:id/like", requireAuth, writeLimiter, async (req, res) => {
  // Toggle inside MongoDB with an update pipeline: one round trip, and two
  // taps at once can't lose a like the way read-modify-write could.
  const before = await ReviewComment.findById(req.params.id).lean();
  if (!before) return res.status(404).json({});

  const liked = before.likes.some(id => String(id) === String(req.user._id));

  const comment = await ReviewComment.findByIdAndUpdate(
    req.params.id,
    [{
      $set: {
        likes: {
          $cond: [
            { $in: [req.user._id, "$likes"] },
            { $setDifference: ["$likes", [req.user._id]] },
            { $concatArrays: ["$likes", [req.user._id]] }
          ]
        }
      }
    }],
    { new: true }
  );
  if (!comment) return res.status(404).json({});

  // 🔔 DELETE notification on UNLIKE (ADD HERE)
  if (
    liked && // this request is UNLIKE
    String(comment.userId) !== String(req.user._id)
  ) {
    await deleteNotification({
      userId: comment.userId,
      type: "comment_like",
      actorId: req.user._id,
      entityId: comment._id
    });
  }

  // 🔔 CREATE notification on LIKE (if you added it earlier)
  if (
    !liked && // this request is LIKE
    String(comment.userId) !== String(req.user._id)
  ) {
    await createNotification({
      userId: comment.userId,
      type: "comment_like",
      actorId: req.user._id,
      entityId: comment._id,
      text: `${req.user.displayName} liked your comment`,
      url: `/reviews/${comment.reviewId}`
    });
  }

  res.json({
    liked: !liked,
    count: comment.likes.length
  });
});

// UPDATE COMMENT
router.put("/comments/:id", requireAuth, writeLimiter, async (req, res) => {
  try {
    const comment = await ReviewComment.findById(req.params.id);
    if (!comment) return res.status(404).json({});

    if (String(comment.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({});

    comment.body = body;
    comment.edited = true;

    await comment.save();
    await comment.populate("userId", REVIEW_AUTHOR);

    res.json(comment);
  } catch (e) {
    logger.error({ err: e }, "update comment failed");
    res.status(500).json({});
  }
});

// DELETE COMMENT (with replies)
router.delete("/comments/:id", requireAuth, writeLimiter, async (req, res) => {
  try {
    const comment = await ReviewComment.findById(req.params.id);
    if (!comment) return res.status(404).json({});

    if (String(comment.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    // The comment and all replies under it (not just the direct ones:
    // replies to replies used to be left behind, parentless).
    const deleted = await deleteCommentTree({ _id: comment._id });

    res.json({ ok: true, deleted });
  } catch (e) {
    logger.error({ err: e }, "delete comment failed");
    res.status(500).json({});
  }
});


router.post("/:rawgId", requireAuth, writeLimiter, async (req, res) => {
  try {
    const {
      verdict,
      title,
      body,
      pros,
      cons,
      completed
    } = req.body;

    if (!verdict) {
      logger.warn("post review: missing verdict");
      return res.status(400).json({ error: "verdict required" });
    }


    const steamAppId = await rawgToSteamAppId(req.params.rawgId);

    const playtime = steamAppId
      ? await getPlaytime(req.user._id, steamAppId)
      : null;


    // One review per user per game (also a unique index): posting again is
    // refused, not merged; changes go through PUT /:id.
    const existing = await GameReview.findOne(
      { userId: req.user._id, rawgId: req.params.rawgId },
      { _id: 1 }
    ).lean();
    if (existing) {
      return res.status(409).json({ error: "You've already reviewed this game.", reviewId: existing._id });
    }

    let review;
    try {
      review = await GameReview.create({
        userId: req.user._id,
        rawgId: req.params.rawgId,
        verdict,
        title,
        body,
        pros: normalizeTags(pros, "pros"),
        cons: normalizeTags(cons, "cons"),
        completed,
        steamAppId,
        playtimeHours: playtime,
        visibility: "public"
      });
    } catch (err) {
      // Two posts racing: the unique index lets only one through.
      if (err?.code === 11000) {
        return res.status(409).json({ error: "You've already reviewed this game." });
      }
      throw err;
    }

// Posted: the auto-saved draft (if any) has done its job.
await ReviewDraft.deleteOne({ userId: req.user._id, rawgId: req.params.rawgId }).catch(() => {});


// 🔔 Mentions in review title/body
const mentions = extractMentions(`${title || ""} ${body || ""}`);

if (mentions.length) {
  const users = await User.find({
    username: { $in: mentions }
  }).select("_id");

  for (const u of users) {
    if (String(u._id) === String(req.user._id)) continue;

    await createNotification({
      userId: u._id,
      type: "mention",
      actorId: req.user._id,
      entityId: review._id,
      text: `${req.user.displayName} mentioned you in a review`,
      url: `/game/${req.params.rawgId}`
    });
  }
}

    // One activity entry per review, mentions or not.
    await createActivity({
      userId: req.user._id,
      type: "review",
      entityId: review._id,
      text: "reviewed a game",
      url: `/game/${req.params.rawgId}`
    });

    res.json(review);
  } catch (e) {
    logger.error({ err: e }, "post review failed");
    res.status(500).json({ error: "review_save_failed" });
  }
});
router.post("/:id/like", requireAuth, writeLimiter, async (req, res) => {

  try {
    // $addToSet makes a repeat like a no-op, and { new: true } returns the
    // updated review in the same round trip.
    const review = await GameReview.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { likes: req.user._id } },
      { new: true, lean: true }
    );

if (
  review &&
  String(review.userId) !== String(req.user._id)
) {
  await createNotification({
    userId: review.userId,
    type: "review_like",
    actorId: req.user._id,
    entityId: review._id,
    text: `${req.user.displayName} liked your review`,
    url: `/game/${review.rawgId}`
  });
  await createActivity({
    userId: req.user._id,
    type: "like",
    entityId: review._id,
    // The feed already shows who did it, so the text starts with the verb.
    text: "liked a review",
    url: `/game/${review.rawgId}`
  });

}


    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "like review failed");
    res.status(500).json({ ok: false });
  }
});

// DELETE REVIEW
router.delete("/:id", requireAuth, writeLimiter, async (req, res) => {
  try {
    const review = await GameReview.findById(req.params.id);
    if (!review) return res.status(404).json({});

    if (String(review.userId) !== String(req.user._id)) {
      return res.status(403).json({});
    }

    // The review goes first, so a comment posted meanwhile is refused (the
    // comment route checks the review exists) instead of outliving it.
    await review.deleteOne();

    // 🧹 Its whole comment thread, with those comments' notifications/activity
    await deleteCommentTree({ reviewId: review._id });

    // 🧹 Notifications and activities about the review itself (all of them)
    await Notification.deleteMany({ entityId: review._id });
    await deleteActivity({ entityId: review._id });

    // 🧹 An auto-saved edit of this review has nothing left to edit
    await ReviewDraft.deleteOne({ userId: req.user._id, reviewId: review._id });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, "delete review failed");
    res.status(500).json({});
  }
});

export default router;
