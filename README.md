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
| Frontend | React 19, Vite 7, React Router 7, Socket.IO Client, Lucide Icons |
| Backend | Node.js, Express, Passport.js, Socket.IO, Mongoose, node-pg, node-cron |
| ML Backend | Python, FastAPI, FAISS, sentence-transformers, ONNX Runtime, Redis |
| Databases | MongoDB (users, sessions, reviews, libraries), PostgreSQL + pgvector (games, embeddings, chat) |
| External APIs | RAWG, Steam Web API, SteamSpy, Epic Games, Riot Games |

## Project Structure

```
GameSocial/
├── frontend/          React SPA (Vite)
├── backend/           Express API server
│   ├── config/        DB connections (Mongo + Postgres), email service
│   ├── cron/          Scheduled jobs (SteamSpy trending, RAWG sync)
│   ├── jobs/          RAWG game sync workers
│   ├── middleware/    Auth guard, Steam auto-sync
│   ├── models/        Mongoose schemas (User, Review, Notification, etc.)
│   ├── routes/        Express route handlers
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

- Node.js 18+
- Python 3.10+
- MongoDB
- PostgreSQL with pgvector extension
- Redis (optional, for recommendation caching)

### Environment Variables

Copy the example files and fill in your credentials:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp gamiq/.env.example gamiq/.env
```

### Installation & Running

**Backend**
```bash
cd backend
npm install
npm run dev          # Express server on port 5000
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

## Architecture Overview

```
                    ┌─────────────────┐
                    │   React SPA     │
                    │   (port 5173)   │
                    └───────┬─────────┘
                            │ /api, /auth (proxy)
                            │ WebSocket
                            ▼
                    ┌─────────────────┐
                    │  Express API    │
                    │  (port 5000)    │
                    │  + Socket.IO    │
                    └──┬─────────┬────┘
                       │         │
                       ▼         ▼
            ┌─────────────┐  ┌─────────────┐
            │  MongoDB    │  │ PostgreSQL  │
            │  Users,     │  │ 868k games, │
            │  Sessions,  │  │ embeddings, │
            │  Reviews    │  │ chat msgs   │
            └─────────────┘  └──────┬──────┘
                                    │
                                    ▼
                    ┌──────────────────────────┐
                    │  FastAPI ML Backend      │
                    │  (port 8000)             │
                    │  FAISS + ONNX Reranker   │
                    │  + Redis Cache           │
                    └──────────────────────────┘
```

The Express backend calls the ML backend internally via `POST /recommend`, enriches the returned game IDs with metadata, and sends results to the frontend.

## Recommendation Engine

Two-stage pipeline processing 868k+ games:

1. **Stage 1 — FAISS retrieval:** `BAAI/bge-large-en-v1.5` embeddings (1024-dim) with IVFFlat index retrieve top-500 candidates
2. **Stage 2 — Cross-encoder reranking:** `BAAI/bge-reranker-base` (ONNX INT8) reranks to top-50, then a 6-signal scoring formula (reranker, FAISS similarity, genre overlap, user rating, metacritic, popularity) produces final top-10

