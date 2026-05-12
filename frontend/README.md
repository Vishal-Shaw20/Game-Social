# GameSocial Frontend

React single-page application for GameSocial — a gaming social platform for discovering games, syncing Steam libraries, writing reviews, chatting in game rooms, and connecting with friends.

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19 | UI framework |
| Vite | 7 | Build tool and dev server |
| React Router | 7 | Client-side routing |
| Socket.IO Client | 4 | Real-time game chat |
| Lucide React | — | Icon library |
| CSS Modules | — | Component-scoped styling |

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | HomePage | Trending carousel, GS Recommended, new releases |
| `/dashboard` | DashBoard | User dashboard with activity feed |
| `/game/:id` | GameDetails | Game page with screenshots, reviews, chat, achievements |
| `/login` | LoginPage | Google OAuth, Steam OpenID, email/password login |
| `/signup` | LoginPage | Account registration with OTP verification |
| `/library` | Library | Steam library with RAWG-enriched game data |
| `/social` | Social | Real-time per-game chat rooms |
| `/u/:username` | UserProfile | Public user profile with game library |

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx                App root with route definitions
│   ├── HomePage.jsx           Home page (trending, recommended, new releases)
│   ├── MentionInput.jsx       @mention input component
│   ├── main.jsx               Entry point
│   ├── components/
│   │   ├── Layout.jsx         Three-column layout (left sidebar, main, right sidebar)
│   │   ├── SidebarLeft.jsx    Navigation sidebar
│   │   ├── SidebarRight.jsx   Contextual sidebar
│   │   ├── Footer.jsx         Site footer
│   │   ├── GameDetails.jsx    Game page (details, screenshots, ownership)
│   │   ├── GameReviews.jsx    Review list with verdict tags
│   │   ├── ReviewComments.jsx Comment thread on reviews
│   │   ├── CommentItem.jsx    Single review comment
│   │   ├── GameChat.jsx       Per-game Socket.IO chat room
│   │   ├── GameSearch.jsx     Game search with filters
│   │   ├── GameCarousel.jsx   Horizontal scrolling game carousel
│   │   ├── GSRecommended.jsx  GameSocial ML-recommended games section
│   │   ├── NewReleases.jsx    New releases section
│   │   ├── TagSelector.jsx    Review pro/con tag picker
│   │   ├── Library.jsx        Steam library page
│   │   ├── Social.jsx         Chat rooms page
│   │   ├── UserProfile.jsx    Public user profile
│   │   ├── DashBoard.jsx      User dashboard
│   │   └── LoginPage.jsx      Login/signup page
│   ├── hooks/
│   │   ├── useAuth.js         Session management and auth state
│   │   ├── useSocket.js       Socket.IO connection lifecycle
│   │   ├── useTextChat.js     Chat message send/receive logic
│   │   └── useCarouselScroll.js  Carousel scroll behavior
│   ├── shared/
│   │   └── reviewTags.js      Review tag definitions (synced with backend)
│   ├── utils/
│   │   ├── normalizeGames.js  Normalize game data across API sources
│   │   └── generateId.js      Client-side ID generation
│   └── tests/                 API integration test components
├── nginx.conf                 Production reverse proxy config
├── Dockerfile                 Multi-stage build (Vite → nginx)
├── vite.config.js             Dev server and proxy config
└── eslint.config.js           ESLint flat config
```

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Polls `/auth/user` for session state, exposes `currentUser`, `isAuthenticated`, `requireLogin` |
| `useSocket` | Manages Socket.IO client connection lifecycle |
| `useTextChat` | Handles chat room join/leave, message send/receive, and history loading |
| `useCarouselScroll` | Horizontal scroll behavior for game carousels |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend URL for Vite dev proxy (e.g., `http://localhost:5000`) |
| `VITE_SOCKET_URL` | No | Socket.IO server URL (falls back to `window.location.origin`) |

## Getting Started

```bash
npm install
npm run dev          # Vite dev server on port 5173
```

The dev server proxies `/api` and `/auth` requests to the backend at `VITE_API_URL`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

## Production Build

The `Dockerfile` uses a multi-stage build:

1. **Build stage** — Node 20 Alpine, runs `vite build`
2. **Serve stage** — nginx Alpine, serves static files from `dist/`

The `nginx.conf` handles:
- HTTPS with Let's Encrypt certificates
- Reverse proxy for `/api/`, `/auth/`, and `/socket.io/` to the backend
- SPA fallback (`try_files` to `index.html`)
- Rate limiting (30 req/s for API, 10 req/m for auth)

## Part of GameSocial

This is the frontend of [GameSocial](https://github.com/Vishal-Shaw20). The backend (Node.js/Express) runs on port 5000, and the ML backend (Python/FastAPI) runs on port 8000. See the root README for the full architecture.
