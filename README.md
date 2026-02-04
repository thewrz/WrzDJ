# WrzDJ

A song request system for DJs. Guests scan a QR code to join an event and submit song requests. DJs manage requests via a web dashboard.

> **Note:** This is the `spotify-search` branch which uses the Spotify API for song search. For the free MusicBrainz-based search, use the `main` branch.

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
npm install
npm run dev
```

### 6. Access the apps

- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Dashboard**: http://localhost:3000

---

## Deployment

WrzDJ supports three deployment methods. All use a **subdomain model** in production:
- **Frontend**: `https://app.wrzdj.com`
- **Backend**: `https://api.wrzdj.com`

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
   - `wrzdj-api` service → `api.wrzdj.com`
   - `wrzdj-web` service → `app.wrzdj.com`
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
   - Set build arg: `NEXT_PUBLIC_API_URL=https://api.wrzdj.com`
5. Add custom domains in Railway settings

**Required Environment Variables (Backend):**
```
ENV=production
DATABASE_URL=<from Railway PostgreSQL>
JWT_SECRET=<generate with: openssl rand -hex 32>
SPOTIFY_CLIENT_ID=<your Spotify client ID>
SPOTIFY_CLIENT_SECRET=<your Spotify client secret>
CORS_ORIGINS=https://app.wrzdj.com
PUBLIC_URL=https://app.wrzdj.com
```

### Option 3: VPS (Docker Compose)

For full control on your own server (DigitalOcean, Linode, Hetzner, etc.):

#### Prerequisites
- Ubuntu VPS with Docker and Docker Compose
- nginx installed
- Certbot for SSL certificates
- DNS A records: `app.wrzdj.com` and `api.wrzdj.com` → your server IP

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

# Set up SSL certificates
sudo certbot certonly --nginx -d app.wrzdj.com
sudo certbot certonly --nginx -d api.wrzdj.com

# Configure nginx
sudo cp deploy/nginx/app.wrzdj.com.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/api.wrzdj.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/app.wrzdj.com.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.wrzdj.com.conf /etc/nginx/sites-enabled/
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

---

## Branches

- **`main`** - Uses MusicBrainz for song search (free, no API key required)
- **`spotify-search`** - Uses Spotify API for song search (requires credentials, includes album art)

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Root health check |
| `GET /api/health` | API health check |
| `POST /api/auth/login` | DJ authentication |
| `GET /api/events` | List DJ's events |
| `POST /api/events` | Create event |
| `GET /api/public/e/{code}` | Get event info (public) |
| `GET /api/search` | Search songs |
| `POST /api/requests` | Submit song request |
| `PATCH /api/requests/{id}` | Update request status |

Full API documentation available at `/docs` when running the backend.
