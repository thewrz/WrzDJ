# Design: Admin UI Fixes & Persistent API Logs

**Date:** 2026-05-12
**Status:** Approved

## Overview

Two independent improvements:

**A — Bot protection toggle language rewrite:** The existing admin settings checkbox for human verification contains inaccurate and jargon-heavy text. Cloudflare Turnstile always runs silently for all guests; the toggle only controls API enforcement. The current description implies the opposite.

**B — Persistent API logs:** Container restarts and deployments (`docker compose down` + `up`) destroy the Docker log buffer. Meaningful application events — human verification failures, enrichment errors, rate limit hits — are lost on every deploy. Bind-mounting a host directory gives logs a stable path that survives the container lifecycle.

---

## Part A: Bot Protection Toggle Language

### Scope

Single file: `dashboard/app/admin/settings/page.tsx`

### Changes

**Label** (line 99):
- Before: `"Enforce human verification on guest pages"`
- After: `"Enforce bot protection on guest pages"`

**Description** (line 101):
- Before: `"When ON, guests must complete a Cloudflare Turnstile check before submitting requests, voting, or searching. Default OFF (soft mode logs warnings only)."`
- After: `"Cloudflare Turnstile runs silently for all guests — most see no challenge. When ON, guests who fail the check are blocked from submitting requests, voting, or searching. When OFF, failures are only logged."`

### Why the current text is wrong

`useHumanVerification` renders a Turnstile widget with `appearance: 'interaction-only'` on mount for `/join` and `/collect`. Cloudflare's risk scoring runs automatically — no user action required for low-risk visitors. The toggle (`human_verification_enforced` in `system_settings`) only controls whether `require_verified_human_soft` in `deps.py` raises a 403 on missing/invalid `wrzdj_human` cookie. The challenge fires regardless of toggle state.

### Future: Error Dashboard

Bot protection failures (403s with `code: "human_verification_required"`) and soft-mode warning log events are candidates for surfacing in a future admin error dashboard. The DJ dashboard's existing infrastructure (activity feed, polling patterns) provides the model. **This is out of scope for this spec** — note it as a follow-up feature when the error dashboard is designed.

---

## Part B: Persistent API Logs

### Architecture

Dual-handler Python logging: one handler writes plain text to a rotating file on a host-mounted volume, the other writes JSON to stdout. No new services, no sidecar containers, no external log aggregation.

```
uvicorn process
  ├── root logger
  │     ├── RotatingFileHandler → /app/logs/app.log  (plain text, 10MB × 5)
  │     └── StreamHandler       → stdout              (JSON via python-json-logger)
  ├── uvicorn.access  (propagate=True, handlers cleared)
  └── uvicorn.error   (propagate=True, handlers cleared)
```

Both uvicorn access logs (HTTP request lines) and application logs (`logging.getLogger("app.*")`) flow through both handlers.

### Files Changed

#### `server/pyproject.toml`
Add `python-json-logger>=3.0` to `[project.dependencies]`.

#### `server/app/main.py`
Replace the current one-liner logging setup with a `configure_logging()` function called at module level:

```python
import logging
import logging.handlers
import os

def configure_logging() -> None:
    log_dir = os.environ.get("LOG_DIR", "/app/logs")
    os.makedirs(log_dir, exist_ok=True)

    file_handler = logging.handlers.RotatingFileHandler(
        os.path.join(log_dir, "app.log"),
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )

    from pythonjsonlogger.jsonlogger import JsonFormatter
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(
        JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(file_handler)
    root.addHandler(stream_handler)

configure_logging()
```

The existing `lifespan` context manager in `main.py` reconfigures uvicorn loggers at startup (after uvicorn installs its own handlers):

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # existing startup code ...
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
    yield
    # existing shutdown code ...
```

`LOG_DIR` defaults to `/app/logs` (production) and can be overridden for local dev (e.g., `LOG_DIR=/tmp/wrzdj-logs`).

#### `deploy/docker-compose.yml`
Add bind-mount to the `api` service `volumes` list:

```yaml
volumes:
  - api_uploads:/app/uploads
  - ./logs/api:/app/logs        # persistent log directory
```

The `read_only: true` container hardening is unaffected — Docker applies read-only to the overlay filesystem; explicitly mounted volumes remain writable.

#### `deploy/deploy.sh`
Add directory creation before `docker compose up`:

```bash
mkdir -p "$(dirname "$0")/logs/api"
```

Idempotent. Creates `deploy/logs/api/` on the host if absent. No permissions adjustment needed — Docker bind-mounts inherit host directory ownership.

### Log Location on VPS

```
~/WrzDJ/deploy/logs/api/
  app.log        ← current log (tail -f this)
  app.log.1      ← most recent rotation
  app.log.2
  ...
  app.log.5      ← oldest kept (50 MB total cap)
```

### Rotation Policy

| Setting | Value | Rationale |
|---------|-------|-----------|
| `maxBytes` | 10 MB | Small enough to open in any editor |
| `backupCount` | 5 | 50 MB total cap; ~weeks of typical traffic |
| Encoding | UTF-8 | Safe for international song titles in log messages |

### `docker logs` Compatibility

Stdout JSON output is unchanged — `docker compose logs api` continues to work normally. The file handler is additive.

### Local Dev

`LOG_DIR` not set in `.env` by default — `os.makedirs(..., exist_ok=True)` creates `/app/logs` inside the dev container if running locally, or the developer can `export LOG_DIR=/tmp/wrzdj-logs` to redirect to a local path.

No volume mount change needed for local dev — `docker-compose.yml` only applies in production deploys.

---

## Testing

### Part A
- Visual inspection: load `/admin/settings`, confirm new label and description text
- No logic changes — no unit tests required

### Part B
- Start API locally, confirm `app.log` is created in `LOG_DIR`
- Make one authenticated request, confirm access log line appears in file (plain text) and stdout (JSON)
- Trigger a soft-mode human verification miss, confirm warning appears in both outputs
- Verify rotation: set `maxBytes=1` in a test run, confirm `.log.1` is created after first write
- CI: existing test suite unchanged — logging config is additive

---

## Out of Scope

- Web container logs (Next.js stdout only; low signal; covered by `docker logs web` if needed)
- External log aggregation (Loki, CloudWatch) — overkill for single-VPS deployment
- Admin error dashboard for bot protection events — future feature, model after DJ dashboard activity infrastructure
- Log retention policy beyond rotation (no archival, no S3 offload)
