# WrzDJ

A song request system for DJs. Guests scan a QR code to join an event and submit song requests. DJs manage requests via a web dashboard.

> **Note:** This is the `spotify-search` branch which uses the Spotify API for song search. For the free MusicBrainz-based search, use the `main` branch.

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+ with pnpm (or npm)
- **Spotify Developer Account** (for API credentials)

### 1. Clone and configure

```bash
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ
git checkout spotify-search
cp .env.example .env
```

### 2. Configure Spotify API

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app to get your Client ID and Client Secret
3. Add your credentials to `.env`:

```env
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
```

### 3. Start the database

```bash
docker compose up -d db
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
pnpm install
pnpm dev
```

### 6. Access the apps

- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Dashboard**: http://localhost:3000

## Docker Compose (Full Stack)

```bash
docker compose up
```

This starts PostgreSQL, the FastAPI backend, and the Next.js dashboard.

## Project Structure

```
WrzDJ/
  server/           # FastAPI backend
  dashboard/        # Next.js DJ dashboard
  mobile/           # Expo React Native app (future)
  docker-compose.yml
  .env.example
```

## Features

### Core
- [x] DJ login with JWT authentication
- [x] Create events with unique codes and QR
- [x] Submit song requests (public, no login required)
- [x] Search songs via Spotify API (with album art and popularity)
- [x] Real-time request queue (polling)
- [x] Request workflow: new → accepted → playing → played (or rejected)
- [x] Basic spam/duplicate detection

### Kiosk Display
- [x] Public kiosk view at `/e/{code}/display`
- [x] Shows "Now Playing" with album art and animated visualizer
- [x] Scrollable "Accepted Requests" queue
- [x] Built-in song request modal
- [x] Auto-hides "Now Playing" when no song is active
- [x] Kiosk mode protections (disabled right-click, selection)
- [x] 60-second inactivity timeout on request modal

### DJ Dashboard
- [x] Accept/Reject incoming requests
- [x] Mark songs as Playing/Played
- [x] Edit event expiry time
- [x] Delete events
- [x] Links to song source (Spotify)

### Planned
- [ ] Mobile app for guests
- [ ] Share-to-app from Spotify/Apple Music
- [ ] EngineDJ/Lexicon integration

## Branches

- **`main`** - Uses MusicBrainz for song search (free, no API key required)
- **`spotify-search`** - Uses Spotify API for song search (requires credentials, includes album art)
