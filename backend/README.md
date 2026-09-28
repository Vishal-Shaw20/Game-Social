# GameSocial Backend

Express API server powering GameSocial — handles authentication, game data proxying, reviews, friend system, real-time chat, and scheduled data pipelines.

## Tech Stack

| Package | Purpose |
|---------|---------|
| Express | HTTP server and routing |
| Passport.js | Authentication (Google OAuth, Steam OpenID) |
| Socket.IO | Real-time per-game text chat |
| Mongoose | MongoDB ODM (users, reviews, sessions) |
| node-pg | PostgreSQL client (games, chat, trending) |
| Pino | Structured JSON logging |
| Helmet | HTTP security headers |
| ioredis | Redis client for rate limiting and OTP storage |
| rate-limiter-flexible | Multi-tier rate limiting |
| node-cron | Scheduled jobs |
| bcryptjs | Password hashing |
| Nodemailer | OTP email delivery |
| connect-mongo | Session storage in MongoDB |

## Getting Started

```bash
npm install
cp .env.example .env     # Fill in credentials
npm run dev               # nodemon + pino-pretty on port 5000
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start with nodemon |
| `npm run dev` | Start with nodemon + pino-pretty log formatting |

## API Routes

| Prefix | File | Purpose |
|--------|------|---------|
| `/auth` | authRoutes.js | Login, signup, Google OAuth, Steam OpenID, OTP verification, password reset |
| `/api` | apiRoutes.js | Steam/RAWG/Epic API proxies, library, achievements, user search, new releases, GS recommended |
| `/api/gameLookup` | gameLookup.js | PostgreSQL game search by name/slug |
| `/api/trending` | trending.js | SteamSpy trending games with RAWG enrichment |
| `/api/reviews` | reviewRoutes.js | Game reviews with four verdicts and pro/con tags |
| `/api/notifications` | notificationRoutes.js | User notifications |
| `/api/search` | searchRoutes.js | User and game search |
| `/api/friends` | friendRoutes.js | Friend requests, list, accept, remove |
| `/api/profile` | profile.js | User profile management |
| `/api/frontend-hit` | server.js | Triggers Steam library auto-sync on first session hit |

## Project Structure

```
backend/
├── server.js                  Entry point (Express + Socket.IO + cron startup)
├── config/
│   ├── db.js                  MongoDB (Mongoose) + PostgreSQL (pg Pool) connections
│   ├── emailService.js        Nodemailer transporter for OTP emails
│   ├── env.js                 Loads .env and parses/validates env vars (import before reading process.env)
│   ├── logger.js              Pino structured logger (JSON, ISO timestamps)
│   └── otpStore.js            Redis OTP storage with TTL (in-memory under DEV_MODE)
├── routes/
│   ├── authRoutes.js          Auth endpoints (login, signup, OAuth callbacks, OTP)
│   ├── apiRoutes.js           Game data proxies, library, achievements, recommendations
│   ├── gameLookup.js          PostgreSQL game search
│   ├── trending.js            SteamSpy trending with Steam-to-RAWG mapping
│   ├── reviewRoutes.js        CRUD for game reviews
│   ├── notificationRoutes.js  Notification management
│   ├── searchRoutes.js        Search endpoints
│   ├── friendRoutes.js        Friend system endpoints
│   └── profile.js             User profile endpoints
├── models/
│   ├── User.js                User with linkedAccounts array (multi-provider auth)
│   ├── GameReview.js           Reviews with verdicts and tag arrays
│   ├── ReviewComment.js       Review comments with @mention support
│   ├── SteamLibraries.js      Cached Steam library snapshots
│   ├── Notification.js        User notifications
│   └── Activity.js            Friend activity feed entries
├── middleware/
│   ├── requireAuth.js         Session-based auth guard
│   ├── rateLimiter.js         Multi-tier Redis rate limiting (see below)
│   └── SteamAutoSync.js       Auto-sync Steam library on first frontend hit per session
├── strategies/
│   ├── google.js              Passport Google OAuth 2.0 strategy
│   └── steam.js               Passport Steam OpenID strategy
├── social/
│   ├── socketServer.js        Socket.IO server setup (text chat only)
│   └── socketTextHandlers.js  Chat handlers: join-room, leave-room, send-msg, get-history
├── cron/
│   ├── steamspy_trending.js   Fetch SteamSpy top 100 every 6 hours
│   └── rawg_games.js          Trigger gamiq daily pipeline at 3 AM UTC
├── services/
│   └── steamLibrary.js        Steam Web API library sync logic
├── utils/
│   ├── rawgToSteam.js         RAWG-to-Steam ID mapping
│   ├── steamRawgmap.js        Steam-to-RAWG batch mapping via PostgreSQL
│   ├── checkOwnership.js      Check if user owns a game on Steam
│   ├── getLibraryForUser.js   Get user's Steam library with RAWG enrichment
│   ├── getPlaytime.js         Steam playtime stats
│   ├── getSteamIdFromUser.js  Extract Steam ID from user's linked accounts
│   ├── mapLookup.js           Lookup helpers for Steam-RAWG map
│   ├── createActivity.js      Create friend activity feed entries
│   ├── deleteActivity.js      Delete activity entries
│   ├── createNotification.js  Create user notifications
│   ├── deleteNotification.js  Delete notifications
│   ├── parseMentions.js       Parse @mentions from text
│   ├── renderMentions.js      Render @mentions in output
│   ├── generateUsername.js    Auto-generate unique usernames
│   └── validation.js          Input validation helpers
└── shared/
    └── reviewTags.js          Review tag definitions (synced with frontend/src/shared/)
```

## Authentication

Three Passport strategies with multi-provider account linking:

| Strategy | Provider | Route |
|----------|----------|-------|
| Google OAuth 2.0 | Google | `/auth/google` → `/auth/google/callback` |
| Steam OpenID | Steam | `/auth/steam` → `/auth/steam/callback` |
| Native email/password | — | `/auth/login`, `/auth/send-otp`, `/auth/verify-otp` |

Sessions are stored in MongoDB via `connect-mongo`. Cookie config auto-toggles:
- **Development**: `secure: false`, `sameSite: "lax"` (localhost)
- **Production**: `secure: true`, `sameSite: "none"` (cross-origin)

Users can link multiple providers to a single account via the `linkedAccounts` array on the User model.

## Databases

| Database | Used For |
|----------|----------|
| **MongoDB** | Users, sessions, Steam libraries, game reviews, review comments, notifications, activities, friend lists |
| **PostgreSQL** | Game catalog (868k+ games), content embeddings, chat messages, SteamSpy trending snapshots, Steam-RAWG ID mappings, game series |

Both connections are initialized in `config/db.js`. Use `getPG()` to access the PostgreSQL pool.

## Real-time Chat

Socket.IO with session-based authentication. The server shares the Express session middleware with Socket.IO so only authenticated users can connect.

- **Per-game rooms**: Users join rooms by game ID (`join-room` / `leave-room`)
- **Persistent messages**: Chat messages stored in PostgreSQL `game_messages` table
- **History**: Last 50 messages loaded on room join
- **Rate limited**: 10 messages per 10 seconds per user
- **Sanitized**: HTML entities escaped, max 2000 characters

## Rate Limiting

Multi-tier Redis-backed rate limiting with automatic in-memory fallback when Redis is
unavailable. Note the OTP store (`config/otpStore.js`) has **no** such fallback — if Redis
is down, signup and password reset fail unless `DEV_MODE=true`:

| Tier | Strategy | Limit | Scope |
|------|----------|-------|-------|
| Auth (strict) | Sliding window log | 5 req / 15 min | Login, signup, password reset |
| Email/OTP | Sliding window log | 3 req / 15 min | OTP send endpoints |
| API reads | Token bucket + burst | 80 + 20 burst / 15 min | General API routes |
| Search | Token bucket + burst | 20 + 10 burst / 60 sec | Search endpoints |
| Writes | Sliding window counter | 10 / 15 min | Review/comment creation |
| Public | Token bucket + burst | 150 + 50 burst / 15 min | Unauthenticated routes |

All limits above are defaults and can be overridden per tier from `.env` (see the
`RATE_LIMIT_*` variables below). Setting `DEV_MODE=true` disables all six HTTP limiters
entirely — intended for local development only.

Scoped by `req.ip`, with `trust proxy` set to 1. The Socket.IO chat limiter
(10 msgs / 10 sec, in-memory) is separate and is **not** affected by `DEV_MODE`.

Mount order matters: in `server.js` the specific `/api/<sub>` routers are mounted
*before* `app.use("/api", apiLimiter, apiRoutes)`. Because `app.use` with a path prefix
runs for every matching sub-path, mounting the general `/api` limiter first would make
every sub-router consume an `apiLimiter` token on top of its own limiter.

## Cron Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| SteamSpy trending | Every 6 hours | Fetches top 100 trending games from SteamSpy, stores snapshots in PostgreSQL with 6-hour bucket timestamps. Keeps last 56 snapshots. |
| RAWG pipeline trigger | Daily at 3 AM UTC | Sends `POST /pipeline/run` to the ML backend (gamiq) to ingest new games from RAWG. |

## Inter-Service Communication

The backend calls the ML backend (gamiq) internally:

| Endpoint | Purpose | Called By |
|----------|---------|-----------|
| `POST /recommend` | Get game recommendations | API routes (recommendations) |
| `POST /pipeline/run` | Trigger daily RAWG ingestion | RAWG cron job |
| `POST /games/ensure/{rawg_id}` | Ensure a game exists in the pipeline | Trending route |

All gamiq calls use `GAMIQ_URL` and require `Authorization: Bearer {PIPELINE_API_KEY}`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `POSTGRES_URI` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session secret |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `STEAM_API_KEY` | Yes | Steam Web API key |
| `RAWG_API_KEY` | Yes | RAWG API key |
| `EPIC_CLIENT_ID` | No | Epic Games client ID |
| `EPIC_CLIENT_SECRET` | No | Epic Games client secret |
| `EPIC_TOKEN_URL` | No | Epic Games OAuth token URL |
| `EMAIL_USER` | Yes | SMTP email for OTP delivery |
| `EMAIL_PASS` | Yes | SMTP email password |
| `FRONTEND_URL` | Yes | Frontend URL for CORS (e.g., `http://localhost:5173`) |
| `PIPELINE_API_KEY` | Yes | Shared secret for gamiq API calls |
| `GAMIQ_URL` | No | ML backend URL (default: `http://localhost:8000`) |
| `REDIS_URL` | **Yes**\* | Redis URL for rate limiting and the OTP store. No default — startup fails if unset. \*Not required when `DEV_MODE=true`. |
| `KEEP_SNAPSHOTS` | No | Number of SteamSpy snapshots to retain (default: 56) |
| `DEV_MODE` | No | `true` disables all HTTP rate limiting and switches the OTP store to in-memory, so no Redis is needed (default: `false`) |
| `RATE_LIMIT_AUTH_POINTS` / `_DURATION` | No | Strict auth tier (defaults: `5` / `900`) |
| `RATE_LIMIT_EMAIL_POINTS` / `_DURATION` | No | Email/OTP tier (defaults: `3` / `900`) |
| `RATE_LIMIT_API_POINTS` / `_BURST` / `_DURATION` | No | API reads tier (defaults: `80` / `20` / `900`) |
| `RATE_LIMIT_SEARCH_POINTS` / `_BURST` / `_DURATION` | No | Search tier (defaults: `20` / `10` / `60`) |
| `RATE_LIMIT_WRITE_POINTS` / `_DURATION` | No | Writes tier (defaults: `10` / `900`) |
| `RATE_LIMIT_PUBLIC_POINTS` / `_BURST` / `_DURATION` | No | Public tier (defaults: `150` / `50` / `900`) |

All `_DURATION` values are in **seconds**, and one `_DURATION` applies to both the main and
burst limiter of its tier. Invalid values fall back to the default with a logged warning.

Environment variables are loaded by `config/env.js`, which resolves `.env` relative to the
backend directory rather than `process.cwd()`. Import it before reading `process.env` at
module scope — the ad-hoc `dotenv.config()` calls elsewhere run too late for modules
evaluated early in the import graph.

## Deployment

Docker container using Node 20 Alpine:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

Deployed alongside frontend, gamiq, and Redis via Kubernetes on Oracle Cloud ARM64. See `k8s/backend.yaml` for the deployment manifest and `.github/workflows/deploy.yml` for CI/CD.

## Part of GameSocial

This is the backend API of [GameSocial](https://github.com/Vishal-Shaw20). The frontend (React/Vite) connects on port 5173, and the ML backend (Python/FastAPI) runs on port 8000. See the root README for the full architecture.
