import mongoose from "mongoose";

const ReviewCommentSchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameReview",
      required: true,
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",              // ✅ CORRECT PLACE
      required: true,
      index: true
    },

    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },

    body: {
      type: String,
      required: true,
      maxLength: 2000
    },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    edited: { type: Boolean, default: false }
  },
  { timestamps: true }
);

ReviewCommentSchema.index({ reviewId: 1, parentId: 1 });
// A review's comment thread, oldest first.
ReviewCommentSchema.index({ reviewId: 1, createdAt: 1 });

export default mongoose.model("ReviewComment", ReviewCommentSchema);
