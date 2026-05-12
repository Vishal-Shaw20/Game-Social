export function normalizeGames(list) {
  return list.map(g => {
    const mapping = g.mapping ?? null;
    const rawgId = mapping?.rawg_id ?? g.id ?? g.steam_id ?? null;
    const cover = g.cover_image || g.background_image || g.image || "";
    const title = g.title || g.name || "Unknown";

    return {
      id: String(rawgId ?? g.slug ?? g.id),
      rawgId,
      title,
      cover,
      released: g.released || null,
      players: g.players ?? null,
    };
  });
}
