/*
 * One-off: fill User.usernameLower for accounts created before that field
 * existed (new and updated accounts get it from the model's hooks).
 *
 *   node scripts/backfillUsernameLower.js
 *
 * Safe to re-run: it only touches accounts whose lowercase copy is missing
 * or out of date.
 */
import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";

async function main() {
  await connectDB();
  const res = await User.updateMany(
    { username: { $type: "string" }, $expr: { $ne: ["$usernameLower", { $toLower: "$username" }] } },
    [{ $set: { usernameLower: { $toLower: "$username" } } }]
  );
  console.log(`Updated ${res.modifiedCount} of ${await User.countDocuments()} users.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
