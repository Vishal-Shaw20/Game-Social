/*
 * One-off: copy chat messages from Postgres (game_messages) into MongoDB
 * (ChatMessage), where the rest of the social data lives.
 *
 *   node scripts/migrateChatToMongo.js          # copy
 *   node scripts/migrateChatToMongo.js --check  # report only, write nothing
 *
 * Safe to re-run: each copied row keeps its Postgres id in legacyPgId, which
 * is unique, so a second run inserts nothing new. The Postgres table is left
 * untouched as a backup; drop it by hand once you're happy with the result.
 */
import "../config/env.js";
import mongoose from "mongoose";
import connectDB, { getPG } from "../config/db.js";
import ChatMessage from "../models/ChatMessage.js";

const CHECK_ONLY = process.argv.includes("--check");
const BATCH = 500;

const isObjectId = (v) => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);

async function main() {
  await connectDB();
  const pg = getPG();

  const { rows } = await pg.query(
    `SELECT id, room_id, user_id, username, text, created_at
     FROM game_messages
     ORDER BY id`
  );
  const inMongo = await ChatMessage.countDocuments();
  console.log(`Postgres: ${rows.length} messages | MongoDB: ${inMongo} already`);

  if (CHECK_ONLY) {
    const missing = [];
    for (const r of rows) {
      if (!(await ChatMessage.exists({ legacyPgId: r.id }))) missing.push(r.id);
    }
    console.log(`Not yet copied: ${missing.length}`, missing.slice(0, 20));
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const docs = rows.slice(i, i + BATCH).map((r) => ({
      legacyPgId: r.id,
      roomId: r.room_id,
      // Senders are MongoDB user ids kept as text in Postgres; anything else
      // (the old anonymous rows) becomes null, keeping the username.
      userId: isObjectId(r.user_id) ? new mongoose.Types.ObjectId(r.user_id) : null,
      username: r.username,
      text: r.text,
      createdAt: r.created_at,
      updatedAt: r.created_at
    }));

    // ordered: false so duplicates (already-copied rows) are skipped rather
    // than stopping the batch.
    try {
      const res = await ChatMessage.insertMany(docs, { ordered: false });
      inserted += res.length;
    } catch (err) {
      inserted += err.insertedDocs?.length ?? 0;
      const dupes = (err.writeErrors ?? []).filter((e) => e.err?.code === 11000).length;
      skipped += dupes;
      const other = (err.writeErrors ?? []).length - dupes;
      if (other > 0) throw err;
    }
  }

  console.log(`Inserted ${inserted}, skipped ${skipped} already copied.`);
  console.log(`MongoDB now holds ${await ChatMessage.countDocuments()} messages.`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
