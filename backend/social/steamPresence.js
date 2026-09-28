// social/steamPresence.js
//
// "Playing Elden Ring" next to a friend's name, and the Active Now column.
//
// Steam's GetPlayerSummaries reports the game a player is in right now. It's
// asked only about users this pod is currently serving who have Steam
// linked, so the cost is a request per POLL_MS however large the catalogue
// of users is (up to 100 Steam ids per request, which Steam allows).
//
// Only changes are pushed, as "presence" events to that user's friends.

import User from "../models/User.js";
import logger from "../config/logger.js";
import { locallyConnectedUserIds, setPlaying } from "./presence.js";
import { emitToUsers } from "./realtime.js";

const POLL_MS = 60 * 1000;
const STEAM_SUMMARIES =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

let timer = null;

async function pollOnce() {
  const key = process.env.STEAM_API_KEY;
  const online = locallyConnectedUserIds();
  if (!key || online.length === 0) return;

  // Only users with Steam linked; their friends are needed to push changes.
  const users = await User.find(
    { _id: { $in: online }, "linkedAccounts.provider": "steam" },
    { linkedAccounts: 1, friends: 1 }
  ).lean();
  if (users.length === 0) return;

  const bySteamId = new Map();
  for (const u of users) {
    const steam = u.linkedAccounts.find((a) => a.provider === "steam");
    if (steam?.providerId) bySteamId.set(String(steam.providerId), u);
  }
  if (bySteamId.size === 0) return;

  // Steam takes up to 100 ids per call.
  const ids = [...bySteamId.keys()].slice(0, 100);
  const res = await fetch(`${STEAM_SUMMARIES}?key=${key}&steamids=${ids.join(",")}`);
  if (!res.ok) throw new Error(`Steam summaries ${res.status}`);
  const players = (await res.json())?.response?.players ?? [];

  const seen = new Set();
  for (const p of players) {
    seen.add(String(p.steamid));
    const user = bySteamId.get(String(p.steamid));
    if (!user) continue;
    // gameextrainfo is the game's name; absent when they're not in one.
    if (setPlaying(user._id, p.gameextrainfo ? { name: p.gameextrainfo } : null)) {
      emitToUsers([...(user.friends ?? []), user._id], "presence", {
        userId: String(user._id),
        playing: p.gameextrainfo ?? null
      });
    }
  }

  // A private or missing profile: treat as "not in a game".
  for (const [steamId, user] of bySteamId) {
    if (seen.has(steamId)) continue;
    if (setPlaying(user._id, null)) {
      emitToUsers([...(user.friends ?? []), user._id], "presence", {
        userId: String(user._id),
        playing: null
      });
    }
  }
}

export function startSteamPresence() {
  if (timer) return;
  timer = setInterval(() => {
    pollOnce().catch((err) => logger.warn("Steam presence poll failed: %s", err.message));
  }, POLL_MS);
  timer.unref?.();
}
