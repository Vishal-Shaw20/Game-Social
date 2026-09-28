// backend/utils/altNames.js
//
// Alternative names (abbreviations and short forms) for search: "gta 5" ->
// Grand Theft Auto V, "csgo" -> Counter-Strike: Global Offensive, "pubg" ->
// PlayerUnknown's Battlegrounds. RAWG stores these in games.alternative_names,
// but only ~6K of the ~836K searchable games have any, and there's no index
// on that column, so checking it inside every search query would scan the
// whole table (~350ms). Instead each backend process keeps them in memory
// (a few MB), loads them on the first search and refreshes hourly.
//
// Names are compared "compacted": lowercased with everything but letters and
// digits removed, so "CS: GO", "cs go" and "csgo" are all the key "csgo".
// Only exact and prefix matches count; fuzzy matching on abbreviations is far
// too loose ("gta 5" would also hit every other "gta ..." abbreviation).

import { getPG } from "../config/db.js";
import logger from "../config/logger.js";

const REFRESH_MS = 60 * 60 * 1000;
// A prefix like "gta" can match many keys; the best-known few are enough.
const MAX_PREFIX_IDS = 50;

export const compact = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

let index = null; // Map<compactedName, number[]> of game ids
let loading = null;
let timer = null;

async function load() {
  const pool = getPG();
  if (!pool) return;
  const { rows } = await pool.query(`
    SELECT id, alternative_names
    FROM games
    WHERE suggestions_count IS NOT NULL
      AND cardinality(alternative_names) > 0
  `);
  const next = new Map();
  for (const { id, alternative_names } of rows) {
    for (const name of alternative_names) {
      const key = compact(name);
      if (key.length < 2) continue;
      const ids = next.get(key);
      if (!ids) next.set(key, [id]);
      else if (!ids.includes(id)) ids.push(id);
    }
  }
  index = next;
  logger.info("Search alternative names loaded: %d names for %d games", next.size, rows.length);
}

function ensureLoaded() {
  if (!loading) {
    loading = load()
      .catch((err) => {
        logger.warn("Loading search alternative names failed: %s", err.message);
        loading = null; // retry on the next search
      });
    if (!timer) {
      timer = setInterval(() => {
        load().catch((err) =>
          logger.warn("Refreshing search alternative names failed: %s", err.message)
        );
      }, REFRESH_MS);
      timer.unref?.();
    }
  }
  return loading;
}

/**
 * Game ids whose alternative names match the query.
 * exact: an alternative name equals the query ("gta 5" == "GTA 5").
 * prefix: an alternative name starts with it ("gta" -> "GTA 5", "GTA SA"...),
 * only for queries of 3+ characters.
 * Until the first load finishes this returns empty lists; ordinary name
 * matching still works in the meantime.
 */
export async function matchAltNames(q) {
  await ensureLoaded();
  const key = compact(q);
  if (!index || key.length < 2) return { exact: [], prefix: [] };

  const exact = index.get(key) ?? [];
  const prefix = [];
  if (key.length >= 3) {
    for (const [name, ids] of index) {
      if (name !== key && name.startsWith(key)) {
        for (const id of ids) if (!exact.includes(id) && !prefix.includes(id)) prefix.push(id);
        if (prefix.length >= MAX_PREFIX_IDS) break;
      }
    }
  }
  return { exact, prefix };
}
