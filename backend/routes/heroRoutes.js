import express from "express";
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { HERO_GAME_IDS } from "../middleware/heroGames.js";

const router = express.Router();

router.get("/", apiLimiter, async (req, res) => {
  try {
    const pg = getPG();

    const { rows } = await pg.query(
      `SELECT id, name, background_image
         FROM games
        WHERE id = ANY($1::int[])
          AND background_image IS NOT NULL
          AND background_image <> ''`,
      [HERO_GAME_IDS]
    );

    // Postgres returns rows in arbitrary order; restore the curated order.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = HERO_GAME_IDS
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((g) => ({
        id: g.id,
        title: g.name,
        cover: g.background_image,
      }));

    res.json(ordered);
  } catch (e) {
    logger.error({ err: e }, "hero fetch failed");
    res.status(500).json([]);
  }
});

export default router;
