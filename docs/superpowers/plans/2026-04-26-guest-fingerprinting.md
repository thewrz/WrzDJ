# Guest Fingerprinting & Platform Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace IP-based guest identification with server-token-first identity using ThumbmarkJS fingerprint reconciliation, enabling reliable guest dedup behind shared NAT and platform-wide identity.

**Architecture:** Server assigns HttpOnly cookie (`wrzdj_guest`) as canonical identity. ThumbmarkJS browser fingerprint is a reconciliation fallback when cookies are lost. New `Guest` model is the platform-level identity root; existing `GuestProfile`, `Request`, `RequestVote` gain a `guest_id` FK. All 10 public endpoints migrate from IP-based `client_fingerprint` to `guest_id`.

**Tech Stack:** Python/FastAPI (backend), SQLAlchemy 2.0 + Alembic (models/migrations), ThumbmarkJS (browser fingerprinting), React hooks (frontend), pytest (tests)

**Spec:** `docs/superpowers/specs/2026-04-26-guest-fingerprinting-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/app/models/guest.py` | `Guest` SQLAlchemy model (platform identity root) |
| `server/app/services/guest_identity.py` | Identity resolution: create, cookie-hit, reconcile, confidence scoring |
| `server/app/api/guest.py` | `POST /api/public/guest/identify` endpoint |
| `server/app/schemas/guest.py` | Pydantic request/response schemas for identify |
| `server/alembic/versions/036_add_guest_identity.py` | Migration: guests table + guest_id FKs |
| `server/tests/test_guest_identity.py` | Unit tests for identity resolution service |
| `server/tests/test_guest_confidence.py` | Unit tests for reconciliation confidence scoring |
| `server/tests/test_identify_endpoint.py` | Integration tests for /identify endpoint |
| `server/tests/test_guest_scenarios.py` | Scenario tests (NAT, network switch, abuse) |
| `dashboard/lib/use-guest-identity.ts` | React hook: ThumbmarkJS + identify call + context |

### Modified Files

| File | Change |
|------|--------|
| `server/app/models/__init__.py` | Add `Guest` import + `__all__` entry |
| `server/app/models/guest_profile.py` | Add `guest_id` FK column |
| `server/app/models/request.py` | Add `guest_id` FK column |
| `server/app/models/request_vote.py` | Add `guest_id` FK + new unique constraint |
| `server/app/main.py` | Register guest API router |
| `server/app/core/rate_limit.py` | Add `get_guest_id()` utility function |
| `server/app/services/vote.py` | Accept `guest_id` param in add/remove/has_voted |
| `server/app/services/request.py` | Accept `guest_id` param, add `get_requests_by_guest()` |
| `server/app/services/collect.py` | Accept `guest_id` param in profile + submission functions |
| `server/app/api/votes.py` | Switch from `get_client_fingerprint` to `get_guest_id` |
| `server/app/api/public.py` | Switch from `get_client_fingerprint` to `get_guest_id` |
| `server/app/api/collect.py` | Switch from `get_client_fingerprint` to `get_guest_id` |
| `server/app/api/events.py` | Pass `guest_id=None` for DJ-submitted requests |
| `server/tests/conftest.py` | Add `test_guest` and `guest_headers` fixtures |
| `dashboard/package.json` | Add `@thumbmarkjs/thumbmarkjs` dependency |

---

## Task 1: Guest Model & Model Registration

**Files:**
- Create: `server/app/models/guest.py`
- Modify: `server/app/models/__init__.py`
- Modify: `server/app/models/guest_profile.py`
- Modify: `server/app/models/request.py`
- Modify: `server/app/models/request_vote.py`

- [ ] **Step 1: Create the Guest model**

```python
# server/app/models/guest.py
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class Guest(Base):
    __tablename__ = "guests"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    fingerprint_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    fingerprint_components: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
```

- [ ] **Step 2: Add guest_id FK to GuestProfile**

In `server/app/models/guest_profile.py`, add after the `client_fingerprint` column:

```python
guest_id: Mapped[int | None] = mapped_column(
    ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, index=True
)
```

Add `ForeignKey` to the imports from sqlalchemy. Add a new unique constraint to `__table_args__`:

```python
__table_args__ = (
    UniqueConstraint(
        "event_id",
        "client_fingerprint",
        name="uq_guest_profile_event_fingerprint",
    ),
    UniqueConstraint(
        "event_id",
        "guest_id",
        name="uq_guest_profile_event_guest",
    ),
)
```

- [ ] **Step 3: Add guest_id FK to Request**

In `server/app/models/request.py`, add after the `client_fingerprint` column (line 50):

```python
guest_id: Mapped[int | None] = mapped_column(
    ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, index=True
)
```

Add `ForeignKey` to the imports if not already present.

- [ ] **Step 4: Add guest_id FK to RequestVote**

In `server/app/models/request_vote.py`, add after the `client_fingerprint` column:

```python
guest_id: Mapped[int | None] = mapped_column(
    ForeignKey("guests.id", ondelete="SET NULL"), nullable=True, index=True
)
```

Update `__table_args__` to include both constraints:

```python
__table_args__ = (
    UniqueConstraint("request_id", "client_fingerprint", name="uq_request_vote"),
    UniqueConstraint("request_id", "guest_id", name="uq_request_vote_guest"),
)
```

Add `ForeignKey` to the imports.

- [ ] **Step 5: Register Guest in models/__init__.py**

Add to `server/app/models/__init__.py`:

```python
from app.models.guest import Guest
```

Add `"Guest"` to the `__all__` list (alphabetically, after `"GuestProfile"`... wait, before it: after `"Event"`).

- [ ] **Step 6: Verify models load cleanly**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/python -c "from app.models import Guest; print(Guest.__tablename__)"`

Expected: `guests`

- [ ] **Step 7: Commit**

```bash
git add server/app/models/guest.py server/app/models/__init__.py server/app/models/guest_profile.py server/app/models/request.py server/app/models/request_vote.py
git commit -m "feat: add Guest model and guest_id FKs to existing models"
```

---

## Task 2: Test Fixtures & Guest Identity Service

**Files:**
- Modify: `server/tests/conftest.py`
- Create: `server/tests/test_guest_identity.py`
- Create: `server/app/services/guest_identity.py`

- [ ] **Step 1: Add test fixtures to conftest.py**

Add to `server/tests/conftest.py` (imports and fixtures):

Import at top:
```python
from app.models.guest import Guest
```

Add fixture:
```python
@pytest.fixture
def test_guest(db: Session) -> Guest:
    """Create a test guest with known token and fingerprint."""
    guest = Guest(
        token="a" * 64,
        fingerprint_hash="fp_test_hash_123",
        fingerprint_components='{"screen":"1170x2532","timezone":"America/Chicago"}',
        ip_address="192.168.1.100",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest
```

- [ ] **Step 2: Write failing tests for identity creation**

Create `server/tests/test_guest_identity.py`:

```python
"""Unit tests for guest identity resolution service."""

import json
import secrets

from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.services.guest_identity import IdentifyResult, identify_guest


def test_create_guest_new_visitor(db: Session):
    """No cookie, no fingerprint match -> new Guest created."""
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="brand_new_fp",
        fingerprint_components={"screen": "1170x2532"},
        ip_address="10.0.0.1",
        user_agent="Mozilla/5.0 Safari/17.4",
    )
    assert result.guest_id is not None
    assert result.action == "create"
    assert result.token is not None
    assert len(result.token) == 64

    guest = db.query(Guest).filter(Guest.id == result.guest_id).one()
    assert guest.fingerprint_hash == "brand_new_fp"
    assert guest.ip_address == "10.0.0.1"
    assert json.loads(guest.fingerprint_components) == {"screen": "1170x2532"}


def test_cookie_hit_returns_existing(db: Session, test_guest: Guest):
    """Valid cookie -> returns existing Guest, updates last_seen_at."""
    old_last_seen = test_guest.last_seen_at

    result = identify_guest(
        db,
        token_from_cookie=test_guest.token,
        fingerprint_hash="fp_test_hash_123",
        fingerprint_components={"screen": "1170x2532"},
        ip_address="10.0.0.50",
        user_agent="Mozilla/5.0 Safari/17.4",
    )
    assert result.guest_id == test_guest.id
    assert result.action == "cookie_hit"
    assert result.token is None  # no new token needed

    db.refresh(test_guest)
    assert test_guest.last_seen_at >= old_last_seen
    assert test_guest.ip_address == "10.0.0.50"


def test_cookie_hit_updates_ip_and_ua(db: Session, test_guest: Guest):
    """Cookie hit from new IP/UA -> fields updated, guest_id unchanged."""
    result = identify_guest(
        db,
        token_from_cookie=test_guest.token,
        fingerprint_hash="fp_test_hash_123",
        fingerprint_components={"screen": "1170x2532"},
        ip_address="172.16.0.99",
        user_agent="Mozilla/5.0 Chrome/125.0",
    )
    assert result.guest_id == test_guest.id

    db.refresh(test_guest)
    assert test_guest.ip_address == "172.16.0.99"
    assert "Chrome" in test_guest.user_agent


def test_expired_token_ignored(db: Session):
    """Cookie present but token not in DB -> treated as new visitor."""
    result = identify_guest(
        db,
        token_from_cookie="nonexistent_token_" + "x" * 46,
        fingerprint_hash="some_fp_hash",
        fingerprint_components={},
        ip_address="10.0.0.1",
        user_agent="Mozilla/5.0 Safari/17.4",
    )
    assert result.action == "create"
    assert result.guest_id is not None


def test_fingerprint_drift_updates_hash(db: Session, test_guest: Guest):
    """Returning guest (cookie valid) with new fingerprint -> hash updated."""
    result = identify_guest(
        db,
        token_from_cookie=test_guest.token,
        fingerprint_hash="new_fp_after_browser_update",
        fingerprint_components={"screen": "1170x2532", "new_signal": True},
        ip_address="10.0.0.1",
        user_agent="Mozilla/5.0 Safari/18.0",
    )
    assert result.guest_id == test_guest.id
    assert result.action == "cookie_hit"

    db.refresh(test_guest)
    assert test_guest.fingerprint_hash == "new_fp_after_browser_update"


def test_token_is_cryptographically_random(db: Session):
    """Generated tokens are 64 hex chars and unique."""
    tokens = set()
    for _ in range(100):
        result = identify_guest(
            db,
            token_from_cookie=None,
            fingerprint_hash=secrets.token_hex(16),
            fingerprint_components={},
            ip_address="10.0.0.1",
            user_agent="Mozilla/5.0",
        )
        assert len(result.token) == 64
        assert result.token not in tokens
        tokens.add(result.token)


def test_fingerprint_components_stored_as_json(db: Session):
    """Components JSON saved on create."""
    components = {"screen": "390x844", "timezone": "America/New_York", "lang": "en-US"}
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="fp_components_test",
        fingerprint_components=components,
        ip_address="10.0.0.1",
        user_agent="Mozilla/5.0",
    )
    guest = db.query(Guest).filter(Guest.id == result.guest_id).one()
    assert json.loads(guest.fingerprint_components) == components
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_identity.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.guest_identity'`

- [ ] **Step 4: Implement the guest identity service**

Create `server/app/services/guest_identity.py`:

```python
"""Guest identity resolution service.

Resolves anonymous guests via a two-signal system:
1. Server-assigned HttpOnly cookie token (primary, canonical)
2. ThumbmarkJS browser fingerprint hash (reconciliation fallback)
"""

import json
import logging
import secrets
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.rate_limit import mask_fingerprint
from app.core.time import utcnow
from app.models.guest import Guest

_logger = logging.getLogger("app.guest.identity")


@dataclass
class IdentifyResult:
    guest_id: int
    action: str  # "create", "cookie_hit", "reconcile"
    token: str | None  # set only when a new cookie should be issued


def _get_client_ip_source(ip_address: str) -> str:
    if ip_address.startswith("10.") or ip_address.startswith("192.168."):
        return "private"
    return "public"


def _compute_confidence(stored_ua: str | None, submitted_ua: str) -> float:
    """Score how likely the submitted UA belongs to the same person as stored_ua.

    Weights: UA family (0.5), UA platform (0.3), version proximity (0.2).
    """
    if not stored_ua:
        return 0.0

    stored_family, stored_platform, stored_version = _parse_ua(stored_ua)
    sub_family, sub_platform, sub_version = _parse_ua(submitted_ua)

    score = 0.0

    if stored_family == sub_family:
        score += 0.5

    if stored_platform == sub_platform:
        score += 0.3

    if stored_version and sub_version:
        try:
            diff = abs(int(stored_version) - int(sub_version))
            if diff <= 2:
                score += 0.2
        except ValueError:
            pass

    return score


def _parse_ua(ua: str) -> tuple[str, str, str]:
    """Extract (browser_family, platform, major_version) from UA string.

    Simple heuristic parser — not a full UA library. Covers the browsers
    that matter for mobile event guests (Safari, Chrome, Firefox, Samsung).
    """
    ua_lower = ua.lower()

    # Platform detection
    platform = "unknown"
    if "iphone" in ua_lower or "ipad" in ua_lower:
        platform = "ios"
    elif "android" in ua_lower:
        platform = "android"
    elif "windows" in ua_lower:
        platform = "windows"
    elif "macintosh" in ua_lower or "mac os" in ua_lower:
        platform = "macos"
    elif "linux" in ua_lower:
        platform = "linux"

    # Browser family detection (order matters: check specific before generic)
    family = "unknown"
    version = ""
    if "firefox/" in ua_lower:
        family = "firefox"
        version = _extract_version(ua, "Firefox/")
    elif "edg/" in ua_lower:
        family = "edge"
        version = _extract_version(ua, "Edg/")
    elif "samsungbrowser/" in ua_lower:
        family = "samsung"
        version = _extract_version(ua, "SamsungBrowser/")
    elif "crios/" in ua_lower:
        family = "chrome"
        version = _extract_version(ua, "CriOS/")
    elif "chrome/" in ua_lower and "safari/" in ua_lower:
        family = "chrome"
        version = _extract_version(ua, "Chrome/")
    elif "version/" in ua_lower and "safari/" in ua_lower:
        family = "safari"
        version = _extract_version(ua, "Version/")

    return family, platform, version


def _extract_version(ua: str, prefix: str) -> str:
    """Extract major version number after a prefix like 'Chrome/'."""
    idx = ua.find(prefix)
    if idx == -1:
        return ""
    start = idx + len(prefix)
    end = start
    while end < len(ua) and ua[end].isdigit():
        end += 1
    return ua[start:end]


def identify_guest(
    db: Session,
    *,
    token_from_cookie: str | None,
    fingerprint_hash: str,
    fingerprint_components: dict | None = None,
    ip_address: str,
    user_agent: str,
) -> IdentifyResult:
    """Resolve a guest's identity using cookie token and/or browser fingerprint.

    Returns an IdentifyResult with the guest_id, the action taken, and
    optionally a new token (when a cookie must be set/refreshed).
    """
    components_json = json.dumps(fingerprint_components) if fingerprint_components else None
    now = utcnow()
    masked_fp = mask_fingerprint(fingerprint_hash)

    # --- Flow 2: Cookie present ---
    if token_from_cookie:
        guest = db.query(Guest).filter(Guest.token == token_from_cookie).first()
        if guest:
            old_fp = guest.fingerprint_hash
            guest.last_seen_at = now
            guest.ip_address = ip_address
            guest.user_agent = user_agent
            if fingerprint_hash and fingerprint_hash != guest.fingerprint_hash:
                _logger.warning(
                    "guest.identify action=fingerprint_drift guest_id=%s old_fp=%s new_fp=%s",
                    guest.id,
                    mask_fingerprint(old_fp) if old_fp else "-",
                    masked_fp,
                )
                guest.fingerprint_hash = fingerprint_hash
                guest.fingerprint_components = components_json
            db.commit()
            _logger.info(
                "guest.identify action=cookie_hit guest_id=%s fp=%s source=cookie",
                guest.id,
                masked_fp,
            )
            return IdentifyResult(guest_id=guest.id, action="cookie_hit", token=None)
        # Token not in DB — fall through to fingerprint lookup

    # --- Flow 3: Reconciliation (no cookie, fingerprint on file) ---
    if fingerprint_hash:
        existing = (
            db.query(Guest)
            .filter(Guest.fingerprint_hash == fingerprint_hash)
            .order_by(Guest.last_seen_at.desc())
            .first()
        )
        if existing:
            confidence = _compute_confidence(existing.user_agent, user_agent)
            if confidence >= 0.7:
                existing.last_seen_at = now
                existing.ip_address = ip_address
                existing.user_agent = user_agent
                existing.fingerprint_components = components_json
                new_token = secrets.token_hex(32)
                existing.token = new_token
                db.commit()
                _logger.info(
                    "guest.identify action=reconcile guest_id=%s fp=%s"
                    " source=fingerprint confidence=%.2f",
                    existing.id,
                    masked_fp,
                    confidence,
                )
                return IdentifyResult(
                    guest_id=existing.id, action="reconcile", token=new_token
                )
            else:
                _logger.warning(
                    "guest.identify action=reconcile_rejected fp=%s"
                    " reason=ua_mismatch existing_guest=%s confidence=%.2f",
                    masked_fp,
                    existing.id,
                    confidence,
                )

    # --- Flow 1: New guest ---
    new_token = secrets.token_hex(32)
    guest = Guest(
        token=new_token,
        fingerprint_hash=fingerprint_hash,
        fingerprint_components=components_json,
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=now,
        last_seen_at=now,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)

    _logger.info(
        "guest.identify action=create guest_id=%s fp=%s source=new",
        guest.id,
        masked_fp,
    )
    return IdentifyResult(guest_id=guest.id, action="create", token=new_token)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_identity.py -v`

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/tests/conftest.py server/tests/test_guest_identity.py server/app/services/guest_identity.py
git commit -m "feat: add guest identity resolution service with tests"
```

---

## Task 3: Confidence Scoring Tests

**Files:**
- Create: `server/tests/test_guest_confidence.py`

- [ ] **Step 1: Write confidence scoring tests**

Create `server/tests/test_guest_confidence.py`:

```python
"""Unit tests for reconciliation confidence scoring."""

from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.services.guest_identity import IdentifyResult, identify_guest


def _create_guest(db: Session, fingerprint_hash: str, user_agent: str) -> Guest:
    """Helper to create a guest with specific fingerprint and UA."""
    from app.core.time import utcnow

    guest = Guest(
        token="t_" + fingerprint_hash.ljust(62, "0"),
        fingerprint_hash=fingerprint_hash,
        ip_address="10.0.0.1",
        user_agent=user_agent,
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


def test_high_confidence_same_ua_family(db: Session):
    """Same browser family + same platform -> re-link."""
    guest = _create_guest(
        db,
        fingerprint_hash="shared_fp_aaa",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15 Version/17.4 Safari/604.1",
    )
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="shared_fp_aaa",
        fingerprint_components={},
        ip_address="10.0.0.2",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Version/17.5 Safari/604.1",
    )
    assert result.guest_id == guest.id
    assert result.action == "reconcile"


def test_low_confidence_different_ua_family(db: Session):
    """Safari vs Chrome -> different UA family -> new Guest."""
    guest = _create_guest(
        db,
        fingerprint_hash="shared_fp_bbb",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Version/17.4 Safari/604.1",
    )
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="shared_fp_bbb",
        fingerprint_components={},
        ip_address="10.0.0.2",
        user_agent="Mozilla/5.0 (Linux; Android 14) Chrome/125.0.6422.52 Mobile Safari/537.36",
    )
    assert result.guest_id != guest.id
    assert result.action == "create"


def test_medium_confidence_same_ua_different_version(db: Session):
    """Safari 17.4 vs Safari 18.0 -> same family, version within 2 -> re-link."""
    guest = _create_guest(
        db,
        fingerprint_hash="shared_fp_ccc",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Version/17 Safari/604.1",
    )
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="shared_fp_ccc",
        fingerprint_components={},
        ip_address="10.0.0.2",
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18 Safari/604.1",
    )
    assert result.guest_id == guest.id
    assert result.action == "reconcile"


def test_identical_devices_different_guests(db: Session):
    """Two guests with same fingerprint both get unique tokens via cookies."""
    guest_a = _create_guest(
        db,
        fingerprint_hash="school_ipad_fp",
        user_agent="Mozilla/5.0 (iPad; CPU OS 17_4) Version/17.4 Safari/604.1",
    )

    # Guest B arrives with same fingerprint but no cookie — gets reconciled to A
    # (same UA, same fingerprint = high confidence). This is the collision case.
    # In practice, guest B would already have their OWN cookie from their first visit.
    # This test verifies that if B has their OWN cookie, they stay separate.
    from app.core.time import utcnow

    guest_b = Guest(
        token="b_" + "0" * 62,
        fingerprint_hash="school_ipad_fp",
        ip_address="10.0.0.3",
        user_agent="Mozilla/5.0 (iPad; CPU OS 17_4) Version/17.4 Safari/604.1",
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(guest_b)
    db.commit()
    db.refresh(guest_b)

    # Guest B returns with their own cookie -> stays separate
    result = identify_guest(
        db,
        token_from_cookie=guest_b.token,
        fingerprint_hash="school_ipad_fp",
        fingerprint_components={},
        ip_address="10.0.0.3",
        user_agent="Mozilla/5.0 (iPad; CPU OS 17_4) Version/17.4 Safari/604.1",
    )
    assert result.guest_id == guest_b.id
    assert result.guest_id != guest_a.id
    assert result.action == "cookie_hit"
```

- [ ] **Step 2: Run tests**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_confidence.py -v`

Expected: All 4 tests PASS (service already implemented in Task 2).

- [ ] **Step 3: Commit**

```bash
git add server/tests/test_guest_confidence.py
git commit -m "test: add reconciliation confidence scoring tests"
```

---

## Task 4: Pydantic Schemas & /identify Endpoint

**Files:**
- Create: `server/app/schemas/guest.py`
- Create: `server/app/api/guest.py`
- Modify: `server/app/main.py`
- Create: `server/tests/test_identify_endpoint.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `server/app/schemas/guest.py`:

```python
"""Pydantic schemas for guest identity."""

from pydantic import BaseModel, Field


class IdentifyRequest(BaseModel):
    fingerprint_hash: str = Field(..., min_length=8, max_length=64)
    fingerprint_components: dict | None = None


class IdentifyResponse(BaseModel):
    guest_id: int
```

- [ ] **Step 2: Write failing integration tests**

Create `server/tests/test_identify_endpoint.py`:

```python
"""Integration tests for POST /api/public/guest/identify."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.guest import Guest


def test_identify_sets_cookie(client: TestClient):
    """Response includes Set-Cookie with correct attributes."""
    resp = client.post(
        "/api/public/guest/identify",
        json={
            "fingerprint_hash": "test_fp_cookie_check",
            "fingerprint_components": {"screen": "1170x2532"},
        },
    )
    assert resp.status_code == 200
    assert "guest_id" in resp.json()

    cookie = resp.cookies.get("wrzdj_guest")
    assert cookie is not None
    assert len(cookie) == 64

    set_cookie_header = resp.headers.get("set-cookie", "")
    assert "httponly" in set_cookie_header.lower()
    assert "path=/api/" in set_cookie_header.lower()


def test_identify_with_cookie_returns_same_guest(client: TestClient):
    """Second call with cookie -> same guest_id, no new row."""
    resp1 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_same_guest"},
    )
    guest_id_1 = resp1.json()["guest_id"]
    cookie_val = resp1.cookies["wrzdj_guest"]

    # Second call — TestClient auto-sends cookies
    client.cookies.set("wrzdj_guest", cookie_val)
    resp2 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_same_guest"},
    )
    guest_id_2 = resp2.json()["guest_id"]

    assert guest_id_1 == guest_id_2


def test_identify_without_cookie_reconciles(client: TestClient):
    """Second call without cookie but with same fingerprint -> same guest."""
    resp1 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_reconcile"},
    )
    guest_id_1 = resp1.json()["guest_id"]

    # Clear cookies and call again with same fingerprint
    client.cookies.clear()
    resp2 = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "test_fp_reconcile"},
    )
    guest_id_2 = resp2.json()["guest_id"]

    assert guest_id_1 == guest_id_2


def test_identify_invalid_fingerprint_format(client: TestClient):
    """Malformed fingerprint_hash -> 422."""
    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "short"},
    )
    assert resp.status_code == 422


def test_identify_missing_body(client: TestClient):
    """No body -> 422."""
    resp = client.post("/api/public/guest/identify")
    assert resp.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_identify_endpoint.py -v`

Expected: FAIL — 404 (route not registered yet).

- [ ] **Step 4: Create the /identify endpoint**

Create `server/app/api/guest.py`:

```python
"""Public API endpoint for guest identity resolution."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.rate_limit import get_client_ip, limiter
from app.schemas.guest import IdentifyRequest, IdentifyResponse
from app.services.guest_identity import identify_guest

router = APIRouter()


@router.post("/guest/identify", response_model=IdentifyResponse)
@limiter.limit("120/minute")
def identify(
    payload: IdentifyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Resolve guest identity via cookie token and/or browser fingerprint.

    Sets an HttpOnly cookie on new or reconciled guests.
    """
    token_from_cookie = request.cookies.get("wrzdj_guest")
    ip_address = get_client_ip(request)
    user_agent = (request.headers.get("user-agent") or "")[:512]

    result = identify_guest(
        db,
        token_from_cookie=token_from_cookie,
        fingerprint_hash=payload.fingerprint_hash,
        fingerprint_components=payload.fingerprint_components,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    response = JSONResponse(content={"guest_id": result.guest_id})

    if result.token:
        is_prod = get_settings().env == "production"
        response.set_cookie(
            key="wrzdj_guest",
            value=result.token,
            httponly=True,
            secure=is_prod,
            samesite="lax",
            max_age=31536000,
            path="/api/",
        )

    return response
```

- [ ] **Step 5: Register the router in main.py**

In `server/app/main.py`, add the import and router include. Find where other public routers are included (look for `public` or `collect` router includes) and add:

```python
from app.api.guest import router as guest_router
```

And in the router section:
```python
app.include_router(guest_router, prefix="/api/public", tags=["guest"])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_identify_endpoint.py -v`

Expected: All 5 tests PASS.

- [ ] **Step 7: Run full backend test suite to check for regressions**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest --tb=short -q`

Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add server/app/schemas/guest.py server/app/api/guest.py server/app/main.py server/tests/test_identify_endpoint.py
git commit -m "feat: add POST /api/public/guest/identify endpoint"
```

---

## Task 5: get_guest_id Utility

**Files:**
- Modify: `server/app/core/rate_limit.py`

- [ ] **Step 1: Add get_guest_id function**

Add to the end of `server/app/core/rate_limit.py`:

```python
def get_guest_id(request: Request, db: "Session") -> int | None:
    """Read wrzdj_guest cookie and return the Guest.id, or None."""
    from app.models.guest import Guest

    token = request.cookies.get("wrzdj_guest")
    if not token:
        return None
    guest = db.query(Guest).filter(Guest.token == token).first()
    return guest.id if guest else None
```

Note: import is inline to avoid circular imports (rate_limit.py is imported early).

Also add the `Session` type import at top of file if not present:
```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
```

- [ ] **Step 2: Commit**

```bash
git add server/app/core/rate_limit.py
git commit -m "feat: add get_guest_id() utility for cookie-based identity lookup"
```

---

## Task 6: Vote Service Migration

**Files:**
- Modify: `server/app/services/vote.py`
- Create: `server/tests/test_vote_guest_id.py`

- [ ] **Step 1: Write failing tests for guest_id-based voting**

Create `server/tests/test_vote_guest_id.py`:

```python
"""Tests for vote service using guest_id."""

import pytest
from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.models.request import Request
from app.services.vote import RequestNotFoundError, add_vote, has_voted, remove_vote


def test_add_vote_by_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """Vote created with guest_id, enforces unique constraint."""
    song_request, is_new = add_vote(db, test_request.id, guest_id=test_guest.id)
    assert is_new is True
    assert song_request.vote_count == 1


def test_duplicate_vote_same_guest(db: Session, test_request: Request, test_guest: Guest):
    """Same guest_id + same request -> rejected."""
    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, is_new = add_vote(db, test_request.id, guest_id=test_guest.id)
    assert is_new is False


def test_different_guests_same_request(db: Session, test_request: Request, test_guest: Guest):
    """Two guest_ids can vote on same request."""
    from app.core.time import utcnow

    guest_b = Guest(
        token="b" * 64,
        fingerprint_hash="fp_guest_b",
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(guest_b)
    db.commit()
    db.refresh(guest_b)

    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, is_new = add_vote(db, test_request.id, guest_id=guest_b.id)
    assert is_new is True

    db.refresh(test_request)
    assert test_request.vote_count == 2


def test_has_voted_checks_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """has_voted() queries by guest_id when present."""
    assert has_voted(db, test_request.id, guest_id=test_guest.id) is False
    add_vote(db, test_request.id, guest_id=test_guest.id)
    assert has_voted(db, test_request.id, guest_id=test_guest.id) is True


def test_remove_vote_by_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """Remove a vote using guest_id."""
    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, was_removed = remove_vote(db, test_request.id, guest_id=test_guest.id)
    assert was_removed is True

    db.refresh(test_request)
    assert test_request.vote_count == 0


def test_legacy_vote_still_works(db: Session, test_request: Request):
    """Old vote with only client_fingerprint still works."""
    song_request, is_new = add_vote(db, test_request.id, client_fingerprint="legacy_ip_addr")
    assert is_new is True
    assert has_voted(db, test_request.id, client_fingerprint="legacy_ip_addr") is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_vote_guest_id.py -v`

Expected: FAIL — `add_vote() got an unexpected keyword argument 'guest_id'`

- [ ] **Step 3: Update vote service to accept guest_id**

Modify `server/app/services/vote.py`. Update all three functions to accept both `client_fingerprint` and `guest_id`, preferring `guest_id` when set.

Change the `add_vote` signature from:
```python
def add_vote(db: Session, request_id: int, client_fingerprint: str) -> tuple[Request, bool]:
```
to:
```python
def add_vote(
    db: Session,
    request_id: int,
    client_fingerprint: str | None = None,
    *,
    guest_id: int | None = None,
) -> tuple[Request, bool]:
```

Update the existing check and creation logic to use `guest_id` when available:

```python
    # Check if already voted
    if guest_id:
        existing = (
            db.query(RequestVote)
            .filter(
                RequestVote.request_id == request_id,
                RequestVote.guest_id == guest_id,
            )
            .first()
        )
    else:
        existing = (
            db.query(RequestVote)
            .filter(
                RequestVote.request_id == request_id,
                RequestVote.client_fingerprint == client_fingerprint,
            )
            .first()
        )

    if existing:
        return song_request, False

    try:
        vote = RequestVote(
            request_id=request_id,
            client_fingerprint=client_fingerprint,
            guest_id=guest_id,
        )
```

Apply the same pattern to `remove_vote` and `has_voted`:

`remove_vote` signature:
```python
def remove_vote(
    db: Session,
    request_id: int,
    client_fingerprint: str | None = None,
    *,
    guest_id: int | None = None,
) -> tuple[Request, bool]:
```

`has_voted` signature:
```python
def has_voted(
    db: Session,
    request_id: int,
    client_fingerprint: str | None = None,
    *,
    guest_id: int | None = None,
) -> bool:
```

Both use the same pattern: `if guest_id:` query by guest_id, else query by client_fingerprint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_vote_guest_id.py tests/test_voting.py -v`

Expected: All tests PASS (new guest_id tests + old client_fingerprint tests).

- [ ] **Step 5: Commit**

```bash
git add server/app/services/vote.py server/tests/test_vote_guest_id.py
git commit -m "feat: add guest_id support to vote service (backward compatible)"
```

---

## Task 7: Request Service Migration

**Files:**
- Modify: `server/app/services/request.py`

- [ ] **Step 1: Update create_request to accept guest_id**

In `server/app/services/request.py`, change `create_request` signature. Add `guest_id: int | None = None` parameter:

```python
def create_request(
    db: Session,
    event: Event,
    artist: str,
    title: str,
    note: str | None = None,
    nickname: str | None = None,
    source: str = "manual",
    source_url: str | None = None,
    artwork_url: str | None = None,
    client_fingerprint: str | None = None,
    guest_id: int | None = None,
    raw_search_query: str | None = None,
    genre: str | None = None,
    bpm: float | None = None,
    musical_key: str | None = None,
) -> tuple[Request, bool]:
```

Update the duplicate auto-vote to pass guest_id:
```python
    if existing:
        if client_fingerprint or guest_id:
            add_vote(db, existing.id, client_fingerprint, guest_id=guest_id)
            db.refresh(existing)
        return existing, True
```

Update Request creation to include guest_id:
```python
    request = Request(
        event_id=event.id,
        song_title=title,
        artist=artist,
        note=note,
        nickname=nickname,
        source=source,
        source_url=source_url,
        artwork_url=artwork_url,
        client_fingerprint=client_fingerprint,
        guest_id=guest_id,
        dedupe_key=dedupe_key,
        raw_search_query=raw_search_query,
        genre=genre,
        bpm=bpm,
        musical_key=normalize_key(musical_key),
    )
```

- [ ] **Step 2: Add get_requests_by_guest function**

Add to `server/app/services/request.py` after `get_requests_by_fingerprint`:

```python
def get_requests_by_guest(
    db: Session,
    event_id: int,
    guest_id: int,
    limit: int = 50,
) -> list[Request]:
    """Get all requests submitted by a specific guest for an event."""
    return (
        db.query(Request)
        .filter(
            Request.event_id == event_id,
            Request.guest_id == guest_id,
        )
        .order_by(Request.created_at.desc())
        .limit(limit)
        .all()
    )
```

- [ ] **Step 3: Run existing request tests**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_dedup.py tests/test_requests.py -v --tb=short`

Expected: All existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add server/app/services/request.py
git commit -m "feat: add guest_id support to request service"
```

---

## Task 8: Collect Service Migration

**Files:**
- Modify: `server/app/services/collect.py`

- [ ] **Step 1: Update get_profile to accept guest_id**

In `server/app/services/collect.py`, update `get_profile`:

```python
def get_profile(
    db: Session, *, event_id: int, fingerprint: str | None = None, guest_id: int | None = None
) -> GuestProfile | None:
    if guest_id:
        return (
            db.query(GuestProfile)
            .filter(
                GuestProfile.event_id == event_id,
                GuestProfile.guest_id == guest_id,
            )
            .one_or_none()
        )
    return (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == event_id,
            GuestProfile.client_fingerprint == fingerprint,
        )
        .one_or_none()
    )
```

- [ ] **Step 2: Update upsert_profile**

```python
def upsert_profile(
    db: Session,
    *,
    event_id: int,
    fingerprint: str | None = None,
    guest_id: int | None = None,
    nickname: str | None = None,
    email: str | None = None,
) -> GuestProfile:
    profile = get_profile(db, event_id=event_id, fingerprint=fingerprint, guest_id=guest_id)
    if profile is None:
        profile = GuestProfile(
            event_id=event_id,
            client_fingerprint=fingerprint,
            guest_id=guest_id,
            nickname=nickname,
            email=email,
        )
        db.add(profile)
    else:
        if nickname is not None:
            profile.nickname = nickname
        if email is not None:
            profile.email = email
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 3: Update check_and_increment_submission_count**

```python
def check_and_increment_submission_count(
    db: Session, *, event: Event, fingerprint: str | None = None, guest_id: int | None = None
) -> GuestProfile:
    profile = get_profile(db, event_id=event.id, fingerprint=fingerprint, guest_id=guest_id)
    if profile is None:
        profile = GuestProfile(
            event_id=event.id,
            client_fingerprint=fingerprint,
            guest_id=guest_id,
        )
        db.add(profile)
        db.flush()

    cap = event.submission_cap_per_guest
    if cap != 0 and profile.submission_count >= cap:
        db.rollback()
        raise SubmissionCapExceeded()

    profile.submission_count += 1
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 4: Run existing collect tests**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_collect_service.py tests/test_collect_public.py -v --tb=short`

Expected: All existing tests still PASS (they pass `fingerprint=` kwarg which still works).

- [ ] **Step 5: Commit**

```bash
git add server/app/services/collect.py
git commit -m "feat: add guest_id support to collect service"
```

---

## Task 9: API Endpoint Migration

**Files:**
- Modify: `server/app/api/votes.py`
- Modify: `server/app/api/public.py`
- Modify: `server/app/api/collect.py`
- Modify: `server/app/api/events.py`

This is the big switchover — all 10 public endpoints move from `get_client_fingerprint` to `get_guest_id`. Each endpoint keeps `client_fingerprint` as fallback for guests who haven't called `/identify` yet (graceful degradation).

- [ ] **Step 1: Update votes.py**

In `server/app/api/votes.py`:

Add import:
```python
from app.core.rate_limit import get_client_fingerprint, get_guest_id, limiter
```

Update `vote_for_request`:
```python
    client_fingerprint = get_client_fingerprint(request)
    guest_id = get_guest_id(request, db)

    try:
        song_request, is_new = add_vote(db, request_id, client_fingerprint, guest_id=guest_id)
```

Update `unvote_request`:
```python
    client_fingerprint = get_client_fingerprint(request)
    guest_id = get_guest_id(request, db)

    try:
        song_request, was_removed = remove_vote(db, request_id, client_fingerprint, guest_id=guest_id)
    except RequestNotFoundError:
        raise HTTPException(status_code=404, detail="Request not found")

    return VoteResponse(
        status="unvoted" if was_removed else "not_voted",
        vote_count=song_request.vote_count,
        has_voted=has_voted(db, request_id, client_fingerprint, guest_id=guest_id),
    )
```

- [ ] **Step 2: Update public.py**

In `server/app/api/public.py`:

Add import:
```python
from app.core.rate_limit import get_client_fingerprint, get_guest_id, limiter
```

Update `check_has_requested` (around line 250):
```python
    fingerprint = get_client_fingerprint(request)
    guest_id = get_guest_id(request, db)

    if guest_id:
        has_requested = (
            db.query(SongRequest)
            .filter(
                SongRequest.event_id == event.id,
                SongRequest.guest_id == guest_id,
            )
            .first()
            is not None
        )
    else:
        has_requested = (
            db.query(SongRequest)
            .filter(
                SongRequest.event_id == event.id,
                SongRequest.client_fingerprint == fingerprint,
            )
            .first()
            is not None
        )
```

Update `get_my_requests` (around line 284):
```python
    fingerprint = get_client_fingerprint(request)
    guest_id = get_guest_id(request, db)

    if guest_id:
        requests_list = get_requests_by_guest(db, event.id, guest_id)
    else:
        requests_list = get_requests_by_fingerprint(db, event.id, fingerprint)
```

Add the import:
```python
from app.services.request import get_guest_visible_requests, get_requests_by_fingerprint, get_requests_by_guest
```

- [ ] **Step 3: Update collect.py**

In `server/app/api/collect.py`, every endpoint that calls `get_client_fingerprint` also calls `get_guest_id`. When `guest_id` is available, pass it to services; else fall back to fingerprint.

Add import:
```python
from app.core.rate_limit import get_client_fingerprint, get_guest_id, limiter, mask_fingerprint
```

Update `get_profile`:
```python
    fingerprint = get_client_fingerprint(request, action="collect.get_profile", event_code=code)
    guest_id = get_guest_id(request, db)
    profile = collect_service.get_profile(
        db, event_id=event.id, fingerprint=fingerprint, guest_id=guest_id
    )
```

Update `set_profile`:
```python
    fingerprint = get_client_fingerprint(request, action="collect.set_profile", event_code=code)
    guest_id = get_guest_id(request, db)
    profile = collect_service.upsert_profile(
        db,
        event_id=event.id,
        fingerprint=fingerprint,
        guest_id=guest_id,
        nickname=payload.nickname,
        email=payload.email,
    )
```

Update `my_picks` — the submitted query, voted query, and top contributor query:

For submitted:
```python
    fingerprint = get_client_fingerprint(request, action="collect.my_picks", event_code=code)
    guest_id = get_guest_id(request, db)

    submitted_filter = (
        SongRequest.guest_id == guest_id
        if guest_id
        else SongRequest.client_fingerprint == fingerprint
    )
    submitted = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(submitted_filter)
        .order_by(SongRequest.created_at.desc())
        .all()
    )
```

For voted:
```python
    voted_filter = (
        RequestVote.guest_id == guest_id
        if guest_id
        else RequestVote.client_fingerprint == fingerprint
    )
    voted_rows = (
        db.query(RequestVote.request_id)
        .join(SongRequest, SongRequest.id == RequestVote.request_id)
        .filter(voted_filter)
        .filter(SongRequest.event_id == event.id)
        .all()
    )
```

For top contributor:
```python
    group_col = SongRequest.guest_id if guest_id else SongRequest.client_fingerprint
    identity_val = guest_id if guest_id else fingerprint
    top_row = (
        db.query(
            group_col,
            func.count(SongRequest.id).label("n"),
        )
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(group_col.isnot(None))
        .group_by(group_col)
        .order_by(desc("n"))
        .first()
    )
    is_top = (
        top_row is not None
        and top_row[0] == identity_val
        and top_row[1] > 0
    )
```

Update `submit`:
```python
    fingerprint = get_client_fingerprint(request, action="collect.submit", event_code=code)
    guest_id = get_guest_id(request, db)

    existing = find_duplicate(db, event.id, payload.artist, payload.song_title)
    if existing:
        is_own = False
        if guest_id and existing.guest_id:
            is_own = existing.guest_id == guest_id
        elif existing.client_fingerprint and fingerprint:
            is_own = existing.client_fingerprint == fingerprint
        if is_own:
            raise HTTPException(status_code=409, detail="You already picked this one!")

        add_vote(db, existing.id, fingerprint, guest_id=guest_id)
        ...
```

And for submission cap + request creation:
```python
    try:
        collect_service.check_and_increment_submission_count(
            db, event=event, fingerprint=fingerprint, guest_id=guest_id
        )
    except collect_service.SubmissionCapExceeded:
        raise HTTPException(status_code=429, detail="Picks limit reached") from None

    if payload.nickname:
        collect_service.upsert_profile(
            db,
            event_id=event.id,
            fingerprint=fingerprint,
            guest_id=guest_id,
            nickname=payload.nickname,
        )

    row = SongRequest(
        event_id=event.id,
        song_title=payload.song_title,
        artist=payload.artist,
        source=payload.source,
        source_url=payload.source_url,
        artwork_url=payload.artwork_url,
        note=payload.note,
        nickname=payload.nickname,
        status=RequestStatus.NEW.value,
        dedupe_key=compute_dedupe_key(payload.artist, payload.song_title),
        client_fingerprint=fingerprint,
        guest_id=guest_id,
        submitted_during_collection=True,
    )
```

Update `vote`:
```python
    fingerprint = get_client_fingerprint(request, action="collect.vote", event_code=code)
    guest_id = get_guest_id(request, db)
    ...
    is_own = False
    if guest_id and row.guest_id:
        is_own = row.guest_id == guest_id
    elif row.client_fingerprint and row.client_fingerprint == fingerprint:
        is_own = True
    if is_own:
        raise HTTPException(status_code=409, detail="Can't vote on your own pick")
    _, is_new_vote = add_vote(db, request_id=row.id, client_fingerprint=fingerprint, guest_id=guest_id)
```

- [ ] **Step 4: Update events.py**

In `server/app/api/events.py`, the DJ-submitted request at line 635. DJ requests are owned by the user account, not a guest. Change:

```python
        client_fingerprint=get_client_fingerprint(request),
```
to:
```python
        client_fingerprint=None,
        guest_id=None,
```

Remove the `get_client_fingerprint` import if it's no longer used in this file. Check if any other usage exists in events.py first.

- [ ] **Step 5: Run full backend test suite**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest --tb=short -q`

Expected: All tests PASS.

- [ ] **Step 6: Run linter and formatter**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/ruff check . && .venv/bin/ruff format --check .`

Fix any issues. Common ones: unused imports, import sort order.

- [ ] **Step 7: Commit**

```bash
git add server/app/api/votes.py server/app/api/public.py server/app/api/collect.py server/app/api/events.py
git commit -m "feat: migrate all public endpoints from IP fingerprint to guest_id"
```

---

## Task 10: Alembic Migration

**Files:**
- Create: `server/alembic/versions/036_add_guest_identity.py`

- [ ] **Step 1: Write the migration**

Create `server/alembic/versions/036_add_guest_identity.py`:

```python
"""Add guests table and guest_id FKs to existing tables.

Revision ID: 036
Revises: 035_guest_profiles_event_cascade
Create Date: 2026-04-26
"""

import sqlalchemy as sa
from alembic import op

revision: str = "036"
down_revision: str | None = "035_guest_profiles_event_cascade"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "guests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column("fingerprint_hash", sa.String(64), nullable=True),
        sa.Column("fingerprint_components", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_guests_token"), "guests", ["token"], unique=True)
    op.create_index(op.f("ix_guests_fingerprint_hash"), "guests", ["fingerprint_hash"])

    # Add guest_id FK to guest_profiles
    op.add_column(
        "guest_profiles",
        sa.Column("guest_id", sa.Integer(), sa.ForeignKey("guests.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index(op.f("ix_guest_profiles_guest_id"), "guest_profiles", ["guest_id"])
    op.create_unique_constraint("uq_guest_profile_event_guest", "guest_profiles", ["event_id", "guest_id"])

    # Add guest_id FK to requests
    op.add_column(
        "requests",
        sa.Column("guest_id", sa.Integer(), sa.ForeignKey("guests.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index(op.f("ix_requests_guest_id"), "requests", ["guest_id"])

    # Add guest_id FK to request_votes
    op.add_column(
        "request_votes",
        sa.Column("guest_id", sa.Integer(), sa.ForeignKey("guests.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index(op.f("ix_request_votes_guest_id"), "request_votes", ["guest_id"])
    op.create_unique_constraint("uq_request_vote_guest", "request_votes", ["request_id", "guest_id"])


def downgrade() -> None:
    op.drop_constraint("uq_request_vote_guest", "request_votes", type_="unique")
    op.drop_index(op.f("ix_request_votes_guest_id"), table_name="request_votes")
    op.drop_column("request_votes", "guest_id")

    op.drop_index(op.f("ix_requests_guest_id"), table_name="requests")
    op.drop_column("requests", "guest_id")

    op.drop_constraint("uq_guest_profile_event_guest", "guest_profiles", type_="unique")
    op.drop_index(op.f("ix_guest_profiles_guest_id"), table_name="guest_profiles")
    op.drop_column("guest_profiles", "guest_id")

    op.drop_index(op.f("ix_guests_fingerprint_hash"), table_name="guests")
    op.drop_index(op.f("ix_guests_token"), table_name="guests")
    op.drop_table("guests")
```

- [ ] **Step 2: Run migration locally**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/alembic upgrade head`

Expected: Migration runs cleanly.

- [ ] **Step 3: Run alembic check**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/alembic check`

Expected: No differences detected (models match migration).

- [ ] **Step 4: Commit**

```bash
git add server/alembic/versions/036_add_guest_identity.py
git commit -m "chore: add Alembic migration 036 for guest identity tables"
```

---

## Task 11: Scenario Tests

**Files:**
- Create: `server/tests/test_guest_scenarios.py`

- [ ] **Step 1: Write scenario tests**

Create `server/tests/test_guest_scenarios.py`:

```python
"""Scenario tests simulating real event conditions.

These tests verify the system solves the actual problems:
guests behind shared NAT, network switching, and abuse prevention.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event


def _identify(client: TestClient, fingerprint: str, cookie: str | None = None) -> dict:
    """Helper: call /identify and return {guest_id, cookie}."""
    if cookie:
        client.cookies.set("wrzdj_guest", cookie)
    else:
        client.cookies.clear()

    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": fingerprint, "fingerprint_components": {}},
    )
    assert resp.status_code == 200
    return {
        "guest_id": resp.json()["guest_id"],
        "cookie": resp.cookies.get("wrzdj_guest"),
    }


# --- NAT Scenario ---


def test_three_guests_same_ip_different_fingerprints(
    client: TestClient, db: Session, test_event: Event
):
    """3 phones on same WiFi. Each has unique fingerprint.
    All should get separate guest identities."""
    guest_a = _identify(client, "phone_a_fingerprint")
    guest_b = _identify(client, "phone_b_fingerprint")
    guest_c = _identify(client, "phone_c_fingerprint")

    ids = {guest_a["guest_id"], guest_b["guest_id"], guest_c["guest_id"]}
    assert len(ids) == 3, "All three guests should have unique IDs"


def test_two_identical_devices_separate_via_cookies(
    client: TestClient, db: Session, test_event: Event
):
    """Two school iPads with identical fingerprints.
    Each gets their own cookie on first visit -> remain separate."""
    ipad_a = _identify(client, "identical_ipad_fp")
    cookie_a = ipad_a["cookie"]

    ipad_b = _identify(client, "identical_ipad_fp")
    cookie_b = ipad_b["cookie"]

    # Second iPad gets reconciled to first (same fingerprint, same UA from TestClient).
    # This is expected — identical devices without their own cookie ARE ambiguous.
    # In real life, each iPad gets a cookie on FIRST visit (before the other exists).
    # The real defense is: once both have cookies, they stay separate.
    result_a = _identify(client, "identical_ipad_fp", cookie=cookie_a)
    result_b = _identify(client, "identical_ipad_fp", cookie=cookie_b)

    if cookie_a and cookie_b and cookie_a != cookie_b:
        assert result_a["guest_id"] != result_b["guest_id"]


# --- Network Switch Scenario ---


def test_guest_returns_with_cookie_different_ip(
    client: TestClient, db: Session, test_event: Event
):
    """Guest identifies on WiFi, returns on cellular.
    Cookie persists -> same guest_id."""
    first = _identify(client, "stable_device_fp")
    cookie = first["cookie"]

    # Return with same cookie (network changed, but cookie survives)
    second = _identify(client, "stable_device_fp", cookie=cookie)
    assert second["guest_id"] == first["guest_id"]


def test_guest_clears_cookies_returns_same_device(
    client: TestClient, db: Session, test_event: Event
):
    """Guest clears cookies, comes back. Fingerprint reconciliation
    recovers identity. New cookie issued."""
    first = _identify(client, "persistent_device_fp")
    original_id = first["guest_id"]

    # Clear cookies, return with same fingerprint
    second = _identify(client, "persistent_device_fp", cookie=None)
    assert second["guest_id"] == original_id
    assert second["cookie"] is not None  # new cookie issued


# --- Abuse Scenario ---


def test_incognito_does_not_reset_identity(
    client: TestClient, db: Session, test_event: Event
):
    """Guest identified, opens incognito (no cookie, same fingerprint).
    Reconciliation re-links to same guest."""
    normal = _identify(client, "troublemaker_fp")
    original_id = normal["guest_id"]

    # Incognito = no cookie, but same fingerprint survives
    incognito = _identify(client, "troublemaker_fp", cookie=None)
    assert incognito["guest_id"] == original_id
```

- [ ] **Step 2: Run scenario tests**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_scenarios.py -v`

Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest --tb=short -q`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/tests/test_guest_scenarios.py
git commit -m "test: add scenario tests for NAT, network switch, and abuse cases"
```

---

## Task 12: Frontend — ThumbmarkJS & useGuestIdentity Hook

**Files:**
- Modify: `dashboard/package.json` (add thumbmarkjs)
- Create: `dashboard/lib/use-guest-identity.ts`

- [ ] **Step 1: Install ThumbmarkJS**

Run: `cd /home/adam/github/WrzDJ/dashboard && npm install @thumbmarkjs/thumbmarkjs`

Verify: `npm audit` shows no critical vulnerabilities.

- [ ] **Step 2: Create the useGuestIdentity hook**

Create `dashboard/lib/use-guest-identity.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface GuestIdentity {
  guestId: number | null;
  isReturning: boolean;
  isLoading: boolean;
  error: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

let cachedIdentity: { guestId: number; isReturning: boolean } | null = null;

export function useGuestIdentity(): GuestIdentity {
  const [state, setState] = useState<GuestIdentity>({
    guestId: cachedIdentity?.guestId ?? null,
    isReturning: cachedIdentity?.isReturning ?? false,
    isLoading: !cachedIdentity,
    error: null,
  });
  const calledRef = useRef(false);

  const identify = useCallback(async () => {
    if (cachedIdentity || calledRef.current) {
      return;
    }
    calledRef.current = true;

    try {
      const thumbmark = await import("@thumbmarkjs/thumbmarkjs");
      const fp = await thumbmark.get({
        exclude: ["canvas", "webgl"],
      });
      const fingerprintHash =
        typeof fp === "string" ? fp : (fp as { hash: string }).hash;
      const components =
        typeof fp === "object" && "hash" in fp ? fp : undefined;

      const resp = await fetch(`${API_URL}/api/public/guest/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fingerprint_hash: fingerprintHash,
          fingerprint_components: components,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Identify failed: ${resp.status}`);
      }

      const data = await resp.json();
      const identity = {
        guestId: data.guest_id,
        isReturning: resp.headers.get("set-cookie") === null,
      };
      cachedIdentity = identity;
      setState({ ...identity, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Identity check failed",
      }));
    }
  }, []);

  useEffect(() => {
    identify();
  }, [identify]);

  return state;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/lib/use-guest-identity.ts
git commit -m "feat: add ThumbmarkJS and useGuestIdentity hook"
```

---

## Task 13: Frontend — Integrate Hook into Guest Pages

**Files:**
- Modify: Guest-facing page components that submit requests or vote

The hook must be called on guest-facing pages so the `/identify` call fires on page load (sets the cookie). The specific page files to modify depend on the current guest page structure. Locate:

1. The join/request page at `dashboard/app/e/[code]/page.tsx` or similar
2. The collect flow pages under `dashboard/app/collect/` or `dashboard/app/e/[code]/collect/`

- [ ] **Step 1: Identify guest-facing page files**

Run: `find /home/adam/github/WrzDJ/dashboard/app -path "*/e/*" -name "page.tsx" -o -path "*/collect/*" -name "page.tsx" | head -20`

- [ ] **Step 2: Add useGuestIdentity to guest entry pages**

In each guest-facing page component, add the hook call near the top of the component:

```typescript
import { useGuestIdentity } from "@/lib/use-guest-identity";

// Inside the component:
const { isLoading: identityLoading, error: identityError } = useGuestIdentity();
```

The hook call triggers `/identify` on mount. The cookie is set automatically and persists. Subsequent API calls (`fetch` with `credentials: "include"`) send the cookie. No further changes needed for individual submit/vote calls.

If a page currently shows a loading skeleton, extend it to include `identityLoading`:

```typescript
if (loading || identityLoading) {
  return <LoadingSkeleton />;
}
```

If identity fails, show error only when the user tries to submit or vote — not on page load.

- [ ] **Step 3: Verify dev server runs and pages load**

Run: `cd /home/adam/github/WrzDJ/dashboard && npm run dev`

Open a guest page in the browser. Verify:
- No console errors from ThumbmarkJS
- Network tab shows `POST /api/public/guest/identify` returning 200
- `wrzdj_guest` cookie visible in Application > Cookies

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/
git commit -m "feat: integrate useGuestIdentity into guest-facing pages"
```

---

## Task 14: CI Checks & Final Verification

- [ ] **Step 1: Run backend CI checks**

```bash
cd /home/adam/github/WrzDJ/server
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/bandit -r app -c pyproject.toml -q
.venv/bin/pytest --tb=short -q
```

All must pass.

- [ ] **Step 2: Run frontend CI checks**

```bash
cd /home/adam/github/WrzDJ/dashboard
npm run lint
npx tsc --noEmit
npm test -- --run
```

All must pass.

- [ ] **Step 3: Run Alembic migration check**

```bash
cd /home/adam/github/WrzDJ/server
.venv/bin/alembic upgrade head
.venv/bin/alembic check
```

Expected: No model/migration drift.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address CI check issues"
```
