// models/Activity.js
import mongoose from "mongoose";

/* One thing a user did, shown to their friends in the activity feed.
   userId is the actor. Game-related entries (library, playing, chat) carry
   the game in gameId / gameName, since RAWG ids are numbers, not ObjectIds. */
const ActivitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // review | comment | like | friend | library_add | playing | chat
    type: String,
    entityId: mongoose.Schema.Types.ObjectId,
    gameId: Number,
    gameName: String,
    text: String,
    url: String
  },
  { timestamps: true }
);

// The feed's query: my friends' entries, newest first.
ActivitySchema.index({ userId: 1, createdAt: -1 });
// Undoing an action removes its entry (deleteActivity.js).
ActivitySchema.index({ userId: 1, type: 1, entityId: 1 });
// "is chatting in X" is limited to one entry per game per window.
ActivitySchema.index({ userId: 1, type: 1, gameId: 1, createdAt: -1 });
// Expired by MongoDB after 90 days; the feed only ever shows recent items.
ActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("Activity", ActivitySchema);
