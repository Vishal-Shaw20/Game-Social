import { triggerSteamSyncIfNeeded } from "../services/steamLibrary.js";
import logger from "../config/logger.js";

// Starts a background Steam library sync for the signed-in user when theirs
// is stale (services/steamLibrary.js); never delays the request. Mounted on
// /api/frontend-hit (once per browser session), the Library and game pages.
export default async function steamAutoSync(req, res, next) {
  try {
    logger.debug("SteamAutoSync hit by %s", req.user?._id);
    if (!req.user) return next();

    const steamAccount = req.user.linkedAccounts?.find(
      acc => acc.provider === "steam"
    );

    if (!steamAccount) return next();

    triggerSteamSyncIfNeeded(req.user._id, steamAccount.providerId)
      .catch(err => logger.error({ err }, "Steam auto-sync check failed"));
  } catch (err) {
    logger.error({ err }, "Steam auto-sync middleware error");
  }

  next();
}
