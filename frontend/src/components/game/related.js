// src/components/game/related.js
import { normalizeGames } from "../../utils/normalizeGames";

// How many related games the spotlight cycles through; past this its dash
// pager gets too cramped to use.
const RELATED_MAX = 15;

const released = (g) => (g.released ? Date.parse(g.released) || 0 : 0);

/**
 * A game's base game, DLC and editions, and the rest of its series as one
 * list for the spotlight (TrendingSpotlight): base game first, then DLC and
 * editions (newest first), then the series. Each carries `kind`, shown as
 * the slide's corner label. Games without art or a page to open, repeats,
 * and the game itself are left out.
 */
export function relatedGames(game) {
  const tag = (list, kind) => normalizeGames(list ?? []).map((g) => ({ ...g, kind }));
  const seen = new Set([String(game.id)]);
  return [
    ...tag(game.parents, "Base game"),
    ...tag(game.dlc, "DLC / edition").sort((a, b) => released(b) - released(a)),
    ...tag(game.series, "In this series"),
  ]
    .filter((g) => {
      const key = String(g.rawgId);
      if (!g.rawgId || !g.cover || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RELATED_MAX);
}

/* The slide's corner label: what it is, and where it is in the list. */
export const relatedKicker = (g, i, n) => ({ tag: g.kind, text: `${i + 1} of ${n}` });
