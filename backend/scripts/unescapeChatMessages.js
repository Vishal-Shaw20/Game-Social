/*
 * One-off: undo the old HTML escaping of stored chat text.
 *
 *   node scripts/unescapeChatMessages.js --check   # report only, write nothing
 *   node scripts/unescapeChatMessages.js           # apply
 *
 * Chat used to be saved with "<" and ">" turned into "&lt;" and "&gt;".
 * Clients render it as plain text, so DMs showed "&lt;3" instead of "<3".
 * New messages are stored as typed; this rewrites the old ones:
 *   - ChatMessage.text (game chat, DMs, groups)
 *   - Conversation.lastMessage.text (the sidebar preview)
 * Only "&lt;" and "&gt;" were ever produced ("&" was not escaped).
 *
 * Safe to re-run: it only touches text that still contains them.
 */
import "../config/env.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import ChatMessage from "../models/ChatMessage.js";
import Conversation from "../models/Conversation.js";

const CHECK_ONLY = process.argv.includes("--check");
const ESCAPED = /&lt;|&gt;/;

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Rewrites `field` in every matching doc of `col`; returns [matched, modified]. */
async function fix(col, field) {
  const docs = await col
    .find({ [field]: { $regex: ESCAPED } }, { projection: { [field]: 1 } })
    .toArray();
  const read = (d) => field.split(".").reduce((v, k) => v?.[k], d);

  if (docs.length) {
    console.log(`  ${col.collectionName}.${field} examples:`, docs.slice(0, 5).map((d) => `"${read(d).slice(0, 40)}"`));
  }
  if (CHECK_ONLY || !docs.length) return [docs.length, 0];

  const res = await col.bulkWrite(
    docs.map((d) => ({
      updateOne: { filter: { _id: d._id }, update: { $set: { [field]: unescape(read(d)) } } }
    })),
    { ordered: false }
  );
  return [docs.length, res.modifiedCount];
}

async function main() {
  await connectDB();

  // The raw driver, not the models: no validation or timestamps on a data fix.
  const [msgFound, msgFixed] = await fix(ChatMessage.collection, "text");
  const [convFound, convFixed] = await fix(Conversation.collection, "lastMessage.text");

  console.log(`Escaped messages: ${msgFound} | escaped conversation previews: ${convFound}`);
  if (CHECK_ONLY) return;
  console.log(`Rewrote ${msgFixed} messages and ${convFixed} previews.`);
}

main()
  .catch((err) => {
    console.error("Unescape failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit();
  });
