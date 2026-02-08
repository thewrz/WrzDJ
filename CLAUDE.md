# Claude Code Instructions for WrzDJ

## Project Overview

WrzDJ is a DJ song request management system with four services:
- **Backend**: Python FastAPI (`server/`) — SQLAlchemy 2.0, PostgreSQL, Alembic migrations
- **Frontend**: Next.js 16+ with React 18 (`dashboard/`) — TypeScript, vanilla CSS (dark theme)
- **Bridge**: Node.js StageLinQ integration (`bridge/`) — connects to Denon DJ equipment
- **Bridge App**: Electron GUI for the bridge (`bridge-app/`) — React + Vite, cross-platform installers

## Git Workflow

**Always use feature branches and PRs — never commit directly to `main`.**

```bash
# Create a feature branch before starting work
git checkout -b feat/short-description

# After work is done, push and open a PR
git push -u origin feat/short-description
gh pr create --title "feat: Short description" --body "..."
```

- Branch naming: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/` prefixes
- PR into `main` — never push directly to `main`
- Run all CI checks locally before pushing (see below)

## Local Development

### Prerequisites
- PostgreSQL 16 via Docker: `docker compose up -d db`
- Python 3.11+ with venv: `server/.venv/`
- Node.js 20+

### Starting Services
```bash
# Database
docker compose up -d db

# Backend (from server/)
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (from dashboard/)
Use typical cli tools to determine the local machines LAN IP address (e.g. 192.168.1.25) and update NEXT_PUBLIC_API_URL
NEXT_PUBLIC_API_URL="http://LAN_IP:8000" npm run dev
```

### LAN Testing (phone)
- Bind to `0.0.0.0`, use the LAN IP you discover 
- Set `CORS_ORIGINS=*` for dev
- Set `PUBLIC_URL=http://LAN_IP:3000` for QR codes
- Frontend dev server already binds to `0.0.0.0` via `-H 0.0.0.0` in package.json

### Environment
- `.env` at repo root has all local dev config
- Key vars: `DATABASE_URL`, `JWT_SECRET`, `SPOTIFY_CLIENT_ID/SECRET`, `CORS_ORIGINS`, `PUBLIC_URL`, `NEXT_PUBLIC_API_URL`

## Running CI Checks Locally

**Always run these before pushing.** They mirror `.github/workflows/ci.yml` exactly.

### Backend (from `server/`)
```bash
.venv/bin/ruff check .                        # Lint (E, F, I, UP rules)
.venv/bin/ruff format --check .               # Format check (line-length=100)
.venv/bin/bandit -r app -c pyproject.toml -q  # Security scan
.venv/bin/pytest --tb=short -q                # Tests (70% coverage minimum)
```

### Frontend (from `dashboard/`)
```bash
npm run lint              # ESLint
npx tsc --noEmit          # TypeScript type check (strict)
npm test -- --run         # Vitest (23 tests)
```

### Bridge App (from `bridge-app/`)
```bash
npx tsc --noEmit          # TypeScript type check
npm test -- --run         # Vitest (12 tests)
```

### Quick fix commands
```bash
.venv/bin/ruff format .   # Auto-format Python files
.venv/bin/ruff check --fix .  # Auto-fix lint issues
```

## Testing

### Backend (pytest)
- Config: `server/pyproject.toml` under `[tool.pytest.ini_options]`
- Test DB: SQLite in-memory (not PostgreSQL)
- Fixtures in `server/tests/conftest.py`: `db`, `client`, `test_user`, `auth_headers`, `test_event`, `test_request`
- TestClient's default host is `"testclient"` — use this for client_fingerprint in test fixtures
- Coverage minimum: 70% (`--cov-fail-under=70`)
- Run single file: `.venv/bin/pytest tests/test_requests.py -v`

### Frontend (vitest)
- Config: `dashboard/vitest.config.ts`
- Environment: jsdom
- Test files: `**/__tests__/**/*.test.{ts,tsx}` and `**/*.test.{ts,tsx}`
- API client tests: `dashboard/lib/__tests__/api.test.ts`
- Display page tests: `dashboard/app/e/[code]/display/page.test.tsx`
- When adding fields to shared types (like `PublicRequestInfo`), update test fixtures too

## Code Style

### Backend (Python)
- Formatter/linter: ruff (line-length=100)
- Rules: E (errors), F (pyflakes), I (isort), UP (upgrades)
- SQLAlchemy `== None` / `== True` comparisons allowed (E711, E712 ignored)
- Forward references allowed in models (F821 ignored)

### Frontend (TypeScript/React)
- No UI framework — vanilla CSS + inline React styles
- Dark theme: bg `#0a0a0a`, cards `#1a1a1a`, text `#ededed`
- Mobile-first: max-width containers, flexbox layouts
- No Tailwind — all styles in `dashboard/app/globals.css` or inline

## Architecture Patterns

### API Structure
- Authenticated endpoints: `server/app/api/events.py`, `requests.py`
- Public endpoints (no auth): `server/app/api/public.py`, `votes.py`, `bridge.py`
- Rate limiting via slowapi: `@limiter.limit("N/minute")`
- Client fingerprinting: IP-based via `X-Forwarded-For` header fallback to `request.client.host`

### Frontend API Client
- `dashboard/lib/api.ts` — singleton `ApiClient` class
- Authenticated calls: use `this.fetch()` (adds Bearer token)
- Public calls: use raw `fetch()` without auth headers
- Types mirror backend Pydantic schemas

### Request Status Flow
```
NEW → ACCEPTED → PLAYING → PLAYED
NEW → REJECTED
```

### Key Services
- `server/app/services/request.py` — CRUD, deduplication, bulk accept
- `server/app/services/vote.py` — idempotent voting with atomic increments
- `server/app/services/event.py` — event lifecycle, status computation
- `server/app/services/tidal.py` — Tidal playlist sync (background tasks)

### Bridge Plugin System
- Plugins self-describe via `info`, `capabilities`, and `configOptions`
- `PluginConfigOption` declares type (`number`/`string`/`boolean`), default, min/max, label
- Registry provides `getPluginMeta()`/`listPluginMeta()` for serializable metadata (safe for IPC)
- Bridge-app SettingsPanel is fully data-driven from plugin metadata — no hardcoded plugin UI
- Adding a plugin with `configOptions` auto-surfaces those settings in the UI
- See `docs/PLUGIN-ARCHITECTURE.md` for full details

### Bridge App Architecture
- Electron main process: auth, events API, bridge runner, persistent store (electron-store)
- Electron renderer: React UI with login, event selection, bridge controls, status panel
- IPC via contextBridge — renderer has no Node.js access
- Imports bridge code from `../bridge/src/` (DeckStateManager, types)
- Installers: `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux) via electron-forge

### Release System
- GitHub Actions release workflow: `.github/workflows/release.yml`
- Triggers on tag push (`v*`), not on PR merge
- Workflow: merge PRs freely, then `git tag v2026.02.07 && git push --tags`
- Dated versioning: `v2026.02.07`, suffix for same-day: `v2026.02.07.2`
- Builds bridge-app installers on 3 platforms (matrix)
- Linux format: AppImage (universal, no distro-specific packaging)
- Bundles deploy scripts as `.tar.gz`

## Pre-commit Hook
- Only runs on staged Python files in `server/`
- Checks: ruff lint, ruff format, bandit security
- Setup: `./scripts/setup-hooks.sh`

## Common Pitfalls
- `next-env.d.ts` gets auto-modified by builds — always `git checkout` before committing
- Frontend `next build` is needed for TypeScript validation (stricter than dev mode)
- The `request.client.host` in events.py submit_request differs from `X-Forwarded-For` logic in votes.py — known inconsistency behind proxies
- When adding fields to shared interfaces (e.g., `PublicRequestInfo`), grep for test fixtures that construct those types and add the field there too
