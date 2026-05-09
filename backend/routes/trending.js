// routes/trending-composite.js
import express from "express";
import fetch from "node-fetch";
import { getPG } from "../config/db.js";
import {
  getMappingBySteamId,
  upsertMapping,
  autoMatchRawg
} from "../utils/steamRawgmap.js";

const router = express.Router();

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";
const PIPELINE_API_KEY = process.env.PIPELINE_API_KEY;

// safe integer parse
const toInt = (v, d = 50) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 200) : d;
};

// small batch runner to limit concurrency
async function batchMap(items, batchSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
    await new Promise(r => setTimeout(r, 80));
  }
  return out;
}

// ensure RAWG game exists in games table via gamiq
async function ensureRawgGame(client, rawgId) {
  const exists = await client.query(
    `SELECT 1 FROM games WHERE id = $1 LIMIT 1`,
    [rawgId]
  );
  if (exists.rowCount > 0) return;

  try {
    await fetch(`${GAMIQ_URL}/games/ensure/${rawgId}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PIPELINE_API_KEY}`
      }
    });
  } catch (err) {
    console.warn(`[trending] Failed to ensure game ${rawgId} via gamiq:`, err.message);
  }
}

router.get("/", async (req, res) => {
  try {
    const limit = toInt(req.query.limit || "100", 100);
    const pool = getPG();
    if (!pool) {
      return res.status(500).json({ error: "Postgres pool not available" });
    }

    const autoMatchEnabled = req.query.autoMatch !== "0";
    const autoThreshold = Number(req.query.autoThreshold ?? 0.6);
    const batchSize = Math.min(Math.max(Number(req.query.batchSize || 8), 1), 32);

    const client = await pool.connect();
    try {
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

      const processed = await batchMap(rows, batchSize, async (row) => {
        const steamId = Number(row.steam_id);
        const name = row.name ?? "";

        let mapping = await getMappingBySteamId(steamId).catch(() => null);

        if (!mapping && autoMatchEnabled) {
          const match = await autoMatchRawg(steamId, name, {
            threshold: autoThreshold
          }).catch(() => null);

          if (match?.rawgId) {
            mapping = await upsertMapping(steamId, String(match.rawgId), {
              source: "auto",
              confidence: match.score,
              metadata: match.candidate
            });
          }
        }

        if (mapping?.rawg_id) {
          await ensureRawgGame(client, mapping.rawg_id);
        }

        let game = null;
        if (mapping?.rawg_id) {
          const { rows } = await client.query(
            `SELECT id, slug, released, platforms, background_image
             FROM games WHERE id = $1`,
            [mapping.rawg_id]
          );
          game = rows[0] || null;
        }

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

      return res.json(processed);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("trending-composite error:", err);
    return res.status(500).json({ error: "failed to fetch trending" });
  }
});

export default router;
