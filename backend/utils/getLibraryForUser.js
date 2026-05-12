import SteamLibrary from "../models/SteamLibraries.js";
import { getPG } from "../config/db.js";
import {
  getMappingsBySteamIds,
  autoMatchRawg,
  upsertMapping
} from "./steamRawgmap.js";

const libraryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of libraryCache) {
    if (now - entry.timestamp > CACHE_TTL) libraryCache.delete(key);
  }
}, 10 * 60 * 1000);

export function clearLibraryCache(userId) {
  libraryCache.delete(String(userId));
}

export async function getLibraryForUser(userId) {
  const cacheKey = String(userId);
  const cached = libraryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const library = await SteamLibrary.findOne({ userId }).lean();

  if (!library) {
    return { linked: false, games: [] };
  }

  const pg = getPG();
  const allSteamIds = library.games.map(g => g.appid);

  // Phase 1: batch-fetch all existing mappings
  const mappings = await getMappingsBySteamIds(allSteamIds);

  // Phase 2: auto-match unmapped games (still per-game — calls external RAWG API)
  const unmapped = library.games.filter(g => !mappings.has(g.appid));
  for (const game of unmapped) {
    try {
      const match = await autoMatchRawg(game.appid, game.name, { threshold: 0.55 });
      if (match) {
        const saved = await upsertMapping(game.appid, match.rawgId, {
          source: "auto",
          confidence: match.score,
          metadata: match.candidate
        });
        mappings.set(game.appid, saved);
      }
    } catch {}
  }

  // Phase 3: collect all rawg IDs and batch-fetch game metadata
  const rawgIds = [];
  const steamToRawg = new Map();

  for (const game of library.games) {
    const mapping = mappings.get(game.appid);
    if (mapping?.rawg_id) {
      const rid = Number(mapping.rawg_id);
      rawgIds.push(rid);
      steamToRawg.set(game.appid, String(mapping.rawg_id));
    }
  }

  if (rawgIds.length === 0) {
    return {
      linked: true,
      steamId: library.steamId,
      gameCount: library.gameCount,
      lastSyncedAt: library.lastSyncedAt,
      games: []
    };
  }

  const { rows: rawgGames } = await pg.query(
    `SELECT * FROM games WHERE id = ANY($1)`,
    [rawgIds]
  );

  const rawgMap = new Map();
  for (const g of rawgGames) {
    rawgMap.set(String(g.id), g);
  }

  const finalGames = library.games
    .map(game => {
      const rawgId = steamToRawg.get(game.appid);
      if (!rawgId) return null;

      return {
        steam: game,
        rawg: rawgMap.get(rawgId) || null
      };
    })
    .filter(Boolean);

  const result = {
    linked: true,
    steamId: library.steamId,
    gameCount: library.gameCount,
    lastSyncedAt: library.lastSyncedAt,
    games: finalGames
  };

  libraryCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return result;
}
