import SteamLibrary from "../models/SteamLibraries.js";
import logger from "../config/logger.js";
import { createActivity } from "../utils/createActivity.js";
import { getMappingsBySteamIds } from "../utils/steamRawgmap.js";
import { clearLibraryCache } from "../utils/getLibraryForUser.js";

// Per sync, at most this many individual entries of each kind; beyond that a
// single summary line, so one big sync can't flood friends' feeds.
const MAX_ADDED_ENTRIES = 3;
const MAX_PLAYED_ENTRIES = 2;

/**
 * Friend-feed entries from the difference between two syncs:
 * - library_add: appids that weren't in the library before;
 * - playing: games whose total playtime went up since the last sync
 *   (biggest gains first).
 * Links go to our game page when the Steam app is mapped to a RAWG id.
 */
async function recordLibraryActivity(userId, before, after) {
  const prevById = new Map(before.map(g => [g.appid, g]));

  const added = after.filter(g => !prevById.has(g.appid));
  const played = after
    .map(g => ({ g, gained: (g.playtimeForever || 0) - (prevById.get(g.appid)?.playtimeForever || 0) }))
    .filter(x => prevById.has(x.g.appid) && x.gained > 0)
    .sort((a, b) => b.gained - a.gained)
    .map(x => x.g);

  if (!added.length && !played.length) return;

  const mappings = await getMappingsBySteamIds(
    [...added, ...played].map(g => g.appid)
  ).catch(() => new Map());
  const rawgIdOf = (g) => mappings.get(Number(g.appid))?.rawg_id ?? null;
  const entry = (g) => {
    const rawgId = rawgIdOf(g);
    return {
      gameId: rawgId ? Number(rawgId) : undefined,
      gameName: g.name,
      url: rawgId ? `/game/${rawgId}` : undefined
    };
  };

  for (const g of added.slice(0, MAX_ADDED_ENTRIES)) {
    await createActivity({ userId, type: "library_add", text: `added ${g.name} to their library`, ...entry(g) });
  }
  if (added.length > MAX_ADDED_ENTRIES) {
    const more = added.length - MAX_ADDED_ENTRIES;
    await createActivity({
      userId,
      type: "library_add",
      text: `added ${more} more game${more === 1 ? "" : "s"} to their library`
    });
  }

  for (const g of played.slice(0, MAX_PLAYED_ENTRIES)) {
    await createActivity({ userId, type: "playing", text: `played ${g.name}`, ...entry(g) });
  }
}

/* ── Keeping a user's Steam library up to date ──
   A library is synced when Steam is first linked, then again whenever the
   user is on the site and it's more than SYNC_INTERVAL_MS old: once per
   browser session (GET /api/frontend-hit), and when they open their Library
   or a game page (middleware/SteamAutoSync.js), never holding the page up.
   "Sync now" on the Library page (POST /api/me/library/sync) does it at once.

   A private profile's game details come back as an empty response; that
   never replaces a library we already have (it's kept, and the sync is
   reported as private). One sync per user at a time; a failed automatic one
   isn't retried for RETRY_AFTER_MS. */
const STEAM_TIMEOUT_MS = 8000;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 30 * 60 * 1000;
const MANUAL_MIN_GAP_MS = 60 * 1000;

const running = new Map();     // userId -> the sync in progress
const lastAttempt = new Map(); // userId -> when an automatic sync last started
const lastManual = new Map();  // userId -> when "Sync now" last ran

export async function fetchSteamLibrary(steamId) {
  if (!process.env.STEAM_API_KEY) throw new Error("STEAM_API_KEY is not set");
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(STEAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Steam GetOwnedGames ${res.status}`);
  const json = await res.json();
  return json?.response ?? {};
}

/**
 * Fetch the library from Steam and store it. Resolves to
 * { lastSyncedAt, gameCount, private }; `private` means Steam sent nothing
 * (private game details) and the stored library was left as it was.
 */
export function syncSteamLibrary(userId, steamId) {
  const key = String(userId);
  if (running.has(key)) return running.get(key);
  const job = doSync(userId, steamId).finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

async function doSync(userId, steamId) {
  const library = await fetchSteamLibrary(steamId);
  // The library as it was before this sync, to tell friends what changed.
  const previous = await SteamLibrary.findOne({ userId }, { games: 1, gameCount: 1, lastSyncedAt: 1 }).lean();

  if (!Array.isArray(library.games) && previous?.games?.length) {
    logger.warn("Steam returned no games for %s (private game details?): keeping the stored library", userId);
    return { lastSyncedAt: previous.lastSyncedAt ?? null, gameCount: previous.gameCount ?? previous.games.length, private: true };
  }

  const games = (library.games || []).map(g => ({
    appid: g.appid,
    name: g.name,
    playtimeForever: g.playtime_forever,
    playtime2Weeks: g.playtime_2weeks || 0,
    imgIconUrl: g.img_icon_url,
    imgLogoUrl: g.img_logo_url,
    hasCommunityVisibleStats: g.has_community_visible_stats || false
  }));
  const lastSyncedAt = new Date();

  await SteamLibrary.findOneAndUpdate(
    { userId },
    {
      userId,
      steamId,
      gameCount: library.game_count || games.length,
      games,
      lastSyncedAt
    },
    { upsert: true, new: true }
  );
  clearLibraryCache(userId);

  // Never on the first sync: every game would look "just added".
  if (previous?.games) {
    recordLibraryActivity(userId, previous.games, games)
      .catch(err => logger.error({ err }, "Steam library activity failed"));
  }
  return { lastSyncedAt, gameCount: library.game_count || games.length, private: !Array.isArray(library.games) };
}

export async function createSteamLibraryIfMissing(userId, steamId) {
  const exists = await SteamLibrary.exists({ userId });
  if (exists) return;
  await syncSteamLibrary(userId, steamId);
}

async function isStale(userId) {
  const lib = await SteamLibrary.findOne({ userId }).select("lastSyncedAt").lean();
  if (!lib?.lastSyncedAt) return true;
  return Date.now() - new Date(lib.lastSyncedAt).getTime() > SYNC_INTERVAL_MS;
}

/** Sync in the background if the library is stale (never waits for it). */
export async function triggerSteamSyncIfNeeded(userId, steamId) {
  const key = String(userId);
  if (running.has(key)) return;
  if (Date.now() - (lastAttempt.get(key) ?? 0) < RETRY_AFTER_MS) return;
  if (!(await isStale(userId))) return;
  lastAttempt.set(key, Date.now());
  syncSteamLibrary(userId, steamId)
    .catch(err => logger.error({ err }, "Steam auto-sync failed"));
}

/** "Sync now": at once, at most once a minute per user. */
export async function syncSteamLibraryNow(userId, steamId) {
  const key = String(userId);
  const wait = MANUAL_MIN_GAP_MS - (Date.now() - (lastManual.get(key) ?? 0));
  if (wait > 0 && !running.has(key)) {
    const err = new Error("Synced a moment ago");
    err.retryMs = wait;
    throw err;
  }
  lastManual.set(key, Date.now());
  return syncSteamLibrary(userId, steamId);
}
