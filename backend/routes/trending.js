import express from "express";
import fetch from "node-fetch";
import { getPG } from "../config/db.js";
import {
  getMappingsBySteamIds,
  upsertMapping,
  autoMatchRawg
} from "../utils/steamRawgmap.js";
import logger from "../config/logger.js";

const router = express.Router();

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY;

const toInt = (v, d = 50) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 200) : d;
};

// Response cache — 5-minute TTL
let cachedResponse = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

router.get("/", async (req, res) => {
  try {
    const limit = toInt(req.query.limit || "100", 100);
    const pool = getPG();
    if (!pool) {
      return res.status(500).json({ error: "Postgres pool not available" });
    }

    const autoMatchEnabled = req.query.autoMatch !== "0";
    const autoThreshold = Number(req.query.autoThreshold ?? 0.6);

    // Serve from cache if fresh
    if (cachedResponse && Date.now() - cachedAt < CACHE_TTL_MS) {
      return res.json(cachedResponse.slice(0, limit));
    }

    const client = await pool.connect();
    try {
      // Phase 1: fetch trending rows
      const trendingSql = `WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY steam_id ORDER BY snapshot_time DESC) rn
        FROM steamspy_trending
      ),
      latest AS (
        SELECT * FROM ranked WHERE rn = 1
      )
      SELECT * FROM latest
      ORDER BY snapshot_time DESC
      LIMIT $1`;

      const { rows } = await client.query(trendingSql, [limit]);
      const steamIds = rows.map(r => Number(r.steam_id));

      // Phase 2: batch-fetch all existing mappings
      const mappings = await getMappingsBySteamIds(steamIds);

      // Phase 3: auto-match unmapped (still per-game — calls external RAWG API)
      if (autoMatchEnabled) {
        const unmapped = rows.filter(r => !mappings.has(Number(r.steam_id)));
        for (const row of unmapped) {
          const sid = Number(row.steam_id);
          try {
            const match = await autoMatchRawg(sid, row.name || "", {
              threshold: autoThreshold
            });
            if (match?.rawgId) {
              const saved = await upsertMapping(sid, String(match.rawgId), {
                source: "auto",
                confidence: match.score,
                metadata: match.candidate
              });
              mappings.set(sid, saved);
            }
          } catch {}
        }
      }

      // Phase 4: collect rawg IDs and batch-ensure via gamiq
      const rawgIdsToEnsure = [];
      for (const [, mapping] of mappings) {
        if (mapping?.rawg_id) rawgIdsToEnsure.push(mapping.rawg_id);
      }

      if (rawgIdsToEnsure.length > 0) {
        const { rows: existing } = await client.query(
          `SELECT id FROM games WHERE id = ANY($1)`,
          [rawgIdsToEnsure.map(Number)]
        );
        const existingSet = new Set(existing.map(r => Number(r.id)));
        const missing = rawgIdsToEnsure.filter(id => !existingSet.has(Number(id)));

        for (const rawgId of missing) {
          try {
            await fetch(`${GAMIQ_URL}/games/ensure/${rawgId}`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${PIPELINE_API_KEY}` }
            });
          } catch (err) {
            logger.warn("Failed to ensure game %s via gamiq: %s", rawgId, err.message);
          }
        }
      }

      // Phase 5: batch-fetch all game metadata
      const allRawgIds = rawgIdsToEnsure.map(Number);
      let gameMap = new Map();
      if (allRawgIds.length > 0) {
        const { rows: gameRows } = await client.query(
          `SELECT id, slug, released, platforms, background_image
           FROM games WHERE id = ANY($1)`,
          [allRawgIds]
        );
        for (const g of gameRows) {
          gameMap.set(Number(g.id), g);
        }
      }

      // Phase 6: assemble response
      const processed = rows.map(row => {
        const sid = Number(row.steam_id);
        const mapping = mappings.get(sid) || null;
        const rawgId = mapping?.rawg_id ? Number(mapping.rawg_id) : null;
        const game = rawgId ? gameMap.get(rawgId) || null : null;

        return {
          steam_id: String(row.steam_id),
          title: row.name,
          players: row.ccu,
          score: row.score_rank,
          snapshot_time: row.snapshot_time,
          rawg_id: mapping?.rawg_id ?? null,
          background_image: game?.background_image ?? null,
          mapping,
          games: game ? [game] : []
        };
      });

      cachedResponse = processed;
      cachedAt = Date.now();

      return res.json(processed);
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, "trending-composite error");
    return res.status(500).json({ error: "failed to fetch trending" });
  }
});

export default router;
