// utils/profileExtras.js
//
// Small shared pieces of the profile: a custom status (only while it hasn't
// expired), notification preferences (which kinds of notification you
// want), a game picked for your favourite or banner, and your picture.

import User from "../models/User.js";

/** Your custom status, or null once it's expired (or there's none). */
export function activeStatus(s) {
  if (!s?.text) return null;
  if (s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now()) return null;
  return { text: s.text, expiresAt: s.expiresAt ?? null };
}

/* Notification kinds, grouped the way the profile's switches are. */
export const NOTIFY_GROUPS = {
  friend: "friends",
  friend_request: "friends",
  friend_accept: "friends",
  mention: "mentions",
  review_like: "likes",
  comment_like: "likes",
  message: "messages",
};
export const NOTIFY_KEYS = ["friends", "mentions", "likes", "messages"];

/** Everything on unless you've turned it off. */
export function notifyPrefs(user) {
  const n = user?.settings?.notifications ?? {};
  return Object.fromEntries(NOTIFY_KEYS.map((k) => [k, n[k] !== false]));
}

/** Does this user want notifications of this type? (Yes, if unsure.) */
export async function wantsNotification(userId, type) {
  const group = NOTIFY_GROUPS[type];
  if (!group) return true;
  const u = await User.findById(userId, { "settings.notifications": 1 }).lean();
  return notifyPrefs(u)[group];
}

/** A game picked from search ({ rawgId, name, cover }), checked; or an error message. */
export function parseGamePick(f) {
  const rawgId = String(f?.rawgId ?? "");
  const name = String(f?.name ?? "").trim();
  const cover = f?.cover ? String(f.cover) : "";
  if (!/^\d{1,10}$/.test(rawgId) || !name || name.length > 150 || cover.length > 600 || (cover && !/^https:\/\//.test(cover))) {
    return { error: "That game didn't come through. Pick it again." };
  }
  return { game: { rawgId, name, cover: cover || undefined } };
}

/** The picture others see: the one you chose (or none, if you chose your
    initial), else a linked account's. */
export function publicAvatar(user) {
  if (user?.avatarSource === "none") return null;
  return user?.profilePicture || user?.linkedAccounts?.find((a) => a.avatar)?.avatar || null;
}
