// backend/utils/steamRawgMap.js
import fetch from "node-fetch"; // safe even if Node has native fetch
import { getPG } from "../config/db.js"; // adjust path if needed

const RAWG_API_KEY = process.env.RAWG_API_KEY || ""; // optional
const RAWG_BASE = "https://api.rawg.io/api"; // RAWG API base

// Normalizes game name for simple fuzzy compares
function normalizeName(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// simple similarity score between two names (0..1)
function nameSimilarity(a = "", b = "") {
  a = normalizeName(a);
  b = normalizeName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // token overlap score
  const as = new Set(a.split(" "));
  const bs = new Set(b.split(" "));
  let common = 0;
  for (const t of as) if (bs.has(t)) common++;
  const score = common / Math.max(as.size, bs.size);
  return Math.min(1, Math.max(0, score));
}

// DATABASE: get mapping by steam_id
export async function getMappingBySteamId(steamId) {
  const pool = getPG();
  if (!pool) throw new Error("Postgres pool not available");
  const { rows } = await pool.query(
    `SELECT steam_id, rawg_id, source, confidence, metadata FROM steam_rawg_map WHERE steam_id = $1 LIMIT 1`,
    [steamId]
  );
  return rows[0] ?? null;
}

export async function getMappingsBySteamIds(steamIds) {
  if (!steamIds.length) return new Map();
  const pool = getPG();
  if (!pool) throw new Error("Postgres pool not available");
  const { rows } = await pool.query(
    `SELECT steam_id, rawg_id, source, confidence, metadata
     FROM steam_rawg_map WHERE steam_id = ANY($1)`,
    [steamIds]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.steam_id), r);
  }
  return map;
}

// DATABASE: set or update mapping
export async function upsertMapping(steamId, rawgId, opts = {}) {
  const { source = "manual", confidence = 1.0, metadata = null } = opts;
  const pool = getPG();
  if (!pool) throw new Error("Postgres pool not available");
  const q = `
    INSERT INTO steam_rawg_map (steam_id, rawg_id, source, confidence, metadata, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, now(), now())
    ON CONFLICT (steam_id) DO UPDATE
      SET rawg_id = EXCLUDED.rawg_id,
          source = EXCLUDED.source,
          confidence = EXCLUDED.confidence,
          metadata = EXCLUDED.metadata,
          updated_at = now()
    RETURNING *;
  `;
  const { rows } = await pool.query(q, [steamId, String(rawgId), source, confidence, metadata ? metadata : null]);
  return rows[0];
}

// Helper: search RAWG by name (returns array of candidates)
export async function searchRawgByName(name, page_size = 10) {
  const params = new URLSearchParams({
    search: name,
    page_size: String(page_size)
  });
  if (RAWG_API_KEY) params.set("key", RAWG_API_KEY);
  const url = `${RAWG_BASE}/games?${params.toString()}`;
  const r = await fetch(url, { timeout: 10000 });
  if (!r.ok) throw new Error(`RAWG search failed ${r.status}`);
  const json = await r.json();
  return Array.isArray(json.results) ? json.results : [];
}

// Auto-match single steam item (name) -> best rawg candidate
// returns { rawgId, score, candidate } or null if none good
export async function autoMatchRawg(steamId, steamName, opts = {}) {
  const { threshold = 0.55 } = opts; // require minimum similarity
  const candidates = await searchRawgByName(steamName, 8);
  if (!candidates.length) return null;
  // score candidates by nameSimilarity + optional year/platform boost
  let best = null;
  for (const c of candidates) {
    const rawgName = c.name || c.slug || "";
    const sim = nameSimilarity(steamName, rawgName);
    // boost if exact slug contains numeric steam id? (rare)
    const score = sim;
    if (!best || score > best.score) best = { candidate: c, score, rawgId: c.id };
  }
  if (!best || best.score < threshold) return null;
  return { rawgId: best.rawgId, score: best.score, candidate: best.candidate };
}

// Bulk sync: read latest bucket from DB and try to auto-match unmapped steam ids
export async function syncUnmappedFromLatestBucket({ limit = 500, threshold = 0.55 } = {}) {
  const pool = getPG();
  if (!pool) throw new Error("Postgres pool not available");
  const client = await pool.connect();
  try {
    // find latest bucket_id (prefer non-null)
    const lb = await client.query(`
      SELECT bucket_id
      FROM steamspy_trending
      WHERE bucket_id IS NOT NULL
      GROUP BY bucket_id
      ORDER BY MAX(snapshot_time) DESC
      LIMIT 1
    `);
    let rows;
    if (lb.rowCount > 0) {
      const bucketId = lb.rows[0].bucket_id;
      rows = await client.query(
        `SELECT steam_id, name FROM steamspy_trending WHERE bucket_id = $1 LIMIT $2`,
        [bucketId, limit]
      );
    } else {
      // fallback to latest snapshot_time
      const ls = await client.query(`SELECT snapshot_time FROM steamspy_trending ORDER BY snapshot_time DESC LIMIT 1`);
      if (ls.rowCount === 0) return { processed: 0, matched: 0 };
      const latestSnapshot = ls.rows[0].snapshot_time;
      rows = await client.query(
        `SELECT steam_id, name FROM steamspy_trending WHERE snapshot_time = $1 LIMIT $2`,
        [latestSnapshot, limit]
      );
    }
    const candidates = rows.rows;
    let matched = 0, processed = 0;
    for (const c of candidates) {
      processed++;
      const steamId = c.steam_id;
      const name = c.name || "";
      // skip if mapping exists
      const existing = await client.query(`SELECT 1 FROM steam_rawg_map WHERE steam_id = $1 LIMIT 1`, [steamId]);
      if (existing.rowCount > 0) continue;
      // try auto-match
      try {
        const result = await autoMatchRawg(steamId, name, { threshold });
        if (result) {
          await client.query(
            `INSERT INTO steam_rawg_map (steam_id, rawg_id, source, confidence, metadata, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5, now(), now())
             ON CONFLICT (steam_id) DO NOTHING`,
            [steamId, String(result.rawgId), "auto", result.score, JSON.stringify(result.candidate)]
          );
          matched++;
        } else {
          // optional: record conflict for manual review
          await client.query(
            `INSERT INTO steam_rawg_conflicts (steam_id, tried_payload, reason, created_at)
             VALUES ($1, $2, $3, now())`,
            [steamId, JSON.stringify({ name }), 'no-good-candidate']
          );
        }
      } catch (e) {
        await client.query(
          `INSERT INTO steam_rawg_conflicts (steam_id, tried_payload, reason, created_at)
           VALUES ($1, $2, $3, now())`,
          [steamId, JSON.stringify({ name, err: e.message }), 'exception']
        );
      }
    }
    return { processed, matched };
  } finally {
    client.release();
  }
}
