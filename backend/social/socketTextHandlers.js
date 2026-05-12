// social/socketTextHandlers.js
import { getPG } from "../config/db.js";
import logger from "../config/logger.js";
import { RateLimiterMemory } from "rate-limiter-flexible";

const socketLimiter = new RateLimiterMemory({ points: 10, duration: 10 });

const MAX_MESSAGE_LENGTH = 2000;

function sanitizeText(raw) {
  return raw
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

/* ---------------- DB helpers ---------------- */

async function saveMessage(pg, { roomId, userId, username, text }) {
  const q = `
    INSERT INTO game_messages (room_id, user_id, username, text)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at
  `;
  const res = await pg.query(q, [roomId, userId, username, text]);
  return res.rows[0];
}

async function loadHistory(pg, roomId, limit = 50) {
  const q = `
    SELECT id, user_id, username, text, created_at
    FROM game_messages
    WHERE room_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  const res = await pg.query(q, [roomId, limit]);
  return res.rows.reverse();
}

/* ---------------- User helpers ---------------- */

function getUserFromSocket(socket) {
  const user = socket.user;

  if (user && typeof user === "object") {
    return {
      id: user._id?.toString() ?? user.id ?? null,
      name:
        user.displayName ??
        user.username ??
        `User-${socket.id.slice(0, 6)}`
    };
  }

  return {
    id: null,
    name: `Anon-${socket.id.slice(0, 6)}`
  };
}

/* ---------------- Socket handlers ---------------- */

export function attachTextHandlers(io, socket) {
  const pg = getPG();
  const user = getUserFromSocket(socket);

  /* join-room */
  socket.on("join-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      await socket.join(roomId);

      io.to(roomId).emit("user-joined", {
        roomId,
        user: { id: user.id, name: user.name }
      });

      const history = await loadHistory(pg, roomId, 50);
      socket.emit("chat-history", history);

      cb?.({ ok: true });
    } catch (err) {
      logger.error({ err }, "join-room error");
      cb?.({ error: "join_failed" });
    }
  });

  /* leave-room */
  socket.on("leave-room", async (payload, cb) => {
    try {
      const { roomId } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      await socket.leave(roomId);

      io.to(roomId).emit("user-left", {
        roomId,
        user: { id: user.id, name: user.name }
      });

      cb?.({ ok: true });
    } catch (err) {
      logger.error({ err }, "leave-room error");
      cb?.({ error: "leave_failed" });
    }
  });

  /* send-msg */
  socket.on("send-msg", async (payload, cb) => {
    try {
      try {
        await socketLimiter.consume(user.id || socket.id);
      } catch {
        cb?.({ error: "rate_limited" });
        return;
      }

      const { roomId, text, clientId } = payload || {};
      if (!roomId || !text) {
        cb?.({ error: "missing_params" });
        return;
      }

      if (typeof text !== "string") {
        cb?.({ error: "invalid_text" });
        return;
      }

      const clean = sanitizeText(text);
      if (clean.length === 0) {
        cb?.({ error: "empty_message" });
        return;
      }

      const save = await saveMessage(pg, {
        roomId,
        userId: user.id,
        username: user.name,
        text: clean
      });

      const msg = {
        id: save.id,
        clientId: clientId ?? null,
        roomId,
        from: { id: user.id, name: user.name },
        text: clean,
        ts: new Date(save.created_at).toISOString()
      };

      io.to(roomId).emit("message", msg);
      cb?.({ ok: true, id: save.id });
    } catch (err) {
      logger.error({ err }, "send-msg error");
      cb?.({ error: "send_failed" });
    }
  });

  /* get-history */
  socket.on("get-history", async (payload, cb) => {
    try {
      const { roomId, limit = 50 } = payload || {};
      if (!roomId) {
        cb?.({ error: "missing_roomId" });
        return;
      }

      const hist = await loadHistory(pg, roomId, limit);
      socket.emit("chat-history", hist);
      cb?.({ ok: true, count: hist.length });
    } catch (err) {
      logger.error({ err }, "get-history error");
      cb?.({ error: "history_failed" });
    }
  });

  /* disconnect */
  socket.on("disconnect", () => {
    logger.debug("Text socket disconnected: %s", socket.id);
  });
}
