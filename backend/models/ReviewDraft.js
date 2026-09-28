import mongoose from "mongoose";

/*
 * An auto-saved, unpublished review: what the user has typed in the game
 * page's review composer while "Auto-save" is on. Private to its author;
 * nothing that lists or counts reviews reads this collection. One per user
 * per game. reviewId is set when the draft is an edit of a published review.
 * Deleted when the review is posted, when auto-save is switched off, and by
 * TTL after 90 days without a save.
 */
const ReviewDraftSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rawgId: { type: String, required: true },
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: "GameReview", default: null },
    verdict: {
      type: String,
      enum: ["awful_fun", "subpar", "almost_good", "perfection", null],
      default: null,
    },
    body: { type: String, maxLength: 5000, default: "" },
    pros: [{ type: String, maxLength: 120 }],
    cons: [{ type: String, maxLength: 120 }],
  },
  { timestamps: true }
);

ReviewDraftSchema.index({ userId: 1, rawgId: 1 }, { unique: true });
ReviewDraftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("ReviewDraft", ReviewDraftSchema);
