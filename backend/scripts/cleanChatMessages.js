/*
 * One-off: tidy the chat collection after names moved out of messages.
 *
 *   node scripts/cleanChatMessages.js --check   # report only, write nothing
 *   node scripts/cleanChatMessages.js           # apply
 *
 * 1. Deletes messages whose author no longer exists (deleted accounts, and
 *    the old anonymous messages with no sender at all). Names now come from
 *    the user record, so such a message has no one to attribute it to.
 * 2. Removes the leftover `username` field, which the model no longer has:
 *    the name is read from the sender's user record instead.
 *
 * Safe to re-run: both steps only touch what still matches.
 */
import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import ChatMessage from "../models/ChatMessage.js";
import User from "../models/User.js";

const CHECK_ONLY = process.argv.includes("--check");

async function main() {
  await connectDB();

  // The raw driver, not the model: `username` is no longer in the schema,
  // and Mongoose silently drops filters and updates for unknown fields
  // (a model-level $unset here modified nothing).
  const col = ChatMessage.collection;

  const total = await col.countDocuments();
  const userIds = (await User.find({}, { _id: 1 }).lean()).map((u) => u._id);

  const orphanQuery = {
    $or: [{ userId: null }, { userId: { $exists: false } }, { userId: { $nin: userIds } }]
  };

  const orphans = await col
    .find(orphanQuery, { projection: { roomId: 1, userId: 1, text: 1 } })
    .limit(10)
    .toArray();
  const orphanCount = await col.countDocuments(orphanQuery);
  const withUsername = await col.countDocuments({ username: { $exists: true } });

  console.log(`Messages: ${total} | from missing users: ${orphanCount} | still carrying a name: ${withUsername}`);
  if (orphanCount) {
    console.log("Examples:", orphans.map((m) => `${m.roomId} ${String(m.userId)} "${(m.text || "").slice(0, 30)}"`));
  }

  if (CHECK_ONLY) return;

  const deleted = await col.deleteMany(orphanQuery);
  const unset = await col.updateMany(
    { username: { $exists: true } },
    { $unset: { username: "" } }
  );

  console.log(`Deleted ${deleted.deletedCount}, removed the name field from ${unset.modifiedCount}.`);
  console.log(`${await col.countDocuments()} messages remain.`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
