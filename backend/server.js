import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import steamAutoSync from "./middleware/SteamAutoSync.js";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import dotenv from "dotenv";

import connectDB from "./config/db.js";
import User from "./models/User.js";
import logger from "./config/logger.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import "./strategies/google.js";
import "./strategies/steam.js";

import authRoutes from "./routes/authRoutes.js";
import apiRoutes from "./routes/apiRoutes.js";
import gameLookup from "./routes/gameLookup.js";
import gamePage from "./routes/gamePage.js";
import trending from "./routes/trending.js";
import socketHandlers from "./social/socketServer.js";
import friendRoutes from "./routes/friendRoutes.js";
import libraryRoutes from "./routes/libraryRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import configRoutes from "./routes/configRoutes.js";
import recommendedRoutes from "./routes/recommendedRoutes.js";

import { startCron } from "./cron/steamspy_trending.js";
import { startRawgCron } from "./cron/rawg_games.js";

import reviewRoutes from "./routes/reviewRoutes.js";
import reviewDraftRoutes from "./routes/reviewDraftRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import heroRoutes from "./routes/heroRoutes.js";

dotenv.config();

/* ---------------- APP ---------------- */

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

/* ---------------- CORS ---------------- */

const allowedOrigins = [
  process.env.FRONTEND_URL,      // https://game-social.vercel.app
  "http://localhost:5173",       // local dev - default
  "http://127.0.0.1:5173",       // local dev - loopback
  "http://localhost:5174",       // local dev - alt port
  "http://127.0.0.1:5174",
  "http://127.0.0.1:52515"        // local dev - alt port loopback
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      logger.warn("Blocked by CORS: %s", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);

/* ---------------- SECURITY ---------------- */

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------- SESSION ---------------- */

const sessionMiddleware = session({
  name: "connect.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: "sessions"
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "lax" : "lax"
  }
});

app.use(sessionMiddleware);

/* ---------------- PASSPORT ---------------- */

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const User = (await import("./models/User.js")).default;
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

/* ---------------- ROUTES ---------------- */
// app.js / server.js
import profileRoutes from "./routes/profile.js";
app.use("/api/profile", profileRoutes);
import accountRoutes, { avatarRouter } from "./routes/accountRoutes.js";
app.use("/api/account", accountRoutes);
app.use("/api/avatar", avatarRouter);

app.use("/auth", authRoutes);

// Specific /api/<sub> routers must be mounted BEFORE the general /api mount:
// app.use("/api", ...) matches every /api sub-path and calls next() even when
// apiRoutes has no handler for it, so mounting it first would make every
// request below also consume an apiLimiter token on top of its own limiter.
app.use("/api/gameLookup", gameLookup);
app.use("/api/gamepage", gamePage);
app.use("/api/trending", trending);
app.use("/api/reviews", reviewRoutes);
app.use("/api/review-drafts", reviewDraftRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/hero", heroRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/config", configRoutes);
app.use("/api/recommended", recommendedRoutes);

app.use("/api", apiLimiter, apiRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "GameSocial API Running",
    user: req.user || null
  });
});

app.get("/api/frontend-hit", steamAutoSync, (req, res) => {
  res.json({ ok: true });
});

/* ---------------- SOCKET.IO ---------------- */

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const sess = socket.request.session;
  if (!sess?.passport?.user) {
    return next(new Error("Authentication required"));
  }

  User.findById(sess.passport.user)
    // friends included: presence changes are pushed to this user's friends
    // (social/socketServer.js), so the list must be on the socket.
    .select("_id username displayName profilePicture linkedAccounts.avatar friends")
    .lean()
    .then(user => {
      if (!user) {
        return next(new Error("User not found"));
      }
      // One picture for chat and voice: the uploaded one, else a linked
      // account's. Only the avatar of linkedAccounts is selected, and the
      // list is dropped so no account details ride along on the socket.
      user.avatar = user.profilePicture || user.linkedAccounts?.find(a => a.avatar)?.avatar || null;
      delete user.linkedAccounts;
      socket.user = user;
      next();
    })
    .catch(() => next(new Error("Authentication failed")));
});

socketHandlers(io);

/* ---------------- STARTUP ---------------- */

async function main() {
  try {
    
    await connectDB();
    logger.info("All DBs connected");

    startCron({ runImmediately: true });
    logger.info("Trending cron started");

    startRawgCron({ runImmediately: false });

    server.listen(PORT, () => {
      logger.info("Server running on port %d", PORT);
      logger.info("Socket.IO ready");
    });
  } catch (err) {
    logger.error({ err }, "Startup failure");
    process.exit(1);
  }
}

main();
