# WrzDJ

A modern song request system for DJs. Guests scan a QR code to join an event and submit song requests. DJs manage requests via a web dashboard with real-time StageLinQ integration.

---

## Features at a Glance

| Guest Experience | DJ Dashboard | Live Integration |
|------------------|--------------|------------------|
| Scan QR to join | Accept/reject requests | Auto-detect playing tracks |
| Search via Spotify | Mark songs as played | Real-time "Now Playing" |
| No login required | View play history | Fuzzy request matching |
| See queue on kiosk | Toggle kiosk visibility | Album art enrichment |

### Kiosk Display

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Name                       [QR]  │
├─────────────────┬─────────────────┬─────────────────────────┤
│   Now Playing   │    Up Next      │   Recently Played       │
│                 │                 │                         │
│   Track Title   │  1. Song A      │  1. Song X  [Requested] │
│   Artist Name   │  2. Song B      │  2. Song Y              │
│   [Album Art]   │  3. Song C      │  3. Song Z  [Requested] │
│                 │                 │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

**Smart Visibility**: Now Playing auto-hides after 60 minutes of inactivity. DJs can manually show/hide from the dashboard.

---

## Quick Start (Local Development)

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+ with npm/pnpm
- **Spotify Developer Account** (for API credentials)

### 1. Clone and configure

```bash
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ
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

### 4. Install git hooks

```bash
./scripts/setup-hooks.sh
```

This installs a pre-commit hook that runs ruff and bandit on staged Python files, catching lint errors before they reach CI.

### 5. Start the backend

```bash
cd server
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.scripts.create_user --username admin --password admin
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 6. Start the dashboard

```bash
cd dashboard
npm install
npm run dev
```

### 7. Access the apps

- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Dashboard**: http://localhost:3000

---

## Deployment

WrzDJ supports three deployment methods. All use a **subdomain model** in production:
- **Frontend**: `https://app.your-domain.example`
- **Backend**: `https://api.your-domain.example`

### Option 1: Docker Compose (Local Full Stack)

Run everything locally with Docker:

```bash
docker compose up --build
```

Access at http://localhost:3000 (frontend) and http://localhost:8000 (API).

### Option 2: PaaS (Railway / Render)

#### Render (Recommended)

1. Fork/push this repo to GitHub
2. Connect the repo to [Render](https://render.com)
3. Render auto-detects `render.yaml` and creates services
4. Set Spotify credentials in Render dashboard (Environment tab)
5. Add custom domains:
   - `wrzdj-api` service → `api.yourdomain.com`
   - `wrzdj-web` service → `app.yourdomain.com`
6. Configure DNS with CNAME records pointing to Render

#### Railway

1. Create a new project on [Railway](https://railway.app)
2. Add a PostgreSQL database
3. Deploy backend:
   - New Service → GitHub Repo → Select `server` folder
   - Set root directory to `server`
   - Add environment variables (see below)
4. Deploy frontend:
   - New Service → GitHub Repo → Select `dashboard` folder
   - Set root directory to `dashboard`
   - Set build arg: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`
5. Add custom domains in Railway settings

**Required Environment Variables (Backend):**
```
ENV=production
DATABASE_URL=<from Railway PostgreSQL>
JWT_SECRET=<generate with: openssl rand -hex 32>
SPOTIFY_CLIENT_ID=<your Spotify client ID>
SPOTIFY_CLIENT_SECRET=<your Spotify client secret>
CORS_ORIGINS=https://app.yourdomain.com
PUBLIC_URL=https://app.yourdomain.com
```

### Option 3: VPS (Docker Compose)

For full control on your own server (DigitalOcean, Linode, Hetzner, etc.):

#### Prerequisites
- Ubuntu VPS with Docker and Docker Compose
- nginx installed
- Certbot for SSL certificates
- DNS A records: `app.yourdomain.com` and `api.yourdomain.com` → your server IP

#### Deployment Steps

```bash
# Clone repository
cd /opt
git clone https://github.com/yourusername/WrzDJ.git
cd WrzDJ

# Configure environment
cp deploy/.env.example deploy/.env
nano deploy/.env  # Fill in secure values

# Generate JWT secret
openssl rand -hex 32

# Set up SSL certificates (replace yourdomain.com with your actual domain)
sudo certbot certonly --nginx -d app.yourdomain.com
sudo certbot certonly --nginx -d api.yourdomain.com

# Configure nginx (copy and rename the example configs for your domain)
sudo cp deploy/nginx/app.wrzdj.com.conf /etc/nginx/sites-available/app.yourdomain.com.conf
sudo cp deploy/nginx/api.wrzdj.com.conf /etc/nginx/sites-available/api.yourdomain.com.conf
# Edit both files to replace wrzdj.com with your domain
sudo ln -s /etc/nginx/sites-available/app.yourdomain.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Build and start services
docker compose -f deploy/docker-compose.yml up -d --build

# Create admin user
docker compose -f deploy/docker-compose.yml exec api python -m app.scripts.create_user --username admin --password your-secure-password
```

#### Maintenance

```bash
# View logs
docker compose -f deploy/docker-compose.yml logs -f

# Restart services
docker compose -f deploy/docker-compose.yml restart

# Update deployment
git pull
docker compose -f deploy/docker-compose.yml up -d --build

# Database backup
docker compose -f deploy/docker-compose.yml exec db pg_dump -U wrzdj wrzdj > backup.sql
```

---

## Project Structure

```
WrzDJ/
  server/              # FastAPI backend
    app/
      api/             # API routes
      core/            # Configuration, validation
      db/              # Database session
      models/          # SQLAlchemy models
      schemas/         # Pydantic schemas
      services/        # Business logic
    scripts/           # Startup scripts
    Dockerfile
  dashboard/           # Next.js frontend
    app/               # App router pages
    lib/               # Utilities
    Dockerfile
  bridge/              # StageLinQ bridge service (Node.js)
    src/               # TypeScript source
    Dockerfile
  scripts/             # Git hooks and dev tooling
  deploy/              # Deployment configs
    docker-compose.yml # Production compose
    nginx/             # Nginx configs
    .env.example       # Production env template
  docker-compose.yml   # Local dev compose
  render.yaml          # Render PaaS config
  .env.example         # Dev env template
```

---

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
- [x] Three-column layout: Now Playing | Up Next | Recently Played
- [x] Shows "Now Playing" with album art and animated visualizer
- [x] Scrollable "Accepted Requests" queue
- [x] Play history with "Requested" badges for matched songs
- [x] Built-in song request modal
- [x] Auto-hides "Now Playing" after 60 minutes of inactivity
- [x] Kiosk mode protections (disabled right-click, selection)
- [x] 60-second inactivity timeout on request modal

### DJ Dashboard
- [x] Accept/Reject incoming requests
- [x] Mark songs as Playing/Played
- [x] Toggle "Now Playing" visibility on kiosk (show/hide)
- [x] Edit event expiry time
- [x] Delete events
- [x] Links to song source (Spotify)
- [x] Play history with source badges (Live/Manual) and request matching

### StageLinQ Integration
- [x] Auto-detect tracks from Denon DJ equipment (SC6000, Prime 4, etc.)
- [x] Real-time "Now Playing" with LIVE badge
- [x] Play history log (append-only)
- [x] Automatic request matching via fuzzy search
- [x] Request auto-transition: accepted -> playing -> played
- [x] Spotify album art enrichment for played tracks
- [x] Bridge connection status indicator

### Planned
- [ ] Mobile app for guests
- [ ] Share-to-app from Spotify/Apple Music

---

## StageLinQ Integration

WrzDJ supports automatic track detection from Denon DJ equipment via the StageLinQ protocol. When enabled, the system automatically:

1. Detects what track the DJ is playing in real-time
2. Displays it on the kiosk with a "LIVE" badge
3. Logs all played tracks to a play history
4. Auto-matches played tracks to guest requests (fuzzy matching)
5. Transitions matched requests through the workflow automatically

### Architecture

```
[SC6000 / Prime 4]
        | StageLinQ (Ethernet/LAN)
        v
[Bridge Service]  -- Node.js, runs on DJ's network
        | HTTP POST (API key auth)
        v
[FastAPI Backend]  -- Cloud or local
        | Polling
        v
[Next.js Frontend] -- Kiosk display + DJ dashboard
```

### Supported Hardware

- Denon SC6000 / SC6000M
- Denon SC5000 / SC5000M
- Denon Prime 4 / Prime 4+
- Denon Prime 2 / Prime Go
- Denon X1850 / X1800 mixer (for network hub)

### Setup

#### 1. Generate a Bridge API Key

```bash
openssl rand -hex 32
```

Save this key - you'll need it for both the backend and bridge.

#### 2. Configure the Backend

Add to your backend `.env`:

```env
BRIDGE_API_KEY=your_generated_key_here
```

Run the database migration:

```bash
cd server
source .venv/bin/activate
alembic upgrade head
```

#### 3. Set Up the Bridge Service

The bridge must run on the same local network as your DJ equipment (StageLinQ uses UDP broadcast discovery).

```bash
cd bridge
npm install
cp .env.example .env
```

Edit `.env`:

```env
WRZDJ_API_URL=https://api.yourdomain.com  # Your backend URL
WRZDJ_BRIDGE_API_KEY=your_generated_key_here
WRZDJ_EVENT_CODE=ABC123  # Event code from DJ dashboard
MIN_PLAY_SECONDS=5  # Debounce threshold (optional)
```

#### 4. Run the Bridge

```bash
npm start
```

You should see:
```
[Bridge] WrzDJ StageLinQ Bridge starting...
[Bridge] API URL: https://api.yourdomain.com
[Bridge] Event Code: ABC123
[Bridge] Connecting to StageLinQ network...
[Bridge] Listening for DJ equipment...
[Bridge] Device ready: SC6000
```

#### 5. Verify It Works

1. Load a track on your DJ equipment
2. Check the kiosk display - you should see the track with a "LIVE" badge
3. The DJ dashboard will show bridge connection status

### Docker Deployment

For production, run the bridge in Docker (must use host networking for StageLinQ discovery):

```bash
cd bridge
docker build -t wrzdj-bridge .
docker run --network host \
  -e WRZDJ_API_URL=https://api.yourdomain.com \
  -e WRZDJ_BRIDGE_API_KEY=your_key \
  -e WRZDJ_EVENT_CODE=ABC123 \
  wrzdj-bridge
```

### Network Requirements

- Bridge machine must be on the same LAN as DJ equipment
- DJ equipment connected via Ethernet (not WiFi)
- Backend can be local or cloud-hosted (bridge only needs outbound HTTP/HTTPS)
- If using HTTPS (recommended), ensure valid SSL certificates

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Bridge not detecting equipment | Ensure bridge is on same LAN, equipment connected via Ethernet |
| "Authentication failed" | Check BRIDGE_API_KEY matches in backend and bridge |
| Tracks not appearing | Check event code is correct and event is active |
| High latency | Bridge should be on same network, not over VPN |

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Root health check |
| `GET /api/health` | API health check |
| `POST /api/auth/login` | DJ authentication |
| `GET /api/events` | List DJ's events |
| `POST /api/events` | Create event |
| `GET /api/events/{code}/display-settings` | Get kiosk display settings |
| `PATCH /api/events/{code}/display-settings` | Toggle now playing visibility |
| `GET /api/public/e/{code}` | Get event info (public) |
| `GET /api/search` | Search songs |
| `POST /api/requests` | Submit song request |
| `PATCH /api/requests/{id}` | Update request status |

### StageLinQ Bridge Endpoints (API Key Auth)

| Endpoint | Description |
|----------|-------------|
| `POST /api/bridge/nowplaying` | Report new track playing |
| `POST /api/bridge/status` | Report bridge connection status |
| `DELETE /api/bridge/nowplaying/{code}` | Signal track ended/deck cleared |

### StageLinQ Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/public/e/{code}/nowplaying` | Get current now-playing track |
| `GET /api/public/e/{code}/history` | Get play history (paginated) |

Full API documentation available at `/docs` when running the backend.
