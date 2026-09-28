// utils/createActivity.js
import Activity from "../models/Activity.js";
import User from "../models/User.js";
import logger from "../config/logger.js";
import { emitToUsers } from "../social/realtime.js";

/**
 * Record something a user did and push it live to their friends' feeds
 * (event "activity", same shape as GET /api/friends/activity items).
 *
 * userId: the actor. type: review | comment | like | friend | library_add |
 * playing | chat. Game entries pass gameId / gameName.
 * Never throws, for the same reason as createNotification.
 */
export async function createActivity({
  userId,
  type,
  entityId,
  gameId,
  gameName,
  text,
  url
}) {
  if (!userId || !type) return null;

  try {
    const doc = await Activity.create({
      userId,
      type,
      entityId,
      gameId,
      gameName,
      text,
      url
    });

    const actor = await User.findById(userId, { username: 1, displayName: 1, avatar: 1, friends: 1 }).lean();
    if (actor?.friends?.length) {
      const { friends, ...publicActor } = actor;
      emitToUsers(friends, "activity", { ...doc.toObject(), userId: publicActor });
    }
    return doc;
  } catch (err) {
    logger.error({ err, type, userId: String(userId) }, "createActivity failed");
    return null;
  }
}
