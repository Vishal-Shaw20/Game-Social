import express from "express";
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { searchLimiter } from "../middleware/rateLimiter.js";
import { matchAltNames, compact } from "../utils/altNames.js";

const router = express.Router();

/* The search bar filters by platform family ("playstation"), but games list
   individual consoles ("PlayStation 4", "PS Vita"). Matching the family name
   exactly only ever hit the one console that shares it: "playstation" found
   just the PS1, "xbox" just the original Xbox, and "nintendo" nothing at all.
   Each family expands to the RAWG platform names it covers (as they appear in
   games.platforms), matching how the cards group platforms. */
const PLATFORM_FAMILIES = {
  pc: ["PC", "macOS", "Linux"],
  playstation: [
    "PlayStation", "PlayStation 2", "PlayStation 3", "PlayStation 4",
    "PlayStation 5", "PSP", "PS Vita",
  ],
  xbox: ["Xbox", "Xbox 360", "Xbox One", "Xbox Series S/X"],
  nintendo: [
    "Nintendo Switch", "Nintendo 3DS", "Nintendo DS", "Nintendo DSi",
    "Wii", "Wii U", "Nintendo 64", "GameCube", "NES", "SNES",
    "Game Boy", "Game Boy Color", "Game Boy Advance",
  ],
  mobile: ["iOS", "Android"],
};

router.get("/games", searchLimiter, async (req, res) => {
  try {
    const {
      q = "",
      genres = "",
      platforms = ""
    } = req.query;

    // The dropdown asks for 15; the /search page pages through with
    // limit + offset. Capped so one request can't pull a huge slice.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 60);
    const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 5000);

    // A platform alone is not a search (see GameSearch.jsx); it only narrows
    // a text or genre search.
    const text = String(q).trim();
    if (!text && !genres) return res.json({ total: 0, results: [] });

    const pg = getPG();

    const where = [`suggestions_count IS NOT NULL`];
    const values = [];
    const param = (v) => {
      values.push(v);
      return `$${values.length}`;
    };

    /* ── Matching (Steam-like: forgiving) ──
       A game matches the text if any of:
       - its name contains it. Stored names have no apostrophes ("Baldurs
         Gate III"), so they're stripped from the text for this test;
       - some word run in its name is close to it: pg_trgm word similarity
         above the default 0.6 threshold (the `<%` operator), which uses the
         games_name_trgm_idx index. This is what forgives typos: "witchr",
         "elden rng";
       - one of its alternative names matches exactly or as a prefix ("gta 5",
         "csgo"), looked up in memory (utils/altNames.js). */
    let alt = { exact: [], prefix: [] };
    let pText, pExact, pPrefix, pCompact, pStarts;
    if (text) {
      alt = await matchAltNames(text);
      pText = param(text);
      pExact = param(alt.exact);
      pPrefix = param(alt.prefix);
      pCompact = param(compact(text));
      // Title starts with the text as whole words ("war" -> "War Thunder",
      // not "Warhammer"). Regex-escaped; \M is Postgres's end-of-word.
      pStarts = param(
        "^" + text.toLowerCase().replace(/['’]/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\M"
      );
      const pLike = param(`%${text.replace(/['’]/g, "")}%`);
      where.push(`(
        name ILIKE ${pLike}
        OR ${pText} <% name
        OR id = ANY(${pExact}::int[])
        OR id = ANY(${pPrefix}::int[])
      )`);
    }

    if (genres) {
      where.push(`EXISTS (
        SELECT 1 FROM unnest(genres) g WHERE lower(g) = ANY(${param(
          genres.split(",").map(g => g.toLowerCase())
        )})
      )`);
    }

    // Unknown family keys are ignored; if none are valid, no platform filter.
    const platformNames = platforms
      .split(",")
      .flatMap(f => PLATFORM_FAMILIES[f.trim().toLowerCase()] ?? [])
      .map(p => p.toLowerCase());

    if (platformNames.length) {
      where.push(`EXISTS (
        SELECT 1 FROM unnest(platforms) p WHERE lower(p) = ANY(${param(platformNames)})
      )`);
    }

    /* ── Ranking (Steam-like: relevance mixed with popularity) ──
       popularity: RAWG ratings_count on a log scale, 0..1. Half of all games
       have 0 ratings and the most-rated have ~7,300, so the log keeps a
       7,000-vs-50 gap large and a 7,000-vs-5,000 gap small.
       relevance (text searches only):
         0.55 x closeness of the text to the name (word similarity; an exact
                alternative-name match counts as 1, a prefix one as 0.85)
       + 0.40 for an exact title (punctuation and case ignored) or exact
                alternative name, 0.20 for a title that starts with the text
                as whole words
       + 0.45 x popularity
       So a well-known close match beats an obscure exact one ("war": God of
       War over a 0-rating game called "war"), while an exact title on a
       known game wins outright. Genre-only browsing ranks by popularity.
       id last so the order is total and paging never repeats or skips. */
    const popularity = `LEAST(ln(1 + COALESCE(ratings_count, 0)) / ln(7336), 1)`;
    const score = text
      ? `0.55 * GREATEST(
            word_similarity(${pText}, name),
            CASE WHEN id = ANY(${pExact}::int[]) THEN 1
                 WHEN id = ANY(${pPrefix}::int[]) THEN 0.85
                 ELSE 0 END
          )
          + CASE
              WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = ${pCompact}
                OR id = ANY(${pExact}::int[]) THEN 0.40
              WHEN lower(name) ~ ${pStarts} THEN 0.20
              ELSE 0
            END
          + 0.45 * ${popularity}`
      : popularity;

    const sql = `
      SELECT id, name, metacritic, rating,
             background_image, genres, platforms,
             -- Year taken in SQL: released is a date, and node-postgres turns
             -- a date into local midnight, which serialises as the previous
             -- day in UTC (a Jan 1 release would read as the year before).
             EXTRACT(YEAR FROM released)::int AS year,
             -- Every match, not just this page: "N results match your search".
             -- Computed in the same pass the sort needs anyway.
             count(*) OVER ()::int AS total_count
      FROM games
      WHERE ${where.join(" AND ")}
      ORDER BY ${score} DESC, id
      LIMIT ${param(limit)} OFFSET ${param(offset)}
    `;

    const { rows } = await pg.query(sql, values);

    // Past the last page there are no rows to carry the count; the client
    // only asks for more while offset < total, so 0 there is harmless.
    const total = rows[0]?.total_count ?? 0;
    res.json({
      total,
      results: rows.map(({ total_count, ...game }) => game)
    });
  } catch (e) {
    logger.error({ err: e }, "search failed");
    res.status(500).json({ total: 0, results: [] });
  }
});

export default router;
