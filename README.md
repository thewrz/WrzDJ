<p align="center">
  <img src="https://img.shields.io/badge/release-v2026-blue" alt="Release">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platforms">
</p>

# WrzDJ

A real-time song request system for DJs. Guests scan a QR code to submit requests. DJs manage everything from a live dashboard with automatic track detection from their equipment via plugins for Denon, Pioneer, Serato, and Traktor.

<p align="center">
  <img src="docs/images/event-management.png" alt="WrzDJ DJ Dashboard" width="800">
  <br>
  <em>DJ dashboard: manage requests, QR code for guests, live Now Playing detection, kiosk controls</em>
</p>

<p align="center">
  <img src="docs/images/guest-join-mobile.png" alt="WrzDJ Guest Join Page (Mobile)" width="300">
  <br>
  <em>Guest join page: scan a QR code, browse the queue, request a song</em>
</p>

---

## Features

**Guest experience**
- QR code join, no app install or login required
- Search songs via Spotify, submit requests with notes, upvote others
- Live request queue and kiosk display showing what's playing now

**DJ dashboard**
- Accept, reject, and manage requests in real-time (SSE push updates)
- Tabbed event detail with Song Management and Event Management views
- Search Spotify, Beatport, and Tidal directly from the dashboard
- Inline audio previews for Spotify and Tidal tracks
- Color-coded Camelot key badges and BPM proximity indicators for harmonic mixing
- Single-active playing constraint (marking a new track auto-transitions the previous one)
- Multi-service playlist sync to Tidal and Beatport with version-aware matching
- Manual track linking when auto-match fails
- Event banners, play history with source badges, CSV export
- Bridge connection status, activity log, contextual help system
- Cloud provider OAuth (Tidal, Beatport) with per-event playlist sync toggles

**Song recommendations**
- Three modes: From Requests (musical profile), From Playlist (template), AI Assist (natural language via Claude)
- Scored on BPM compatibility, harmonic key, genre similarity, and artist diversity
- Half-time BPM matching, junk filtering, MusicBrainz artist verification badges
- Background metadata enrichment via ISRC matching, Beatport, Tidal, MusicBrainz, Soundcharts

**Admin dashboard**
- User management with role-based access (admin/dj/pending) and self-registration
- Integration health dashboard with per-service enable/disable toggles
- AI/LLM settings, search rate limits, system settings (all DB-backed, no restart needed)

**Kiosk display**
- Full-screen three-column layout: Now Playing, Up Next, Recently Played
- QR pairing with session persistence across power cycles
- Custom banner backgrounds, built-in request modal, display-only mode
- Raspberry Pi deployment with WiFi captive portal and crash recovery watchdog

**Stream overlay**
- Transparent OBS browser source at `/e/{code}/overlay`
- Now Playing track with album art, queue with vote counts

**Bridge (DJ equipment detection)**
- Plugin system: Denon StageLinQ, Pioneer PRO DJ LINK, Serato DJ, Traktor Broadcast
- Automatic request matching via fuzzy search, Spotify album art enrichment
- Circuit breaker, reconnection with backoff, track buffer replay
- Desktop app (Windows/macOS/Linux) or CLI

---

## Architecture

```
[Guests]                     [DJ]
   |                           |
   | scan QR                   | dashboard
   v                           v
[Next.js Frontend] <------> [FastAPI Backend] <--- [PostgreSQL]
                               |          |
                     +---------+----------+---------+
                     |         |          |         |          |
                  [Spotify] [Tidal]  [Beatport]  [MusicBrainz] [Soundcharts]
                  (search)  (sync +   (sync +    (genre +       (discovery +
                            search)   search)    verification)   BPM/key)
                               ^
                               | HTTP (API key auth)
                               |
                        [Bridge Service]
                          (plugin system)
                      /       |        |        \
            StageLinQ   PRO DJ LINK  Session    Icecast
              (LAN)      (Ethernet)   (file)    (local)
                |             |          |          |
          [Denon CDJs]  [Pioneer CDJs] [Serato]  [Traktor Pro]
```

| Service | Stack | Directory |
|---------|-------|-----------|
| Backend | Python, FastAPI, SQLAlchemy 2.0, PostgreSQL, Alembic | `server/` |
| Frontend | Next.js 16, React 19, TypeScript, vanilla CSS | `dashboard/` |
| Bridge | Node.js, TypeScript, plugin architecture | `bridge/` |
| Bridge App | Electron, React, Vite, electron-forge | `bridge-app/` |
| Kiosk | Raspberry Pi, Cage (Wayland), Chromium, Python stdlib | `kiosk/` |

### Supported DJ Equipment

**Denon (via StageLinQ)** -- SC6000, SC5000, Prime 4/4+, Prime 2, Prime Go, X1850/X1800 mixer

**Pioneer (via PRO DJ LINK)** -- CDJ-3000, CDJ-2000NXS2/NXS, XDJ-1000MK2, XDJ-700, DJM-900NXS2/750MK2 mixer. Requires Ethernet (same LAN).

**Serato (via session file monitoring)** -- Serato DJ Pro/Lite, any controller. Reads session files from disk, no network setup needed.

**Traktor (via Broadcast)** -- Traktor Pro 3/4, any controller with broadcast enabled.

---

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 22+
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

The bridge connects to DJ equipment and reports "Now Playing" data to the server. It requires a running WrzDJ server (steps 1-6 above).

**Desktop app (recommended):** Download from [Releases](https://github.com/thewrz/WrzDJ/releases) (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`). Also available via `winget install WrzDJ.WrzDJ-Bridge` on Windows.

**CLI bridge:**

```bash
cd bridge
npm install
cp .env.example .env
# Edit .env with your API URL, bridge API key, event code, and protocol
npm start
```

---

## Deployment

Production uses a subdomain model: `app.your-domain.example` (frontend) and `api.your-domain.example` (backend).

### Docker Compose (Local Full Stack)

```bash
docker compose up --build
```

### PaaS (Render / Railway)

**Render** auto-detects `render.yaml`. Push to GitHub, connect to [Render](https://render.com), set credentials in the Environment tab.

**Railway**: Create project on [Railway](https://railway.app), add PostgreSQL, deploy `server/` and `dashboard/` as separate services.

### VPS (Docker + nginx)

```bash
cd /opt && git clone https://github.com/thewrz/WrzDJ.git && cd WrzDJ
cp deploy/.env.example deploy/.env  # Fill in secure values
docker compose -f deploy/docker-compose.yml up -d --build
```

Set up nginx:
```bash
APP_DOMAIN=app.yourdomain.com API_DOMAIN=api.yourdomain.com ./deploy/setup-nginx.sh
sudo certbot --nginx -d app.yourdomain.com -d api.yourdomain.com
```

See `deploy/DEPLOYMENT.md` for full setup instructions.

### Required Backend Environment Variables

```
ENV=production
DATABASE_URL=<PostgreSQL connection string>
JWT_SECRET=<openssl rand -hex 32>
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET
BEATPORT_CLIENT_ID / BEATPORT_CLIENT_SECRET
BRIDGE_API_KEY=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<optional, enables AI Assist recommendations>
CORS_ORIGINS=https://app.yourdomain.com
PUBLIC_URL=https://app.yourdomain.com
```

---

## API Documentation

Interactive API docs are available at `/docs` when the backend is running.

---

## Project Structure

```
WrzDJ/
  server/           # FastAPI backend
  dashboard/        # Next.js frontend
  bridge/           # DJ equipment bridge (Node.js)
  bridge-app/       # Electron desktop app for the bridge
  kiosk/            # Raspberry Pi kiosk deployment
  deploy/           # Production deployment configs
  scripts/          # Git hooks and dev tooling
  .github/workflows # CI + release pipeline
```

---

## License

MIT
