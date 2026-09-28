import express from "express";
import { activeStatus, publicAvatar } from "../utils/profileExtras.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { rawgToSteamAppId } from "../utils/rawgToSteam.js";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import GameReview from "../models/GameReview.js";
import { getLibraryForUser } from "../utils/getLibraryForUser.js";
import { getSteamIdFromUser } from "../utils/getSteamIdFromUser.js";
import { checkOwnership } from "../utils/checkOwnership.js";

import SteamLibrary from "../models/SteamLibraries.js";
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { searchLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";
import steamAutoSync from "../middleware/SteamAutoSync.js";
import { syncSteamLibraryNow } from "../services/steamLibrary.js";

dotenv.config();
const router = express.Router();



// --- STEAM ---
router.get("/games/:steamid", async (req, res) => {
  const { steamid } = req.params;
  try {
    const response = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamid}&format=json`
    );
    const data = await response.json();
    res.json(data.response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- RAWG ---
router.get("/rawg/game/:id", async (req, res) => {
  const gameId = req.params.id;

  if (!process.env.RAWG_API_KEY) {
    return res.status(500).json({ error: "RAWG_API_KEY missing" });
  }

  try {
    const response = await fetch(
      `https://api.rawg.io/api/games/${gameId}?key=${process.env.RAWG_API_KEY}`,
      {
        headers: {
          "User-Agent": "GameSocial/1.0",
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      logger.warn("RAWG %s status: %d", gameId, response.status);

      return res.status(response.status).json({
        error: "RAWG request failed",
        status: response.status
      });
    }

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    logger.error({ err }, "RAWG fetch error");
    return res.status(500).json({ error: "RAWG fetch failed" });
  }
});



// --- EPIC ---
router.get("/epic/test", async (req, res) => {
  try {
    const response = await fetch("https://api.epicgames.dev/epic/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.EPIC_CLIENT_ID}:${process.env.EPIC_CLIENT_SECRET}`
          ).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch token" });
  }
});

// --- MY STEAM LIBRARY ---






// "Sync now" on the Library page: fetch the library from Steam at once.
router.post("/me/library/sync", requireAuth, async (req, res) => {
  const steamId = getSteamIdFromUser(req.user);
  if (!steamId) return res.status(400).json({ error: "Link your Steam account first." });
  try {
    const result = await syncSteamLibraryNow(req.user._id, steamId);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.retryMs) return res.status(429).json({ error: "Synced a moment ago. Try again in a minute.", retryMs: err.retryMs });
    logger.error({ err }, "manual Steam sync failed");
    res.status(502).json({ error: "Couldn't reach Steam. Try again in a moment." });
  }
});

router.get("/me/library", requireAuth, steamAutoSync, async (req, res) => {
  try {
    const data = await getLibraryForUser(req.user._id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load library" });
  }
});
router.get("/me/owns/:rawgId", requireAuth, async (req, res) => {
  try {
    const { rawgId } = req.params;

    const owned = await checkOwnership(req.user._id, rawgId);

    res.json({ owned });
  } catch (err) {
    res.status(500).json({ owned: false });
  }
});

router.get("/me/game/:rawgId/stats", requireAuth, async (req, res) => {
  try {
    const steamId = getSteamIdFromUser(req.user);

    if (!steamId) {
      return res.json([]);
    }

    if (!process.env.STEAM_API_KEY) {
      return res.status(500).json([]);
    }

    const steamAppId = await rawgToSteamAppId(req.params.rawgId);

    if (!steamAppId) return res.json([]);

    const url =
      `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/` +
      `?key=${process.env.STEAM_API_KEY}` +
      `&steamid=${steamId}` +
      `&appid=${steamAppId}`;


    const r = await fetch(url);
    if (r.status === 400) {
      return res.status(403).json({ private: true });
    }


    if (!r.ok) return res.json([]);

    const json = await r.json();
    const stats = json?.playerstats?.stats;

    if (!Array.isArray(stats)) {
      return res.json([]);
    }

    res.json(
      stats.map(s => ({
        name: s.name,
        value: s.value,
        label: s.name.replace(/_/g, " ")
      }))
    );
  } catch (e) {
    res.status(500).json([]);
  }
});

router.get("/me/game/:rawgId/achievements", requireAuth, async (req, res) => {
  try {
    const steamId = getSteamIdFromUser(req.user);

    if (!steamId) {
      return res.json({});
    }

    if (!process.env.STEAM_API_KEY) {
      return res.status(500).json({ error: "steam_key_missing" });
    }

    const steamAppId = await rawgToSteamAppId(req.params.rawgId);

    if (!steamAppId) return res.json({});

    const url =
      `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/` +
      `?key=${process.env.STEAM_API_KEY}` +
      `&steamid=${steamId}` +
      `&appid=${steamAppId}`;


    const r = await fetch(url);
    if (r.status === 400) {
      return res.status(403).json({ private: true });
    }


    if (!r.ok) return res.json({});

    const json = await r.json();

    const achievements = json?.playerstats?.achievements;
    if (!Array.isArray(achievements)) {
      return res.json({});
    }

    const unlocked = achievements.filter(a => a.achieved === 1).length;

    res.json({
      total: achievements.length,
      unlocked,
      achievements: achievements.map(a => ({
        name: a.apiname,
        achieved: a.achieved,
        unlockTime: a.unlocktime
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "achievements_failed" });
  }
});

router.get("/me/game/:rawgId/summary", requireAuth, async (req, res) => {
  try {
    const steamId = getSteamIdFromUser(req.user);

    const steamAppId = await rawgToSteamAppId(req.params.rawgId);

    if (!steamAppId) {
      return res.json({});
    }

    const lib = await SteamLibrary.findOne(
      { userId: req.user._id, "games.appid": steamAppId },
      { "games.$": 1 }
    ).lean();


    if (!lib || !lib.games?.length) {
      return res.json({});
    }

    const g = lib.games[0];

    res.json({
      appid: g.appid,
      playtimeForever: g.playtimeForever,
      playtime2Weeks: g.playtime2Weeks,
      hasCommunityVisibleStats: g.hasCommunityVisibleStats
    });
  } catch (e) {
    res.status(500).json({ error: "summary_failed" });
  }
});

router.get("/game/:rawgId/achievement-rarity", async (req, res) => {
  try {
    const steamAppId = await rawgToSteamAppId(req.params.rawgId);
    if (!steamAppId) return res.json({});

    const url =
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/` +
      `?gameid=${steamAppId}`;

    const r = await fetch(url);
    if (!r.ok) return res.json({});

    const json = await r.json();
    const list = json?.achievementpercentages?.achievements;
    if (!Array.isArray(list)) return res.json({});

    const map = {};
    for (const a of list) {
      map[a.name] = a.percent;
    }

    res.json(map);
  } catch (e) {
    res.status(500).json({});
  }
  
});

/* ---------------- Settings ----------------
   GET   /api/me/settings   { voice: { pttKey, pttDelay, pttSounds }, saved }
                            (the defaults filled in; saved: stored yet)
   PATCH /api/me/settings   { voice: { ...any of those } } -> the same shape
   Only known fields with valid values are stored; anything else is a 400. */
const VOICE_DEFAULTS = { pttKey: "KeyV", pttDelay: 0, pttSounds: false };
const PTT_DELAYS = [0, 150, 300, 600];

function settingsOut(u) {
  const voice = u?.settings?.voice ?? {};
  return {
    voice: {
      pttKey: voice.pttKey ?? VOICE_DEFAULTS.pttKey,
      pttDelay: voice.pttDelay ?? VOICE_DEFAULTS.pttDelay,
      pttSounds: voice.pttSounds ?? VOICE_DEFAULTS.pttSounds,
    },
    saved: voice.pttKey != null || voice.pttDelay != null || voice.pttSounds != null,
  };
}

router.get("/me/settings", requireAuth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id, { settings: 1 }).lean();
    res.json(settingsOut(u));
  } catch (err) {
    logger.error({ err }, "get settings error");
    res.status(500).json({ error: "Couldn't load your settings." });
  }
});

router.patch("/me/settings", requireAuth, async (req, res) => {
  const voice = req.body?.voice;
  if (!voice || typeof voice !== "object" || Array.isArray(voice)) {
    return res.status(400).json({ error: "Nothing to save." });
  }
  const set = {};
  for (const [k, v] of Object.entries(voice)) {
    if (k === "pttKey" && typeof v === "string" && /^[A-Za-z0-9]{1,24}$/.test(v) && v !== "Escape") {
      set["settings.voice.pttKey"] = v;
    } else if (k === "pttDelay" && PTT_DELAYS.includes(v)) {
      set["settings.voice.pttDelay"] = v;
    } else if (k === "pttSounds" && typeof v === "boolean") {
      set["settings.voice.pttSounds"] = v;
    } else {
      return res.status(400).json({ error: `Invalid setting: voice.${k}` });
    }
  }
  if (!Object.keys(set).length) return res.status(400).json({ error: "Nothing to save." });
  try {
    const u = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true, projection: { settings: 1 } }).lean();
    res.json(settingsOut(u));
  } catch (err) {
    logger.error({ err }, "save settings error");
    res.status(500).json({ error: "Couldn't save your settings." });
  }
});

// GET /api/users/search?username=har
router.get("/users/search", requireAuth, searchLimiter, async (req, res) => {
  const { username } = req.query;
  if (!username || username.length < 3) return res.json([]);

  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Prefix match on the lowercased copy: an index range MongoDB can walk,
  // unlike a case-insensitive regex (which no index can serve).
  const users = await User.find(
    {
      usernameLower: { $regex: `^${escaped.toLowerCase()}` },
      _id: { $ne: req.user._id },
    },
    { username: 1, displayName: 1, avatar: 1 }
  )
    .limit(10)
    .lean();

  // relation: "friend" | "outgoing" (I asked them) | "incoming" (they asked
  // me) | "none", with the pending request's id so the UI can act on it.
  const ids = users.map(u => u._id);
  const pending = await FriendRequest.find({
    $or: [
      { from: req.user._id, to: { $in: ids } },
      { to: req.user._id, from: { $in: ids } },
    ],
  }).lean();

  const result = users.map(u => {
    const isFriend = req.user.friends.some(f => f.equals(u._id));
    const out = pending.find(r => r.to.equals(u._id));
    const inc = pending.find(r => r.from.equals(u._id));
    return {
      ...u,
      isFriend,
      relation: isFriend ? "friend" : out ? "outgoing" : inc ? "incoming" : "none",
      requestId: (out || inc)?._id ?? null,
    };
  });

  res.json(result);
});


// POST /api/friends/add/:userId

/* GET /api/users/:username/profile: someone's public profile (/u/:username):
   who they are (picture, name, status, bio, favourite game, banner or
   their most played games' art), their review and friend counts, a few
   friends, and, when you're signed in, how you're connected (friend,
   request either way, or you). */
router.get("/users/:username/profile", async (req, res) => {
  try {
    // Case-insensitive: /u/Harshit and /u/harshit are the same profile.
    const user = await User.findOne({ usernameLower: req.params.username.toLowerCase(), deleted: { $ne: true } }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const me = req.user?._id ?? null;
    const [friends, reviews, library, pending] = await Promise.all([
      User.find({ _id: { $in: (user.friends ?? []).slice(0, 12) } }, { username: 1, displayName: 1, profilePicture: 1, avatarSource: 1, "linkedAccounts.avatar": 1 }).lean(),
      GameReview.countDocuments({ userId: user._id, visibility: "public" }),
      user.banner?.cover ? null : getLibraryForUser(user._id).catch(() => null),
      me && !me.equals(user._id)
        ? FriendRequest.findOne({ $or: [{ from: me, to: user._id }, { from: user._id, to: me }] }).lean()
        : null,
    ]);
    const wall = (library?.games ?? [])
      .filter(({ rawg }) => rawg?.background_image)
      .sort((a, b) => (b.steam.playtimeForever || 0) - (a.steam.playtimeForever || 0))
      .slice(0, 12)
      .map(({ rawg }) => rawg.background_image);

    let relation = "none";
    if (!me) relation = "guest";
    else if (me.equals(user._id)) relation = "self";
    else if ((user.friends ?? []).some((f) => f.equals(me))) relation = "friend";
    else if (pending) relation = pending.from.equals(me) ? "outgoing" : "incoming";

    res.json({
      id: String(user._id),
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: publicAvatar(user),
      bio: user.bio ?? "",
      status: activeStatus(user.customStatus),
      favoriteGame: user.favoriteGame?.rawgId ? user.favoriteGame : null,
      banner: user.banner?.rawgId ? user.banner : null,
      wall,
      createdAt: user.createdAt ?? null,
      stats: { reviews, friends: (user.friends ?? []).length },
      friends: friends.map((f) => ({
        id: String(f._id),
        name: f.displayName || f.username || "Player",
        username: f.username ?? null,
        avatar: publicAvatar(f),
      })),
      relation,
      requestId: pending ? String(pending._id) : null,
    });
  } catch (err) {
    logger.error({ err }, "public profile failed");
    res.status(500).json({ error: "Failed to load profile" });
  }
});


router.get("/users/:username/library", async (req, res) => {
  try {
    const user = await User.findOne(
      { usernameLower: req.params.username.toLowerCase() },
      { _id: 1 }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🔒 OPTIONAL privacy check can go here later

    const data = await getLibraryForUser(user._id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load library" });
  }
});

router.get("/new-releases", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const db = getPG();

    const { rows } = await db.query(
      `
      SELECT
        id,
        name,
        background_image,
        released,
        genres,
        platforms,
        metacritic,
        rating
      FROM games
      WHERE released IS NOT NULL
        AND released <= CURRENT_DATE
        AND background_image is not null
        AND suggestions_count is not null
      ORDER BY released DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json(
      rows.map(r => ({
        id: r.id,
        title: r.name,
        background_image: r.background_image,
        released: r.released,
        genres: r.genres,
        platforms: r.platforms,
        metacritic: r.metacritic,
        rating: r.rating
      }))
    );
  } catch (err) {
    logger.error({ err }, "new-releases query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ───────── Upcoming ─────────
   Games not out yet, soonest first, from our own games table. Same shape as
   /new-releases so the homepage renders both with one carousel. */
router.get("/upcoming", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const db = getPG();

    const { rows } = await db.query(
      `
      SELECT id, name, background_image, released, genres, platforms,
             metacritic, rating
      FROM games
      WHERE released IS NOT NULL
        AND released > CURRENT_DATE
        AND background_image IS NOT NULL
        AND suggestions_count IS NOT NULL
      ORDER BY released ASC, id
      LIMIT $1
      `,
      [limit]
    );

    res.json(
      rows.map(r => ({
        id: r.id,
        title: r.name,
        background_image: r.background_image,
        released: r.released,
        genres: r.genres,
        platforms: r.platforms,
        metacritic: r.metacritic,
        rating: r.rating
      }))
    );
  } catch (err) {
    logger.error({ err }, "upcoming query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// routes/api.js

/* ───────── GameSocial Recommended ───────── */

router.get("/gsrecommended", async (req, res) => {
  try {
    const db = getPG();

    const RECOMMENDED_RAWG_IDS = [
      3498,
      4200,
      3328,
      5286,
      5679,
      4062,
      3439,
      8025,
      3070,
      41494
    ];

    const { rows } = await db.query(
      `
      SELECT
        id,
        name,
        background_image,
        released,
        genres,
        platforms,
        metacritic,
        rating
      FROM games
      WHERE id = ANY($1)
        AND background_image IS NOT NULL
      ORDER BY array_position($1, id)
      `,
      [RECOMMENDED_RAWG_IDS]
    );

    res.json(
      rows.map(r => ({
        id: r.id,
        title: r.name,
        background_image: r.background_image,
        released: r.released,
        genres: r.genres,
        platforms: r.platforms,
        metacritic: r.metacritic,
        rating: r.rating
      }))
    );
  } catch (err) {
    logger.error({ err }, "gsrecommended query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});




export default router;