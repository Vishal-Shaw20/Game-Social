// backend/utils/steamAppInfo.js
//
// Tells games apart from software in SteamSpy's trending list, which is
// "top 100 by players" and so includes tools people leave running
// (Wallpaper Engine, OBS...). Neither the name matcher nor RAWG can tell the
// difference; Steam can.
//
// Steam's `type` is no help on its own: it reports Wallpaper Engine as
// "game". What does separate them is genre. Steam files software under a
// fixed set of software genres (Utilities, Design & Illustration, ...), and
// a real game essentially never carries one. So an app is a game when Steam
// says type "game" AND none of its genres are software genres.
//
// Each app is looked up once and remembered in steam_app_info; apps don't
// change what they are. `override` (true/false) beats the computed value for
// the odd miscategorised app:
//   UPDATE steam_app_info SET override = true WHERE steam_id = <appid>;

import { getPG } from "../config/db.js";
import logger from "../config/logger.js";

const APPDETAILS_URL = "https://store.steampowered.com/api/appdetails";

// Steam's software genre IDs.
const SOFTWARE_GENRES = new Map([
  ["50", "Accounting"],
  ["51", "Animation & Modeling"],
  ["52", "Audio Production"],
  ["53", "Design & Illustration"],
  ["54", "Education"],
  ["55", "Photo Editing"],
  ["56", "Software Training"],
  ["57", "Utilities"],
  ["58", "Video Production"],
  ["59", "Web Publishing"],
  ["60", "Game Development"],
]);

// The store API allows roughly 200 requests per 5 minutes; stay well under.
const REQUEST_GAP_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tableReady = null;

// There is no migration system for this database, so the table is created on
// first use. Memoised: one CREATE per process.
export function ensureSteamAppInfoTable() {
  if (!tableReady) {
    const pool = getPG();
    if (!pool) return Promise.reject(new Error("Postgres pool not available"));
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS steam_app_info (
        steam_id   bigint PRIMARY KEY,
        name       text,
        type       text,
        genres     text[] NOT NULL DEFAULT '{}',
        is_game    boolean NOT NULL,
        override   boolean,
        checked_at timestamptz NOT NULL DEFAULT now()
      )
    `).catch((err) => {
      tableReady = null; // let the next caller retry
      throw err;
    });
  }
  return tableReady;
}

// null when Steam has no answer (delisted, region-locked, rate limited):
// the app stays unclassified, is treated as a game, and is retried next run.
async function fetchAppDetails(steamId) {
  const url = `${APPDETAILS_URL}?appids=${steamId}&filters=basic,genres`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`appdetails ${steamId} failed: ${r.status}`);
  const json = await r.json();
  const entry = json?.[steamId];
  if (!entry?.success || !entry.data) return null;

  const genres = (entry.data.genres ?? []).map((g) => ({
    id: String(g.id),
    name: g.description,
  }));
  const type = entry.data.type ?? null;
  const isGame = type === "game" && !genres.some((g) => SOFTWARE_GENRES.has(g.id));

  return { name: entry.data.name ?? null, type, genres: genres.map((g) => g.name), isGame };
}

/**
 * Classify any of these Steam app IDs not already in steam_app_info.
 * Sequential and throttled; safe to call repeatedly (already-known apps are
 * skipped without a request). Never throws for a single bad app.
 */
export async function classifyNewApps(steamIds) {
  const ids = [...new Set(steamIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return { checked: 0, classified: 0, software: [] };

  await ensureSteamAppInfoTable();
  const pool = getPG();

  const { rows } = await pool.query(
    `SELECT steam_id FROM steam_app_info WHERE steam_id = ANY($1)`,
    [ids]
  );
  const known = new Set(rows.map((r) => Number(r.steam_id)));
  const todo = ids.filter((id) => !known.has(id));

  let classified = 0;
  const software = [];

  for (const [i, id] of todo.entries()) {
    if (i > 0) await sleep(REQUEST_GAP_MS);
    try {
      const info = await fetchAppDetails(id);
      if (!info) continue;
      await pool.query(
        `INSERT INTO steam_app_info (steam_id, name, type, genres, is_game, checked_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (steam_id) DO UPDATE
           SET name = EXCLUDED.name, type = EXCLUDED.type, genres = EXCLUDED.genres,
               is_game = EXCLUDED.is_game, checked_at = now()`,
        [id, info.name, info.type, info.genres, info.isGame]
      );
      classified++;
      if (!info.isGame) software.push(`${info.name} (${id})`);
    } catch (err) {
      logger.warn("Steam app classification failed for %s: %s", id, err.message);
    }
  }

  if (todo.length) {
    logger.info(
      "Steam app classification: %d new, %d classified, not games: %s",
      todo.length, classified, software.join(", ") || "none"
    );
  }
  return { checked: todo.length, classified, software };
}

// Classify every app in the newest SteamSpy snapshot. Used at startup, since
// the cron skips a bucket that already exists and would otherwise never
// classify it.
export async function classifyLatestBucket() {
  const pool = getPG();
  const { rows } = await pool.query(`
    SELECT steam_id FROM steamspy_trending
    WHERE bucket_id = (
      SELECT bucket_id FROM steamspy_trending ORDER BY snapshot_time DESC LIMIT 1
    )
  `);
  return classifyNewApps(rows.map((r) => r.steam_id));
}
