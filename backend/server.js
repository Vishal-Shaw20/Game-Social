import dns from "dns";
dns.setDefaultResultOrder("ipv4first");import steamAutoSync from "./middleware/SteamAutoSync.js";
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
import trending from "./routes/trending.js";
import socketHandlers from "./social/socketServer.js";
import friendRoutes from "./routes/friendRoutes.js";

import { startCron } from "./cron/steamspy_trending.js";
import { startRawgCron } from "./cron/rawg_games.js";

import reviewRoutes from "./routes/reviewRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";

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
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
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

app.use("/auth", authRoutes);
app.use("/api", apiLimiter, apiRoutes);
app.use("/api/gameLookup", gameLookup);
app.use("/api/trending", trending);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/friends", friendRoutes);

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
    .select("_id username displayName avatar")
    .lean()
    .then(user => {
      if (!user) {
        return next(new Error("User not found"));
      }
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
