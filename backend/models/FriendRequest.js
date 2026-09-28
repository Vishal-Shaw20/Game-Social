// models/FriendRequest.js
import mongoose from "mongoose";

/* A pending friend request. Accepting turns it into a friendship (both
   users' friends arrays) and deletes it; declining or cancelling just
   deletes it. One request per ordered pair. */
const FriendRequestSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { timestamps: true }
);

FriendRequestSchema.index({ from: 1, to: 1 }, { unique: true });

export default mongoose.model("FriendRequest", FriendRequestSchema);
