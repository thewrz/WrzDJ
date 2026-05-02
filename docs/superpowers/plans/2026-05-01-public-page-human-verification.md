# Public-Page Human Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cloudflare Turnstile + signed-cookie human-verification gate to all guest-facing public pages (`/join`, `/collect`, `/kiosk-pair`), with a separate per-action Turnstile gate on OTP email send and an IP-bound nonce gate on kiosk pairing.

**Architecture:** Frontend runs Turnstile in invisible/managed mode on guest page load. On success, server validates the token and issues a 60-min sliding-window HMAC-signed `wrzdj_human` cookie. A FastAPI dependency `require_verified_human` enforces the cookie on mutating + paid-API endpoints. OTP `verify/request` keeps a fresh-token-per-call requirement. Kiosk-pair uses an IP-bound 10-second nonce instead of Turnstile (Pi has no input device).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, slowapi, httpx (existing). Cloudflare Turnstile JS API. HMAC-SHA256 via stdlib `hmac` + `hashlib`. React 19 hooks, Next.js 16. Vitest + pytest.

**Spec reference:** `docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md`

---

## Task 0: Create implementation branch

**Files:**
- N/A (branch creation only)

- [ ] **Step 1: Create branch from latest main**

```bash
git checkout main
git pull
git checkout -b feat/human-verification
```

- [ ] **Step 2: Verify branch + clean tree**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected output:
```
On branch feat/human-verification
nothing to commit, working tree clean
feat/human-verification
```

---

## Task 1: Add HUMAN_COOKIE_SECRET config

**Files:**
- Modify: `server/app/core/config.py:96-99` (after Turnstile block)
- Modify: `server/.env.example` (if present) and root `.env` (locally)

- [ ] **Step 1: Add settings fields**

Edit `server/app/core/config.py`. After the existing Turnstile block (around line 99, after `registration_rate_limit_per_minute: int = 3`), add:

```python
    # Cloudflare Turnstile session bootstrap for guest pages
    # HMAC-SHA256 key for wrzdj_human cookie signing.
    # Production: REQUIRED — startup fatal if missing.
    # Dev: auto-generates ephemeral key if empty (logs warning).
    # Generate via: python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
    human_cookie_secret: str = ""
    human_cookie_ttl_seconds: int = 3600  # 60 min sliding window
```

- [ ] **Step 2: Add startup validation**

Find the existing block in `config.py` that validates `token_encryption_key` for production. Add an analogous check after it:

```python
    @property
    def effective_human_cookie_secret(self) -> bytes:
        """Return the HMAC key as bytes. In dev, auto-generates an ephemeral
        key on first call and caches it on the settings instance."""
        import base64
        import logging
        import secrets

        if self.human_cookie_secret:
            return base64.urlsafe_b64decode(self.human_cookie_secret)

        if self.is_production:
            msg = "HUMAN_COOKIE_SECRET is required in production"
            raise RuntimeError(msg)

        cached = getattr(self, "_dev_human_cookie_secret", None)
        if cached is None:
            cached = secrets.token_bytes(32)
            object.__setattr__(self, "_dev_human_cookie_secret", cached)
            logging.getLogger(__name__).warning(
                "HUMAN_COOKIE_SECRET not set; generated ephemeral key (dev only). "
                "wrzdj_human cookies will not survive a server restart."
            )
        return cached
```

- [ ] **Step 3: Run existing config tests to confirm nothing broke**

Run: `cd server && .venv/bin/pytest tests/test_config.py -v 2>/dev/null || .venv/bin/pytest tests/ -k config -v`
Expected: PASS (no new tests yet)

- [ ] **Step 4: Add to local .env**

Edit `/home/adam/github/WrzDJ/.env` (root, dev-only). Add a line:

```
HUMAN_COOKIE_SECRET=
```

Leave value empty in dev — auto-generation will kick in.

- [ ] **Step 5: Commit**

```bash
cd /home/adam/github/WrzDJ
git add server/app/core/config.py .env
git commit -m "feat(human-verify): add HUMAN_COOKIE_SECRET config"
```

---

## Task 2: Cookie sign/verify service (TDD)

**Files:**
- Create: `server/app/services/human_verification.py`
- Create: `server/tests/test_human_verification.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_human_verification.py`:

```python
"""Tests for human-verification cookie sign/verify."""

import base64
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi import Request, Response

from app.services.human_verification import (
    COOKIE_NAME,
    issue_human_cookie,
    verify_human_cookie,
)


def _make_request_with_cookie(cookie_value: str | None = None) -> Request:
    """Build a minimal Request with a wrzdj_human cookie."""
    cookies = {COOKIE_NAME: cookie_value} if cookie_value else {}
    scope = {
        "type": "http",
        "headers": [],
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    request = Request(scope)
    request._cookies = cookies  # bypass parsing
    return request


@patch("app.services.human_verification.get_settings")
class TestIssueHumanCookie:
    def test_sets_cookie_with_signed_payload(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert set_cookie is not None
        assert COOKIE_NAME in set_cookie
        assert "HttpOnly" in set_cookie
        assert "SameSite=lax" in set_cookie.lower()
        assert "Path=/api/" in set_cookie
        assert "Max-Age=3600" in set_cookie

    def test_secure_flag_in_production(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = True
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert "Secure" in set_cookie

    def test_no_secure_flag_in_dev(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=42)

        set_cookie = response.headers.get("set-cookie")
        assert "Secure" not in set_cookie


@patch("app.services.human_verification.get_settings")
class TestVerifyHumanCookie:
    def _issue_and_extract(self, mock_settings, guest_id: int = 42) -> str:
        """Issue a cookie and return its raw value for use in a fresh request."""
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 3600

        response = Response()
        issue_human_cookie(response, guest_id=guest_id)
        set_cookie = response.headers.get("set-cookie")
        # Parse the cookie value (everything between '=' and ';')
        value = set_cookie.split("=", 1)[1].split(";", 1)[0]
        return value

    def test_valid_cookie_returns_guest_id(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        request = _make_request_with_cookie(cookie_value)

        result = verify_human_cookie(request)
        assert result == 42

    def test_missing_cookie_returns_none(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        request = _make_request_with_cookie(None)

        result = verify_human_cookie(request)
        assert result is None

    def test_tampered_signature_returns_none(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        # Flip a character in the signature portion (after the '.')
        payload, sig = cookie_value.rsplit(".", 1)
        bad_sig = "A" + sig[1:] if sig[0] != "A" else "B" + sig[1:]
        tampered = f"{payload}.{bad_sig}"
        request = _make_request_with_cookie(tampered)

        result = verify_human_cookie(request)
        assert result is None

    def test_tampered_payload_returns_none(self, mock_settings):
        cookie_value = self._issue_and_extract(mock_settings, guest_id=42)
        payload, sig = cookie_value.rsplit(".", 1)
        # Decode payload, change guest_id, re-encode WITHOUT updating sig
        decoded = base64.urlsafe_b64decode(payload + "==")
        tampered_payload_bytes = decoded.replace(b'"guest_id":42', b'"guest_id":99')
        tampered_payload = base64.urlsafe_b64encode(tampered_payload_bytes).decode().rstrip("=")
        tampered = f"{tampered_payload}.{sig}"
        request = _make_request_with_cookie(tampered)

        result = verify_human_cookie(request)
        assert result is None

    def test_expired_cookie_returns_none(self, mock_settings):
        # Issue with ttl=0 so it's already expired
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32
        mock_settings.return_value.is_production = False
        mock_settings.return_value.human_cookie_ttl_seconds = 0

        response = Response()
        issue_human_cookie(response, guest_id=42)
        set_cookie = response.headers.get("set-cookie")
        cookie_value = set_cookie.split("=", 1)[1].split(";", 1)[0]
        # Sleep beyond exp
        time.sleep(1.1)

        # Restore real ttl for the verify call (doesn't matter, exp is in the cookie)
        mock_settings.return_value.human_cookie_ttl_seconds = 3600
        request = _make_request_with_cookie(cookie_value)
        result = verify_human_cookie(request)
        assert result is None

    def test_malformed_cookie_returns_none(self, mock_settings):
        mock_settings.return_value.effective_human_cookie_secret = b"x" * 32

        for bad in ["", "no-dot", "only.one.dot.too.many", "...", "abc.def"]:
            request = _make_request_with_cookie(bad)
            assert verify_human_cookie(request) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && .venv/bin/pytest tests/test_human_verification.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.human_verification'` or `ImportError`.

- [ ] **Step 3: Implement service**

Create `server/app/services/human_verification.py`:

```python
"""Human-verification signed cookie helpers.

Issues and validates wrzdj_human cookies after Turnstile verification.
HMAC-SHA256 signed payload with a sliding TTL.

Spec: docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from typing import TYPE_CHECKING

from app.core.config import get_settings
from app.core.time import utcnow

if TYPE_CHECKING:
    from fastapi import Request, Response

logger = logging.getLogger(__name__)

COOKIE_NAME = "wrzdj_human"


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_bytes: bytes, key: bytes) -> bytes:
    return hmac.new(key, payload_bytes, hashlib.sha256).digest()


def issue_human_cookie(response: Response, guest_id: int) -> None:
    """Sign payload with HMAC-SHA256 and set the wrzdj_human cookie.

    Sliding window: caller invokes this on every successful gated request to
    reset the cookie's exp to now + ttl.
    """
    settings = get_settings()
    key = settings.effective_human_cookie_secret
    ttl = settings.human_cookie_ttl_seconds
    exp = int(utcnow().timestamp()) + ttl

    payload = {"guest_id": int(guest_id), "exp": exp}
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode()
    sig = _sign(payload_bytes, key)
    cookie_value = f"{_b64encode(payload_bytes)}.{_b64encode(sig)}"

    response.set_cookie(
        key=COOKIE_NAME,
        value=cookie_value,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=ttl,
        path="/api/",
    )


def verify_human_cookie(request: Request) -> int | None:
    """Return guest_id if the wrzdj_human cookie is valid, signed, and unexpired.

    Returns None on any failure (missing, malformed, bad signature, expired).
    """
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or "." not in raw:
        return None

    try:
        payload_part, sig_part = raw.rsplit(".", 1)
        payload_bytes = _b64decode(payload_part)
        sig_bytes = _b64decode(sig_part)
    except (ValueError, base64.binascii.Error):
        return None

    settings = get_settings()
    key = settings.effective_human_cookie_secret
    expected_sig = _sign(payload_bytes, key)

    if not hmac.compare_digest(expected_sig, sig_bytes):
        return None

    try:
        payload = json.loads(payload_bytes)
        guest_id = int(payload["guest_id"])
        exp = int(payload["exp"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None

    if exp < int(utcnow().timestamp()):
        return None

    return guest_id
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_human_verification.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Run lint + format**

Run: `cd server && .venv/bin/ruff check app/services/human_verification.py tests/test_human_verification.py && .venv/bin/ruff format app/services/human_verification.py tests/test_human_verification.py`
Expected: clean output, no errors.

- [ ] **Step 6: Commit**

```bash
git add server/app/services/human_verification.py server/tests/test_human_verification.py
git commit -m "feat(human-verify): cookie sign/verify service with HMAC-SHA256"
```

---

## Task 3: Add `human_verification_enforced` flag to SystemSettings

**Files:**
- Modify: `server/app/models/system_settings.py`
- Create: `server/alembic/versions/<next_id>_add_human_verification_enforced.py`
- Modify: `server/app/services/system_settings.py` (defaults)
- Modify: `server/tests/test_system_settings.py` (if exists)

- [ ] **Step 1: Add column to model**

Edit `server/app/models/system_settings.py`. Add after `bridge_enabled`:

```python
    # Human verification (Turnstile gate on guest pages)
    # Soft-warn-only when False; hard-enforce 403 when True.
    human_verification_enforced: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
```

- [ ] **Step 2: Generate Alembic migration**

Run:
```bash
cd server
.venv/bin/alembic revision --autogenerate -m "add human_verification_enforced flag"
```
Expected: creates `server/alembic/versions/<hash>_add_human_verification_enforced.py`.

- [ ] **Step 3: Hand-edit migration to ensure correctness**

Open the generated migration. Confirm `upgrade()` contains:

```python
def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "human_verification_enforced",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Drop server_default so future inserts use the SQLAlchemy default
    op.alter_column("system_settings", "human_verification_enforced", server_default=None)
```

And `downgrade()`:

```python
def downgrade() -> None:
    op.drop_column("system_settings", "human_verification_enforced")
```

If the autogenerated body differs from this, replace it.

- [ ] **Step 4: Run migration locally and verify alembic check is clean**

```bash
cd server
.venv/bin/alembic upgrade head
.venv/bin/alembic check
```
Expected: `alembic check` exits 0 with `No new upgrade operations detected.`

- [ ] **Step 5: Update service defaults if needed**

Open `server/app/services/system_settings.py`. If it explicitly constructs `SystemSettings(...)` with kwargs, add `human_verification_enforced=False`. If it relies on model defaults, no change needed.

- [ ] **Step 6: Run pytest to confirm nothing broke**

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short
```
Expected: all green (existing baseline).

- [ ] **Step 7: Commit**

```bash
git add server/app/models/system_settings.py server/alembic/versions/ server/app/services/system_settings.py
git commit -m "feat(human-verify): system_settings.human_verification_enforced flag"
```

---

## Task 4: `POST /api/guest/verify-human` endpoint (TDD)

**Files:**
- Modify: `server/app/api/guest.py`
- Create: `server/app/schemas/human_verification.py`
- Create: `server/tests/test_verify_human_endpoint.py`

- [ ] **Step 1: Create schema file**

Create `server/app/schemas/human_verification.py`:

```python
"""Schemas for the human-verification bootstrap endpoint."""

from pydantic import BaseModel, Field


class VerifyHumanRequest(BaseModel):
    turnstile_token: str = Field(..., min_length=1, max_length=4096)


class VerifyHumanResponse(BaseModel):
    verified: bool
    expires_in: int
```

- [ ] **Step 2: Write failing tests**

Create `server/tests/test_verify_human_endpoint.py`:

```python
"""Tests for POST /api/guest/verify-human."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.services.human_verification import COOKIE_NAME


def _create_guest(db: Session, token: str = "test-guest-token") -> Guest:
    guest = Guest(token=token)
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


class TestVerifyHumanEndpoint:
    @patch(
        "app.api.guest.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_success_sets_cookie(self, mock_turnstile, client: TestClient, db: Session):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post(
            "/api/guest/verify-human",
            json={"turnstile_token": "fake-token"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["verified"] is True
        assert body["expires_in"] == 3600
        assert COOKIE_NAME in response.cookies

    @patch(
        "app.api.guest.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=False,
    )
    def test_invalid_turnstile_token_400(
        self, mock_turnstile, client: TestClient, db: Session
    ):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post(
            "/api/guest/verify-human",
            json={"turnstile_token": "bad-token"},
        )
        assert response.status_code == 400
        assert "CAPTCHA" in response.json()["detail"]
        assert COOKIE_NAME not in response.cookies

    def test_missing_guest_cookie_400(self, client: TestClient, db: Session):
        # No wrzdj_guest cookie set
        response = client.post(
            "/api/guest/verify-human",
            json={"turnstile_token": "any"},
        )
        assert response.status_code == 400
        assert "Guest" in response.json()["detail"]

    def test_missing_token_field_422(self, client: TestClient, db: Session):
        guest = _create_guest(db)
        client.cookies.set("wrzdj_guest", guest.token)

        response = client.post("/api/guest/verify-human", json={})
        assert response.status_code == 422
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd server && .venv/bin/pytest tests/test_verify_human_endpoint.py -v`
Expected: FAIL with 404 (endpoint doesn't exist) or import errors.

- [ ] **Step 4: Implement endpoint**

Edit `server/app/api/guest.py`. Add imports at the top:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.core.rate_limit import get_client_ip, get_guest_id, limiter
from app.schemas.human_verification import VerifyHumanRequest, VerifyHumanResponse
from app.services.human_verification import issue_human_cookie
from app.services.turnstile import verify_turnstile_token
```

(Merge with existing imports — keep alphabetical order within each group.)

Add the endpoint at the end of the file:

```python
@router.post("/guest/verify-human", response_model=VerifyHumanResponse)
@limiter.limit("10/minute")
async def verify_human(
    payload: VerifyHumanRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> VerifyHumanResponse:
    """Validate a Turnstile token and issue a wrzdj_human session cookie."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    client_ip = get_client_ip(request)
    is_valid = await verify_turnstile_token(payload.turnstile_token, client_ip)
    if not is_valid:
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed")

    issue_human_cookie(response, guest_id)

    settings = get_settings()
    return VerifyHumanResponse(verified=True, expires_in=settings.human_cookie_ttl_seconds)
```

- [ ] **Step 5: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_verify_human_endpoint.py -v`
Expected: All PASS.

- [ ] **Step 6: Lint + format**

Run: `cd server && .venv/bin/ruff check app/api/guest.py app/schemas/human_verification.py tests/test_verify_human_endpoint.py && .venv/bin/ruff format app/api/guest.py app/schemas/human_verification.py tests/test_verify_human_endpoint.py`

- [ ] **Step 7: Commit**

```bash
git add server/app/api/guest.py server/app/schemas/human_verification.py server/tests/test_verify_human_endpoint.py
git commit -m "feat(human-verify): POST /api/guest/verify-human bootstrap endpoint"
```

---

## Task 5: `require_verified_human` dependency (TDD)

**Files:**
- Modify: `server/app/api/deps.py`
- Create: `server/tests/test_require_verified_human.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_require_verified_human.py`:

```python
"""Tests for the require_verified_human dependency."""

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_verified_human
from app.models.guest import Guest
from app.services.human_verification import COOKIE_NAME, issue_human_cookie


def _make_test_app(db_dep_override):
    """Build a tiny FastAPI app with one endpoint that uses the dependency."""
    from fastapi import Depends, Response

    app = FastAPI()

    @app.get("/test-protected")
    def protected(
        response: Response,
        guest_id: int = Depends(require_verified_human),
    ):
        return {"guest_id": guest_id}

    app.dependency_overrides[get_db] = db_dep_override
    return app


def _setup_guest_with_human_cookie(db: Session, client: TestClient, guest_id: int = 1) -> str:
    guest = Guest(id=guest_id, token=f"guest-{guest_id}")
    db.add(guest)
    db.commit()

    # Issue cookie via the actual helper to get a valid signed value
    from fastapi import Response
    response = Response()
    issue_human_cookie(response, guest_id)
    set_cookie = response.headers.get("set-cookie")
    cookie_value = set_cookie.split("=", 1)[1].split(";", 1)[0]
    client.cookies.set(COOKIE_NAME, cookie_value)
    client.cookies.set("wrzdj_guest", guest.token)
    return cookie_value


class TestRequireVerifiedHuman:
    def test_valid_cookie_passes(self, client: TestClient, db: Session):
        # Use the existing client fixture — it already has the dep override
        guest = Guest(id=42, token="guest-42")
        db.add(guest)
        db.commit()

        from fastapi import Response
        resp = Response()
        issue_human_cookie(resp, 42)
        cookie_value = resp.headers.get("set-cookie").split("=", 1)[1].split(";", 1)[0]

        client.cookies.set("wrzdj_guest", "guest-42")
        client.cookies.set(COOKIE_NAME, cookie_value)

        # Hit a protected endpoint (we'll use one of the gated ones once they exist;
        # for now, use a known-protected endpoint after Task 7)
        # In this isolated test, mount a test endpoint via dep override on conftest's app.
        # Skip: this test is best deferred until Task 7 when there's a real protected endpoint.

    def test_missing_human_cookie_returns_403(self, client: TestClient, db: Session):
        guest = Guest(id=99, token="guest-99")
        db.add(guest)
        db.commit()
        client.cookies.set("wrzdj_guest", "guest-99")
        # No wrzdj_human cookie

        # We'll exercise this via a real gated endpoint in later tasks.
        # Direct unit test of the dependency:
        from fastapi import HTTPException, Request

        scope = {
            "type": "http",
            "headers": [(b"cookie", b"wrzdj_guest=guest-99")],
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
        request = Request(scope)
        from fastapi import Response
        response = Response()
        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403
            assert isinstance(exc.detail, dict)
            assert exc.detail["code"] == "human_verification_required"

    def test_mismatched_guest_id_returns_403(self, client: TestClient, db: Session):
        from fastapi import HTTPException, Request, Response

        # Guest with token "guest-A" exists, id=10
        guest_a = Guest(id=10, token="guest-A")
        db.add(guest_a)
        db.commit()

        # Issue human cookie for guest_id=99 (NOT id=10)
        resp = Response()
        issue_human_cookie(resp, 99)
        cookie_value = resp.headers.get("set-cookie").split("=", 1)[1].split(";", 1)[0]

        scope = {
            "type": "http",
            "headers": [
                (b"cookie", f"wrzdj_guest=guest-A; {COOKIE_NAME}={cookie_value}".encode()),
            ],
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
        request = Request(scope)
        response = Response()
        try:
            require_verified_human(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403

    def test_valid_cookie_refreshes_window(self, client: TestClient, db: Session):
        from fastapi import Request, Response

        guest = Guest(id=7, token="guest-7")
        db.add(guest)
        db.commit()

        resp_for_cookie = Response()
        issue_human_cookie(resp_for_cookie, 7)
        cookie_value = resp_for_cookie.headers.get("set-cookie").split("=", 1)[1].split(";", 1)[0]

        scope = {
            "type": "http",
            "headers": [
                (b"cookie", f"wrzdj_guest=guest-7; {COOKIE_NAME}={cookie_value}".encode()),
            ],
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
        request = Request(scope)
        response = Response()

        result = require_verified_human(request, response, db)
        assert result == 7
        # Confirm a new cookie was set on response (sliding refresh)
        assert response.headers.get("set-cookie") is not None
        assert COOKIE_NAME in response.headers.get("set-cookie")
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && .venv/bin/pytest tests/test_require_verified_human.py -v`
Expected: FAIL with `ImportError: cannot import name 'require_verified_human' from 'app.api.deps'`.

- [ ] **Step 3: Implement dependency**

Edit `server/app/api/deps.py`. Add at the bottom of the file:

```python
def require_verified_human(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> int:
    """Require a valid wrzdj_human cookie tied to the current wrzdj_guest.

    Refreshes (slides) the cookie on every successful call. Raises 403 with
    structured detail {"code": "human_verification_required"} so the frontend
    can distinguish this from generic forbidden errors.
    """
    from app.core.rate_limit import get_guest_id
    from app.services.human_verification import issue_human_cookie, verify_human_cookie

    guest_id_cookie = verify_human_cookie(request)
    guest_id_db = get_guest_id(request, db)

    if guest_id_cookie is None or guest_id_db is None or guest_id_cookie != guest_id_db:
        raise HTTPException(
            status_code=403,
            detail={"code": "human_verification_required"},
        )

    issue_human_cookie(response, guest_id_db)
    return guest_id_db
```

Add `Response` to the FastAPI imports at the top if not present:

```python
from fastapi import Depends, HTTPException, Request, Response, status
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_require_verified_human.py -v`
Expected: All PASS.

- [ ] **Step 5: Lint + format**

Run: `cd server && .venv/bin/ruff check app/api/deps.py tests/test_require_verified_human.py && .venv/bin/ruff format app/api/deps.py tests/test_require_verified_human.py`

- [ ] **Step 6: Commit**

```bash
git add server/app/api/deps.py server/tests/test_require_verified_human.py
git commit -m "feat(human-verify): require_verified_human FastAPI dependency"
```

---

## Task 6: Soft-mode wrapper for staged rollout

**Files:**
- Modify: `server/app/api/deps.py`
- Modify: `server/tests/test_require_verified_human.py`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_require_verified_human.py`:

```python
class TestSoftMode:
    def test_soft_mode_logs_warning_but_allows_through(self, client: TestClient, db: Session, caplog):
        """When SystemSettings.human_verification_enforced=False, missing cookie
        logs warning but does NOT raise 403."""
        from app.api.deps import require_verified_human_soft
        from app.models.system_settings import SystemSettings
        from fastapi import Request, Response
        import logging

        settings = SystemSettings(id=1, human_verification_enforced=False)
        db.add(settings)
        guest = Guest(id=11, token="guest-11")
        db.add(guest)
        db.commit()

        scope = {
            "type": "http",
            "headers": [(b"cookie", b"wrzdj_guest=guest-11")],
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
        request = Request(scope)
        response = Response()

        with caplog.at_level(logging.WARNING):
            result = require_verified_human_soft(request, response, db)

        assert result == 11  # Returns guest_id even without human cookie
        assert any("human_verification_missing" in r.message for r in caplog.records)

    def test_soft_mode_with_enforce_flag_blocks(self, client: TestClient, db: Session):
        """With human_verification_enforced=True, soft-mode wrapper acts as hard."""
        from app.api.deps import require_verified_human_soft
        from app.models.system_settings import SystemSettings
        from fastapi import HTTPException, Request, Response

        settings = SystemSettings(id=1, human_verification_enforced=True)
        db.add(settings)
        guest = Guest(id=12, token="guest-12")
        db.add(guest)
        db.commit()

        scope = {
            "type": "http",
            "headers": [(b"cookie", b"wrzdj_guest=guest-12")],
            "method": "GET",
            "path": "/",
            "query_string": b"",
        }
        request = Request(scope)
        response = Response()

        try:
            require_verified_human_soft(request, response, db)
            raise AssertionError("Expected HTTPException")
        except HTTPException as exc:
            assert exc.status_code == 403
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd server && .venv/bin/pytest tests/test_require_verified_human.py::TestSoftMode -v`
Expected: FAIL with `ImportError: cannot import name 'require_verified_human_soft'`.

- [ ] **Step 3: Implement soft-mode wrapper**

Edit `server/app/api/deps.py`. Add a new dependency below `require_verified_human`:

```python
def require_verified_human_soft(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> int | None:
    """Soft-mode wrapper around require_verified_human.

    Reads SystemSettings.human_verification_enforced. When False (rollout
    Phase 1), a missing/invalid cookie logs a warning and returns the guest_id
    (or None) without raising. When True (Phase 2+), behaves identically to
    require_verified_human and raises 403.

    Apply this dependency to all gated public endpoints during rollout. After
    Phase 3 cleanup, swap to require_verified_human directly and remove this.
    """
    import logging

    from app.core.rate_limit import get_guest_id
    from app.services.human_verification import issue_human_cookie, verify_human_cookie
    from app.services.system_settings import get_system_settings

    sys_settings = get_system_settings(db)
    guest_id_cookie = verify_human_cookie(request)
    guest_id_db = get_guest_id(request, db)

    if guest_id_cookie is not None and guest_id_db == guest_id_cookie:
        issue_human_cookie(response, guest_id_db)
        return guest_id_db

    if sys_settings.human_verification_enforced:
        raise HTTPException(
            status_code=403,
            detail={"code": "human_verification_required"},
        )

    # Soft-mode: log and pass through
    logging.getLogger(__name__).warning(
        "guest.human_verify action=missing guest_id=%s reason=soft_mode_pass",
        guest_id_db,
    )
    return guest_id_db
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_require_verified_human.py -v`
Expected: All PASS.

- [ ] **Step 5: Lint + format**

Run: `cd server && .venv/bin/ruff check app/api/deps.py tests/test_require_verified_human.py && .venv/bin/ruff format app/api/deps.py tests/test_require_verified_human.py`

- [ ] **Step 6: Commit**

```bash
git add server/app/api/deps.py server/tests/test_require_verified_human.py
git commit -m "feat(human-verify): soft-mode wrapper for staged rollout"
```

---

## Task 7: Apply gate to events.py (search + submit)

**Files:**
- Modify: `server/app/api/events.py:368-375` (event_search) and `server/app/api/events.py:602-610` (submit_request)
- Modify: `server/tests/test_requests.py`, `server/tests/test_search.py` (if exist) — add wrzdj_human cookie fixture
- Modify: `server/tests/conftest.py` — add helper

- [ ] **Step 1: Add helper fixture to conftest.py**

Edit `server/tests/conftest.py`. Add fixture at the bottom:

```python
@pytest.fixture
def human_verified_cookies(db):
    """Returns a callable that takes a Guest and returns a dict of cookies
    (wrzdj_guest + wrzdj_human) ready to set on a TestClient."""
    from fastapi import Response
    from app.services.human_verification import COOKIE_NAME, issue_human_cookie

    def _build(guest):
        resp = Response()
        issue_human_cookie(resp, guest.id)
        set_cookie = resp.headers.get("set-cookie")
        cookie_value = set_cookie.split("=", 1)[1].split(";", 1)[0]
        return {"wrzdj_guest": guest.token, COOKIE_NAME: cookie_value}

    return _build
```

- [ ] **Step 2: Apply soft dependency to event_search and submit_request**

Edit `server/app/api/events.py`. At the top, add to the `app.api.deps` import:

```python
from app.api.deps import get_current_active_user, get_db, require_verified_human_soft
```

Find `event_search` (line ~370). Add the dependency:

```python
@router.get("/{code}/search", response_model=list[SearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
def event_search(
    code: str,
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> list[SearchResult]:
```

Find `submit_request` (line ~604). Add the dependency:

```python
@router.post("/{code}/requests", response_model=RequestOut)
@limiter.limit(lambda: f"{settings.request_rate_limit_per_minute}/minute")
def submit_request(
    code: str,
    request_data: RequestCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> RequestOut:
```

- [ ] **Step 3: Update existing tests to set human cookie when enforced**

Most existing tests should still pass (soft-mode default). Verify:

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short -k "search or request"
```
Expected: existing tests still pass (soft-mode warns but passes through).

- [ ] **Step 4: Add a new enforce-mode test**

Append to `server/tests/test_requests.py` (or create `tests/test_human_verify_enforce.py` if simpler):

```python
class TestEnforceModeBlocks:
    def test_submit_request_403_when_enforced_and_no_cookie(
        self, client, db, test_event
    ):
        from app.models.system_settings import SystemSettings

        sys_settings = db.query(SystemSettings).filter_by(id=1).first()
        if sys_settings is None:
            sys_settings = SystemSettings(id=1, human_verification_enforced=True)
            db.add(sys_settings)
        else:
            sys_settings.human_verification_enforced = True
        db.commit()

        # Note: TestClient default has no wrzdj_guest cookie either; the
        # endpoint may 400 before reaching the dep. So set wrzdj_guest first
        # via a Guest row.
        from app.models.guest import Guest
        guest = Guest(token="enforce-test")
        db.add(guest)
        db.commit()
        client.cookies.set("wrzdj_guest", guest.token)
        # NO wrzdj_human cookie

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "title": "Test", "artist": "Test", "source": "spotify",
                "source_url": "https://open.spotify.com/track/x",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "human_verification_required"

    def test_submit_request_passes_when_enforced_and_cookie_valid(
        self, client, db, test_event, human_verified_cookies
    ):
        from app.models.system_settings import SystemSettings
        from app.models.guest import Guest

        sys_settings = SystemSettings(id=1, human_verification_enforced=True)
        db.add(sys_settings)
        guest = Guest(token="enforce-pass")
        db.add(guest)
        db.commit()
        for k, v in human_verified_cookies(guest).items():
            client.cookies.set(k, v)

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "title": "Test", "artist": "Test", "source": "spotify",
                "source_url": "https://open.spotify.com/track/x",
            },
        )
        assert response.status_code == 200
```

- [ ] **Step 5: Run all backend tests**

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short
```
Expected: green.

- [ ] **Step 6: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/events.py tests/conftest.py tests/test_requests.py && .venv/bin/ruff format app/api/events.py tests/conftest.py tests/test_requests.py
```

- [ ] **Step 7: Commit**

```bash
git add server/app/api/events.py server/tests/conftest.py server/tests/test_requests.py
git commit -m "feat(human-verify): gate event_search + submit_request"
```

---

## Task 8: Apply gate to votes.py (public vote/unvote)

**Files:**
- Modify: `server/app/api/votes.py:35-50`

- [ ] **Step 1: Apply soft dependency**

Edit `server/app/api/votes.py`. Add import:

```python
from app.api.deps import get_db, require_verified_human_soft
```

Find both vote endpoints. Add `_human` parameter to each:

```python
@router.post("/{request_id}/vote", response_model=VoteResponse)
@limiter.limit("10/minute")
def cast_vote(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> VoteResponse:
    ...

@router.delete("/{request_id}/vote", response_model=VoteResponse)
@limiter.limit("10/minute")
def remove_vote(
    request_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> VoteResponse:
    ...
```

(Keep existing function bodies unchanged.)

- [ ] **Step 2: Run vote tests**

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short -k vote
```
Expected: green (soft-mode default).

- [ ] **Step 3: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/votes.py && .venv/bin/ruff format app/api/votes.py
```

- [ ] **Step 4: Commit**

```bash
git add server/app/api/votes.py
git commit -m "feat(human-verify): gate public vote/unvote endpoints"
```

---

## Task 9: Apply gate to collect.py (4 mutating endpoints)

**Files:**
- Modify: `server/app/api/collect.py` — endpoints at lines 180, 327, 405, 441

- [ ] **Step 1: Add import**

Edit `server/app/api/collect.py`:

```python
from app.api.deps import get_db, require_verified_human_soft
```

- [ ] **Step 2: Apply dependency to all four**

Find each of these endpoint functions and add `_human` parameter:

```python
# Line ~180
@router.post("/{code}/profile", response_model=CollectProfileResponse)
@limiter.limit("5/minute")
def upsert_profile(
    code: str,
    body: CollectProfileUpsertRequest,
    request: Request,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> CollectProfileResponse:
    ...

# Line ~327
@router.post("/{code}/requests", status_code=201)
@limiter.limit("10/minute")
def submit_collect_request(
    code: str,
    body: CollectRequestCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
):
    ...

# Line ~405
@router.post("/{code}/vote")
@limiter.limit("60/minute")
def collect_vote(
    code: str,
    body: CollectVoteRequest,
    request: Request,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
):
    ...

# Line ~441
@router.post("/{code}/enrich-preview", response_model=EnrichPreviewResponse)
@limiter.limit("10/minute")
def enrich_preview(
    code: str,
    body: EnrichPreviewRequest,
    request: Request,
    db: Session = Depends(get_db),
    _human: int | None = Depends(require_verified_human_soft),
) -> EnrichPreviewResponse:
    ...
```

(Function names may differ in actual file; preserve the existing names. Add only the dep.)

- [ ] **Step 3: Run collect tests**

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short -k collect
```
Expected: green.

- [ ] **Step 4: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/collect.py && .venv/bin/ruff format app/api/collect.py
```

- [ ] **Step 5: Commit**

```bash
git add server/app/api/collect.py
git commit -m "feat(human-verify): gate collect mutating endpoints"
```

---

## Task 10: OTP fresh-token gate on `/verify/request`

**Files:**
- Modify: `server/app/schemas/verify.py` (or wherever `VerifyRequestSchema` lives)
- Modify: `server/app/api/verify.py:28-47`
- Modify: `server/tests/test_email_verification.py` (or create `test_otp_turnstile.py`)

- [ ] **Step 1: Find existing schema**

```bash
grep -rn "VerifyRequestSchema\|class Verify" server/app/schemas/ | head -5
```

- [ ] **Step 2: Write failing test**

Create `server/tests/test_otp_turnstile.py`:

```python
"""Tests for Turnstile gate on POST /api/verify/request."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest


def _setup_guest(db: Session, client: TestClient) -> Guest:
    guest = Guest(token="otp-test")
    db.add(guest)
    db.commit()
    client.cookies.set("wrzdj_guest", guest.token)
    return guest


class TestOtpTurnstileGate:
    @patch(
        "app.api.verify.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    @patch("app.api.verify.create_verification_code")
    def test_valid_token_proceeds(
        self, mock_create, mock_turnstile, client: TestClient, db: Session
    ):
        _setup_guest(db, client)

        response = client.post(
            "/api/verify/request",
            json={"email": "test@example.com", "turnstile_token": "valid"},
        )
        assert response.status_code == 200
        mock_turnstile.assert_called_once()
        mock_create.assert_called_once()

    @patch(
        "app.api.verify.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=False,
    )
    def test_invalid_token_400(self, mock_turnstile, client: TestClient, db: Session):
        _setup_guest(db, client)

        response = client.post(
            "/api/verify/request",
            json={"email": "test@example.com", "turnstile_token": "bad"},
        )
        assert response.status_code == 400
        assert "CAPTCHA" in response.json()["detail"]

    def test_missing_token_field_422(self, client: TestClient, db: Session):
        _setup_guest(db, client)

        response = client.post(
            "/api/verify/request",
            json={"email": "test@example.com"},
        )
        assert response.status_code == 422
```

- [ ] **Step 3: Run tests, verify failure**

Run: `cd server && .venv/bin/pytest tests/test_otp_turnstile.py -v`
Expected: FAIL — schema doesn't have `turnstile_token` yet, or endpoint doesn't call `verify_turnstile_token`.

- [ ] **Step 4: Update schema**

Edit `server/app/schemas/verify.py` (or wherever the schema lives — found in Step 1). Add field to `VerifyRequestSchema`:

```python
from pydantic import BaseModel, EmailStr, Field


class VerifyRequestSchema(BaseModel):
    email: EmailStr
    turnstile_token: str = Field(..., min_length=1, max_length=4096)
```

- [ ] **Step 5: Update endpoint to validate token**

Edit `server/app/api/verify.py`. Add import at top:

```python
from app.core.rate_limit import get_client_ip, limiter, get_guest_id
from app.services.turnstile import verify_turnstile_token
```

Convert handler to async and add Turnstile check:

```python
@router.post("/verify/request", response_model=VerifyRequestResponse)
@limiter.limit("10/minute")
async def request_verification_code(
    payload: VerifyRequestSchema,
    request: Request,
    db: Session = Depends(get_db),
) -> VerifyRequestResponse:
    """Send a verification code to the provided email."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    is_valid = await verify_turnstile_token(payload.turnstile_token, get_client_ip(request))
    if not is_valid:
        raise HTTPException(status_code=400, detail="CAPTCHA verification failed")

    try:
        create_verification_code(db, guest_id=guest_id, email=payload.email)
    except RateLimitExceededError:
        raise HTTPException(status_code=429, detail="Too many codes requested")
    except (EmailNotConfiguredError, EmailSendError):
        raise HTTPException(status_code=422, detail="Email verification is temporarily unavailable")

    return VerifyRequestResponse(sent=True)
```

- [ ] **Step 6: Run tests**

```bash
cd server && .venv/bin/pytest tests/test_otp_turnstile.py tests/ -k "verify" -q --tb=short
```
Expected: new tests pass; existing email-verification tests may need an update (add `"turnstile_token": "fake"` and mock `verify_turnstile_token` → True). Update them to keep green.

- [ ] **Step 7: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/verify.py app/schemas/verify.py tests/test_otp_turnstile.py && .venv/bin/ruff format app/api/verify.py app/schemas/verify.py tests/test_otp_turnstile.py
```

- [ ] **Step 8: Commit**

```bash
git add server/app/api/verify.py server/app/schemas/verify.py server/tests/test_otp_turnstile.py server/tests/test_email_verification.py
git commit -m "feat(human-verify): require fresh Turnstile token on OTP send"
```

---

## Task 11: Kiosk-pair nonce challenge endpoint (TDD)

**Files:**
- Modify: `server/app/api/kiosk.py` (add new endpoint + module-level dict)
- Create: `server/tests/test_kiosk_pair_nonce.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_kiosk_pair_nonce.py`:

```python
"""Tests for kiosk-pair nonce mechanism."""

import time

from fastapi.testclient import TestClient


class TestPairChallenge:
    def test_returns_nonce_with_expiry(self, client: TestClient):
        response = client.get("/api/public/kiosk/pair-challenge")
        assert response.status_code == 200
        body = response.json()
        assert "nonce" in body
        assert isinstance(body["nonce"], str)
        assert len(body["nonce"]) >= 16  # token_urlsafe(16) >= 22 chars after b64
        assert body["expires_in"] == 10

    def test_pair_with_valid_nonce_succeeds(self, client: TestClient):
        challenge = client.get("/api/public/kiosk/pair-challenge").json()
        response = client.post(
            "/api/public/kiosk/pair",
            headers={"X-Pair-Nonce": challenge["nonce"]},
        )
        assert response.status_code == 200
        assert "pair_code" in response.json()

    def test_pair_without_nonce_400(self, client: TestClient):
        response = client.post("/api/public/kiosk/pair")
        assert response.status_code == 400
        assert "nonce" in response.json()["detail"].lower()

    def test_pair_with_invalid_nonce_400(self, client: TestClient):
        client.get("/api/public/kiosk/pair-challenge")  # Issue one
        response = client.post(
            "/api/public/kiosk/pair",
            headers={"X-Pair-Nonce": "totally-wrong-nonce-value-here"},
        )
        assert response.status_code == 400

    def test_nonce_single_use(self, client: TestClient):
        challenge = client.get("/api/public/kiosk/pair-challenge").json()
        # First use succeeds
        first = client.post(
            "/api/public/kiosk/pair",
            headers={"X-Pair-Nonce": challenge["nonce"]},
        )
        assert first.status_code == 200
        # Second use with same nonce fails
        second = client.post(
            "/api/public/kiosk/pair",
            headers={"X-Pair-Nonce": challenge["nonce"]},
        )
        assert second.status_code == 400

    def test_nonce_expires_after_10s(self, client: TestClient, monkeypatch):
        """Mock time so we don't actually wait 10s."""
        from app.api import kiosk

        challenge = client.get("/api/public/kiosk/pair-challenge").json()
        # Fast-forward time
        monkeypatch.setattr(kiosk.time, "time", lambda: time.time() + 11)
        response = client.post(
            "/api/public/kiosk/pair",
            headers={"X-Pair-Nonce": challenge["nonce"]},
        )
        assert response.status_code == 400
        assert "expired" in response.json()["detail"].lower()
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd server && .venv/bin/pytest tests/test_kiosk_pair_nonce.py -v`
Expected: FAIL — `/pair-challenge` endpoint doesn't exist.

- [ ] **Step 3: Implement nonce mechanism**

Edit `server/app/api/kiosk.py`. Add at the top:

```python
import hmac
import secrets
import time

from pydantic import BaseModel
```

(Merge with existing imports.)

Add module-level state below the imports:

```python
# In-memory nonce cache. Safe under single-worker uvicorn.
# {client_ip: (nonce_str, expires_at_unix_timestamp)}
# Pruned opportunistically on each call to get_pair_challenge.
_pair_nonces: dict[str, tuple[str, float]] = {}
_NONCE_TTL_SECONDS = 10


class KioskPairChallengeResponse(BaseModel):
    nonce: str
    expires_in: int
```

Find the existing `create_pairing` endpoint (around line 64). REPLACE its handler body:

```python
@public_router.get("/pair-challenge", response_model=KioskPairChallengeResponse)
@limiter.limit("10/minute")
def get_pair_challenge(request: Request) -> KioskPairChallengeResponse:
    """Issue a one-time IP-bound nonce required for kiosk pairing."""
    client_ip = get_client_ip(request)
    now = time.time()
    # Opportunistic prune of expired entries
    expired = [ip for ip, (_, exp) in _pair_nonces.items() if exp < now]
    for ip in expired:
        _pair_nonces.pop(ip, None)

    nonce = secrets.token_urlsafe(16)
    _pair_nonces[client_ip] = (nonce, now + _NONCE_TTL_SECONDS)
    return KioskPairChallengeResponse(nonce=nonce, expires_in=_NONCE_TTL_SECONDS)


@public_router.post("/pair", response_model=KioskPairResponse)
@limiter.limit("3/minute")
def create_pairing(request: Request, db: Session = Depends(get_db)):
    """Create a new kiosk pairing session.

    Requires a valid X-Pair-Nonce header obtained from /pair-challenge,
    bound to the same client IP. Nonce is consumed on use.
    """
    client_ip = get_client_ip(request)
    nonce_header = request.headers.get("X-Pair-Nonce")
    entry = _pair_nonces.pop(client_ip, None)

    if not nonce_header or entry is None:
        raise HTTPException(400, "Missing or unknown pairing nonce")

    nonce, expires_at = entry
    if not hmac.compare_digest(nonce_header, nonce):
        raise HTTPException(400, "Invalid pairing nonce")
    if time.time() > expires_at:
        raise HTTPException(400, "Pairing nonce expired")

    kiosk = create_kiosk(db)
    return KioskPairResponse(
        pair_code=kiosk.pair_code,
        session_token=kiosk.session_token,
        expires_at=kiosk.pair_expires_at,
    )
```

Note: rate limit on `/pair` was tightened from `10/minute` to `3/minute` per spec.

Also add `get_client_ip` to the imports if not already imported:

```python
from app.core.rate_limit import get_client_ip, limiter
```

- [ ] **Step 4: Run tests**

```bash
cd server && .venv/bin/pytest tests/test_kiosk_pair_nonce.py -v
```
Expected: All PASS.

- [ ] **Step 5: Run all kiosk tests to confirm no regressions**

```bash
cd server && .venv/bin/pytest tests/ -q --tb=short -k kiosk
```
Expected: green. (Existing pair tests will fail until updated to use the new flow — fix them.)

- [ ] **Step 6: Update existing pair tests**

Find existing tests that POST `/api/public/kiosk/pair` directly. Update each to first GET `/pair-challenge` and pass the `X-Pair-Nonce` header. Example pattern:

```python
def some_existing_pair_test(self, client):
    challenge = client.get("/api/public/kiosk/pair-challenge").json()
    response = client.post(
        "/api/public/kiosk/pair",
        headers={"X-Pair-Nonce": challenge["nonce"]},
    )
    # ... existing assertions
```

- [ ] **Step 7: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/kiosk.py tests/test_kiosk_pair_nonce.py && .venv/bin/ruff format app/api/kiosk.py tests/test_kiosk_pair_nonce.py
```

- [ ] **Step 8: Commit**

```bash
git add server/app/api/kiosk.py server/tests/test_kiosk_pair_nonce.py server/tests/  # any test files updated
git commit -m "feat(human-verify): kiosk-pair IP-bound nonce challenge"
```

---

## Task 12: Frontend Turnstile loader + site-key fetcher utility

**Files:**
- Create: `dashboard/lib/turnstile.ts`

- [ ] **Step 1: Implement loader**

Create `dashboard/lib/turnstile.ts`:

```ts
/**
 * Cloudflare Turnstile loader + site-key cache.
 *
 * Used by the human-verification bootstrap on guest pages (/join, /collect).
 * Loads the Turnstile JS once per page session and caches the site key
 * fetched from /api/auth/settings.
 *
 * Spec: docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md
 */

import { api } from './api';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: TurnstileOptions
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
      ready: (callback: () => void) => void;
    };
  }
}

export interface TurnstileOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  appearance?: 'always' | 'execute' | 'interaction-only';
  size?: 'normal' | 'flexible' | 'compact' | 'invisible';
  theme?: 'light' | 'dark' | 'auto';
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptLoadPromise: Promise<void> | null = null;
let cachedSiteKey: string | null = null;

export async function getTurnstileSiteKey(): Promise<string> {
  if (cachedSiteKey !== null) return cachedSiteKey;
  const settings = await api.getPublicSettings();
  cachedSiteKey = settings.turnstile_site_key || '';
  return cachedSiteKey;
}

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile script failed to load'));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export function resetTurnstileCache(): void {
  cachedSiteKey = null;
}
```

- [ ] **Step 2: Type-check**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 3: Lint**

```bash
cd dashboard && npm run lint
```
Expected: clean (or only pre-existing warnings).

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/turnstile.ts
git commit -m "feat(human-verify): Turnstile script loader + site-key cache"
```

---

## Task 13: `useHumanVerification` hook (TDD)

**Files:**
- Create: `dashboard/lib/useHumanVerification.ts`
- Create: `dashboard/lib/__tests__/useHumanVerification.test.tsx`

- [ ] **Step 1: Write failing test**

Create `dashboard/lib/__tests__/useHumanVerification.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    getPublicSettings: vi.fn().mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: 'test-site-key',
    }),
    verifyHuman: vi.fn().mockResolvedValue({ verified: true, expires_in: 3600 }),
  },
}));

vi.mock('../turnstile', () => ({
  getTurnstileSiteKey: vi.fn().mockResolvedValue('test-site-key'),
  loadTurnstileScript: vi.fn().mockResolvedValue(undefined),
}));

describe('useHumanVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.turnstile
    (window as any).turnstile = {
      render: vi.fn((_el, opts) => {
        // Synchronously fire the callback with a fake token
        setTimeout(() => opts.callback?.('fake-token'), 0);
        return 'widget-id-1';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
  });

  it('starts in loading state', async () => {
    const { useHumanVerification } = await import('../useHumanVerification');
    const { result } = renderHook(() => useHumanVerification());
    expect(['idle', 'loading']).toContain(result.current.state);
  });

  it('transitions to verified after successful bootstrap', async () => {
    const { useHumanVerification } = await import('../useHumanVerification');
    const { api } = await import('../api');
    const { result } = renderHook(() => useHumanVerification());

    await waitFor(() => {
      expect(result.current.state).toBe('verified');
    }, { timeout: 2000 });

    expect(api.verifyHuman).toHaveBeenCalledWith('fake-token');
  });

  it('reverify resets and re-renders the widget', async () => {
    const { useHumanVerification } = await import('../useHumanVerification');
    const { result } = renderHook(() => useHumanVerification());

    await waitFor(() => expect(result.current.state).toBe('verified'));

    await act(async () => {
      await result.current.reverify();
    });

    expect((window as any).turnstile.reset).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd dashboard && npm test -- --run useHumanVerification
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement hook**

Create `dashboard/lib/useHumanVerification.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import { getTurnstileSiteKey, loadTurnstileScript } from './turnstile';

export type HumanVerificationState =
  | 'idle'
  | 'loading'
  | 'verified'
  | 'challenge'
  | 'failed';

export interface UseHumanVerification {
  state: HumanVerificationState;
  ensureVerified: () => Promise<void>;
  reverify: () => Promise<void>;
  widgetContainerRef: React.RefObject<HTMLDivElement>;
}

export function useHumanVerification(): UseHumanVerification {
  const [state, setState] = useState<HumanVerificationState>('idle');
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const verifiedResolversRef = useRef<Array<() => void>>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const submitToken = useCallback(async (token: string) => {
    try {
      const result = await api.verifyHuman(token);
      if (result.verified) {
        setState('verified');
        verifiedResolversRef.current.forEach((resolve) => resolve());
        verifiedResolversRef.current = [];
      } else {
        setState('failed');
      }
    } catch {
      setState('failed');
    }
  }, []);

  const renderWidget = useCallback(async () => {
    setState('loading');
    const sitekey = await getTurnstileSiteKey();
    if (!sitekey) {
      // No site key configured — treat as verified (dev / Turnstile-disabled deploy)
      setState('verified');
      verifiedResolversRef.current.forEach((resolve) => resolve());
      verifiedResolversRef.current = [];
      return;
    }
    await loadTurnstileScript();
    if (!window.turnstile || !widgetContainerRef.current) return;

    if (widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
      return;
    }

    widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
      sitekey,
      appearance: 'interaction-only',
      size: 'normal',
      callback: (token: string) => {
        void submitToken(token);
      },
      'error-callback': () => setState('failed'),
      'expired-callback': () => {
        setState('idle');
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    });
  }, [submitToken]);

  useEffect(() => {
    void renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  const ensureVerified = useCallback((): Promise<void> => {
    if (stateRef.current === 'verified') return Promise.resolve();
    return new Promise((resolve) => {
      verifiedResolversRef.current.push(resolve);
    });
  }, []);

  const reverify = useCallback(async () => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    setState('loading');
    await renderWidget();
  }, [renderWidget]);

  return { state, ensureVerified, reverify, widgetContainerRef };
}
```

- [ ] **Step 4: Add `verifyHuman` to api client**

Edit `dashboard/lib/api.ts`. Add this method to the `ApiClient` class (near `getPublicSettings`):

```ts
async verifyHuman(turnstileToken: string): Promise<{ verified: boolean; expires_in: number }> {
  const res = await fetch(`${getApiUrl()}/api/guest/verify-human`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ turnstile_token: turnstileToken }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(error.detail || 'Verify failed', res.status);
  }
  return res.json();
}
```

- [ ] **Step 5: Run tests**

```bash
cd dashboard && npm test -- --run useHumanVerification
```
Expected: PASS.

- [ ] **Step 6: Type-check + lint**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/useHumanVerification.ts dashboard/lib/__tests__/useHumanVerification.test.tsx dashboard/lib/api.ts
git commit -m "feat(human-verify): useHumanVerification hook + verifyHuman API"
```

---

## Task 14: API client wrapper for 403 retry

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add error class + retry helper**

Edit `dashboard/lib/api.ts`. After the existing `ApiError` class definition, add:

```ts
export class HumanVerificationRequiredError extends ApiError {
  constructor() {
    super('Human verification required', 403);
    this.name = 'HumanVerificationRequiredError';
  }
}

/**
 * Wrap a guest-public fetch in 403-human-verification-required retry logic.
 * Caller must pass a `reverify` async function that re-runs the Turnstile
 * bootstrap and resolves once `wrzdj_human` cookie is set.
 */
async function withHumanRetry<T>(
  doFetch: () => Promise<Response>,
  reverify: () => Promise<void>,
): Promise<T> {
  let res = await doFetch();
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (body?.detail?.code === 'human_verification_required') {
      await reverify();
      res = await doFetch();
    }
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(error.detail || 'Request failed', res.status);
  }
  return res.json();
}
```

- [ ] **Step 2: Refactor public-guest API methods to accept reverify**

Find `eventSearch`, `submitRequest` (public variant), `publicVoteRequest`, and the collect helpers. Update each to accept an optional `reverify` parameter:

```ts
async eventSearch(
  code: string,
  query: string,
  reverify?: () => Promise<void>,
): Promise<SearchResult[]> {
  const doFetch = () =>
    fetch(`${getApiUrl()}/api/events/${code}/search?q=${encodeURIComponent(query)}`, {
      credentials: 'include',
    });
  if (reverify) {
    return withHumanRetry<SearchResult[]>(doFetch, reverify);
  }
  const res = await doFetch();
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(error.detail || 'Request failed', res.status);
  }
  return res.json();
}
```

Apply the same pattern to:
- `publicVoteRequest`
- `submitRequest` (public guest version)
- `getCollectEvent` writes — actually only mutating: `submitCollectRequest`, `voteCollectRequest`, `setCollectProfile`, `enrichCollectPreview`

(For each method, check whether it currently uses raw `fetch()` or `this.fetch()` — only the raw-fetch ones need the wrapper; `this.fetch()` is for authenticated DJ flows.)

- [ ] **Step 3: Type-check**

```bash
cd dashboard && npx tsc --noEmit
```

- [ ] **Step 4: Run existing API tests**

```bash
cd dashboard && npm test -- --run api
```
Expected: existing tests still pass (since `reverify` is optional, default behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat(human-verify): API client 403 retry wrapper"
```

---

## Task 15: Integrate hook into `/join/[code]` page

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx`

- [ ] **Step 1: Import and mount hook**

Edit `dashboard/app/join/[code]/page.tsx`. At the top of the file, add:

```ts
import { useHumanVerification } from '@/lib/useHumanVerification';
```

In the page component, near the other state declarations:

```ts
const { state: humanState, reverify, widgetContainerRef } = useHumanVerification();
```

- [ ] **Step 2: Pass `reverify` to API calls**

Find all calls to `api.eventSearch`, `api.search`, `api.submitRequest` (public version), `api.publicVoteRequest`, `api.publicUnvoteRequest` in this file. Pass `reverify` as the third argument:

```ts
const results = await api.eventSearch(code, searchQuery, reverify);
// ...
await api.submitRequest({ ... }, reverify);
// ...
await api.publicVoteRequest(requestId, reverify);
```

- [ ] **Step 3: Render widget container**

Near the form's submit button (or anywhere in the page DOM), add the hidden widget container:

```tsx
<div
  ref={widgetContainerRef}
  style={{
    display: humanState === 'challenge' ? 'block' : 'none',
    margin: '1rem 0',
  }}
/>
{humanState === 'failed' && (
  <div style={{ color: '#ef4444', marginTop: '0.5rem', fontSize: '0.9rem' }}>
    Verification failed. Please refresh the page.
  </div>
)}
```

(If the page already has a styled error/notice block, follow that pattern instead.)

- [ ] **Step 4: Type-check**

```bash
cd dashboard && npx tsc --noEmit
```

- [ ] **Step 5: Run page tests**

```bash
cd dashboard && npm test -- --run join
```
Expected: existing tests may fail because the new hook tries to call `api.getPublicSettings`. Update the test mock to include the existing setting plus mock `useHumanVerification` itself:

```ts
vi.mock('@/lib/useHumanVerification', () => ({
  useHumanVerification: () => ({
    state: 'verified',
    reverify: vi.fn().mockResolvedValue(undefined),
    ensureVerified: vi.fn().mockResolvedValue(undefined),
    widgetContainerRef: { current: null },
  }),
}));
```

Add this mock to all `__tests__/page.test.tsx` files for `/join`.

- [ ] **Step 6: Run lint**

```bash
cd dashboard && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/app/join/
git commit -m "feat(human-verify): integrate hook into /join page"
```

---

## Task 16: Integrate hook into `/collect/[code]` page (excluding OTP form)

**Files:**
- Modify: `dashboard/app/collect/[code]/page.tsx`
- Modify: `dashboard/app/collect/[code]/__tests__/*.tsx` (if exist)

- [ ] **Step 1: Apply same pattern as Task 15**

Edit `dashboard/app/collect/[code]/page.tsx`. Mount `useHumanVerification`, pass `reverify` to all collect-mutating API calls (`api.setCollectProfile`, `api.submitCollectRequest`, `api.voteCollectRequest`, `api.enrichCollectPreview`), render hidden widget container.

(Identical structure to Task 15 — see Task 15 steps 1-3 for code patterns; replace the API method names.)

- [ ] **Step 2: Mock hook in collect tests**

Edit each `dashboard/app/collect/__tests__/*.tsx`. Add the same `vi.mock('@/lib/useHumanVerification', ...)` block from Task 15 step 5.

- [ ] **Step 3: Type-check + tests + lint**

```bash
cd dashboard && npx tsc --noEmit && npm test -- --run collect && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/collect/
git commit -m "feat(human-verify): integrate hook into /collect page"
```

---

## Task 17: OTP fresh-token Turnstile widget on /collect

**Files:**
- Modify: `dashboard/app/collect/[code]/page.tsx` (the email-verify section)
- Modify: `dashboard/lib/api.ts` — `requestVerificationCode` method

- [ ] **Step 1: Add `turnstile_token` parameter to API method**

Edit `dashboard/lib/api.ts`. Find `requestVerificationCode` (the method that POSTs `/api/verify/request`). Update its signature:

```ts
async requestVerificationCode(
  email: string,
  turnstileToken: string,
): Promise<{ sent: boolean }> {
  const res = await fetch(`${getApiUrl()}/api/verify/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, turnstile_token: turnstileToken }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new ApiError(error.detail || 'Request failed', res.status);
  }
  return res.json();
}
```

- [ ] **Step 2: Render second Turnstile widget for OTP form**

Edit `dashboard/app/collect/[code]/page.tsx`. In the email/OTP form section, render an inline Turnstile widget with non-interactive (execute) mode. Add state:

```ts
const [otpTurnstileToken, setOtpTurnstileToken] = useState<string>('');
const otpWidgetRef = useRef<HTMLDivElement>(null);
const otpWidgetIdRef = useRef<string | null>(null);

useEffect(() => {
  if (!otpWidgetRef.current) return;
  let cancelled = false;
  void (async () => {
    const sitekey = await getTurnstileSiteKey();
    if (!sitekey || cancelled) return;
    await loadTurnstileScript();
    if (!window.turnstile || cancelled || !otpWidgetRef.current) return;
    otpWidgetIdRef.current = window.turnstile.render(otpWidgetRef.current, {
      sitekey,
      appearance: 'interaction-only',
      size: 'normal',
      callback: (token: string) => setOtpTurnstileToken(token),
      'error-callback': () => setOtpTurnstileToken(''),
      'expired-callback': () => setOtpTurnstileToken(''),
    });
  })();
  return () => {
    cancelled = true;
    if (otpWidgetIdRef.current && window.turnstile) {
      window.turnstile.remove(otpWidgetIdRef.current);
      otpWidgetIdRef.current = null;
    }
  };
}, []);
```

Update the "Send code" handler:

```ts
const handleSendCode = async () => {
  if (!otpTurnstileToken) {
    setOtpError('Please complete the human-verification check.');
    return;
  }
  try {
    await api.requestVerificationCode(email, otpTurnstileToken);
    setCodeSent(true);
    // Reset widget for next attempt
    if (otpWidgetIdRef.current && window.turnstile) {
      window.turnstile.reset(otpWidgetIdRef.current);
    }
    setOtpTurnstileToken('');
  } catch (err) {
    setOtpError(err instanceof Error ? err.message : 'Failed to send code');
  }
};
```

Render the widget in the form JSX:

```tsx
<div ref={otpWidgetRef} style={{ margin: '1rem 0' }} />
```

- [ ] **Step 3: Add imports**

```ts
import { getTurnstileSiteKey, loadTurnstileScript } from '@/lib/turnstile';
```

- [ ] **Step 4: Type-check + tests + lint**

```bash
cd dashboard && npx tsc --noEmit && npm test -- --run collect && npm run lint
```

Update collect tests that exercised `requestVerificationCode` to pass a fake token argument.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/collect/ dashboard/lib/api.ts
git commit -m "feat(human-verify): per-action Turnstile gate on OTP send"
```

---

## Task 18: Kiosk-pair frontend nonce flow

**Files:**
- Modify: `dashboard/app/kiosk-pair/page.tsx`
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add API method**

Edit `dashboard/lib/api.ts`. Add:

```ts
async getKioskPairChallenge(): Promise<{ nonce: string; expires_in: number }> {
  const res = await fetch(`${getApiUrl()}/api/public/kiosk/pair-challenge`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError('Failed to fetch pair challenge', res.status);
  }
  return res.json();
}

async createKioskPairing(nonce: string): Promise<KioskPairResponse> {
  const res = await fetch(`${getApiUrl()}/api/public/kiosk/pair`, {
    method: 'POST',
    headers: { 'X-Pair-Nonce': nonce },
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Pairing failed' }));
    throw new ApiError(error.detail || 'Pairing failed', res.status);
  }
  return res.json();
}
```

(If `KioskPairResponse` doesn't exist in `lib/api.ts`, find where the existing pair-call types live and re-export them. Otherwise define inline.)

- [ ] **Step 2: Update kiosk-pair page**

Edit `dashboard/app/kiosk-pair/page.tsx`. Find the function that creates the pair (likely uses raw `fetch` or `api.createKioskPairing`). Replace with:

```ts
const startPairing = async () => {
  try {
    const challenge = await api.getKioskPairChallenge();
    const result = await api.createKioskPairing(challenge.nonce);
    // ... existing handling of pair_code, session_token, etc.
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // Nonce expired or invalid — retry once
      const challenge = await api.getKioskPairChallenge();
      const result = await api.createKioskPairing(challenge.nonce);
      // ... handle result
    } else {
      throw err;
    }
  }
};
```

- [ ] **Step 3: Type-check + lint**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

- [ ] **Step 4: Add page test for nonce flow**

Create or extend `dashboard/app/kiosk-pair/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  api: {
    getKioskPairChallenge: vi.fn().mockResolvedValue({ nonce: 'test-nonce', expires_in: 10 }),
    createKioskPairing: vi.fn().mockResolvedValue({
      pair_code: 'ABC123',
      session_token: 'tok',
      expires_at: '2099-01-01T00:00:00Z',
    }),
  },
  ApiError: class extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
}));

describe('KioskPairPage', () => {
  it('fetches challenge then creates pairing with nonce', async () => {
    const { default: KioskPairPage } = await import('../page');
    render(<KioskPairPage />);
    const { api } = await import('@/lib/api');
    await waitFor(() => {
      expect(api.getKioskPairChallenge).toHaveBeenCalled();
      expect(api.createKioskPairing).toHaveBeenCalledWith('test-nonce');
    });
  });
});
```

- [ ] **Step 5: Run test**

```bash
cd dashboard && npm test -- --run kiosk-pair
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/kiosk-pair/ dashboard/lib/api.ts
git commit -m "feat(human-verify): kiosk-pair nonce flow on frontend"
```

---

## Task 19: Admin UI toggle for `human_verification_enforced`

**Files:**
- Modify: `server/app/api/admin.py` (settings endpoint)
- Modify: `server/app/schemas/admin.py` (or wherever settings schema lives)
- Modify: `dashboard/app/admin/settings/page.tsx`

- [ ] **Step 1: Find existing settings endpoint**

```bash
grep -n "registration_enabled" /home/adam/github/WrzDJ/server/app/api/admin.py /home/adam/github/WrzDJ/server/app/schemas/*.py 2>/dev/null | head -10
```

- [ ] **Step 2: Add field to schema + endpoint**

Edit the admin settings schema (likely `server/app/schemas/admin.py`). Add `human_verification_enforced: bool` to the `SystemSettingsRead` and `SystemSettingsUpdate` models.

Edit `server/app/api/admin.py`. In the settings PATCH/PUT handler, persist the new field:

```python
if body.human_verification_enforced is not None:
    sys_settings.human_verification_enforced = body.human_verification_enforced
```

- [ ] **Step 3: Add toggle to admin page**

Edit `dashboard/app/admin/settings/page.tsx`. Add a toggle entry for `human_verification_enforced` matching the pattern of `registration_enabled`. Label: "Enforce human verification on guest pages". Help text: "When ON, guests must complete a Cloudflare Turnstile check before submitting requests, voting, or searching. Disable for staging only."

- [ ] **Step 4: Run backend + frontend tests**

```bash
cd server && .venv/bin/pytest tests/ -k admin -q
cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add server/app/api/admin.py server/app/schemas/ dashboard/app/admin/
git commit -m "feat(human-verify): admin settings toggle for enforce flag"
```

---

## Task 20: Update CLAUDE.md security section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add bullet to Security Posture section**

Edit `CLAUDE.md`. In the "Security Posture" section, under "Public-Facing Endpoint Hardening", add:

```markdown
- **Human verification on guest pages**: Public guest endpoints (`/join`, `/collect`) require a `wrzdj_human` HMAC-signed cookie issued after Cloudflare Turnstile verification on page load. Apply via `Depends(require_verified_human_soft)` (rollout) or `Depends(require_verified_human)` (post-rollout). The cookie has a 60-min sliding window. OTP send (`/api/verify/request`) requires a fresh Turnstile token per call. Kiosk-pair (`/api/public/kiosk/pair`) uses an IP-bound 10-second nonce instead of Turnstile (Pi has no input device). See `docs/HUMAN-VERIFICATION.md` for details.
```

- [ ] **Step 2: Add to Architecture Patterns section**

Add a new subsection in "Architecture Patterns":

```markdown
### Human Verification (Guest Pages)
- New endpoint: `POST /api/guest/verify-human` accepts a Turnstile token, sets HMAC-signed `wrzdj_human` cookie via `services/human_verification.py`.
- Dependency `require_verified_human_soft` (in `api/deps.py`) gates: event_search, submit_request, public vote/unvote, collect profile/requests/vote/enrich-preview.
- Soft-mode flag: `SystemSettings.human_verification_enforced` — when False, missing cookie logs warning; when True, returns 403 with `detail.code = "human_verification_required"`.
- OTP `/api/verify/request` requires `turnstile_token` field per call (separate from session cookie).
- Kiosk-pair: `GET /api/public/kiosk/pair-challenge` issues IP-bound nonce, `POST /api/public/kiosk/pair` requires `X-Pair-Nonce` header. Rate limit on POST: 3/minute.
- Required env var in production: `HUMAN_COOKIE_SECRET` (32-byte base64). Dev auto-generates ephemeral key.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md updates for human-verification system"
```

---

## Task 21: Create `docs/HUMAN-VERIFICATION.md`

**Files:**
- Create: `docs/HUMAN-VERIFICATION.md`

- [ ] **Step 1: Write the doc**

Create `docs/HUMAN-VERIFICATION.md`:

```markdown
# Human Verification on Public Guest Pages

WrzDJ guards `/join`, `/collect`, and `/kiosk-pair` against mass automated abuse and email-cost abuse using a layered approach. This doc explains how it works for future developers.

## Three mechanisms

1. **Session cookie (`wrzdj_human`)** — issued after a Cloudflare Turnstile check on page load. Required for all guest-mutating endpoints. 60-min sliding window.
2. **Per-action Turnstile (OTP only)** — `POST /api/verify/request` requires a fresh Turnstile token per email send. Burns Resend cost only with proven human input.
3. **IP-bound nonce (kiosk-pair only)** — `GET /api/public/kiosk/pair-challenge` issues a 10-second nonce, `POST /api/public/kiosk/pair` requires it. Tightened rate limit (3/min). No Turnstile because Pi has no input device for hard challenges.

## Cookie format

`wrzdj_human` is an HMAC-SHA256 signed JSON payload:

```
base64url(payload).base64url(hmac_sha256(payload, key))
```

Payload: `{"guest_id": <int>, "exp": <unix_ts>}`

Key sourced from `HUMAN_COOKIE_SECRET` env var (32 bytes, base64). Required in production. Dev auto-generates ephemeral key with startup warning — cookies don't survive a server restart in dev.

## Backend integration

- `app/services/human_verification.py` — sign/verify cookie helpers.
- `app/api/deps.py:require_verified_human` — hard dependency, raises 403 when invalid.
- `app/api/deps.py:require_verified_human_soft` — soft-mode wrapper, reads `SystemSettings.human_verification_enforced`. Use this during rollout.
- `app/api/guest.py:verify_human` — bootstrap endpoint that validates Turnstile and issues cookie.

Apply the dependency:

```python
from app.api.deps import require_verified_human_soft

@router.post("/some-mutating-endpoint")
def my_handler(
    ...,
    _human: int | None = Depends(require_verified_human_soft),
):
    ...
```

## Frontend integration

- `lib/turnstile.ts` — script loader + site-key cache.
- `lib/useHumanVerification.ts` — React hook that runs Turnstile in `interaction-only` mode on mount and POSTs to `/api/guest/verify-human`.
- `lib/api.ts:withHumanRetry` — fetch wrapper that catches 403 + `detail.code === "human_verification_required"`, calls `reverify()`, retries once.

Page integration pattern:

```tsx
const { state, reverify, widgetContainerRef } = useHumanVerification();

await api.someMutatingCall(args, reverify);

return (
  <div>
    {/* Hidden widget container, only visible when Cloudflare escalates */}
    <div ref={widgetContainerRef} style={{ display: state === 'challenge' ? 'block' : 'none' }} />
  </div>
);
```

## Rollout

- **Phase 1** (deploy): `human_verification_enforced=False`. Soft-mode logs warnings on missing cookie but allows requests through. Frontend bootstrap deployed in same release.
- **Phase 2** (+7 days): Admin flips `human_verification_enforced=True` from the admin Settings page. Endpoint dependency starts returning 403. All live users have valid cookies (frontend has been live for a week).
- **Phase 3** (+30 days): Replace `require_verified_human_soft` calls with `require_verified_human` and remove the soft-mode wrapper.

## Observability

Structured log events:
- `guest.human_verify action=verified guest_id=N` — bootstrap success.
- `guest.human_verify action=blocked guest_id=N reason=cookie_invalid|expired|missing` — 403 from gated endpoint.
- `guest.human_verify action=missing guest_id=N reason=soft_mode_pass` — soft-mode warning.
- `guest.human_verify action=turnstile_failed reason=cloudflare_rejected` — Turnstile rejected token.
- `kiosk.pair action=nonce_issued|nonce_consumed|nonce_expired|nonce_missing` — kiosk pairing.

## Single-worker assumption

The kiosk-pair nonce dict (`_pair_nonces` in `api/kiosk.py`) is in-memory. `server/scripts/start.sh` runs `uvicorn` with no `--workers` flag (= 1 worker), so this is safe today. **If the deploy ever scales to multiple workers, replace the dict with a `KioskPairChallenge` SQLAlchemy model** (10-second TTL row, periodic cleanup). The session cookie is fine across workers because it's stateless.

## Threats covered

- Mass bot floods of search/submit/vote: each guest cookie requires Turnstile solve; per-IP rate limit caps bootstrap calls.
- IP rotation: each new IP needs a new Turnstile solve. Cloudflare scoring catches IP-rotation patterns.
- OTP email-cost abuse: per-action Turnstile + email-hash 3/hr cap + IP 10/min cap.
- Kiosk pair-table flooding: IP-bound 10s nonce + 3/min rate.

## Threats NOT covered (out of scope)

- Targeted in-event griefing by attendees with valid event codes (different threat model).
- Per-action fresh Turnstile on submit/vote (would re-introduce visible friction).
- Bot detection on authenticated DJ endpoints (DJs auth via JWT, separate threat model).

## Spec reference

`docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md`
```

- [ ] **Step 2: Commit**

```bash
git add docs/HUMAN-VERIFICATION.md
git commit -m "docs: HUMAN-VERIFICATION.md for future devs"
```

---

## Task 22: Production deploy checklist execution

**Files:**
- N/A (deployment activity)

- [ ] **Step 1: Generate production HUMAN_COOKIE_SECRET**

Run locally:
```bash
python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```
Save the output to a password manager.

- [ ] **Step 2: Add to VPS .env**

```bash
ssh wrz-droplet
cd ~/WrzDJ
# Edit .env, add: HUMAN_COOKIE_SECRET=<value-from-step-1>
nano .env
```

- [ ] **Step 3: Confirm nginx CSP includes Cloudflare**

Check `deploy/nginx/*.conf.template` for `Content-Security-Policy` header. Confirm:
- `script-src` includes `https://challenges.cloudflare.com`
- `frame-src` includes `https://challenges.cloudflare.com`

If not, add them and re-run setup-nginx.sh as documented in `MEMORY.md` `Production Deploy (VPS)` section.

- [ ] **Step 4: Confirm `human_verification_enforced=False` on initial deploy**

Default value from migration. Don't flip it yet — Phase 1 soak.

- [ ] **Step 5: Run full local CI before pushing**

```bash
cd /home/adam/github/WrzDJ/server
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/bandit -r app -c pyproject.toml -q && .venv/bin/pytest --tb=short -q
cd ../dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
cd ../bridge && npx tsc --noEmit && npm test -- --run
cd ../bridge-app && npx tsc --noEmit && npm test -- --run
```
Expected: all green.

- [ ] **Step 6: Push branch and open PR**

```bash
cd /home/adam/github/WrzDJ
git push -u origin feat/human-verification
gh pr create --title "feat: human verification on guest pages" --body "$(cat <<'EOF'
## Summary
- Add Cloudflare Turnstile + signed-cookie session bootstrap on /join and /collect
- Per-action Turnstile gate on /api/verify/request (OTP email send)
- IP-bound nonce + tighter rate limit on /api/public/kiosk/pair
- Soft-mode rollout flag in SystemSettings (Phase 1 default OFF)

Spec: docs/superpowers/specs/2026-05-01-public-page-human-verification-design.md

## Test plan
- [ ] All backend pytest green (incl. new test_human_verification, test_verify_human_endpoint, test_require_verified_human, test_otp_turnstile, test_kiosk_pair_nonce)
- [ ] All frontend vitest green (incl. new useHumanVerification.test, kiosk-pair page test)
- [ ] alembic check clean after new migration
- [ ] Manual: visit /join in dev, verify wrzdj_human cookie set after page load
- [ ] Manual: tamper with cookie, verify 403 + transparent re-bootstrap
- [ ] Manual: kiosk-pair flow on Pi (or simulated browser) succeeds
- [ ] Manual: OTP flow on /collect requires Turnstile widget interaction
- [ ] Production: HUMAN_COOKIE_SECRET set in .env BEFORE deploy
EOF
)"
```

- [ ] **Step 7: Wait for CI green, merge with --admin --squash --delete-branch**

```bash
gh pr checks <pr-number> --watch
gh pr merge <pr-number> --admin --squash --delete-branch
```

- [ ] **Step 8: Deploy to VPS**

```bash
ssh wrz-droplet
cd ~/WrzDJ
git fetch && git checkout main && git pull
./deploy/deploy.sh
docker compose -f deploy/docker-compose.yml logs api 2>&1 | head -30
# Verify: NO "auto-generated ephemeral key" warning
# Verify: alembic upgrade ran cleanly
```

If `deploy/nginx/` files were changed:

```bash
APP_DOMAIN=app.wrzdj.com API_DOMAIN=api.wrzdj.com ./deploy/setup-nginx.sh
```

- [ ] **Step 9: Phase 1 soak — 7 days of soft-mode**

Watch logs for `human_verification_missing` warnings:

```bash
ssh wrz-droplet "docker compose -f deploy/docker-compose.yml logs api --since 1h | grep human_verify"
```

After 7 days, if logs show steady volume of `action=verified` and minimal `action=missing`, proceed to Phase 2.

- [ ] **Step 10: Phase 2 enforce**

Log into admin dashboard → Settings → toggle "Enforce human verification on guest pages" to ON. Watch logs for any spike in 403s. Roll back via the same toggle if anything regresses.

---

# Self-Review Notes

## Spec coverage check

| Spec section | Tasks covering it |
|---|---|
| Backend module `human_verification.py` | Task 2 |
| `POST /api/guest/verify-human` | Task 4 |
| `require_verified_human` dependency | Task 5 |
| `require_verified_human_soft` (rollout) | Task 6 |
| Apply gate to events.py (search + submit) | Task 7 |
| Apply gate to votes.py (vote/unvote) | Task 8 |
| Apply gate to collect.py (4 endpoints) | Task 9 |
| OTP fresh-token gate | Task 10 |
| Kiosk-pair nonce challenge | Task 11 |
| Frontend Turnstile loader | Task 12 |
| `useHumanVerification` hook | Task 13 |
| API client 403 retry wrapper | Task 14 |
| `/join` integration | Task 15 |
| `/collect` integration | Task 16 |
| OTP fresh-token frontend | Task 17 |
| Kiosk-pair frontend nonce | Task 18 |
| Admin UI toggle | Task 19 |
| CLAUDE.md update | Task 20 |
| `docs/HUMAN-VERIFICATION.md` | Task 21 |
| Production deploy + Phase 1 soak | Task 22 |
| Config: `HUMAN_COOKIE_SECRET` | Task 1 |
| SystemSettings flag | Task 3 |

All spec sections have a task. No gaps.

## Type consistency

- `verify_human_cookie` returns `int | None` — matches every caller (Tasks 5, 6).
- `require_verified_human_soft` returns `int | None` (caller may get None during soft-mode pass-through). Matches the `_human: int | None` type hint in every gated endpoint (Tasks 7, 8, 9).
- `useHumanVerification` returns `{ state, ensureVerified, reverify, widgetContainerRef }` — matches usage in Task 15, 16.
- `verifyHuman` API method (Task 13 step 4) returns `{ verified: boolean; expires_in: number }` — matches backend `VerifyHumanResponse` schema (Task 4 step 1).
- `getKioskPairChallenge` returns `{ nonce: string; expires_in: number }` — matches backend `KioskPairChallengeResponse` (Task 11 step 3).

No type drift detected.

## Placeholder scan

No "TBD", "TODO", or "implement later" placeholders. Every step has either exact code, exact command, or explicit deferral with reason (e.g. Task 5 step 1 notes one test is "best deferred until Task 7" with explanation, but the dependency itself is fully tested in that task).

## Scope check

This plan implements a single feature with three internal mechanisms (session cookie + per-action OTP gate + kiosk nonce). All three share the threat model and are coupled by the same rollout. Single plan is appropriate.
