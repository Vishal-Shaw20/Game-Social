// models/Conversation.js
import mongoose from "mongoose";

/*
 * A direct message or a group chat. Messages themselves are ChatMessage
 * documents with roomId "conv:<conversationId>", which is also the socket
 * room they're broadcast to, so game rooms and conversations share one
 * pipeline.
 *
 * dmKey makes a DM unique per pair: the two user ids sorted and joined, so
 * whoever opens it first, both land in the same conversation. Groups leave
 * it unset (the index is sparse).
 *
 * lastMessage/lastMessageAt are kept on the conversation so the sidebar can
 * list conversations with their latest line without reading messages.
 */
const MemberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    // Everything up to here has been seen; drives the unread badge.
    lastReadAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ConversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["dm", "group"], required: true },
    // Groups only; a DM is named after the other person.
    name: { type: String, maxLength: 60 },
    dmKey: { type: String, index: { unique: true, sparse: true } },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    members: [MemberSchema],
    lastMessageAt: { type: Date, default: Date.now },
    lastMessage: {
      text: String,
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: Date
    }
  },
  { timestamps: true }
);

// The sidebar's query: my conversations, most recent first.
ConversationSchema.index({ "members.userId": 1, lastMessageAt: -1 });

/** The dmKey for a pair of users, in a fixed order. */
export const dmKeyFor = (a, b) => [String(a), String(b)].sort().join(":");

export default mongoose.model("Conversation", ConversationSchema);
