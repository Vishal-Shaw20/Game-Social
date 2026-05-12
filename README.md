# GameSocial

A gaming social platform where players discover games, sync their Steam libraries, write reviews, chat in game-specific rooms, and get ML-powered recommendations.

## Features

**Discovery**
- Trending games carousel powered by SteamSpy data
- Game search with genre and platform filters across 868k+ games
- Curated "GameSocial Recommended" and new releases sections
- AI-powered game recommendations using FAISS vector search + cross-encoder reranking

**Game Pages**
- Detailed game pages with screenshots, descriptions, ratings, and metadata
- Real-time per-game chat rooms (Socket.IO)
- Review system with four verdicts (Perfection / Almost had something / Subpar slop / A disaster, but kind of funny) and pro/con tags
- Review comments with @mentions
- Steam achievement tracking and playtime stats for owned games

**Social**
- Friend system with send/accept/remove
- Friend activity feed
- Public user profiles with game libraries

**Library**
- Automatic Steam library sync on login
- RAWG-to-Steam ID mapping for cross-platform game data
- Ownership detection on game pages

**Authentication**
- Google OAuth
- Steam OpenID
- Email/password with OTP verification
- Multi-provider account linking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, React Router 7, Socket.IO Client, Lucide Icons, CSS Modules |
| Backend | Node.js 20, Express, Passport.js, Socket.IO, Mongoose, node-pg, Pino, Helmet, node-cron |
| ML Backend | Python 3.13, FastAPI, FAISS, sentence-transformers, ONNX Runtime, Redis |
| Databases | MongoDB (users, sessions, reviews, libraries), PostgreSQL + pgvector (games, embeddings, chat) |
| Infrastructure | Docker Compose, nginx, Redis 7, Let's Encrypt (certbot), GitHub Actions CI/CD |
| External APIs | RAWG, Steam Web API, SteamSpy, Epic Games, Riot Games |

## Project Structure

```
GameSocial/
├── frontend/          React SPA (Vite)
├── backend/           Express API server
│   ├── config/        DB connections (Mongo + Postgres), email, logger
│   ├── cron/          Scheduled jobs (SteamSpy trending, RAWG sync)
│   ├── middleware/    Auth guard, rate limiter, Steam auto-sync
│   ├── models/        Mongoose schemas (User, Review, Notification, etc.)
│   ├── routes/        Express route handlers
│   ├── services/      Steam library sync
│   ├── social/        Socket.IO text chat handlers
│   ├── strategies/    Passport strategies (Google, Steam)
│   └── utils/         Helpers (Steam mapping, mentions, activities)
└── gamiq/             ML recommendation engine
    ├── recommender/   FastAPI app, inference pipeline, data pipeline
    │   ├── inference/ FAISS search + ONNX reranker
    │   └── offline/   Index rebuild and embedding export scripts
    └── tests/         pytest test suite (43 tests)
```

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+
- MongoDB
- PostgreSQL with pgvector extension
- Redis (optional — rate limiting and recommendation caching fall back gracefully without it)

### Environment Variables

Copy the example files and fill in your credentials:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp gamiq/.env.example gamiq/.env
```

Key variables per service:

| Service | Variables |
|---------|-----------|
| Backend | `MONGO_URI`, `POSTGRES_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `STEAM_API_KEY`, `RAWG_API_KEY`, `EMAIL_USER`, `EMAIL_PASS`, `FRONTEND_URL`, `PIPELINE_API_KEY`, `GAMIQ_URL` |
| Frontend | `VITE_API_URL`, `VITE_SOCKET_URL` |
| ML Backend | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `RAWG_API_KEY` (+ `_1` through `_15`), `PIPELINE_API_KEY`, `HF_TOKEN`, `REDIS_URL` |

See each service's README for the full list.

### Installation & Running

**Backend**
```bash
cd backend
npm install
npm run dev          # Express + Socket.IO on port 5000 (with pino-pretty logs)
```

**Frontend**
```bash
cd frontend
npm install
npm run dev          # Vite dev server on port 5173
```

**ML Backend**
```bash
cd gamiq
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload    # FastAPI on port 8000
```

The Vite dev server proxies `/api` and `/auth` requests to the backend automatically.

### Running Tests

```bash
# ML backend tests
cd gamiq
pytest tests/ -v

# Frontend lint
cd frontend
npm run lint
```

## Architecture

```
                    ┌─────────────────┐
                    │   React SPA     │
                    │   (port 5173)   │
                    └───────┬─────────┘
                            │ /api, /auth (proxy)
                            │ WebSocket (Socket.IO)
                            ▼
                    ┌─────────────────┐
                    │  Express API    │
                    │  (port 5000)    │
                    │  + Socket.IO    │
                    └──┬──────┬───┬───┘
                       │      │   │
                       ▼      │   ▼
            ┌─────────────┐   │  ┌──────────────┐
            │  MongoDB    │   │  │ PostgreSQL   │
            │  Users,     │   │  │ 868k games,  │
            │  Sessions,  │   │  │ embeddings,  │
            │  Reviews    │   │  │ chat msgs    │
            └─────────────┘   │  └──────┬───────┘
                              │         │
                              ▼         ▼
                    ┌──────────────────────────┐
                    │  FastAPI ML Backend      │
                    │  (port 8000)             │
                    │  FAISS + ONNX Reranker   │
                    └──────────┬───────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │  Redis 7                 │
                    │  Rate limiting (backend) │
                    │  Rec cache (gamiq, 24h)  │
                    └──────────────────────────┘
```

The Express backend calls the ML backend internally via `POST /recommend`, enriches the returned game IDs with metadata, and sends results to the frontend. Redis is shared: the backend uses it for multi-tier rate limiting, and gamiq uses it for recommendation caching.

## Recommendation Engine

Two-stage pipeline processing 868k+ games:

1. **Stage 1 — FAISS retrieval:** `BAAI/bge-large-en-v1.5` embeddings (1024-dim) with IVFFlat index retrieve top-500 candidates
2. **Stage 2 — Cross-encoder reranking:** `BAAI/bge-reranker-base` (ONNX INT8) reranks to top-50, then a 6-signal scoring formula (reranker, FAISS similarity, genre overlap, user rating, metacritic, popularity) produces final top-10

## Deployment

All three services deploy as Docker containers on EC2 (t3.small) via Docker Compose, with automated CI/CD through GitHub Actions.

```
docker-compose.yml
├── frontend     → nginx (ports 80, 443) — serves SPA + reverse proxies to backend
├── backend      → Node.js 20 Alpine (port 5000)
├── gamiq        → Python 3.13 slim (port 8000) — FAISS artifacts on persistent volume
├── redis        → Redis 7 Alpine — rate limiting + recommendation cache
└── certbot      → Let's Encrypt certificate auto-renewal
```

The CI/CD pipeline (`.github/workflows/deploy.yml`) builds Docker images, pushes to GHCR, then SSH-deploys to EC2 on every push to `main`.
