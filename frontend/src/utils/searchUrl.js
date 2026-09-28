/* URL of the /search results page for a query and filters, or null when
   there's nothing to search for (same rule as the dropdown: some text or a
   genre; a platform only narrows). */
export function searchUrl(q, genres, platforms) {
  const text = q.trim();
  if (!text && genres.length === 0) return null;
  const params = new URLSearchParams();
  if (text) params.set("q", text);
  if (genres.length) params.set("genres", genres.join(","));
  if (platforms.length) params.set("platforms", platforms.join(","));
  return `/search?${params}`;
}
