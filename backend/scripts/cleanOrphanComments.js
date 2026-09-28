/*
 * One-off: delete review comments left behind by the old delete routes.
 *
 *   node scripts/cleanOrphanComments.js --check   # report only, write nothing
 *   node scripts/cleanOrphanComments.js           # apply
 *
 * Deleting a comment used to remove only its direct replies, so replies to
 * those replies stayed in the database with a parent that no longer exists
 * (the thread then showed them as top-level comments, and the review's
 * comment count included them). This removes:
 *   - comments whose parent comment is gone
 *   - comments whose review is gone
 *   - every reply under those, at any depth
 * plus the notifications and activity that point at them.
 *
 * Safe to re-run: it only finds what is still orphaned.
 */
import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import ReviewComment from "../models/ReviewComment.js";
import GameReview from "../models/GameReview.js";
import Notification from "../models/Notification.js";
import Activity from "../models/Activity.js";

const CHECK_ONLY = process.argv.includes("--check");

async function main() {
  await connectDB();

  const comments = await ReviewComment.find({}, { reviewId: 1, parentId: 1, body: 1 }).lean();
  const commentIds = new Set(comments.map((c) => String(c._id)));
  const reviewIds = new Set(
    (await GameReview.find({ _id: { $in: [...new Set(comments.map((c) => String(c.reviewId)))] } }, { _id: 1 }).lean())
      .map((r) => String(r._id))
  );

  // The orphans themselves...
  const doomed = new Set(
    comments
      .filter((c) => !reviewIds.has(String(c.reviewId)) || (c.parentId && !commentIds.has(String(c.parentId))))
      .map((c) => String(c._id))
  );
  // ...and everything replying to them, however deep.
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of comments) {
      if (c.parentId && doomed.has(String(c.parentId)) && !doomed.has(String(c._id))) {
        doomed.add(String(c._id));
        grew = true;
      }
    }
  }

  const ids = [...doomed].map((id) => new mongoose.Types.ObjectId(id));
  const notes = await Notification.countDocuments({ entityId: { $in: ids } });
  const acts = await Activity.countDocuments({ entityId: { $in: ids } });

  console.log(`Comments: ${comments.length} | orphaned (with their replies): ${ids.length} | their notifications: ${notes} | activity: ${acts}`);
  if (ids.length) {
    const byId = new Map(comments.map((c) => [String(c._id), c]));
    console.log("Examples:", [...doomed].slice(0, 10).map((id) => `${id} "${(byId.get(id)?.body || "").slice(0, 30)}"`));
  }

  if (CHECK_ONLY || !ids.length) return;

  const c = await ReviewComment.deleteMany({ _id: { $in: ids } });
  const n = await Notification.deleteMany({ entityId: { $in: ids } });
  const a = await Activity.deleteMany({ entityId: { $in: ids } });
  console.log(`Deleted ${c.deletedCount} comments, ${n.deletedCount} notifications, ${a.deletedCount} activity entries.`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
