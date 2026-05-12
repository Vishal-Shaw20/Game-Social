import { triggerSteamSyncIfNeeded } from "../services/steamLibrary.js";
import { clearLibraryCache } from "../utils/getLibraryForUser.js";
import logger from "../config/logger.js";

export default async function steamAutoSync(req, res, next) {
  try {
    logger.debug("SteamAutoSync hit by %s", req.user?._id);
    if (!req.user) return next();

    const steamAccount = req.user.linkedAccounts?.find(
      acc => acc.provider === "steam"
    );

    if (!steamAccount) return next();

    triggerSteamSyncIfNeeded(req.user._id, steamAccount.providerId);
    clearLibraryCache(req.user._id);
  } catch (err) {
    logger.error({ err }, "Steam auto-sync middleware error");
  }

  next();
}
