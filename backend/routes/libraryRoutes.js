// routes/libraryRoutes.js
//
// The Library page (/api/library), for the signed-in user:
//   GET  /                     the page: the Steam library (matched to RAWG
//                              where we can), your verdicts, your shelves, and
//                              which friends own each game
//   GET  /achievements         unlocked / total per game (cached a while)
//   PUT  /shelves/:appid       { status } puts a game on a shelf; null clears
//   GET  /match-search?q=      RAWG games to link an unmatched Steam game to
//   POST /match                { appid, rawgId } links it
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import steamAutoSync from "../middleware/SteamAutoSync.js";
import { getLibraryForUser, clearLibraryCache } from "../utils/getLibraryForUser.js";
import { searchRawgByName, upsertMapping } from "../utils/steamRawgmap.js";
import { getSteamIdFromUser } from "../utils/getSteamIdFromUser.js";
import { cached } from "../utils/pageCache.js";
import SteamLibrary from "../models/SteamLibraries.js";
import GameShelf, { SHELVES } from "../models/GameShelf.js";
import GameReview from "../models/GameReview.js";
import User from "../models/User.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(requireAuth);

const PUBLIC_USER = { displayName: 1, username: 1, profilePicture: 1, "linkedAccounts.avatar": 1 };
const person = (u) => ({
  id: String(u._id),
  name: u.displayName || u.username || "Someone",
  username: u.username ?? null,
  avatar: u.profilePicture || u.linkedAccounts?.find((a) => a.avatar)?.avatar || null,
});

router.get("/", steamAutoSync, async (req, res) => {
  try {
    const userId = req.user._id;
    const library = await getLibraryForUser(userId);
    if (!library.linked) return res.json(library);

    const appids = library.games.map((g) => g.steam.appid);
    const rawgIds = library.games.map((g) => g.rawg?.id).filter(Boolean).map(String);
    const friendIds = req.user.friends ?? [];

    const [reviews, shelves, friendLibs] = await Promise.all([
      rawgIds.length
        ? GameReview.find({ userId, rawgId: { $in: rawgIds } }, { rawgId: 1, verdict: 1 }).lean()
        : [],
      GameShelf.find({ userId }, { appid: 1, status: 1 }).lean(),
      friendIds.length
        ? SteamLibrary.find({ userId: { $in: friendIds } }, { userId: 1, "games.appid": 1 }).lean()
        : [],
    ]);

    // Friends who own each of your games.
    const owners = {};
    if (friendLibs.length) {
      const mine = new Set(appids);
      const people = new Map(
        (await User.find({ _id: { $in: friendLibs.map((l) => l.userId) } }, PUBLIC_USER).lean())
          .map((u) => [String(u._id), person(u)])
      );
      for (const lib of friendLibs) {
        const who = people.get(String(lib.userId));
        if (!who) continue;
        for (const g of lib.games ?? []) {
          if (!mine.has(g.appid)) continue;
          (owners[g.appid] ??= []).push(who);
        }
      }
    }

    res.json({
      ...library,
      reviews: Object.fromEntries(reviews.map((r) => [r.rawgId, r.verdict])),
      shelves: Object.fromEntries(shelves.map((s) => [s.appid, s.status])),
      owners,
    });
  } catch (err) {
    logger.error({ err }, "library page failed");
    res.status(500).json({ error: "Couldn't load your library." });
  }
});

/* Achievements per game (only games you've played that have them), each
   answer cached for 12 hours, fetched a few at a time. */
const ACH_TTL = 12 * 60 * 60;
const ACH_MAX_GAMES = 80;
async function achievementsOf(steamId, appid) {
  return cached(`ach:${steamId}:${appid}`, ACH_TTL, async () => {
    const r = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&appid=${appid}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.status === 400 || r.status === 403) return { private: true };
    if (!r.ok) throw new Error(`GetPlayerAchievements ${r.status}`);
    const list = (await r.json())?.playerstats?.achievements ?? [];
    if (!list.length) return null;
    return { unlocked: list.filter((a) => a.achieved).length, total: list.length };
  });
}

router.get("/achievements", async (req, res) => {
  const steamId = getSteamIdFromUser(req.user);
  if (!steamId || !process.env.STEAM_API_KEY) return res.json({});
  try {
    const lib = await SteamLibrary.findOne({ userId: req.user._id }, { games: 1 }).lean();
    const games = (lib?.games ?? [])
      .filter((g) => g.hasCommunityVisibleStats && g.playtimeForever > 0)
      .sort((a, b) => b.playtimeForever - a.playtimeForever)
      .slice(0, ACH_MAX_GAMES);
    const out = {};
    let privateProfile = false;
    for (let i = 0; i < games.length; i += 5) {
      const batch = games.slice(i, i + 5);
      const results = await Promise.all(batch.map((g) => achievementsOf(steamId, g.appid).catch(() => null)));
      batch.forEach((g, k) => {
        const a = results[k];
        if (a?.private) privateProfile = true;
        else if (a) out[g.appid] = a;
      });
      if (privateProfile) break; // the rest would be private too
    }
    res.json({ games: out, privateProfile });
  } catch (err) {
    logger.error({ err }, "library achievements failed");
    res.status(500).json({ games: {}, error: "Couldn't load achievements." });
  }
});

router.put("/shelves/:appid", async (req, res) => {
  const appid = Number(req.params.appid);
  const { status } = req.body ?? {};
  if (!Number.isInteger(appid) || appid <= 0) return res.status(400).json({ error: "Bad game." });
  if (status !== null && !SHELVES.includes(status)) return res.status(400).json({ error: "Unknown shelf." });
  try {
    const owns = await SteamLibrary.exists({ userId: req.user._id, "games.appid": appid });
    if (!owns) return res.status(404).json({ error: "That game isn't in your library." });
    if (status === null) await GameShelf.deleteOne({ userId: req.user._id, appid });
    else await GameShelf.updateOne({ userId: req.user._id, appid }, { $set: { status } }, { upsert: true });
    res.json({ ok: true, appid, status });
  } catch (err) {
    logger.error({ err }, "shelf update failed");
    res.status(500).json({ error: "Couldn't save that." });
  }
});

router.get("/match-search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  if (q.length < 2) return res.json([]);
  try {
    const results = await searchRawgByName(q, 8);
    res.json(results.map((g) => ({
      id: g.id,
      name: g.name,
      released: g.released ?? null,
      cover: g.background_image ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "match search failed");
    res.status(502).json({ error: "Couldn't search right now." });
  }
});

router.post("/match", async (req, res) => {
  const appid = Number(req.body?.appid);
  const rawgId = Number(req.body?.rawgId);
  if (!Number.isInteger(appid) || !Number.isInteger(rawgId) || appid <= 0 || rawgId <= 0) {
    return res.status(400).json({ error: "Bad match." });
  }
  try {
    const owns = await SteamLibrary.exists({ userId: req.user._id, "games.appid": appid });
    if (!owns) return res.status(404).json({ error: "That game isn't in your library." });
    await upsertMapping(appid, rawgId, { source: "user", confidence: 1, metadata: { by: String(req.user._id) } });
    clearLibraryCache(req.user._id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "manual match failed");
    res.status(500).json({ error: "Couldn't save that match." });
  }
});

export default router;
