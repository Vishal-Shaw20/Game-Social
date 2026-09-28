import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    type: {
      type: String,
      enum: [
        "mention",
        "review_like",
        "comment_like",
        "friend",           // legacy: "X added you as a friend" (pre-requests)
        "friend_request",   // X sent you a friend request
        "friend_accept",    // X accepted your friend request
        "message"           // a DM or group message you weren't looking at
      ],
      required: true
    },

    actorId: { type: mongoose.Schema.Types.ObjectId },
    entityId: { type: mongoose.Schema.Types.ObjectId },

    text: String,
    url: String,

    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// The bar's query: my notifications, newest first.
NotificationSchema.index({ userId: 1, createdAt: -1 });
// The unread count and "mark all read".
NotificationSchema.index({ userId: 1, read: 1 });
// Undoing a like removes its notification (deleteNotification.js).
NotificationSchema.index({ userId: 1, type: 1, actorId: 1, entityId: 1 });
// MongoDB deletes these itself 90 days after they're created: notifications
// are only useful while recent, and nothing has to sweep them up.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("Notification", NotificationSchema);
