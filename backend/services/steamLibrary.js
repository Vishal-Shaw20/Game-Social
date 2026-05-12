import SteamLibrary from "../models/SteamLibraries.js";
import logger from "../config/logger.js";

export async function fetchSteamLibrary(steamId) {

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`;

  const res = await fetch(url);

  
  if (!res.ok) {
    logger.error("Steam API failed");
    throw new Error("Steam API failed");
  }

  const json = await res.json();

 

  return json.response;
}

export async function syncSteamLibrary(userId, steamId) {

  const library = await fetchSteamLibrary(steamId);

  const games = (library.games || []).map(g => ({
    appid: g.appid,
    name: g.name,
    playtimeForever: g.playtime_forever,
    playtime2Weeks: g.playtime_2weeks || 0,
    imgIconUrl: g.img_icon_url,
    imgLogoUrl: g.img_logo_url,
    hasCommunityVisibleStats: g.has_community_visible_stats || false
  }));


  await SteamLibrary.findOneAndUpdate(
    { userId },
    {
      userId,
      steamId,
      gameCount: library.game_count || games.length,
      games,
      lastSyncedAt: new Date()
    },
    { upsert: true, new: true }
  );

}

export async function createSteamLibraryIfMissing(userId, steamId) {

  const exists = await SteamLibrary.exists({ userId });


  if (exists) return;

  await syncSteamLibrary(userId, steamId);
}

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function maybeSyncSteamLibrary(userId, steamId) {

  const lib = await SteamLibrary.findOne({ userId }).select("lastSyncedAt");

  if (!lib || !lib.lastSyncedAt) {
    return true;
  }

  const age = Date.now() - new Date(lib.lastSyncedAt).getTime();

  

  return age > SYNC_INTERVAL_MS;
}

export async function triggerSteamSyncIfNeeded(userId, steamId) {

  const shouldSync = await maybeSyncSteamLibrary(userId, steamId);


  if (!shouldSync) return;


  syncSteamLibrary(userId, steamId)
    .catch(err => logger.error({ err }, "Steam auto-sync failed"));
}
