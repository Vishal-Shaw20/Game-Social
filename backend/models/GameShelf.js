// models/GameShelf.js
import mongoose from "mongoose";

/* The shelf a user put one of their Steam games on (Library page): what
   Steam can't know, like whether they finished it. Kept apart from
   SteamLibrary on purpose, since every sync replaces that library's list of
   games. One row per user and game; no row means "not on a shelf". */
export const SHELVES = ["playing", "finished", "backlog", "dropped"];

const GameShelfSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    appid: { type: Number, required: true }, // Steam app id
    status: { type: String, enum: SHELVES, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

GameShelfSchema.index({ userId: 1, appid: 1 }, { unique: true });

export default mongoose.model("GameShelf", GameShelfSchema);
