import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { rawgToSteamAppId } from "../utils/rawgToSteam.js";
import User from "../models/User.js";
import { getLibraryForUser } from "../utils/getLibraryForUser.js";
import { getSteamIdFromUser } from "../utils/getSteamIdFromUser.js";
import { checkOwnership } from "../utils/checkOwnership.js";

import SteamLibrary from "../models/SteamLibraries.js";
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { searchLimiter } from "../middleware/rateLimiter.js";
import { requireAuth } from "../middleware/requireAuth.js";

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

// --- RIOT ---
router.get("/riot/summoner/:name", async (req, res) => {
  try {
    const response = await fetch(
      `https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(
        req.params.name
      )}`,
      {
        headers: { "X-Riot-Token": process.env.RIOT_API_KEY },
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Riot data" });
  }
});

// --- MY STEAM LIBRARY ---






router.get("/me/library", requireAuth, async (req, res) => {
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

// GET /api/users/search?username=har
router.get("/users/search", requireAuth, searchLimiter, async (req, res) => {
  const { username } = req.query;
  if (!username || username.length < 3) return res.json([]);

  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const users = await User.find(
    {
      username: { $regex: `^${escaped}`, $options: "i" },
      _id: { $ne: req.user._id },
    },
    { username: 1, displayName: 1, avatar: 1 }
  ).limit(10);

  const result = users.map(u => ({
    ...u.toObject(),
    isFriend: req.user.friends.includes(u._id),
  }));

  res.json(result);
});


// POST /api/friends/add/:userId

router.get("/users/:username/profile", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate("friends", "username displayName")
      .lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || null,
      friendsCount: user.friends.length,
      friends: user.friends,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load profile" });
  }
});


router.get("/users/:username/library", async (req, res) => {
  try {
    const user = await User.findOne(
      { username: req.params.username },
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
        released
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
        released: r.released
      }))
    );
  } catch (err) {
    logger.error({ err }, "new-releases query failed");
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
        released
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
        released: r.released
      }))
    );
  } catch (err) {
    logger.error({ err }, "gsrecommended query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});




export default router;