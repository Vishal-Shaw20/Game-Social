import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import logger from "./logger.js";

// Load backend/.env relative to THIS file, not process.cwd(), so env vars are
// available no matter which directory the process was started from.
//
// Importing this module is also how a module guarantees .env is loaded before
// its own body runs: the rest of the codebase calls dotenv.config() ad hoc, and
// ES module evaluation order means a module imported earlier than the first of
// those calls would otherwise see an empty process.env. dotenv does not
// override already-set vars, so the other calls remain harmless no-ops.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    logger.warn({ name, value: raw, fallback }, "Invalid integer env var, using fallback");
    return fallback;
  }

  return parsed;
}

// For vars with no safe default. Throws at startup rather than letting the
// process run misconfigured — e.g. ioredis silently defaults to localhost:6379
// when handed undefined, which hides the misconfiguration until traffic fails.
export function envRequired(name, hint) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} is not set${hint ? ` — ${hint}` : ""}`);
  }
  return raw.trim();
}

export function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  return ["true", "1", "yes"].includes(raw.trim().toLowerCase());
}

export const DEV_MODE = envBool("DEV_MODE", false);

/* Master switch for voice chat, off unless turned on.
   With it off the voice socket handlers are never registered and the client
   is told voice is unavailable (GET /api/config), so nothing opens a
   microphone or a peer connection. Flipping it needs an env change and a
   restart, not a rebuild. */
export const VOICE_ENABLED = envBool("VOICE_ENABLED", false);

// REDIS_URL is mandatory: there is no localhost fallback, so a missing value
// fails loudly instead of quietly pointing at a Redis that isn't there.
// Only called from code paths that actually construct a client, so DEV_MODE
// (which uses in-memory substitutes throughout) never requires it.
export function redisUrl() {
  return envRequired(
    "REDIS_URL",
    "set it in backend/.env (e.g. redis://localhost:6379), or set DEV_MODE=true to run without Redis"
  );
}
