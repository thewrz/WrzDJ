# Claude Code Instructions for WrzDJ

## Project Overview

WrzDJ is a DJ song request management system with four services:
- **Backend**: Python FastAPI (`server/`) — SQLAlchemy 2.0, PostgreSQL, Alembic migrations
- **Frontend**: Next.js 16+ with React 18 (`dashboard/`) — TypeScript, vanilla CSS (dark theme)
- **Bridge**: Node.js DJ equipment integration (`bridge/`) — plugin system for Denon StageLinQ, Pioneer PRO DJ LINK, Serato DJ, Traktor Broadcast
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
- Node.js 22+

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
- Turnstile vars (for self-registration CAPTCHA): `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- Upload vars: `UPLOADS_DIR` (defaults to `server/uploads/` locally, `/app/uploads` in Docker)

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
npm test -- --run         # Vitest (28 tests)
```

### Bridge (from `bridge/`)
```bash
npx tsc --noEmit          # TypeScript type check
npm test -- --run         # Vitest (209 tests)
```

### Bridge App (from `bridge-app/`)
```bash
npx tsc --noEmit          # TypeScript type check
npm test -- --run         # Vitest (34 tests)
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
- Fixtures in `server/tests/conftest.py`: `db`, `client`, `test_user`, `auth_headers`, `admin_user`, `admin_headers`, `pending_user`, `pending_headers`, `test_event`, `test_request`
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

### Roles & Permissions
- User roles: `admin`, `dj`, `pending` — stored as `String(20)` column on User model
- `admin`: Full access including `/api/admin/*` endpoints and admin dashboard
- `dj`: Standard DJ access — create events, manage requests, search music
- `pending`: Can login and view `/me` only — blocked from all DJ features until approved
- Auth dependencies in `server/app/api/deps.py`:
  - `get_current_user` — any authenticated user (used for `/me`)
  - `get_current_active_user` — rejects `pending` users (used for all DJ endpoints)
  - `get_current_admin` — rejects non-admin users (used for `/api/admin/*`)
- Bootstrap user (from `BOOTSTRAP_ADMIN_USERNAME` env var) gets `role="admin"`
- Self-registered users get `role="pending"` until approved by admin

### Admin Dashboard
- Frontend pages under `dashboard/app/admin/` with sidebar layout
- Overview (`/admin`): Stats grid (users, events, requests, pending count)
- Users (`/admin/users`): CRUD with role filter tabs, approve/reject pending users
- Events (`/admin/events`): View/edit/delete any event regardless of owner
- Settings (`/admin/settings`): Toggle registration, adjust search rate limit
- Auth guard: non-admin users redirected to `/events`

### Self-Registration
- `POST /api/auth/register` — rate limited (3/min), creates `pending` user
- `GET /api/auth/settings` — public endpoint returning `registration_enabled` + `turnstile_site_key`
- Registration can be toggled on/off from admin Settings page (DB-backed, not env var)
- Cloudflare Turnstile CAPTCHA required (server-side verification via `server/app/services/turnstile.py`)
- Turnstile verification skipped in dev when no `TURNSTILE_SECRET_KEY` is configured
- Frontend: `dashboard/app/register/page.tsx` — form with Turnstile widget
- Login page conditionally shows "Create Account" link when registration is enabled

### System Settings
- DB-backed singleton in `system_settings` table (`server/app/models/system_settings.py`)
- `registration_enabled` (bool) — controls self-registration
- `search_rate_limit_per_minute` (int) — admin-configurable external API rate limit
- Service: `server/app/services/system_settings.py` — lazy-creates with defaults if missing

### API Structure
- Admin endpoints: `server/app/api/admin.py` — 10 endpoints under `/api/admin/`
- Authenticated endpoints: `server/app/api/events.py`, `requests.py`
- Public endpoints (no auth): `server/app/api/public.py`, `votes.py`, `bridge.py`, auth settings/register
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

### Banner / Image Upload
- DJs upload banner images per event via `POST /api/events/{code}/banner` (multipart)
- Backend (Pillow): validates format (JPEG/PNG/GIF/WebP), resizes to 1920x480, converts to WebP (quality 92)
- Two variants saved: original and desaturated kiosk version (40% saturation, 80% brightness)
- Dominant colors extracted via quantization (3 colors, darkened to 40% for theme-safe backgrounds)
- Files stored in `{UPLOADS_DIR}/banners/`, served via FastAPI `StaticFiles` at `/uploads`
- DB columns on `events`: `banner_filename` (String), `banner_colors` (JSON text)
- Kiosk display: desaturated banner rendered as **absolute-positioned background layer** behind the header (event name + QR), full-width, no border-radius, with gradient fade-out to `--kiosk-bg` color. Header/main/button sit on top via `z-index: 1`.
- Join page: original banner rendered as **absolute-positioned background** behind the header area, full-width, with `blur(2px) brightness(0.65)` and gradient fade to `#0a0a0a`
- Delete endpoint: `DELETE /api/events/{code}/banner` — cleans up both file variants
- Path traversal protection: resolved paths validated with `Path.is_relative_to()`
- Service: `server/app/services/banner.py`
- Migration: `server/alembic/versions/009_add_event_banner.py`

### Key Services
- `server/app/services/request.py` — CRUD, deduplication, bulk accept
- `server/app/services/vote.py` — idempotent voting with atomic increments
- `server/app/services/event.py` — event lifecycle, status computation
- `server/app/services/tidal.py` — Tidal playlist sync (background tasks)
- `server/app/services/admin.py` — user/event CRUD for admins, system stats, last-admin protection
- `server/app/services/system_settings.py` — DB-backed singleton settings
- `server/app/services/turnstile.py` — Cloudflare Turnstile CAPTCHA verification
- `server/app/services/banner.py` — banner image processing (resize, WebP, desaturate, color extraction)

### Bridge Plugin System
- Built-in plugins: StageLinQ (Denon), Pioneer PRO DJ LINK, Serato DJ, Traktor Broadcast
- Plugins self-describe via `info`, `capabilities`, and `configOptions`
- `PluginConfigOption` declares type (`number`/`string`/`boolean`), default, min/max, label
- Registry provides `getPluginMeta()`/`listPluginMeta()` for serializable metadata (safe for IPC)
- Bridge-app SettingsPanel is fully data-driven from plugin metadata — no hardcoded plugin UI
- Adding a plugin with `configOptions` auto-surfaces those settings in the UI
- Pioneer plugin uses `alphatheta-connect` npm library for PRO DJ LINK protocol (maintained fork of `prolink-connect` with encrypted Rekordbox DB support)
- Serato plugin watches binary session files (`Music/_Serato_/History/Sessions/`) — no npm deps, pure TS binary parsing + `fs` polling
- Serato capabilities: `multiDeck: true`, `albumMetadata: true`, `playState: false` (synthesized by PluginBridge)
- Serato parser: `serato-session-parser.ts` — OENT/ADAT chunk parsing, UTF-16 BE text decoding, OS-specific path detection
- Traktor plugin uses only Node.js built-ins (`http` module) — no npm deps, no externalization needed
- See `docs/PLUGIN-ARCHITECTURE.md` for full details

### Bridge App Architecture
- Electron main process: auth, events API, bridge runner, persistent store (electron-store)
- Electron renderer: React UI with login, event selection, bridge controls, status panel
- IPC via contextBridge — renderer has no Node.js access
- Imports bridge code from `../bridge/src/` (DeckStateManager, types)
- Installers: `.exe` (Windows), `.dmg` (macOS), `.AppImage` (Linux) via electron-forge

### Bridge App Externalization (Native Modules)
- Plugins with npm deps (stagelinq, alphatheta-connect) must be **externalized** from Vite
- Add to `externalDeps` in `bridge-app/vite.main.config.ts` AND `dependencies` in `bridge-app/package.json`
- `copyExternals` plugin copies externalized deps + transitive deps to `.vite/build/node_modules/`
- `AutoUnpackNativesPlugin` unpacks `.node` native files from asar to `app.asar.unpacked/`
- Native module compilation: `npm install --ignore-scripts` then `npx electron-rebuild`
- `alphatheta-connect` uses `better-sqlite3-multiple-ciphers` natively — no `overrides` needed
- Serato and Traktor plugins use only Node.js built-ins — no externalization needed

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
- Admin endpoints need `get_current_admin` dependency; DJ endpoints need `get_current_active_user` (not `get_current_user` which allows pending)
- `EmailStr` requires `pydantic[email]` (includes `email-validator`) — already in pyproject.toml
- Admin last-admin protection: verify `count_admins(db) > 1` before demoting/deleting/deactivating any admin
- Banner upload uses `File(...)` not `UploadFile(...)` for proper FastAPI file validation
- Banner colors stored as JSON string in DB — parse with `json.loads()` when reading, serialize with `json.dumps()` when writing
- Deploy: `api_uploads` Docker volume persists uploaded files across container restarts

## Upstream Dependency Health Checks

Bridge plugins depend on community-maintained open-source projects for protocol support. **Periodically check the health of these upstream dependencies** — if a library goes unmaintained, breaks, or changes its API, the corresponding plugin may need updates or a replacement library.

### Critical Plugin Dependencies (npm)

| Package | Plugin | GitHub | What to check |
|---------|--------|--------|---------------|
| `stagelinq` | StageLinQ (Denon) | [chrisle/StageLinq](https://github.com/chrisle/StageLinq) | New releases, open issues, protocol changes from Denon firmware updates |
| `alphatheta-connect` | Pioneer PRO DJ LINK | [chrisle/alphatheta-connect](https://github.com/chrisle/alphatheta-connect) | New releases, PRO DJ LINK protocol changes, Rekordbox DB encryption updates, `better-sqlite3-multiple-ciphers` compat |

### Reference Implementations (no runtime dependency, used for format research)

| Project | Plugin | GitHub | What to check |
|---------|--------|--------|---------------|
| `serato-tags` | Serato DJ | [Holzhaus/serato-tags](https://github.com/Holzhaus/serato-tags) | Session file format changes in new Serato versions |
| `SSL-API` | Serato DJ | [bkstein/SSL-API](https://github.com/bkstein/SSL-API) | ADAT field tag additions/changes |
| `whats-now-playing` | Serato DJ | [whatsnowplaying/whats-now-playing](https://github.com/whatsnowplaying/whats-now-playing) | Serato session parsing updates |
| `traktor_nowplaying` | Traktor Broadcast | [radusuciu/traktor_nowplaying](https://github.com/radusuciu/traktor_nowplaying) | ICY metadata format changes |

### Plugins with No External Dependencies

- **Traktor Broadcast** — pure Node.js `http` module (Icecast protocol is stable)
- **Serato DJ** — pure Node.js `fs` + binary parsing (session file format is reverse-engineered)

### When to Check

- Before major version bumps of bridge/bridge-app
- When a DJ reports equipment detection issues after updating their DJ software
- When `npm audit` or Dependabot flags vulnerabilities in `stagelinq` or `alphatheta-connect`
- Quarterly, as part of general maintenance — check for new releases, breaking changes, and community activity
