import SteamLibrary from "../models/SteamLibraries.js";
import { getPG } from "../config/db.js";
import {
  getMappingBySteamId,
  autoMatchRawg,
  upsertMapping
} from "./steamRawgmap.js";

export async function getLibraryForUser(userId) {
  const library = await SteamLibrary.findOne({ userId }).lean();

  if (!library) {
    return { linked: false, games: [] };
  }

  const pg = getPG();
  const rawgIds = [];
  const steamToRawg = new Map();

  for (const game of library.games) {
    const steamId = game.appid;
    let rawgId = null;

    const existing = await getMappingBySteamId(steamId);
    if (existing) {
      rawgId = existing.rawg_id;
    } else {
      try {
        const match = await autoMatchRawg(steamId, game.name, { threshold: 0.55 });
        if (match) {
          const saved = await upsertMapping(steamId, match.rawgId, {
            source: "auto",
            confidence: match.score,
            metadata: match.candidate
          });
          rawgId = saved.rawg_id;
        }
      } catch {}
    }

    if (rawgId) {
      rawgIds.push(Number(rawgId));
      steamToRawg.set(steamId, String(rawgId));
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

  return {
    linked: true,
    steamId: library.steamId,
    gameCount: library.gameCount,
    lastSyncedAt: library.lastSyncedAt,
    games: finalGames
  };
}
