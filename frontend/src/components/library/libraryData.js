// src/components/library/libraryData.js
//
// The Library page's data: /api/library's response turned into one flat
// item per Steam game, the overview numbers, hours by genre, and the
// filtering and sorting the toolbar offers.

export const SHELVES = [
  ["playing", "Playing"],
  ["finished", "Finished"],
  ["backlog", "Backlog"],
  ["dropped", "Dropped"],
];

// Enough hours that a missing review is worth a nudge.
export const NUDGE_HOURS = 5;

const steamHeader = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

/** One item per game: what the cards, filters and sorts need. */
export function libraryItems(data, achievements = {}) {
  return (data?.games ?? []).map(({ steam, rawg }) => {
    const rawgId = rawg?.id ? String(rawg.id) : null;
    const score = rawg?.metacritic ?? (rawg?.rating ? Math.round(rawg.rating * 20) : null);
    return {
      appid: steam.appid,
      name: rawg?.name || steam.name,
      rawgId,
      matched: Boolean(rawgId),
      cover: rawg?.background_image || null,
      image: rawg?.background_image || steamHeader(steam.appid),
      hours: (steam.playtimeForever || 0) / 60,
      recent: (steam.playtime2Weeks || 0) / 60,
      genres: rawg?.genres ?? [],
      platforms: rawg?.platforms ?? [],
      released: rawg?.released ?? null,
      metacritic: rawg?.metacritic ?? null,
      rating: rawg?.rating ?? null,
      score,
      verdict: rawgId ? data.reviews?.[rawgId] ?? null : null,
      shelf: data.shelves?.[steam.appid] ?? null,
      owners: data.owners?.[steam.appid] ?? [],
      achievements: achievements[steam.appid] ?? null,
    };
  });
}

/** The overview: totals, backlog, the last two weeks, the most played. */
export function libraryStats(items) {
  const played = items.filter((g) => g.hours > 0);
  const mostPlayed = [...items].sort((a, b) => b.hours - a.hours)[0] ?? null;
  return {
    total: items.reduce((h, g) => h + g.hours, 0),
    count: items.length,
    played: played.length,
    never: items.length - played.length,
    recent: items.reduce((h, g) => h + g.recent, 0),
    mostPlayed: mostPlayed && mostPlayed.hours > 0 ? mostPlayed : null,
  };
}

/** Hours by genre (a game's hours split evenly over its genres), top first. */
export function hoursByGenre(items, limit = 6) {
  const by = new Map();
  for (const g of items) {
    if (!g.hours || !g.genres.length) continue;
    const share = g.hours / g.genres.length;
    for (const genre of g.genres) by.set(genre, (by.get(genre) ?? 0) + share);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre, hours]) => ({ genre, hours, share: hours / total }));
}

export const hoursText = (h) => (h >= 100 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : h > 0 ? `${Math.round(h * 60)} min` : "Not played");

export const FILTERS = [
  ["all", "All", () => true],
  ["never", "Never played", (g) => g.hours === 0],
  ["unreviewed", "Not reviewed", (g) => g.matched && !g.verdict && g.hours > 0],
  ["reviewed", "Reviewed", (g) => Boolean(g.verdict)],
  ["friends", "With friends", (g) => g.owners.length > 0],
  ["unmatched", "Needs a match", (g) => !g.matched],
];

export const SORTS = [
  ["hours", "Most played", (a, b) => b.hours - a.hours],
  ["recent", "Recently played", (a, b) => b.recent - a.recent || b.hours - a.hours],
  ["name", "Name", (a, b) => a.name.localeCompare(b.name)],
  ["score", "Score", (a, b) => (b.score ?? -1) - (a.score ?? -1)],
];

/** The toolbar's choices applied: shelf, filter, genre, platform, search, sort. */
export function applyView(items, { shelf, filter, genre, platform, query, sort }) {
  const q = query.trim().toLowerCase();
  const keep = FILTERS.find(([k]) => k === filter)?.[2] ?? (() => true);
  const order = SORTS.find(([k]) => k === sort)?.[2] ?? SORTS[0][2];
  return items
    .filter((g) => shelf === "all" || (shelf === "none" ? !g.shelf : g.shelf === shelf))
    .filter(keep)
    .filter((g) => !genre || g.genres.includes(genre))
    .filter((g) => !platform || g.platforms.includes(platform))
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .sort(order);
}

/** Every genre and platform in the library, most common first. */
export function facets(items, key) {
  const n = new Map();
  for (const g of items) for (const v of g[key]) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
