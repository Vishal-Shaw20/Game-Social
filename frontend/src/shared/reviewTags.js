// shared/reviewTags.js
//
// Review tags. IDENTICAL COPIES live in frontend/src/shared/ and
// backend/shared/: edit one, copy it over.
//
// Every tag is a mirrored pair with one id: a review stores the id in
// `pros` when the thing worked and in `cons` when it didn't, so the same
// aspect can be counted both ways ("Gunplay: 14 up, 3 down") and labels can
// be reworded without touching stored reviews.
//
// A game offers the generic tags plus the pack of every genre it has (RAWG
// genre names, as stored in games.genres), plus the multiplayer pack when it
// has multiplayer. The server accepts any known id; the UI decides which to
// show.

/* id: [what worked, what didn't] */
export const TAGS = {
  // generic
  visuals: ["Stunning visuals", "Dated visuals"],
  artstyle: ["Great art style", "Bland art style"],
  audio: ["Great soundtrack", "Weak audio"],
  performance: ["Runs smoothly", "Poor performance"],
  polish: ["Polished", "Buggy"],
  controls: ["Tight controls", "Clunky controls"],
  ui: ["Clean UI", "Confusing UI"],
  replay: ["Replayable", "One and done"],
  price: ["Worth the price", "Overpriced"],
  monetization: ["Fair monetization", "Aggressive monetization"],
  length: ["Great length", "Too short"],
  time: ["Respects your time", "Padded / grindy"],
  accessibility: ["Great accessibility options", "Poor accessibility"],
  // action
  combat: ["Satisfying combat", "Mindless combat"],
  bosses: ["Great boss fights", "Weak bosses"],
  challenge: ["Fair challenge", "Cheap difficulty"],
  // adventure / rpg
  story: ["Gripping story", "Weak story"],
  world: ["Rich world to explore", "Empty world"],
  puzzles: ["Clever puzzles", "Obtuse puzzles"],
  builds: ["Deep builds", "Shallow builds"],
  choices: ["Choices matter", "Choices don't matter"],
  characters: ["Memorable characters", "Forgettable characters"],
  quests: ["Great quests", "Fetch-quest filler"],
  // shooter
  gunplay: ["Satisfying gunplay", "Floaty gunplay"],
  leveldesign: ["Great level design", "Bland levels"],
  weapons: ["Weapon variety", "Few viable weapons"],
  // strategy
  strategy: ["Deep strategy", "Shallow strategy"],
  ai: ["Smart AI", "Dumb AI"],
  pacing: ["Great pacing", "Sluggish pacing"],
  // simulation
  systems: ["Deep systems", "Shallow systems"],
  loop: ["Relaxing loop", "Tedious loop"],
  realism: ["Realistic feel", "Unrealistic"],
  // sports
  authenticity: ["Authentic feel", "Arcadey feel"],
  modes: ["Great modes", "Thin modes"],
  rosters: ["Up-to-date rosters", "Yearly reskin"],
  // racing
  handling: ["Great handling", "Bad handling"],
  tracks: ["Great tracks", "Bland tracks"],
  raceai: ["Fair AI", "Rubber-band AI"],
  // fighting
  mechanics: ["Deep mechanics", "Button-mashy"],
  roster: ["Balanced roster", "Unbalanced roster"],
  netcode: ["Great netcode", "Laggy netcode"],
  // platformer
  jumping: ["Precise jumping", "Floaty jumping"],
  levels: ["Creative levels", "Repetitive levels"],
  movement: ["Great movement", "Stiff movement"],
  // puzzle
  curve: ["Great difficulty curve", "Uneven difficulty"],
  aha: ["Satisfying \"aha\" moments", "Trial and error"],
  // arcade
  instant: ["Instantly fun", "Shallow"],
  score: ["Great score chasing", "Gets stale fast"],
  // card / board
  deckbuilding: ["Deep deckbuilding", "Luck-heavy"],
  rules: ["Clear rules", "Confusing rules"],
  // mmo
  endgame: ["Great endgame", "Thin endgame"],
  community: ["Thriving community", "Dead servers"],
  events: ["Rewarding events", "Stale events"],
  p2w: ["Fair to free players", "Pay-to-win"],
  // multiplayer
  coop: ["Great co-op", "Weak co-op"],
  matchmaking: ["Good matchmaking", "Bad matchmaking"],
  players: ["Friendly community", "Toxic community"],
};

export const GENERIC = [
  "visuals", "artstyle", "audio", "performance", "polish", "controls", "ui",
  "replay", "price", "monetization", "length", "time", "accessibility",
];

/* In display order. `genres` are RAWG genre names. Indie, Casual, Family and
   Educational have no pack: they describe the audience, not the play. */
export const GENRE_PACKS = [
  { key: "rpg", title: "RPGs", genres: ["RPG"], tags: ["story", "builds", "choices", "characters", "quests"] },
  { key: "action", title: "Action", genres: ["Action"], tags: ["combat", "bosses", "challenge"] },
  { key: "shooter", title: "Shooters", genres: ["Shooter"], tags: ["gunplay", "leveldesign", "weapons"] },
  { key: "adventure", title: "Adventure", genres: ["Adventure"], tags: ["story", "world", "puzzles"] },
  { key: "strategy", title: "Strategy", genres: ["Strategy"], tags: ["strategy", "ai", "pacing"] },
  { key: "simulation", title: "Simulation", genres: ["Simulation"], tags: ["systems", "loop", "realism"] },
  { key: "sports", title: "Sports", genres: ["Sports"], tags: ["authenticity", "modes", "rosters"] },
  { key: "racing", title: "Racing", genres: ["Racing"], tags: ["handling", "tracks", "raceai"] },
  { key: "fighting", title: "Fighting", genres: ["Fighting"], tags: ["mechanics", "roster", "netcode"] },
  { key: "platformer", title: "Platformers", genres: ["Platformer"], tags: ["jumping", "levels", "movement"] },
  { key: "puzzle", title: "Puzzle", genres: ["Puzzle"], tags: ["puzzles", "curve", "aha"] },
  { key: "arcade", title: "Arcade", genres: ["Arcade"], tags: ["instant", "score"] },
  { key: "tabletop", title: "Card & board", genres: ["Card", "Board Games"], tags: ["deckbuilding", "rules"] },
  { key: "mmo", title: "MMOs", genres: ["Massively Multiplayer"], tags: ["endgame", "community", "events", "p2w"] },
];

export const MULTIPLAYER_PACK = {
  key: "multiplayer", title: "Multiplayer", tags: ["coop", "matchmaking", "netcode", "players"],
};

/* The tags reviews used before ids existed. Old reviews keep their stored
   text; it's read (and re-saved on edit) as these ids. */
const LEGACY = {
  pros: {
    "Great combat": "combat", "Good story": "story", "Amazing soundtrack": "audio",
    "Beautiful visuals": "visuals", "Replayable": "replay", "Well optimized": "performance",
    "Fun multiplayer": "coop", "Good progression": "time",
  },
  cons: {
    "Poor optimization": "performance", "Repetitive gameplay": "time", "Weak story": "story",
    "Bugs": "polish", "Pay to win": "monetization", "Short length": "length",
    "Bad controls": "controls", "Unbalanced": "challenge",
  },
};

/** A stored value (id or legacy text) as an id, or null if unknown. */
export function tagId(value, side) {
  if (typeof value !== "string") return null;
  if (TAGS[value]) return value;
  return LEGACY[side]?.[value] ?? null;
}

/** Clean a submitted list: known ids only, legacy text converted, no repeats. */
export function normalizeTags(list, side) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const id = tagId(v, side);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Display text for a stored value on a side ("pros" | "cons"). */
export function tagLabel(value, side) {
  const id = tagId(value, side);
  if (!id) return String(value ?? "");
  return TAGS[id][side === "cons" ? 1 : 0];
}

/** Whether a game has multiplayer, from what the game page already knows. */
export function hasMultiplayer({ genres = [], categories = [], tags = [] } = {}) {
  if (genres.includes("Massively Multiplayer")) return true;
  if (categories.some((c) => /multi-?player|co-?op|pvp|\bmmo\b/i.test(c))) return true;
  return tags.some((t) => /^(multiplayer|co-?op|online co-?op|online multiplayer|pvp|online pvp)$/i.test(t));
}

/**
 * The sections a game's review composer shows, in order: General, then one
 * per matching genre pack, then Multiplayer. A tag appears only once, in the
 * first section that has it.
 */
export function tagSections({ genres = [], multiplayer = false } = {}) {
  const seen = new Set(GENERIC);
  const sections = [{ key: "general", title: "General", tags: [...GENERIC] }];
  const packs = GENRE_PACKS.filter((p) => p.genres.some((g) => genres.includes(g)));
  if (multiplayer) packs.push(MULTIPLAYER_PACK);
  for (const p of packs) {
    const tags = p.tags.filter((t) => !seen.has(t));
    tags.forEach((t) => seen.add(t));
    if (tags.length) sections.push({ key: p.key, title: p.title, tags });
  }
  return sections;
}
