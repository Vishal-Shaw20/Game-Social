// src/components/quicklook/quickLookContext.js
//
// The app-wide quick look (a game at a glance in a drawer, QuickLook.jsx):
// the context QuickLookProvider fills, the hook the rest of the app opens it
// with, and toSeed, which reads the many shapes a "game" comes in here.

import { createContext, useContext } from "react";
import { useNavigate } from "react-router-dom";

export const QuickLookContext = createContext(null);

const nameOf = (x) => (typeof x === "string" ? x : x?.name) ?? null;

/**
 * What the drawer needs to show a game before its details arrive, from a
 * RAWG row, a normalized card (normalizeGames) or a library item.
 * `mine` (optional) is your side of it, when the caller already has it:
 * { owned, appid, hours, recent, achievements, shelf, verdict }, and `owners`
 * the friends who own it.
 */
export function toSeed(g) {
  if (!g) return null;
  const rawgId = g.rawgId ?? g.mapping?.rawg_id ?? g.id ?? null;
  return {
    rawgId: rawgId == null ? null : String(rawgId),
    name: g.name ?? g.title ?? null,
    cover: g.cover || g.background_image || g.image || null,
    genres: (g.genres ?? []).map(nameOf).filter(Boolean),
    released: g.released ?? null,
    mine: g.mine ?? null,
    owners: g.owners ?? null,
  };
}

/**
 * open(game, { list, onShelf }): show `game` in the quick look. `list` is
 * the games ← / → step through (the row or grid it was picked from);
 * `onShelf(appid, status)` lets a page that keeps shelves (the Library) make
 * the change itself. Outside the provider, it opens the game page instead.
 */
export function useQuickLook() {
  const open = useContext(QuickLookContext);
  const navigate = useNavigate();
  return open ?? ((game) => {
    const s = toSeed(game);
    if (s?.rawgId) navigate(`/game/${s.rawgId}`);
  });
}
