// backend/utils/steamRawgMap.js
import fetch from "node-fetch"; // safe even if Node has native fetch
import { getPG } from "../config/db.js"; // adjust path if needed

const RAWG_API_KEY = process.env.RAWG_API_KEY || ""; // optional
const RAWG_BASE = "https://api.rawg.io/api"; // RAWG API base

// Roman numerals as they appear in titles, mapped to digits so "Baldur's
// Gate III" and "Baldur's Gate 3" normalize to the same tokens. Only standalone
// tokens are rewritten; "i" is left alone since it's also a word.
const ROMAN = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

// Words that mark a RAWG entry as something other than the game itself (the
// Steam listing is always the game). An entry carrying one the Steam name
// doesn't have is almost certainly a tool, soundtrack or add-on.
const NON_GAME_WORDS = new Set([
  "toolkit", "tool", "tools", "editor", "sdk", "modkit", "soundtrack", "ost",
  "artbook", "dlc", "demo", "playtest", "beta", "server", "goodie", "pack",
  "bundle", "season", "pass", "expansion", "trailer", "benchmark",
]);

// Normalizes game name for simple fuzzy compares
function normalizeName(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((t) => ROMAN[t] ?? t)
    .join(" ");
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
  let score = common / Math.max(as.size, bs.size);
  // Penalise each non-game marker word present only on the RAWG side, so
  // "Baldur's Gate 3 Toolkit" can't outscore "Baldur's Gate III".
  for (const t of bs) if (NON_GAME_WORDS.has(t) && !as.has(t)) score -= 0.25;
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

// Steam app IDs this RAWG game links to, from its store listings. RAWG's
// search results only name the stores; the URLs (which carry the app ID)
// need this per-game call.
export async function steamAppIdsForRawgGame(rawgId) {
  const params = new URLSearchParams();
  if (RAWG_API_KEY) params.set("key", RAWG_API_KEY);
  const r = await fetch(`${RAWG_BASE}/games/${rawgId}/stores?${params}`, { timeout: 10000 });
  if (!r.ok) throw new Error(`RAWG stores failed ${r.status}`);
  const json = await r.json();
  const ids = new Set();
  for (const s of json.results ?? []) {
    const m = /store\.steampowered\.com\/app\/(\d+)/.exec(s.url ?? "");
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

// How many candidates to check against Steam store links. Each check is a
// RAWG API call, so only the best few by name that list a Steam store.
const STORE_CHECKS = 4;

// Auto-match single steam item (name) -> best rawg candidate
// returns { rawgId, score, candidate, verified } or null if none good
//
// 1. Store verification: a candidate whose RAWG store links point at this
//    exact Steam app ID is the right game, whatever its name (this is how
//    "PUBG: BATTLEGROUNDS" finds "PlayerUnknown's Battlegrounds"). Score 1.
// 2. Otherwise fall back to the best name similarity above the threshold.
export async function autoMatchRawg(steamId, steamName, opts = {}) {
  const { threshold = 0.55 } = opts; // require minimum similarity
  const candidates = await searchRawgByName(steamName, 8);
  if (!candidates.length) return null;

  const scored = candidates
    .map((c) => ({ candidate: c, rawgId: c.id, score: nameSimilarity(steamName, c.name || c.slug || "") }))
    .sort((a, b) => b.score - a.score);

  const sid = Number(steamId);
  if (Number.isFinite(sid) && sid > 0) {
    const onSteam = scored
      .filter((s) => (s.candidate.stores ?? []).some((st) => st?.store?.slug === "steam"))
      .slice(0, STORE_CHECKS);
    for (const s of onSteam) {
      try {
        const appIds = await steamAppIdsForRawgGame(s.rawgId);
        if (appIds.has(sid)) return { ...s, score: 1, verified: true };
      } catch {
        // A failed lookup just means no verification for this candidate.
      }
    }
  }

  const best = scored[0];
  if (!best || best.score < threshold) return null;
  return { ...best, verified: false };
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
