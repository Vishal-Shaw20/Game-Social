import mongoose from "mongoose";

const ReviewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },

    rawgId: {
      type: String,
      required: true,
      index: true
    },

    steamAppId: Number,

    verdict: {
      type: String,
      enum: ["awful_fun", "subpar", "almost_good", "perfection"],
      required: true
    },

    title: { type: String, maxLength: 120 },
    body: { type: String, maxLength: 5000 },

    pros: [{ type: String, maxLength: 120 }],
    cons: [{ type: String, maxLength: 120 }],

    playtimeHours: Number,
    completed: Boolean,

    visibility: {
      type: String,
      enum: ["public", "friends"],
      default: "public",
      index: true
    },

    likes: [{ type: mongoose.Schema.Types.ObjectId }],
    edited: { type: Boolean, default: false }
  },
  { timestamps: true }
);

ReviewSchema.index({ rawgId: 1, userId: 1 }, { unique: true });
// A game's review list, newest first.
ReviewSchema.index({ rawgId: 1, createdAt: -1 });
// A profile's reviews, newest first.
ReviewSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("GameReview", ReviewSchema);
