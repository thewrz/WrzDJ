# WrzDJ

A song request system for DJs. Guests scan a QR code to join an event and submit song requests. DJs manage requests via a web dashboard.

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+ with pnpm (or npm)

### 1. Clone and configure

```bash
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ
cp .env.example .env
```

### 2. Start the database

```bash
docker compose up -d db
```

### 3. Start the backend

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.scripts.create_user --username admin --password admin
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Start the dashboard

```bash
cd dashboard
pnpm install
pnpm dev
```

### 5. Access the apps

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

### MVP
- [x] DJ login with JWT authentication
- [x] Create events with unique codes and QR
- [x] Submit song requests (public)
- [x] Search songs via MusicBrainz
- [x] Real-time request queue (polling)
- [x] Mark requests: new, playing, played, rejected
- [x] Basic spam/duplicate detection

### Planned
- [ ] Mobile app for guests
- [ ] Share-to-app from Spotify/Apple Music
- [ ] EngineDJ/Lexicon integration
