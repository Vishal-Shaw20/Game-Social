import Notification from "../models/Notification.js";
import logger from "../config/logger.js";
import { emitToUser } from "../social/realtime.js";
import { wantsNotification } from "./profileExtras.js";

/**
 * Store a notification and push it to the recipient's open tabs instantly
 * (event "notification"; the notification bar prepends it).
 *
 * Never throws: a notification is a side effect of something the user did
 * (adding a friend, liking a review), and failing to record it must not make
 * that action report failure. That's exactly what happened when the friend
 * route used a type the model didn't allow.
 */
export async function createNotification({
  userId,
  type,
  actorId,
  entityId,
  text,
  url
}) {
  if (!userId || !type) return null;

  try {
    // turned off on their profile: not stored, not pushed
    if (!(await wantsNotification(userId, type))) return null;
    const doc = await Notification.create({
      userId,
      type,
      actorId,
      entityId,
      text,
      url
    });
    emitToUser(userId, "notification", doc.toObject());
    return doc;
  } catch (err) {
    logger.error({ err, type, userId: String(userId) }, "createNotification failed");
    return null;
  }
}
