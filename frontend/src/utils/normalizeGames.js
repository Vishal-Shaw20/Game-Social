/* Platform families, each shown as one icon on the card; the label is the
   icon's accessible name. RAWG names platforms per-device ("PlayStation 4",
   "PlayStation 5", "PS Vita"), which is far too granular for a card, so
   collapse them to the family. Order here is the display order. */
const PLATFORM_FAMILIES = [
  { key: "pc", label: "PC", match: /^(pc|windows|linux|macos|apple macintosh)/i },
  { key: "playstation", label: "PlayStation", match:/playstation|^ps\b/i },
  { key: "xbox", label: "Xbox", match: /xbox/i },
  { key: "nintendo", label: "Nintendo", match: /nintendo|switch|wii|game boy|gamecube|^s?nes$/i },
  { key: "mobile", label: "Mobile", match: /^(ios|android)/i },
];

export function toPlatformFamilies(platforms) {
  if (!Array.isArray(platforms)) return [];
  const seen = new Set();
  for (const raw of platforms) {
    const name = String(raw ?? "");
    const family = PLATFORM_FAMILIES.find((f) => f.match.test(name));
    if (family) seen.add(family.key);
  }
  return PLATFORM_FAMILIES.filter((f) => seen.has(f.key));
}

export function normalizeGames(list) {
  return list.map(g => {
    const mapping = g.mapping ?? null;
    const rawgId = mapping?.rawg_id ?? g.id ?? g.steam_id ?? null;
    const cover = g.cover_image || g.background_image || g.image || "";
    const title = g.title || g.name || "Unknown";

    // Trending nests the games-table row as a one-item array under `games`;
    // the other feeds return these fields flat. Read either. (An array is also
    // typeof "object", so it must be unwrapped explicitly, not just detected.)
    const nested = Array.isArray(g.games) ? g.games[0] : g.games;
    const row = nested && typeof nested === "object" ? nested : g;

    const metacritic = Number(row.metacritic ?? g.metacritic) || null;
    const rating = Number(row.rating ?? g.rating) || null;
    const released = row.released || g.released || null;

    return {
      id: String(rawgId ?? g.slug ?? g.id),
      rawgId,
      title,
      cover,
      released,
      year: released ? new Date(released).getUTCFullYear() : null,
      players: g.players ?? null,
      // All of them; the card decides how many fit (GameCard shows two plus a
      // "+N" tag, the spotlight has room for the lot).
      genres: row.genres ?? g.genres ?? [],
      platforms: toPlatformFamilies(row.platforms ?? g.platforms),
      metacritic,
      rating,
      // Only the trending feed carries these (for the spotlight); elsewhere
      // they're simply null.
      summary: row.summary ?? null,
      developer: (row.developers ?? [])[0] ?? null,
      publisher: (row.publishers ?? [])[0] ?? null,
      steamPositive: g.positive ?? null,
      steamNegative: g.negative ?? null,
    };
  });
}
