// backend/routes/gameLookup.js
import express from "express";
import fetch from "node-fetch";
import { getPG } from "../config/db.js";

const router = express.Router();

async function rawgToSteamAppId(rawgId) {
  const pg = getPG();
  const { rows } = await pg.query(
    `SELECT steam_id FROM steam_rawg_map WHERE rawg_id = $1 LIMIT 1`,
    [String(rawgId)]
  );
  if (!rows.length) return null;
  return Number(rows[0].steam_id);
}

// GET /api/game/rawg/:rawgId
router.get("/:rawgId", async (req, res) => {
  const rawgId = req.params.rawgId;
  if (!/^\d+$/.test(rawgId))
    return res.status(400).json({ error: "rawgId must be numeric" });

  const pg = getPG();
  if (!pg)
    return res.status(500).json({ error: "Postgres pool not initialized" });

  try {
    const exists = await pg.query(
      `SELECT 1 FROM games WHERE id = $1 LIMIT 1`,
      [Number(rawgId)]
    );

    // if (!exists.rows.length)
    //   return res.status(404).json({ error: "Game not found" });
    const hasLocalGame = exists.rows.length > 0;


    const steamAppId = await rawgToSteamAppId(rawgId);

    let steam = null;
    if (steamAppId) {
      // const r = await fetch(
      //   `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=english`
      // );
      // const j = await r.json();
      // steam = j?.[steamAppId]?.success ? j[steamAppId].data : null;
      try {
  const r = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=english`,
    {
      headers: {
        "User-Agent": "GameSocial/1.0"
      }
    }
  );

  if (r.ok) {
    const j = await r.json();
    steam = j?.[steamAppId]?.success ? j[steamAppId].data : null;
  }
} catch (e) {
  console.warn("Steam fetch failed:", e.message);
  steam = null;
}

    }

    return res.json({
      rawg_id: Number(rawgId),
      steam: steam
        ? {
            appid: steam.steam_appid,
            name: steam.name,
            short_description: steam.short_description,
            detailed_description: steam.detailed_description,
            header_image: steam.header_image,
            website: steam.website,
            developers: steam.developers,
            publishers: steam.publishers,
            release_date: steam.release_date,
            price_overview: steam.price_overview,
            platforms: steam.platforms,
            categories: steam.categories,
            genres: steam.genres,
            screenshots: steam.screenshots,
            movies: steam.movies,
            metacritic: steam.metacritic
          }
        : null
    });
  } catch (err) {
  console.error("game lookup error:", err);
  return res.status(500).json({ error: "Game lookup failed" });
}

});

export default router;
