import SteamLibrary from "../models/SteamLibraries.js";
import logger from "../config/logger.js";

/**
 * Returns total playtime in HOURS for a given user + steam appid.
 * Returns null if not owned or not found.
 */
export async function getPlaytime(userId, steamAppId) {
  if (!userId || !steamAppId) return null;

  try {
    const lib = await SteamLibrary.findOne(
      { userId, "games.appid": steamAppId },
      { "games.$": 1 }
    ).lean();

    if (!lib || !lib.games || !lib.games.length) return null;

    const game = lib.games[0];

    // Steam stores playtime in MINUTES → convert to hours
    const minutes = Number(game.playtimeForever);

    if (!Number.isFinite(minutes)) return null;

    return Math.round((minutes / 60) * 10) / 10; // 1 decimal
  } catch (err) {
    logger.error({ err }, "getPlaytime failed");
    return null;
  }
}
