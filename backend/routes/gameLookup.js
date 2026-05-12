// backend/routes/gameLookup.js
import express from "express";
import fetch from "node-fetch";
import { getPG } from "../config/db.js";
import { rawgToSteamAppId } from "../utils/rawgToSteam.js";
import logger from "../config/logger.js";

const router = express.Router();

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

    const hasLocalGame = exists.rows.length > 0;


    const steamAppId = await rawgToSteamAppId(rawgId);

    let steam = null;
    if (steamAppId) {
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
  logger.warn("Steam fetch failed: %s", e.message);
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
  logger.error({ err }, "game lookup failed");
  return res.status(500).json({ error: "Game lookup failed" });
}

});

export default router;
