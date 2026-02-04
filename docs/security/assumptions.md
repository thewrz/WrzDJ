# Security Assumptions

## Hosting Topology

- **Reverse Proxy**: Nginx handles HTTPS termination and forwards requests to the backend
- **Backend**: FastAPI running on port 8000 (internal only)
- **Frontend**: Next.js served statically or via Node.js on port 3000
- **Database**: PostgreSQL (internal network only, not exposed to internet)

## Trusted Headers

When behind Nginx reverse proxy:
- `X-Forwarded-For`: Contains the real client IP (first value)
- `X-Forwarded-Proto`: Indicates original protocol (http/https)
- `X-Real-IP`: Alternative client IP header

**Configuration**: The backend should only trust these headers when running behind a known proxy. Use `TRUSTED_PROXY=true` env var to enable.

## Rate Limit Design

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `/api/auth/login` | 5 | 1 min | IP |
| `/api/events/{code}/requests` | 20 | 1 min | IP |
| `/api/search` | 30 | 1 min | IP |
| `/api/public/*` | 60 | 1 min | IP |

Rate limits return `429 Too Many Requests` with `Retry-After` header.

## Login Lockout Policy

- **5 failed attempts**: 5-minute cooldown
- **10 failed attempts**: 30-minute cooldown
- Lockouts are tracked per IP and per username separately
- Error messages are generic to prevent account enumeration

## Endpoint Authentication

### Public Endpoints (No Auth Required)
- `POST /api/auth/login` - Login
- `GET /api/events/{code}` - Get event info (for join page)
- `POST /api/events/{code}/requests` - Submit song request (guest)
- `GET /api/search` - Search songs
- `GET /api/public/events/{code}/display` - Kiosk display data
- `GET /openapi.json` - API documentation

### Authenticated Endpoints (JWT Required)
- `GET /api/auth/me` - Get current user
- `GET /api/events` - List DJ's events
- `POST /api/events` - Create event
- `PATCH /api/events/{code}` - Update event
- `DELETE /api/events/{code}` - Delete event
- `GET /api/events/{code}/requests` - List requests (DJ view)
- `PATCH /api/requests/{id}` - Update request status
- `POST /api/search/clear-cache` - Clear search cache (admin)

## Input Validation Rules

| Field | Min | Max | Rules |
|-------|-----|-----|-------|
| Event name | 1 | 100 | Strip whitespace, no control chars |
| Song title | 1 | 255 | Strip whitespace, no control chars |
| Artist name | 1 | 255 | Strip whitespace, no control chars |
| Request note | 0 | 500 | Strip whitespace, no control chars |
| Search query | 1 | 120 | Strip whitespace, no control chars |
| Event code | 6 | 6 | Alphanumeric only |
| Username | 3 | 50 | Alphanumeric + underscore |
| Password | 8 | 128 | Any printable chars |

## External API Timeouts

| Service | Connect | Read | Total | Retries |
|---------|---------|------|-------|---------|
| Spotify API | 5s | 10s | 15s | 2 |
| MusicBrainz API | 5s | 10s | 15s | 2 |

## CORS Policy

### Development
- Allow `http://localhost:3000`
- Allow `http://192.168.*.*:3000` (LAN testing)

### Production
- Restrict to specific dashboard domain(s)
- Never use wildcard (`*`) with credentials
