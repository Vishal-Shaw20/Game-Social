/*
 * Demo data for Cyberpunk 2077's game page (/game/41494): 8 demo users, a
 * review from each, and a conversation in the game's chat room.
 *
 *   node scripts/seedCyberpunk.js          seed (re-running replaces it)
 *   node scripts/seedCyberpunk.js --undo   remove every demo user and
 *                                          everything they wrote
 *
 * Demo users are marked by their email domain (@demo.gamesocial.invalid,
 * a reserved TLD that can't receive mail). They have no password or linked
 * login, so nobody can sign in as them. Runs against MONGO_URI in
 * backend/.env.
 */
import "../config/env.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import GameReview from "../models/GameReview.js";
import ChatMessage from "../models/ChatMessage.js";
import ReviewComment from "../models/ReviewComment.js";
import ReviewDraft from "../models/ReviewDraft.js";
import { TAGS } from "../shared/reviewTags.js";

const RAWG_ID = "41494";
const STEAM_APP_ID = 1091500;
const ROOM = `game:${RAWG_ID}`;
const DEMO_DOMAIN = "demo.gamesocial.invalid";

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

const USERS = [
  ["nightcity_nomad", "Nightcity Nomad"],
  ["chromejaw", "ChromeJaw"],
  ["pixel_ronin", "Pixel Ronin"],
  ["glitchwitch", "GlitchWitch"],
  ["slowburn_sam", "Slowburn Sam"],
  ["kiroshi_kat", "Kiroshi Kat"],
  ["delamain_fan", "Delamain Fan"],
  ["tacticalnap", "TacticalNap"],
];

// [username, verdict key, body, pros, cons, hours, finished, daysAgo]
// Verdict keys: perfection = Instant classic, almost_good = Almost there,
// subpar = Subpar slop, awful_fun = Hot mess.
const REVIEWS = [
  ["nightcity_nomad", "perfection",
   "Came back after 2.0 and Phantom Liberty and it's a different game. Night City is the best-realised open world I've walked through: every alley has a story, and the main plot with Johnny had me glued to it for the whole final act.",
   ["world", "story", "characters", "visuals"], [], 142, true, 40],
  ["chromejaw", "perfection",
   "Netrunner build is absurdly fun. Quickhacking a whole room from a camera never gets old, and the skill-tree rework finally makes builds feel distinct. Soundtrack slaps; the radio stations alone are worth it.",
   ["builds", "combat", "audio", "replay"], [], 96, true, 31],
  ["pixel_ronin", "almost_good",
   "Gunplay is excellent and the side gigs are often better than the main quest. But the city can feel like a gorgeous backdrop: NPCs and police still don't hold up if you poke at them, and some choices barely change anything.",
   ["gunplay", "quests", "visuals"], ["choices", "world"], 64, true, 22],
  ["glitchwitch", "awful_fun", // shown as "Hot mess"
   "I love this game and it is also a hot mess. My car spawned inside a wall, a cop materialised behind me for jaywalking, and a main-quest NPC sat in a chair that wasn't there. Still laughing. Still playing.",
   ["world", "audio"], ["polish", "ai"], 83, false, 12],
  ["slowburn_sam", "almost_good",
   "Loved the story and characters, but it drags in the middle: too many fixers ringing you with the same kind of gig. Driving still feels floaty. Worth it on sale.",
   ["story", "characters", "price"], ["time", "controls"], 58, true, 15],
  ["kiroshi_kat", "perfection",
   "Photo mode alone ate 10 hours. Ray-traced Night City at night in the rain is unreal, and the side characters (Judy, Panam, River) have better arcs than most games' leads.",
   ["visuals", "artstyle", "characters", "quests"], [], 120, false, 9],
  ["delamain_fan", "subpar",
   "Played at launch on last-gen and bounced hard: crashes, T-posing, missing textures. It's clearly better now, but my save still hits odd bugs and the performance on my older PC is rough.",
   ["story"], ["polish", "performance"], 18, false, 5],
  ["tacticalnap", "almost_good",
   "Great action RPG once it clicks. Boss fights are hit and miss though: a couple are memorable, a few are just bullet sponges. Stealth is fun but the AI is easy to cheese.",
   ["combat", "builds", "leveldesign"], ["bosses", "challenge"], 71, true, 2],
];

// [username, text, minutesAgo]
const MESSAGES = [
  ["nightcity_nomad", "anyone else doing a full 2.0 replay?", 600],
  ["chromejaw", "yep, netrunner this time. quickhacks are ridiculous now", 596],
  ["pixel_ronin", "blades build or bust. sandevistan + mantis blades is peak", 590],
  ["glitchwitch", "my V just got launched into orbit by a car bumper again lol", 572],
  ["slowburn_sam", "is Phantom Liberty worth it if I finished the base game?", 540],
  ["kiroshi_kat", "100%. Dogtown is the best part of the whole game imo", 537],
  ["nightcity_nomad", "agreed, and it adds a new ending. don't look it up, go in blind", 535],
  ["delamain_fan", "still getting crashes near Jig-Jig Street on my old PC :(", 300],
  ["chromejaw", "try turning off crowd density, fixed it for me", 296],
  ["delamain_fan", "oh nice, will try that tonight", 290],
  ["tacticalnap", "Adam Smasher is still a bullet sponge on very hard", 120],
  ["pixel_ronin", "sandevistan him, he folds", 118],
  ["kiroshi_kat", "photo mode at Corpo Plaza during rain, trust me", 45],
  ["glitchwitch", "who else just drives around listening to the radio for an hour", 12],
  ["slowburn_sam", "guilty. 89.7 Growl FM is on a loop", 9],
];

const demoEmail = (username) => `${username}@${DEMO_DOMAIN}`;

async function demoUserIds() {
  const users = await User.find({ email: { $regex: `@${DEMO_DOMAIN.replace(/\./g, "\\.")}$` } }, { _id: 1 }).lean();
  return users.map((u) => u._id);
}

async function removeDemoContent(ids) {
  const reviews = await GameReview.find({ userId: { $in: ids } }, { _id: 1 }).lean();
  const reviewIds = reviews.map((r) => r._id);
  const out = {
    comments: (await ReviewComment.deleteMany({ $or: [{ userId: { $in: ids } }, { reviewId: { $in: reviewIds } }] })).deletedCount,
    reviews: (await GameReview.deleteMany({ userId: { $in: ids } })).deletedCount,
    messages: (await ChatMessage.deleteMany({ userId: { $in: ids } })).deletedCount,
    drafts: (await ReviewDraft.deleteMany({ userId: { $in: ids } })).deletedCount,
  };
  // Demo users may have been liked / friended by real accounts.
  await GameReview.updateMany({ likes: { $in: ids } }, { $pull: { likes: { $in: ids } } });
  await User.updateMany({ friends: { $in: ids } }, { $pull: { friends: { $in: ids } } });
  return out;
}

// Insert with our own createdAt/updatedAt (Mongoose would stamp "now"),
// after validating each document against its model.
async function insertDated(Model, docs) {
  const rows = docs.map((d) => {
    const doc = new Model(d);
    const err = doc.validateSync();
    if (err) throw err;
    return { ...doc.toObject({ depopulate: true }), createdAt: d.createdAt, updatedAt: d.updatedAt ?? d.createdAt };
  });
  await Model.collection.insertMany(rows);
  return rows.length;
}

async function seed() {
  // Demo users (reused if they exist).
  const byName = {};
  for (const [username, displayName] of USERS) {
    const u = await User.findOneAndUpdate(
      { email: demoEmail(username) },
      { $set: { username, displayName }, $setOnInsert: { email: demoEmail(username), createdAt: ago(60 * DAY) } },
      { upsert: true, new: true }
    );
    byName[username] = u._id;
  }
  const ids = Object.values(byName);
  const cleared = await removeDemoContent(ids);

  for (const [, , , pros, cons] of REVIEWS) {
    for (const t of [...pros, ...cons]) if (!TAGS[t]) throw new Error(`Unknown tag id: ${t}`);
  }

  const reviewDocs = REVIEWS.map(([username, verdict, body, pros, cons, hours, completed, daysAgo], i) => {
    // Likes from a few other demo users, more for older reviews.
    const likers = ids.filter((id) => String(id) !== String(byName[username])).slice(0, (i * 3 + 2) % 6);
    return {
      userId: byName[username], rawgId: RAWG_ID, steamAppId: STEAM_APP_ID, verdict,
      title: "", body, pros, cons, playtimeHours: hours, completed,
      visibility: "public", likes: likers, edited: false,
      createdAt: ago(daysAgo * DAY + i * HOUR),
    };
  });
  const reviews = await insertDated(GameReview, reviewDocs);

  const messageDocs = MESSAGES.map(([username, text, minutesAgo]) => ({
    roomId: ROOM, userId: byName[username], text, createdAt: ago(minutesAgo * 60e3),
  }));
  const messages = await insertDated(ChatMessage, messageDocs);

  console.log(`Seeded Cyberpunk 2077 (${RAWG_ID}): ${ids.length} demo users, ${reviews} reviews, ${messages} chat messages.`);
  if (cleared.reviews || cleared.messages) {
    console.log(`(Replaced an earlier seed: ${cleared.reviews} reviews, ${cleared.messages} messages.)`);
  }
}

async function undo() {
  const ids = await demoUserIds();
  if (!ids.length) return console.log("No demo users found; nothing to remove.");
  const out = await removeDemoContent(ids);
  const users = (await User.deleteMany({ _id: { $in: ids } })).deletedCount;
  console.log(`Removed ${users} demo users, ${out.reviews} reviews, ${out.messages} messages, ${out.comments} comments, ${out.drafts} drafts.`);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  if (process.argv.includes("--undo")) await undo();
  else await seed();
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
