// routes/accountRoutes.js
//
// Your own profile page (/profile, the Dashboard route) and your account:
//   GET    /api/account                    the page: profile, review and
//                                          friend counts, the hero's art,
//                                          friends (with presence), connections
//   PATCH  /api/account                    { displayName, username, bio,
//                                          favoriteGame, banner, status,
//                                          avatarSource, avatarUpload }
//                                          (any of them)
//   PATCH  /api/account/notifications      { friends, mentions, likes,
//                                          messages }: which you get
//   POST   /api/account/email/code         { email }: a code to the new one
//   POST   /api/account/email/verify       { code }: then it's yours
//   POST   /api/account/password           { current?, next }: change it, or
//                                          add one to a Google/Steam account
//   POST   /api/account/signout-others     every other signed-in device
//   DELETE /api/account/connections/:p     unlink google | steam (never your
//                                          last way in); Steam takes its
//                                          synced library with it
//   DELETE /api/account                    { confirm: <your username> }
//   GET    /api/avatar/:userId             an uploaded avatar (public)
//
// Deleting an account keeps what you posted (reviews, comments, messages)
// under "Deleted user": the user record stays as a placeholder with every
// personal field removed, and everything else that's yours is deleted.
import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/requireAuth.js";
import User from "../models/User.js";
import SteamLibrary from "../models/SteamLibraries.js";
import GameShelf from "../models/GameShelf.js";
import GameReview from "../models/GameReview.js";
import ReviewDraft from "../models/ReviewDraft.js";
import Notification from "../models/Notification.js";
import FriendRequest from "../models/FriendRequest.js";
import Activity from "../models/Activity.js";
import Conversation from "../models/Conversation.js";
import { getLibraryForUser, clearLibraryCache } from "../utils/getLibraryForUser.js";
import { presenceOfMany } from "../social/presence.js";
import { USERNAME_REGEX, MAX_DISPLAY_NAME_LENGTH } from "../utils/validation.js";
import { activeStatus, notifyPrefs, NOTIFY_KEYS, parseGamePick, publicAvatar } from "../utils/profileExtras.js";
import { setOtp, getOtp, deleteOtp } from "../config/otpStore.js";
import { sendOtpEmail } from "../config/emailService.js";
import logger from "../config/logger.js";

const MIN_PASSWORD = 8;
const MAX_BIO = 160;
const MAX_STATUS = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byEmail = (email) => ({ email: new RegExp(`^${escapeRe(email)}$`, "i") });

/* Your email counts as confirmed if a code confirmed it (sign-up, a
   change), or Google vouches for it (the same address on your Google). */
function emailVerified(user) {
  if (!user.email) return false;
  if (user.emailVerifiedAt) return true;
  const g = user.linkedAccounts?.find((a) => a.provider === "google");
  return Boolean(g?.email && g.email.toLowerCase() === user.email.toLowerCase());
}
const MAX_AVATAR_CHARS = 90_000; // a 256px image as a data URL, well under the JSON body limit
const AVATAR_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const PROVIDERS = ["google", "steam"];
const oops = (res) => res.status(500).json({ message: "Something went wrong on our side. Try again in a moment." });

const linked = (user, provider) => user.linkedAccounts?.find((a) => a.provider === provider) ?? null;
const hasPassword = (user) => Boolean(linked(user, "native"));

/** The picture the app shows for you, from your choice (avatarSource). */
function avatarUrl(user) {
  const upload = user.avatarVersion ? `${process.env.API_BASE_URL}/api/avatar/${user._id}?v=${user.avatarVersion}` : null;
  const google = linked(user, "google")?.avatar || null;
  const steam = linked(user, "steam")?.avatar || null;
  switch (user.avatarSource) {
    case "upload": return upload;
    case "google": return google;
    case "steam": return steam;
    case "none": return null;
    default: return user.profilePicture || steam || google || null;
  }
}

/* ── the public avatar image ── */
export const avatarRouter = express.Router();
avatarRouter.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const u = await User.findById(req.params.id, { avatarUpload: 1 }).select("+avatarUpload").lean();
    const m = u?.avatarUpload?.match(AVATAR_RE);
    if (!m) return res.status(404).end();
    res.set("Content-Type", m[1]);
    // the URL carries ?v=<version>, so a new upload is a new URL
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(m[2], "base64"));
  } catch {
    res.status(500).end();
  }
});

const router = express.Router();
router.use(requireAuth);

/* ── GET: everything the profile page shows ── */
router.get("/", async (req, res) => {
  const me = req.user._id;
  try {
    const user = await User.findById(me).lean();
    const [library, reviewCount, friendDocs] = await Promise.all([
      getLibraryForUser(me),
      GameReview.countDocuments({ userId: me }),
      User.find({ _id: { $in: user.friends ?? [] } }, { username: 1, displayName: 1, profilePicture: 1, avatarSource: 1, customStatus: 1, "linkedAccounts.avatar": 1 }).lean(),
    ]);

    // the hero's art wall: your most played games' covers
    const wall = (library.games ?? [])
      .filter(({ rawg }) => rawg?.background_image)
      .sort((a, b) => (b.steam.playtimeForever || 0) - (a.steam.playtimeForever || 0))
      .slice(0, 12)
      .map(({ rawg }) => rawg.background_image);

    const presence = friendDocs.length ? await presenceOfMany(friendDocs.map((f) => f._id)) : {};
    const friends = friendDocs
      .map((f) => ({
        id: String(f._id),
        name: f.displayName || f.username || "Player",
        username: f.username ?? null,
        avatar: publicAvatar(f),
        status: presence[String(f._id)]?.status ?? "offline",
        playing: presence[String(f._id)]?.playing ?? null,
        customStatus: activeStatus(f.customStatus),
      }))
      .sort((a, b) => (a.status === "offline") - (b.status === "offline") || a.name.localeCompare(b.name));

    const steam = linked(user, "steam");
    res.json({
      profile: {
        id: String(user._id),
        displayName: user.displayName || user.username || "Player",
        username: user.username ?? null,
        email: user.email ?? null,
        bio: user.bio ?? "",
        favoriteGame: user.favoriteGame?.rawgId ? user.favoriteGame : null,
        banner: user.banner?.rawgId ? user.banner : null,
        status: activeStatus(user.customStatus),
        emailVerified: emailVerified(user),
        avatar: avatarUrl(user),
        avatarSource: user.avatarSource ?? null,
        avatarOptions: {
          google: linked(user, "google")?.avatar || null,
          steam: steam?.avatar || null,
          upload: user.avatarVersion ? `${process.env.API_BASE_URL}/api/avatar/${user._id}?v=${user.avatarVersion}` : null,
        },
        createdAt: user.createdAt ?? null,
      },
      stats: { reviews: reviewCount, friends: friends.length },
      wall,
      friends,
      connections: {
        google: linked(user, "google")
          ? { connected: true, name: linked(user, "google").displayName || linked(user, "google").email || null, avatar: linked(user, "google").avatar || null }
          : { connected: false },
        steam: steam
          ? { connected: true, name: steam.displayName || null, avatar: steam.avatar || null, lastSyncedAt: library.lastSyncedAt ?? null, gameCount: library.gameCount ?? library.games?.length ?? 0 }
          : { connected: false },
      },
      hasPassword: hasPassword(user),
      notifications: notifyPrefs(user),
    });
  } catch (err) {
    logger.error({ err }, "account page failed");
    oops(res);
  }
});

/* ── PATCH: edit the profile ── */
router.patch("/", async (req, res) => {
  const b = req.body ?? {};
  try {
    const user = await User.findById(req.user._id).select("+avatarUpload");

    if (b.displayName !== undefined) {
      const name = String(b.displayName).trim();
      if (!name || name.length > MAX_DISPLAY_NAME_LENGTH) {
        return res.status(400).json({ message: `Your name needs 1–${MAX_DISPLAY_NAME_LENGTH} characters.` });
      }
      user.displayName = name;
    }

    if (b.username !== undefined) {
      const username = String(b.username).trim();
      if (!USERNAME_REGEX.test(username)) {
        return res.status(400).json({ message: "Usernames are 3–20 characters: letters, numbers, _ and - only." });
      }
      if (await User.exists({ usernameLower: username.toLowerCase(), _id: { $ne: user._id } })) {
        return res.status(409).json({ message: "That username is taken. Try another." });
      }
      user.username = username;
    }

    if (b.bio !== undefined) {
      const bio = String(b.bio ?? "").trim();
      if (bio.length > MAX_BIO) return res.status(400).json({ message: `Keep your bio to ${MAX_BIO} characters.` });
      user.bio = bio || undefined;
    }

    for (const field of ["favoriteGame", "banner"]) {
      if (b[field] === undefined) continue;
      if (b[field] === null) {
        user[field] = undefined;
        continue;
      }
      const pick = parseGamePick(b[field]);
      if (pick.error) return res.status(400).json({ message: pick.error });
      user[field] = pick.game;
    }

    // { text, expiresAt } (expiresAt: an ISO time, or null for never); null clears
    if (b.status !== undefined) {
      if (b.status === null || !String(b.status?.text ?? "").trim()) user.customStatus = undefined;
      else {
        const text = String(b.status.text).trim();
        if (text.length > MAX_STATUS) return res.status(400).json({ message: `Keep your status to ${MAX_STATUS} characters.` });
        const expiresAt = b.status.expiresAt ? new Date(b.status.expiresAt) : null;
        if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
          return res.status(400).json({ message: "That clear time has already passed." });
        }
        user.customStatus = { text, expiresAt: expiresAt ?? undefined };
      }
    }

    if (b.avatarUpload !== undefined) {
      const data = String(b.avatarUpload ?? "");
      if (data.length > MAX_AVATAR_CHARS || !AVATAR_RE.test(data)) {
        return res.status(400).json({ message: "That picture couldn't be used. Try a JPG, PNG or WebP image." });
      }
      user.avatarUpload = data;
      user.avatarVersion = Date.now();
      user.avatarSource = "upload";
    }

    if (b.avatarSource !== undefined) {
      const s = b.avatarSource;
      const ok =
        s === "none" ||
        (s === "upload" && user.avatarVersion) ||
        (PROVIDERS.includes(s) && linked(user, s)?.avatar);
      if (!ok) return res.status(400).json({ message: "That picture isn't available." });
      user.avatarSource = s;
    }

    // what the rest of the app shows (reviews, chat, friends)
    user.profilePicture = avatarUrl(user) || undefined;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: "That username is taken. Try another." });
    logger.error({ err }, "profile update failed");
    oops(res);
  }
});

/* ── password: change it, or add one ── */
router.post("/password", async (req, res) => {
  const current = String(req.body?.current ?? "");
  const next = String(req.body?.next ?? "");
  try {
    if (next.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Use at least ${MIN_PASSWORD} characters for your password.` });
    }
    const user = await User.findById(req.user._id);
    const native = linked(user, "native");
    const hash = await bcrypt.hash(next, 10);
    if (native) {
      if (!(await bcrypt.compare(current, native.providerId))) {
        return res.status(400).json({ message: "Your current password isn't right." });
      }
      native.providerId = hash;
    } else {
      user.linkedAccounts.push({
        provider: "native",
        providerId: hash,
        displayName: user.displayName || "",
        email: user.email || "",
        avatar: "",
      });
    }
    await user.save();
    res.json({ ok: true, added: !native });
  } catch (err) {
    logger.error({ err }, "password change failed");
    oops(res);
  }
});

/* ── which notifications you get ── */
router.patch("/notifications", async (req, res) => {
  const set = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!NOTIFY_KEYS.includes(k)) return res.status(400).json({ message: `Unknown notification setting: ${k}` });
    if (typeof v !== "boolean") return res.status(400).json({ message: `${k} is either on (true) or off (false).` });
    set[`settings.notifications.${k}`] = v;
  }
  if (!Object.keys(set).length) return res.status(400).json({ message: "Nothing to save." });
  try {
    const u = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true, projection: { settings: 1 } }).lean();
    res.json({ notifications: notifyPrefs(u) });
  } catch (err) {
    logger.error({ err }, "notification settings failed");
    oops(res);
  }
});

/* ── change (or add) your email: a code to the new address confirms it ── */
const emailKey = (userId) => `email:${userId}`;
const MAX_CODE_TRIES = 5;

router.post("/email/code", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  try {
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: "That doesn't look like an email address." });
    // (your current address again is fine while it isn't verified: this verifies it)
    if ((req.user.email || "").toLowerCase() === email && emailVerified(req.user)) {
      return res.status(400).json({ message: "That's already your email, and it's verified." });
    }
    if (await User.exists({ ...byEmail(email), _id: { $ne: req.user._id } })) {
      return res.status(409).json({ message: "Another account already uses that email." });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await setOtp(emailKey(req.user._id), { otp, email, expiresAt: Date.now() + 5 * 60 * 1000 });
    try {
      await sendOtpEmail(email, otp);
    } catch {
      await deleteOtp(emailKey(req.user._id)).catch(() => {});
      return res.status(502).json({ message: "We couldn't send the email just now. Check the address and try again." });
    }
    res.json({ ok: true, email });
  } catch (err) {
    logger.error({ err }, "email code failed");
    oops(res);
  }
});

router.post("/email/verify", async (req, res) => {
  const key = emailKey(req.user._id);
  try {
    const entry = await getOtp(key);
    if (!entry || Date.now() > entry.expiresAt) return res.status(400).json({ message: "That code has expired. Send a new one." });
    if (entry.otp !== String(req.body?.code ?? "").trim()) {
      const tries = (entry.tries ?? 0) + 1;
      if (tries >= MAX_CODE_TRIES) {
        await deleteOtp(key);
        return res.status(400).json({ message: "Too many wrong tries, so that code no longer works. Send a new one." });
      }
      await setOtp(key, { ...entry, tries });
      return res.status(400).json({ message: "That code isn't right. Check the email and try again." });
    }
    if (await User.exists({ ...byEmail(entry.email), _id: { $ne: req.user._id } })) {
      await deleteOtp(key);
      return res.status(409).json({ message: "Another account already uses that email." });
    }
    const user = await User.findById(req.user._id);
    user.email = entry.email;
    user.emailVerifiedAt = new Date();
    const native = linked(user, "native");
    if (native) native.email = entry.email;
    await user.save();
    await deleteOtp(key);
    res.json({ ok: true, email: entry.email });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: "Another account already uses that email." });
    logger.error({ err }, "email verify failed");
    oops(res);
  }
});

// Sessions (connect-mongo) are stored as JSON text holding passport's user id.
const sessionsOf = (userId) => ({ session: { $regex: `"passport":\\{"user":"${String(userId)}"\\}` } });

/* ── sign out every other device ── */
router.post("/signout-others", async (req, res) => {
  try {
    const r = await mongoose.connection.db
      .collection("sessions")
      .deleteMany({ ...sessionsOf(req.user._id), _id: { $ne: req.sessionID } });
    res.json({ ok: true, signedOut: r.deletedCount });
  } catch (err) {
    logger.error({ err }, "sign out others failed");
    oops(res);
  }
});

/* ── unlink Google or Steam ── */
router.delete("/connections/:provider", async (req, res) => {
  const provider = req.params.provider;
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ message: "That can't be disconnected." });
  try {
    const user = await User.findById(req.user._id);
    if (!linked(user, provider)) return res.json({ ok: true });
    const others = user.linkedAccounts.filter((a) => a.provider !== provider);
    if (!others.length) {
      return res.status(400).json({
        code: "LAST_LOGIN",
        message: "This is your only way to sign in. Add a password or connect another account first.",
      });
    }
    user.linkedAccounts = others;
    if (user.avatarSource === provider) user.avatarSource = undefined;
    user.profilePicture = avatarUrl(user) || undefined;
    await user.save();
    if (provider === "steam") {
      // Steam's data goes with it (shelves stay, for a reconnect)
      await SteamLibrary.deleteMany({ userId: user._id });
      clearLibraryCache(user._id);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "disconnect failed");
    oops(res);
  }
});

/* ── delete the account ── */
router.delete("/", async (req, res) => {
  const me = req.user._id;
  try {
    const user = await User.findById(me);
    const confirm = String(req.body?.confirm ?? "").trim().toLowerCase();
    const expected = (user.username || "").toLowerCase();
    if (!expected || confirm !== expected) {
      return res.status(400).json({ message: "Type your username exactly to confirm." });
    }

    await Promise.all([
      SteamLibrary.deleteMany({ userId: me }),
      GameShelf.deleteMany({ userId: me }),
      ReviewDraft.deleteMany({ userId: me }),
      Notification.deleteMany({ $or: [{ userId: me }, { actorId: me }] }),
      Activity.deleteMany({ $or: [{ userId: me }, { actorId: me }] }),
      FriendRequest.deleteMany({ $or: [{ from: me }, { to: me }] }),
      User.updateMany({ friends: me }, { $pull: { friends: me } }),
      Conversation.updateMany({ type: "group", "members.userId": me }, { $pull: { members: { userId: me } } }),
    ]);

    // The placeholder your posts stay under.
    await User.updateOne(
      { _id: me },
      {
        $set: { displayName: "Deleted user", deleted: true, deletedAt: new Date(), linkedAccounts: [], friends: [] },
        $unset: {
          username: 1, usernameLower: 1, email: 1, profilePicture: 1, avatar: 1, bio: 1, favoriteGame: 1,
          avatarSource: 1, avatarUpload: 1, avatarVersion: 1, settings: 1,
          customStatus: 1, banner: 1, emailVerifiedAt: 1,
        },
      }
    );
    clearLibraryCache(me);
    await mongoose.connection.db.collection("sessions").deleteMany({ ...sessionsOf(me), _id: { $ne: req.sessionID } });

    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ ok: true });
      });
    });
  } catch (err) {
    logger.error({ err }, "account delete failed");
    oops(res);
  }
});

export default router;
