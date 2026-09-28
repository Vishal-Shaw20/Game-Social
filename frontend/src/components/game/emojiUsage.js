// Which emojis you react with most, per browser: the picker's "Frequently
// used" row and the hover bar's quick reactions come from it.

const KEY = "gs.emojiUsage";
const DEFAULT_QUICK = ["👍", "😂", "🔥"];
const KEEP = 40; // how many different emojis are remembered

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Count one use of an emoji. */
export function recordEmoji(emoji) {
  try {
    const counts = read();
    counts[emoji] = (counts[emoji] || 0) + 1;
    const kept = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* not remembered: the defaults stay */
  }
}

/** Most used first. */
export function frequentEmojis(n = 16) {
  return Object.entries(read())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([e]) => e);
}

/** The three one-click reactions: your most used, topped up with defaults. */
export function quickEmojis() {
  const top = frequentEmojis(3);
  for (const e of DEFAULT_QUICK) if (top.length < 3 && !top.includes(e)) top.push(e);
  return top;
}
