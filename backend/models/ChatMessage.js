// models/ChatMessage.js
import mongoose from "mongoose";

/*
 * Every chat message in the app. Social data lives in MongoDB; these used to
 * be the Postgres table `game_messages`, which has been migrated
 * (scripts/migrateChatToMongo.js) and dropped; its rows are also kept as a
 * file backup at scripts/game_messages_backup.json.
 *
 * roomId identifies the conversation and is a string so new kinds can be
 * added without a schema change:
 *   "game:<rawgId>"  public room on a game's page
 *   "dm:<a>:<b>"     direct message (user ids sorted, so the pair maps to
 *                    one room whoever opens it first)
 *   "group:<id>"     group chat
 *
 * The sender's name is not stored here: it is read from their user record
 * when history loads, so a rename shows everywhere and messages can't
 * outlive the account that wrote them.
 */
const ReactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { _id: false }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    // Emptied when the message is deleted (it stays as a placeholder).
    text: { type: String, required: function () { return !this.deletedAt; } },

    // Game rooms (socketTextHandlers.js); all optional, so older messages
    // and DMs/groups are unaffected.
    kind: { type: String, enum: ["text", "lfg"], default: "text" },
    // Quoting another message of the same room. The quoted author's name is
    // read from their user record, like the sender's.
    replyTo: {
      type: new mongoose.Schema(
        {
          id: { type: mongoose.Schema.Types.ObjectId, required: true },
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          excerpt: { type: String, maxLength: 200 }
        },
        { _id: false }
      ),
      default: undefined
    },
    reactions: { type: [ReactionSchema], default: undefined },
    editedAt: Date,
    deletedAt: Date,
    // "Looking for group": text is the note; people join up to `slots`
    // (the poster not counted).
    lfg: {
      type: new mongoose.Schema(
        {
          platform: { type: String, maxLength: 40 },
          slots: { type: Number, min: 1, max: 10 },
          joined: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
        },
        { _id: false }
      ),
      default: undefined
    },
    // Set only on rows copied from Postgres, so the migration can be re-run
    // without duplicating anything.
    legacyPgId: { type: Number, index: { unique: true, sparse: true } }
  },
  { timestamps: true }
);

// The query every room load makes: newest N messages of one room.
ChatMessageSchema.index({ roomId: 1, createdAt: -1 });

export default mongoose.model("ChatMessage", ChatMessageSchema);
