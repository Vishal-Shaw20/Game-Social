// utils/gameText.js

/* description_raw is RAWG's markdown-ish text ("###Setting", runs of blank
   lines). Strip the markup and collapse whitespace for the spotlights (the
   homepage's Trending, the game page's related games). Sent in full, not
   cut short: the spotlight's description box scrolls, so a truncated "…"
   would just be a dead end. */
export function summarize(text) {
  if (!text) return null;
  return String(text)
    .replace(/#+\s*/g, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
