// routes/gamePage.js
//
// Everything the game page (/game/:id, :id = RAWG id) shows, in four calls
// so the slow or personal parts never hold up the rest:
//
//   GET /api/gamepage/:id            public data: our games row + Steam +
//                                    SteamSpy + RAWG, merged into one object
//   GET /api/gamepage/:id/community  the dock's chat room numbers, and
//                                    (signed in) friends tied to the game
//   GET /api/gamepage/:id/me         signed-in owner: playtime, achievements
//   GET /api/gamepage/:id/similar    gamiq "games like this" (pending/poll)
//
// Read-only against Postgres and Mongo. Outside data is cached per source in
// utils/pageCache.js (Redis), so a popular game costs Steam and RAWG a
// handful of calls per day, not one per view. Any source that fails or has
// nothing is simply absent from the response and the page hides that part.

import express from "express";
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { rawgToSteamAppId } from "../utils/rawgToSteam.js";
import { getSteamIdFromUser } from "../utils/getSteamIdFromUser.js";
import { cached, cacheGet, cacheSet } from "../utils/pageCache.js";
import { summarize } from "../utils/gameText.js";
import {
  steamStore, steamReviews, steamPlayers, steamNews, steamNewsTab, steamAchievements,
  steamSpy, rawgDetail, rawgStores, rawgAdditions, rawgParents, rawgSeries,
  rawgScreenshots,
} from "../utils/gameSources.js";
import GameReview from "../models/GameReview.js";
import GameShelf from "../models/GameShelf.js";
import SteamLibrary from "../models/SteamLibraries.js";
import ChatMessage from "../models/ChatMessage.js";
import User from "../models/User.js";
import { usersInRoom } from "../social/realtime.js";
import { presenceOfMany } from "../social/presence.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";
import steamAutoSync from "../middleware/SteamAutoSync.js";

const router = express.Router();

const GAMIQ_URL = process.env.GAMIQ_URL || "http://localhost:8000";

function parseId(req, res) {
  const id = req.params.id;
  if (!/^\d{1,10}$/.test(id)) {
    res.status(400).json({ error: "id must be a numeric RAWG id" });
    return null;
  }
  return Number(id);
}

const settle = (p) => Promise.resolve(p).catch((err) => {
  logger.warn("game page part failed: %s", err.message);
  return null;
});

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const first = (...vals) => vals.find((v) => v !== null && v !== undefined && v !== "" &&
  !(Array.isArray(v) && v.length === 0));

// node-pg turns a DATE column into a local-midnight Date; read it back in
// local time so it doesn't slip a day in timezones ahead of UTC.
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function parseJsonish(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return v; }
}

/* ── our own database ── */

async function dbGame(pg, id) {
  const { rows } = await pg.query(`SELECT * FROM games WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

async function dbSeries(pg, id) {
  const { rows } = await pg.query(
    `SELECT g.id, g.name, g.background_image, g.released, g.genres, g.platforms,
            g.metacritic, g.rating
       FROM game_series s
       JOIN games g ON g.id = s.series_game_id
      WHERE s.game_id = $1 AND s.series_game_id <> $1
      ORDER BY g.released DESC NULLS LAST
      LIMIT 24`,
    [id]
  );
  return rows;
}

// The related games (base game, DLC, series) get a description and
// developer from the games table where we have them, for the page's
// spotlight of them. Games we don't have keep what RAWG's list gave.
async function withDetails(pg, lists) {
  const ids = [...new Set(lists.flat().map((g) => Number(g?.id)).filter(Number.isFinite))];
  if (!ids.length) return lists;
  const { rows } = await pg.query(
    `SELECT id, description_raw, developers FROM games WHERE id = ANY($1::int[])`,
    [ids]
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return lists.map((list) =>
    list.map((g) => {
      const r = byId.get(Number(g?.id));
      if (!r) return g;
      return {
        ...g,
        summary: g.summary ?? summarize(r.description_raw),
        developers: g.developers?.length ? g.developers : arr(r.developers),
      };
    })
  );
}

/* ── GET /:id ── */

router.get("/:id", apiLimiter, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const pg = getPG();
  if (!pg) return res.status(500).json({ error: "Postgres pool not initialized" });

  try {
    const [row, steamAppId, seriesRows] = await Promise.all([
      dbGame(pg, id),
      settle(rawgToSteamAppId(id)),
      settle(dbSeries(pg, id)),
    ]);

    const steamParts = steamAppId
      ? Promise.all([
          settle(steamStore(steamAppId)),
          settle(steamReviews(steamAppId)),
          settle(steamPlayers(steamAppId)),
          settle(steamNews(steamAppId)),
          settle(steamSpy(steamAppId)),
        ])
      : Promise.resolve([]);

    const [[store, reviews, players, news, spy], rawg, stores] =
      await Promise.all([steamParts, settle(rawgDetail(id)), settle(rawgStores(id))]);

    if (!row && !rawg && !store) return res.status(404).json({ error: "Game not found" });

    const counts = {
      screenshots: first(row?.screenshots_count, rawg?.screenshots_count) ?? 0,
      achievements: first(row?.achievements_count, rawg?.achievements_count) ?? 0,
      additions: first(row?.additions_count, rawg?.additions_count) ?? 0,
      parents: first(row?.parents_count, rawg?.parents_count) ?? 0,
      series: first(row?.game_series_count, rawg?.game_series_count) ?? 0,
      suggestions: row?.suggestions_count ?? null,
    };

    // Second wave: only the RAWG lists this game actually has entries in.
    const [rawgShots, additions, parents, rawgSeriesList] = await Promise.all([
      store?.screenshots?.length ? null : settle(rawgScreenshots(id)),
      counts.additions > 0 ? settle(rawgAdditions(id)) : null,
      counts.parents > 0 ? settle(rawgParents(id)) : null,
      !seriesRows?.length && counts.series > 0 ? settle(rawgSeries(id)) : null,
    ]);
    const [dlcList, parentList, seriesList] = (await settle(withDetails(pg, [
      additions ?? [],
      parents ?? [],
      (seriesRows?.length ? seriesRows : rawgSeriesList) ?? [],
    ]))) ?? [additions ?? [], parents ?? [], (seriesRows?.length ? seriesRows : rawgSeriesList) ?? []];

    const esrb = parseJsonish(row?.esrb_rating);
    const released = first(row?.released, rawg?.released);

    res.json({
      id,
      slug: first(row?.slug, rawg?.slug) ?? null,
      name: first(row?.name, rawg?.name, store?.name) ?? "Unknown game",
      originalName: row?.name_original && row.name_original !== row.name ? row.name_original : null,
      alternativeNames: arr(first(row?.alternative_names, rawg?.alternative_names)),
      steamAppId: steamAppId ?? null,

      // Steam's description carries its own images and formatting; RAWG's
      // is the plainer fallback.
      description: first(store?.detailedDescription, row?.description, rawg?.description) ?? "",
      shortDescription: store?.shortDescription ?? null,

      released: isoDate(released),
      releaseText: store?.releaseDate?.date ?? null,
      comingSoon: Boolean(store?.releaseDate?.coming_soon || rawg?.tba),

      images: {
        hero: first(row?.background_image, rawg?.background_image, store?.background, store?.headerImage) ?? null,
        additional: first(row?.background_image_additional, rawg?.background_image_additional) ?? null,
        header: store?.headerImage ?? null,
      },
      screenshots: first(store?.screenshots, rawgShots) ?? [],
      trailers: store?.trailers ?? [],

      developers: arr(first(row?.developers, rawg?.developers, store?.developers)),
      publishers: arr(first(row?.publishers, rawg?.publishers, store?.publishers)),
      genres: arr(first(row?.genres, rawg?.genres, store?.genres)),
      tags: arr(first(row?.tags, rawg?.tags)),
      steamTags: spy?.tags?.slice(0, 20) ?? [],
      categories: store?.categories ?? [],
      platforms: arr(first(row?.platforms, rawg?.platforms?.map((p) => p.name))),
      steamPlatforms: store?.platforms ?? null,

      links: {
        steam: steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : null,
        rawg: rawg?.slug ? `https://rawg.io/games/${rawg.slug}` : null,
      },
      stores: stores ?? [],

      price: store ? { isFree: store.isFree, ...(store.price ?? {}) } : null,

      ratings: {
        metacritic: first(store?.metacritic?.score, row?.metacritic, rawg?.metacritic) ?? null,
        rawg: {
          rating: first(row?.rating, rawg?.rating) ?? null,
          top: rawg?.rating_top ?? 5,
          count: first(row?.ratings_count, rawg?.ratings_count) ?? null,
        },
        steam: reviews ?? null,
      },

      age: {
        esrb: first(esrb?.name, rawg?.esrb) ?? null,
        requiredAge: store?.requiredAge ?? 0,
        boards: store?.ageRatings ?? {},
        contentNotes: store?.contentNotes ?? null,
      },

      controllerSupport: store?.controllerSupport ?? null,
      requirements: store?.requirements?.pc || store?.requirements?.mac || store?.requirements?.linux
        ? store.requirements
        : rawg?.pc_requirements
          ? { pc: rawg.pc_requirements, mac: null, linux: null }
          : null,

      // Playing on Steam right now (the title panel's "Playing now").
      players: {
        now: players ?? null,
      },

      dlc: dlcList,
      parents: parentList,
      series: seriesList,
      // { updates, patches, press }: each { items, more }; null when none
      news: news ?? null,
      counts,
      legalNotice: store?.legalNotice ?? null,
      updatedAt: rawg?.updated ?? null,
      inDatabase: Boolean(row),
    });
  } catch (err) {
    logger.error({ err }, "game page failed");
    res.status(500).json({ error: "Game page failed" });
  }
});

/* ── GET /:id/community ── */

async function chatInfo(rawgId) {
  const roomId = `game:${rawgId}`;
  const [userIds, messages, last] = await Promise.all([
    usersInRoom(roomId),
    ChatMessage.countDocuments({ roomId }),
    ChatMessage.findOne({ roomId }, { createdAt: 1 }).sort({ createdAt: -1 }).lean(),
  ]);
  return { userIds, here: userIds.length, messages, lastMessageAt: last?.createdAt ?? null };
}

router.get("/:id/community", apiLimiter, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  try {
    const steamAppId = await settle(rawgToSteamAppId(id));
    const [chat, store] = await Promise.all([
      settle(chatInfo(id)),
      steamAppId ? settle(steamStore(steamAppId)) : null,
    ]);

    let friends = [];
    if (req.user?._id) {
      friends = (await settle(friendsFor(req.user._id, id, steamAppId, chat?.userIds ?? [], store?.name))) ?? [];
    }

    res.json({
      chat: chat ? { here: chat.here, messages: chat.messages, lastMessageAt: chat.lastMessageAt } : null,
      friends,
    });
  } catch (err) {
    logger.error({ err }, "game community failed");
    res.status(500).json({ error: "Community data failed" });
  }
});

/* ── GET /:id/chat-stats?tz=<IANA zone> ──
   The chat room's numbers for the modal: activity in the last day and week,
   the busiest hour of the day (in the viewer's time zone, hence tz), and
   who talks most. Deleted messages don't count. Cached briefly per game
   and zone: it's aggregation over the room's messages. */

const validZone = (tz) => {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

async function chatStats(rawgId, tz) {
  const roomId = `game:${rawgId}`;
  const live = { roomId, deletedAt: null };
  const now = Date.now();
  const day = new Date(now - 24 * 3600e3);
  const week = new Date(now - 7 * 24 * 3600e3);
  const month = new Date(now - 30 * 24 * 3600e3);

  const [messages, last, last24h, chatters, hours, top, perHour] = await Promise.all([
    ChatMessage.countDocuments(live),
    ChatMessage.findOne(live, { createdAt: 1 }).sort({ createdAt: -1 }).lean(),
    ChatMessage.countDocuments({ ...live, createdAt: { $gte: day } }),
    ChatMessage.distinct("userId", { ...live, createdAt: { $gte: week } }),
    ChatMessage.aggregate([
      { $match: { ...live, createdAt: { $gte: month } } },
      { $group: { _id: { $hour: { date: "$createdAt", timezone: tz } }, n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: 1 },
    ]),
    ChatMessage.aggregate([
      { $match: { ...live, createdAt: { $gte: week } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 5 },
    ]),
    // Messages in each of the last 24 hours, by how many hours ago (0 = the
    // hour ending now): the modal's activity chart.
    ChatMessage.aggregate([
      { $match: { ...live, createdAt: { $gte: day } } },
      {
        $group: {
          _id: { $floor: { $divide: [{ $subtract: [new Date(now), "$createdAt"] }, 3600e3] } },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);

  // oldest first: hourly[23] is the hour ending now
  const hourly = Array(24).fill(0);
  for (const h of perHour) if (h._id >= 0 && h._id < 24) hourly[23 - h._id] = h.n;

  const users = top.length
    ? await User.find({ _id: { $in: top.map((t) => t._id) } }, { displayName: 1, username: 1, profilePicture: 1 }).lean()
    : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return {
    messages,
    lastMessageAt: last?.createdAt ?? null,
    last24h,
    chattersWeek: chatters.length,
    hourly,
    busiestHour: hours[0] ? { hour: hours[0]._id, messages: hours[0].n } : null,
    topChatters: top
      .filter((t) => byId.has(String(t._id)))
      .map((t) => {
        const u = byId.get(String(t._id));
        return {
          id: String(u._id),
          name: u.displayName || u.username || "Player",
          username: u.username ?? null,
          avatar: u.profilePicture || null,
          messages: t.n,
        };
      }),
  };
}

router.get("/:id/chat-stats", apiLimiter, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const tz = validZone(req.query.tz) ? req.query.tz : "UTC";
  try {
    res.json(await cached(`chatstats:${id}:${tz}`, 60, () => chatStats(id, tz)));
  } catch (err) {
    logger.error({ err }, "chat stats failed");
    res.status(500).json({ error: "Chat stats failed" });
  }
});

/** Friends with any tie to this game: own it, reviewed it, or are in its chat. */
async function friendsFor(userId, rawgId, steamAppId, chatUserIds, steamName) {
  const me = await User.findById(userId, { friends: 1 }).lean();
  const friendIds = (me?.friends ?? []).map(String);
  if (!friendIds.length) return [];

  const [libs, reviews] = await Promise.all([
    steamAppId
      ? SteamLibrary.find(
          { userId: { $in: friendIds }, "games.appid": steamAppId },
          { userId: 1, "games.$": 1 }
        ).lean()
      : [],
    GameReview.find({ rawgId: String(rawgId), userId: { $in: friendIds } }, { userId: 1, verdict: 1 }).lean(),
  ]);

  const owned = new Map(libs.map((l) => [String(l.userId), l.games?.[0]]));
  const verdict = new Map(reviews.map((r) => [String(r.userId), r.verdict]));
  const inChat = new Set(chatUserIds.filter((u) => friendIds.includes(u)));

  const ids = [...new Set([...owned.keys(), ...verdict.keys(), ...inChat])];
  if (!ids.length) return [];

  const [users, presence] = await Promise.all([
    User.find({ _id: { $in: ids } }, { displayName: 1, username: 1, avatar: 1, profilePicture: 1 }).lean(),
    settle(presenceOfMany(ids)),
  ]);

  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return users
    .map((u) => {
      const key = String(u._id);
      const g = owned.get(key);
      const playing = presence?.[key]?.playing ?? null;
      return {
        id: key,
        name: u.displayName || u.username || "Player",
        username: u.username ?? null,
        avatar: u.profilePicture || u.avatar || null,
        status: presence?.[key]?.status ?? "offline",
        owns: Boolean(g),
        hours: g ? Math.round((g.playtimeForever ?? 0) / 6) / 10 : null,
        recentHours: g?.playtime2Weeks ? Math.round(g.playtime2Weeks / 6) / 10 : 0,
        verdict: verdict.get(key) ?? null,
        inChat: inChat.has(key),
        playingNow: Boolean(playing && steamName && norm(playing) === norm(steamName)),
      };
    })
    .sort((a, b) =>
      Number(b.playingNow) - Number(a.playingNow) ||
      Number(b.inChat) - Number(a.inChat) ||
      (b.hours ?? 0) - (a.hours ?? 0));
}

/* ── GET /:id/me ── */

router.get("/:id/me", requireAuth, steamAutoSync, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  try {
    const steamId = getSteamIdFromUser(req.user);
    const [steamAppId, review] = await Promise.all([
      settle(rawgToSteamAppId(id)),
      // your verdict, if you've reviewed it (for the quick look)
      settle(GameReview.findOne({ userId: req.user._id, rawgId: String(id) }, { verdict: 1 }).lean()),
    ]);
    const verdict = review?.verdict ?? null;
    if (!steamAppId) return res.json({ steamLinked: Boolean(steamId), owned: false, verdict });

    const [lib, shelf] = await Promise.all([
      SteamLibrary.findOne(
        { userId: req.user._id, "games.appid": steamAppId },
        { "games.$": 1, lastSyncedAt: 1 }
      ).lean(),
      settle(GameShelf.findOne({ userId: req.user._id, appid: steamAppId }, { status: 1 }).lean()),
    ]);
    const g = lib?.games?.[0];

    const out = {
      steamLinked: Boolean(steamId),
      owned: Boolean(g),
      // the Steam app and your shelf for it (the quick look's shelf picker)
      appid: steamAppId,
      shelf: g ? shelf?.status ?? null : null,
      verdict,
      playtimeHours: g ? Math.round((g.playtimeForever ?? 0) / 6) / 10 : null,
      playtime2WeeksHours: g?.playtime2Weeks ? Math.round(g.playtime2Weeks / 6) / 10 : 0,
      librarySyncedAt: lib?.lastSyncedAt ?? null,
      privateProfile: false,
      achievements: null,
      stats: [],
    };
    if (!g || !steamId || !process.env.STEAM_API_KEY) return res.json(out);

    const key = process.env.STEAM_API_KEY;
    const base = "https://api.steampowered.com/ISteamUserStats";
    const [mine, schema, stats] = await Promise.all([
      fetch(`${base}/GetPlayerAchievements/v1/?key=${key}&steamid=${steamId}&appid=${steamAppId}`,
        { signal: AbortSignal.timeout(8000) }).catch(() => null),
      settle(steamAchievements(steamAppId)),
      fetch(`${base}/GetUserStatsForGame/v2/?key=${key}&steamid=${steamId}&appid=${steamAppId}`,
        { signal: AbortSignal.timeout(8000) }).catch(() => null),
    ]);

    if (mine?.status === 400 || mine?.status === 403) out.privateProfile = true;
    const mineJson = mine?.ok ? await mine.json().catch(() => null) : null;
    const unlocked = new Map(
      (mineJson?.playerstats?.achievements ?? []).map((a) => [a.apiname, a])
    );

    if (unlocked.size || schema?.list?.length) {
      const defs = schema?.list?.length
        ? schema.list
        : [...unlocked.keys()].map((name) => ({ name, displayName: name, percent: null }));
      const list = defs.map((d) => {
        const u = unlocked.get(d.name);
        return {
          ...d,
          achieved: u?.achieved === 1,
          unlockTime: u?.achieved === 1 && u.unlocktime ? u.unlocktime * 1000 : null,
        };
      });
      out.achievements = {
        total: list.length,
        unlocked: list.filter((a) => a.achieved).length,
        list,
      };
    }

    const statsJson = stats?.ok ? await stats.json().catch(() => null) : null;
    out.stats = (statsJson?.playerstats?.stats ?? []).slice(0, 40).map((s) => ({
      name: s.name,
      label: s.name.replace(/^stat_/i, "").replace(/_/g, " "),
      value: s.value,
    }));

    res.json(out);
  } catch (err) {
    logger.error({ err }, "game me failed");
    res.status(500).json({ error: "Your stats failed" });
  }
});

/* ── GET /:id/similar ── */

// gamiq's cross-encoder takes tens of seconds on a cold game, so like the
// homepage's "Because you play" row this answers "pending" and does the work
// in the background; the page polls.
const SIMILAR_TTL = 7 * 24 * 60 * 60;
const SIMILAR_FAIL_TTL = 10 * 60;
const running = new Set();

async function computeSimilar(id) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const r = await fetch(`${GAMIQ_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawg_ids: [id] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`gamiq /recommend ${r.status}`);
    const { rawg_ids: rows } = await r.json();
    const ids = [...new Set((rows ?? []).flat().map(Number))].filter((x) => x && x !== id);
    await cacheSet(`similar:${id}`, { ids }, ids.length ? SIMILAR_TTL : SIMILAR_FAIL_TTL);
  } catch (err) {
    logger.warn("similar games for %s failed: %s", id, err.message);
    await cacheSet(`similar:${id}`, { ids: [], failed: true }, SIMILAR_FAIL_TTL);
  } finally {
    running.delete(id);
  }
}

/* GET /:id/news?tab=updates|patches|press&before=<ms>: the next page of a
   news tab ("Show more"), older than `before`. */
router.get("/:id/news", apiLimiter, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const tab = ["updates", "patches", "press"].includes(req.query.tab) ? req.query.tab : null;
  const before = Number(req.query.before);
  if (!tab || !Number.isFinite(before) || before <= 0) {
    return res.status(400).json({ error: "tab and before are required" });
  }
  try {
    const appId = await rawgToSteamAppId(id);
    if (!appId) return res.json({ items: [], more: false });
    res.json(await steamNewsTab(appId, tab, before));
  } catch (err) {
    logger.error({ err }, "news page failed");
    res.status(502).json({ error: "Couldn't load more news." });
  }
});

router.get("/:id/similar", apiLimiter, async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  try {
    const hit = await cacheGet(`similar:${id}`);
    if (!hit) {
      computeSimilar(id);
      return res.status(202).json({ status: "pending", games: [] });
    }
    if (!hit.ids?.length) return res.json({ status: "unavailable", games: [] });

    const { rows } = await getPG().query(
      `SELECT id, name, background_image, released, genres, platforms, metacritic, rating
         FROM games WHERE id = ANY($1) AND background_image IS NOT NULL`,
      [hit.ids]
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const games = hit.ids.map((x) => byId.get(x)).filter(Boolean);
    res.json({ status: "ready", games });
  } catch (err) {
    logger.error({ err }, "similar failed");
    res.status(500).json({ status: "unavailable", games: [] });
  }
});

export default router;
