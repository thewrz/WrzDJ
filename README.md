<p align="center">
  <img src="https://img.shields.io/badge/release-v2026-blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platforms">
</p>

# WrzDJ

A modern, real-time song request system for DJs. Guests scan a QR code to submit requests -- no app install, no login. DJs manage everything from a live dashboard with automatic track detection from Denon DJ equipment via StageLinQ.

---

## What Makes WrzDJ Different

- **Zero friction for guests** -- scan a QR code, search Spotify, submit a request. Done.
- **Live track detection** -- the bridge connects directly to Denon DJ hardware over StageLinQ, so the kiosk and dashboard update in real-time as the DJ plays.
- **Automatic request matching** -- when the DJ plays a requested song, WrzDJ detects it via fuzzy matching and moves it through the workflow automatically.
- **Tidal playlist sync** -- accepted requests are auto-added to a Tidal playlist, ready for the SC6000 to load.
- **Desktop app for the bridge** -- no terminal needed. Sign in, pick your event, click Start.

---

## Features

### Guest Experience
- Scan a QR code to join an event instantly (no login required)
- Search songs via Spotify with album art and popularity info
- Submit requests with optional notes to the DJ
- Upvote other guests' requests to bump priority
- View the live request queue and see what's been accepted
- See what's playing now on the kiosk display

### DJ Dashboard
- Accept, reject, and manage incoming song requests in real-time
- Bulk accept all pending requests with one click
- Mark songs as Playing/Played with full status workflow (new -> accepted -> playing -> played)
- Toggle "Now Playing" visibility on the public kiosk
- Bridge connection status indicator (green/gray dot, polls every 3s)
- Tidal playlist sync -- auto-add accepted requests to a Tidal playlist for SC6000
- Manual Tidal track linking when auto-match fails
- Play history with source badges (Live/Manual) and request matching
- Export requests and play history to CSV
- Edit event expiry, delete events
- QR code display for easy guest onboarding

### Kiosk Display
- Public full-screen view at `/e/{code}/display`
- Three-column layout: Now Playing | Up Next | Recently Played
- Animated audio visualizer on the "Now Playing" card
- Album art from Spotify enrichment
- "Requested" badges on play history items that matched guest requests
- Built-in song request modal with 60-second inactivity timeout
- Auto-hides "Now Playing" after 60 minutes of inactivity
- Kiosk mode protections (disabled right-click, text selection)

### StageLinQ Bridge
- Auto-detect tracks from Denon DJ equipment in real-time
- Robust deck state machine with configurable thresholds
- Master deck priority and channel fader detection
- Pause grace periods to avoid false transitions
- Real-time "Now Playing" with LIVE badge on kiosk
- Append-only play history log
- Automatic request matching via fuzzy search (artist + title)
- Request auto-transition: accepted -> playing -> played
- Spotify album art enrichment for detected tracks
- Bridge connection status visible on DJ dashboard

### Bridge Desktop App (NEW)
- Cross-platform Electron app (Windows `.exe`, macOS `.dmg`, Linux `.deb`)
- Sign in with your WrzDJ account -- no API keys to copy/paste
- Select your active event from a dropdown
- One-click Start/Stop for StageLinQ detection
- Real-time status panel: connected devices, current track, per-deck states
- Configurable detection settings (live threshold, pause grace, fader detection, master deck priority)
- Encrypted credential storage via OS keychain (`safeStorage`)
- Dark theme matching the WrzDJ dashboard

### Automated Releases
- GitHub Actions release workflow triggers on PR merge to `main`
- Dated versioning: `v2026.02.07`, with same-day suffix support (`v2026.02.07.2`)
- Builds bridge-app installers on 3 platforms in parallel
- Bundles deploy scripts as a `.tar.gz` artifact
- Auto-generated release notes from PR title/body + commit log

---

## Architecture

```
[Guests]                     [DJ]
   |                           |
   | scan QR                   | dashboard
   v                           v
[Next.js Frontend] <------> [FastAPI Backend] <--- [PostgreSQL]
                               ^
                               | HTTP (API key auth)
                               |
                        [Bridge Service]
                               ^
                               | StageLinQ (LAN)
                               |
                     [Denon SC6000 / Prime 4]
```

| Service | Stack | Directory |
|---------|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy 2.0, PostgreSQL, Alembic | `server/` |
| Frontend | Next.js 16, React 18, TypeScript, vanilla CSS | `dashboard/` |
| Bridge | Node.js, TypeScript, StageLinQ protocol | `bridge/` |
| Bridge App | Electron, React, Vite, electron-forge | `bridge-app/` |

### Supported DJ Hardware

- Denon SC6000 / SC6000M
- Denon SC5000 / SC5000M
- Denon Prime 4 / Prime 4+
- Denon Prime 2 / Prime Go
- Denon X1850 / X1800 mixer (as network hub)

---

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+
- [Spotify Developer Account](https://developer.spotify.com/dashboard) (for song search)

### 1. Clone and configure

```bash
git clone https://github.com/thewrz/WrzDJ.git
cd WrzDJ
cp .env.example .env
# Edit .env with your Spotify credentials, JWT secret, etc.
```

### 2. Start the database

```bash
docker compose up -d db
```

### 3. Install git hooks

```bash
./scripts/setup-hooks.sh
```

### 4. Start the backend

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.scripts.create_user --username admin --password admin
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Start the dashboard

```bash
cd dashboard
npm install
npm run dev
```

### 6. Access the apps

- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Dashboard**: http://localhost:3000

### 7. (Optional) Run the bridge

For StageLinQ integration, the bridge must be on the same LAN as your DJ equipment:

```bash
cd bridge
npm install
cp .env.example .env
# Edit .env with your API URL, bridge API key, and event code
npm start
```

Or use the desktop app instead -- see [Bridge Desktop App](#bridge-desktop-app-new) above.

---

## Deployment

WrzDJ supports three deployment methods. Production uses a **subdomain model**:
- `https://app.your-domain.example` (frontend)
- `https://api.your-domain.example` (backend)

### Option 1: Docker Compose (Local Full Stack)

```bash
docker compose up --build
```

### Option 2: PaaS (Render / Railway)

**Render** -- auto-detects `render.yaml`:

1. Push to GitHub, connect to [Render](https://render.com)
2. Set Spotify credentials in the Environment tab
3. Add custom domains for API and frontend services

**Railway**:

1. Create project on [Railway](https://railway.app), add PostgreSQL
2. Deploy `server/` and `dashboard/` as separate services
3. Set environment variables (see `.env.example`)

### Option 3: VPS (Docker + nginx)

For full control on your own server:

```bash
cd /opt && git clone https://github.com/thewrz/WrzDJ.git && cd WrzDJ
cp deploy/.env.example deploy/.env  # Fill in secure values
docker compose -f deploy/docker-compose.yml up -d --build
```

See `deploy/DEPLOYMENT.md` for full nginx and SSL setup instructions.

### Required Backend Environment Variables

```
ENV=production
DATABASE_URL=<PostgreSQL connection string>
JWT_SECRET=<openssl rand -hex 32>
SPOTIFY_CLIENT_ID=<from Spotify Developer Dashboard>
SPOTIFY_CLIENT_SECRET=<from Spotify Developer Dashboard>
BRIDGE_API_KEY=<openssl rand -hex 32>
CORS_ORIGINS=https://app.yourdomain.com
PUBLIC_URL=https://app.yourdomain.com
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | DJ authentication |
| `GET /api/events` | List DJ's events |
| `POST /api/events` | Create event |
| `GET /api/events/{code}/display-settings` | Get kiosk display settings |
| `PATCH /api/events/{code}/display-settings` | Toggle now playing visibility |
| `GET /api/public/e/{code}` | Get event info (public) |
| `GET /api/search` | Search songs via Spotify |
| `POST /api/requests` | Submit song request |
| `PATCH /api/requests/{id}` | Update request status |
| `POST /api/votes/{request_id}` | Upvote a request |
| `GET /api/bridge/apikey` | Get bridge API key (JWT auth) |

### StageLinQ Bridge Endpoints (API Key Auth)

| Endpoint | Description |
|----------|-------------|
| `POST /api/bridge/nowplaying` | Report currently playing track |
| `POST /api/bridge/status` | Report bridge connection status |
| `DELETE /api/bridge/nowplaying/{code}` | Signal track ended / deck cleared |

### Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/public/e/{code}/nowplaying` | Get current now-playing track |
| `GET /api/public/e/{code}/history` | Get play history (paginated) |
| `GET /api/public/e/{code}/requests` | Get request queue (public) |

Full interactive API documentation available at `/docs` when running the backend.

---

## Built With

WrzDJ is built on these excellent open source projects:

### Core Infrastructure
- [FastAPI](https://github.com/tiangolo/fastapi) -- high-performance Python web framework
- [SQLAlchemy](https://github.com/sqlalchemy/sqlalchemy) -- Python SQL toolkit and ORM
- [Alembic](https://github.com/sqlalchemy/alembic) -- database migration tool for SQLAlchemy
- [PostgreSQL](https://www.postgresql.org/) -- the database
- [Next.js](https://github.com/vercel/next.js) -- React framework for the dashboard and kiosk
- [React](https://github.com/facebook/react) -- UI library

### DJ Integration
- [stagelinq](https://github.com/chrisle/stagelinq) -- Node.js library for the Denon StageLinQ protocol (the backbone of live track detection)
- [Spotipy](https://github.com/spotipy-dev/spotipy) -- Python client for the Spotify Web API
- [python-tidalapi](https://github.com/tamland/python-tidal) -- Python client for the Tidal API

### Desktop App
- [Electron](https://github.com/electron/electron) -- cross-platform desktop framework
- [Electron Forge](https://github.com/electron/forge) -- build tooling and installers for Electron
- [electron-store](https://github.com/sindresorhus/electron-store) -- persistent key-value storage for Electron
- [Vite](https://github.com/vitejs/vite) -- fast build tool and dev server

### Utilities
- [qrcode.react](https://github.com/zpao/qrcode.react) -- QR code generation for React
- [Pydantic](https://github.com/pydantic/pydantic) -- data validation for Python
- [SlowAPI](https://github.com/laurentS/slowapi) -- rate limiting for FastAPI
- [Uvicorn](https://github.com/encode/uvicorn) -- ASGI server
- [bcrypt](https://github.com/pyca/bcrypt) -- password hashing

---

## Project Structure

```
WrzDJ/
  server/              # FastAPI backend
    app/
      api/             # API routes
      core/            # Configuration, validation, rate limiting
      db/              # Database session
      models/          # SQLAlchemy models
      schemas/         # Pydantic schemas
      services/        # Business logic
    scripts/           # Startup scripts
    Dockerfile
  dashboard/           # Next.js frontend
    app/               # App router pages (dashboard, kiosk, join)
    lib/               # API client, auth, utilities
    Dockerfile
  bridge/              # StageLinQ bridge service (Node.js)
    src/               # TypeScript source
    Dockerfile
  bridge-app/          # Electron desktop app for the bridge
    src/
      main/            # Electron main process (auth, IPC, bridge runner)
      preload/         # Context bridge (secure IPC)
      renderer/        # React UI (login, events, controls, status)
      shared/          # Shared types
  scripts/             # Git hooks and dev tooling
  deploy/              # Production deployment configs
    docker-compose.yml
    nginx/
    .env.example
  .github/workflows/   # CI + automated release pipeline
  docker-compose.yml   # Local dev compose
  render.yaml          # Render PaaS config
```

---

## License

MIT
