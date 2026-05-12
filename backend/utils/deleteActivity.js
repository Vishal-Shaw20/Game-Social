import Activity from "../models/Activity.js";
import logger from "../config/logger.js";

export async function deleteActivity({
  userId,
  actorId,
  type,
  entityId
}) {
  try {
    await Activity.deleteMany({
      userId,
      actorId,
      type,
      entityId
    });
  } catch (e) {
    logger.error({ err: e }, "delete activity failed");
  }
}
