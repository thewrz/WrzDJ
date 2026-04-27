# Email Verification & Cross-Device Guest Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable cross-device guest identity via email verification with auto-merge, using Dreamhost SMTP for 6-digit code delivery.

**Architecture:** New `verified_email` + `email_hash` columns on `Guest`, new `email_verification_codes` table, SMTP email service, merge service for consolidating Guest records when same email verified on multiple devices. `GuestProfile.email` column removed. Frontend `FeatureOptInPanel` redesigned with inline verification flow.

**Tech Stack:** Python/FastAPI, SQLAlchemy 2.0 + Alembic, smtplib (SMTP_SSL), React hooks, pytest

**Spec:** `docs/superpowers/specs/2026-04-27-email-verification-cross-device-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/app/models/email_verification_code.py` | `EmailVerificationCode` SQLAlchemy model |
| `server/app/services/email_sender.py` | SMTP email sending (Dreamhost) |
| `server/app/services/email_verification.py` | Verification logic: create code, confirm code, rate limits |
| `server/app/services/guest_merge.py` | Merge two Guest records (requests, votes, profiles) |
| `server/app/api/verify.py` | `/verify/request` and `/verify/confirm` endpoints |
| `server/app/schemas/verify.py` | Pydantic schemas for verification endpoints |
| `server/alembic/versions/037_email_verification.py` | Migration: add columns, create table, drop GuestProfile.email |
| `server/tests/test_email_verification.py` | Unit tests for verification service |
| `server/tests/test_guest_merge.py` | Unit tests for merge mechanics |
| `server/tests/test_smtp_service.py` | Unit tests for SMTP sending (mocked) |
| `server/tests/test_verify_endpoints.py` | Integration tests for verify endpoints |
| `server/tests/test_cross_device_scenario.py` | Scenario tests for cross-device merge |
| `dashboard/app/collect/[code]/components/EmailVerification.tsx` | Inline verification UI component (3 states) |

### Modified Files

| File | Change |
|------|--------|
| `server/app/models/guest.py` | Add `verified_email`, `email_hash`, `email_verified_at`, `nickname` columns |
| `server/app/models/guest_profile.py` | Remove `email` column |
| `server/app/models/__init__.py` | Add `EmailVerificationCode` import |
| `server/app/core/config.py` | Add SMTP settings |
| `server/app/api/__init__.py` | Register verify router |
| `server/app/schemas/collect.py` | Remove `email` from `CollectProfileRequest`, `has_email` from `CollectProfileResponse` |
| `server/app/api/collect.py` | Remove email handling from profile endpoints |
| `server/tests/conftest.py` | Update test_guest fixture (if needed) |
| `dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx` | Replace email input with EmailVerification component |
| `dashboard/app/collect/[code]/page.tsx` | Wire up verification state |
| `dashboard/app/join/[code]/page.tsx` | Add verification CTA after first submission |
| `dashboard/lib/api.ts` | Add verification API methods |

---

## Task 1: Guest Model — Add Email Columns

**Files:**
- Modify: `server/app/models/guest.py`

- [ ] **Step 1: Add verified_email, email_hash, email_verified_at, nickname columns**

```python
# server/app/models/guest.py
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.encryption import EncryptedText
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
    verified_email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    email_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
```

- [ ] **Step 2: Verify model loads**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/python -c "from app.models.guest import Guest; print([c.name for c in Guest.__table__.columns])"`

Expected: list includes `verified_email`, `email_hash`, `email_verified_at`, `nickname`

- [ ] **Step 3: Commit**

```bash
git add server/app/models/guest.py
git commit -m "feat: add email verification columns to Guest model"
```

---

## Task 2: EmailVerificationCode Model

**Files:**
- Create: `server/app/models/email_verification_code.py`
- Modify: `server/app/models/__init__.py`

- [ ] **Step 1: Create the model**

```python
# server/app/models/email_verification_code.py
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class EmailVerificationCode(Base):
    __tablename__ = "email_verification_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    guest_id: Mapped[int] = mapped_column(
        ForeignKey("guests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
```

- [ ] **Step 2: Register in models/__init__.py**

Add import and `__all__` entry:

```python
from app.models.email_verification_code import EmailVerificationCode
```

Add `"EmailVerificationCode"` to `__all__` (alphabetically, after `"Event"`).

- [ ] **Step 3: Verify model loads**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/python -c "from app.models import EmailVerificationCode; print(EmailVerificationCode.__tablename__)"`

Expected: `email_verification_codes`

- [ ] **Step 4: Commit**

```bash
git add server/app/models/email_verification_code.py server/app/models/__init__.py
git commit -m "feat: add EmailVerificationCode model"
```

---

## Task 3: Remove GuestProfile.email Column

**Files:**
- Modify: `server/app/models/guest_profile.py`
- Modify: `server/app/schemas/collect.py`
- Modify: `server/app/api/collect.py`
- Modify: `server/app/services/collect.py`

- [ ] **Step 1: Remove email from GuestProfile model**

In `server/app/models/guest_profile.py`, remove:
```python
    email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
```

Also remove the `EncryptedText` import:
```python
from app.core.encryption import EncryptedText
```

- [ ] **Step 2: Remove email from CollectProfileRequest schema**

In `server/app/schemas/collect.py`, change:
```python
class CollectProfileRequest(BaseModel):
    nickname: Nickname | None = None
    email: EmailStr | None = None
```
to:
```python
class CollectProfileRequest(BaseModel):
    nickname: Nickname | None = None
```

Remove `EmailStr` from the pydantic import if no longer used elsewhere in the file.

- [ ] **Step 3: Update CollectProfileResponse schema**

In `server/app/schemas/collect.py`, change:
```python
class CollectProfileResponse(BaseModel):
    nickname: str | None
    has_email: bool
    submission_count: int
    submission_cap: int
```
to:
```python
class CollectProfileResponse(BaseModel):
    nickname: str | None
    email_verified: bool
    submission_count: int
    submission_cap: int
```

- [ ] **Step 4: Update collect API — get_profile endpoint**

In `server/app/api/collect.py`, update the `get_profile` function. Change all references to `has_email` in the profile responses.

For the no-profile case:
```python
    if profile is None:
        return CollectProfileResponse(
            nickname=None,
            email_verified=False,
            submission_count=0,
            submission_cap=event.submission_cap_per_guest,
        )
```

For the has-profile case, need to check `Guest.email_verified_at`:
```python
    from app.models.guest import Guest

    is_verified = False
    if guest_id:
        guest = db.query(Guest).filter(Guest.id == guest_id).first()
        is_verified = guest is not None and guest.email_verified_at is not None

    return CollectProfileResponse(
        nickname=profile.nickname,
        email_verified=is_verified,
        submission_count=profile.submission_count,
        submission_cap=event.submission_cap_per_guest,
    )
```

- [ ] **Step 5: Update collect API — set_profile endpoint**

In `server/app/api/collect.py`, remove `email=payload.email` from the `upsert_profile` call and remove the email-related activity log parts.

Change:
```python
    profile = collect_service.upsert_profile(
        db,
        event_id=event.id,
        fingerprint=fingerprint,
        guest_id=guest_id,
        nickname=payload.nickname,
        email=payload.email,
    )
```
to:
```python
    profile = collect_service.upsert_profile(
        db,
        event_id=event.id,
        fingerprint=fingerprint,
        guest_id=guest_id,
        nickname=payload.nickname,
    )
```

Remove the email part from the activity log `_parts` list. Remove the `email_verified` response field logic — just return `email_verified=False` (or check Guest like in get_profile).

- [ ] **Step 6: Update collect service — remove email from upsert_profile**

In `server/app/services/collect.py`, remove the `email` parameter from `upsert_profile`:

```python
def upsert_profile(
    db: Session,
    *,
    event_id: int,
    fingerprint: str | None = None,
    guest_id: int | None = None,
    nickname: str | None = None,
) -> GuestProfile:
    profile = get_profile(db, event_id=event_id, fingerprint=fingerprint, guest_id=guest_id)
    if profile is None:
        profile = GuestProfile(
            event_id=event_id,
            client_fingerprint=fingerprint,
            guest_id=guest_id,
            nickname=nickname,
        )
        db.add(profile)
    else:
        if nickname is not None:
            profile.nickname = nickname
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 7: Run existing tests to check for breakage**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_collect_service.py tests/test_collect_public.py tests/test_guest_profile.py -v --tb=short -q 2>&1 | tail -10`

Fix any failures related to the removed email field (test fixtures may reference it).

- [ ] **Step 8: Commit**

```bash
git add server/app/models/guest_profile.py server/app/schemas/collect.py server/app/api/collect.py server/app/services/collect.py
git commit -m "feat: remove unverified email from GuestProfile"
```

---

## Task 4: SMTP Configuration & Email Service

**Files:**
- Modify: `server/app/core/config.py`
- Create: `server/app/services/email_sender.py`
- Create: `server/tests/test_smtp_service.py`

- [ ] **Step 1: Add SMTP settings to config**

In `server/app/core/config.py`, add to the `Settings` class (after the existing `uploads_dir` settings):

```python
    # SMTP (email verification)
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
```

- [ ] **Step 2: Write failing tests for email sender**

Create `server/tests/test_smtp_service.py`:

```python
"""Tests for SMTP email sending service."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.email_sender import EmailNotConfiguredError, send_verification_email


def test_send_verification_email():
    """SMTP called with correct from/to/subject/body."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            smtp_host="mail.example.com",
            smtp_port=465,
            smtp_username="noreply@example.com",
            smtp_password="secret",
            smtp_from_address="noreply@example.com",
        )
        with patch("app.services.email_sender.smtplib.SMTP_SSL") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_verification_email("fan@gmail.com", "847293")

            instance.login.assert_called_once_with("noreply@example.com", "secret")
            instance.send_message.assert_called_once()
            msg = instance.send_message.call_args[0][0]
            assert msg["To"] == "fan@gmail.com"
            assert msg["From"] == "noreply@example.com"
            assert "847293" in msg.get_payload()
            assert "15 minutes" in msg.get_payload()


def test_smtp_not_configured_raises():
    """Empty smtp_host -> clear error."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(smtp_host="", smtp_port=465)
        with pytest.raises(EmailNotConfiguredError):
            send_verification_email("fan@gmail.com", "123456")


def test_email_content_no_pii_leak():
    """Body contains code and expiry, no other personal data."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            smtp_host="mail.example.com",
            smtp_port=465,
            smtp_username="noreply@example.com",
            smtp_password="secret",
            smtp_from_address="noreply@example.com",
        )
        with patch("app.services.email_sender.smtplib.SMTP_SSL") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_verification_email("fan@gmail.com", "999888")

            msg = instance.send_message.call_args[0][0]
            body = msg.get_payload()
            assert "999888" in body
            assert "fan@gmail.com" not in body
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_smtp_service.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.email_sender'`

- [ ] **Step 4: Implement email sender**

Create `server/app/services/email_sender.py`:

```python
"""SMTP email sending for verification codes."""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

_logger = logging.getLogger("app.email")


class EmailNotConfiguredError(Exception):
    """Raised when SMTP settings are missing."""


def send_verification_email(to_address: str, code: str) -> None:
    """Send a 6-digit verification code via SMTP."""
    settings = get_settings()

    if not settings.smtp_host:
        raise EmailNotConfiguredError("SMTP is not configured (smtp_host is empty)")

    msg = EmailMessage()
    msg["Subject"] = "Your WrzDJ verification code"
    msg["From"] = f"WrzDJ <{settings.smtp_from_address}>"
    msg["To"] = to_address
    msg.set_content(
        f"Your verification code is: {code}\n\n"
        f"Enter this code on the WrzDJ page. It expires in 15 minutes.\n\n"
        f"If you didn't request this, you can safely ignore this email.\n"
    )

    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as smtp:
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)

    _logger.info("email.sent to_hash=%s", to_address[:3] + "***")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_smtp_service.py -v`

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app/core/config.py server/app/services/email_sender.py server/tests/test_smtp_service.py
git commit -m "feat: add SMTP email sender for verification codes"
```

---

## Task 5: Email Verification Service

**Files:**
- Create: `server/app/services/email_verification.py`
- Create: `server/tests/test_email_verification.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_email_verification.py`:

```python
"""Unit tests for email verification service."""

import hashlib
from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.email_verification_code import EmailVerificationCode
from app.models.guest import Guest
from app.services.email_verification import (
    CodeExpiredError,
    CodeInvalidError,
    RateLimitExceededError,
    confirm_verification_code,
    create_verification_code,
)


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.lower().encode()).hexdigest()


def test_create_verification_code(db: Session, test_guest: Guest):
    """6-digit code generated, stored with correct expiry."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")

    assert len(code_row.code) == 6
    assert code_row.code.isdigit()
    assert int(code_row.code) >= 100000
    assert code_row.email_hash == _email_hash("fan@test.com")
    assert code_row.expires_at > utcnow()
    assert code_row.used is False
    assert code_row.attempts == 0


def test_verify_correct_code(db: Session, test_guest: Guest):
    """Accepted, marked used, email set on Guest."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")

    result = confirm_verification_code(
        db, guest_id=test_guest.id, email="fan@test.com", code=code_row.code
    )
    assert result.verified is True
    assert result.merged is False

    db.refresh(test_guest)
    assert test_guest.email_hash == _email_hash("fan@test.com")
    assert test_guest.email_verified_at is not None


def test_verify_wrong_code_increments_attempts(db: Session, test_guest: Guest):
    """Wrong code -> attempts +1."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")

    with pytest.raises(CodeInvalidError):
        confirm_verification_code(
            db, guest_id=test_guest.id, email="fan@test.com", code="000000"
        )

    db.refresh(code_row)
    assert code_row.attempts == 1


def test_verify_three_strikes_invalidates(db: Session, test_guest: Guest):
    """3 wrong attempts -> code no longer accepted."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")
    real_code = code_row.code

    for _ in range(3):
        with pytest.raises(CodeInvalidError):
            confirm_verification_code(
                db, guest_id=test_guest.id, email="fan@test.com", code="000000"
            )

    with pytest.raises(CodeInvalidError):
        confirm_verification_code(
            db, guest_id=test_guest.id, email="fan@test.com", code=real_code
        )


def test_verify_expired_code_rejected(db: Session, test_guest: Guest):
    """Code past 15 min -> rejected."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")

    code_row.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()

    with pytest.raises(CodeExpiredError):
        confirm_verification_code(
            db, guest_id=test_guest.id, email="fan@test.com", code=code_row.code
        )


def test_rate_limit_five_codes_per_hour(db: Session, test_guest: Guest):
    """6th code request for same email -> RateLimitExceededError."""
    with patch("app.services.email_verification.send_verification_email"):
        for _ in range(5):
            create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")

        with pytest.raises(RateLimitExceededError):
            create_verification_code(db, guest_id=test_guest.id, email="fan@test.com")


def test_verify_sets_email_on_guest(db: Session, test_guest: Guest):
    """Guest.verified_email and email_verified_at populated."""
    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="test@example.com")

    confirm_verification_code(
        db, guest_id=test_guest.id, email="test@example.com", code=code_row.code
    )

    db.refresh(test_guest)
    assert test_guest.verified_email == "test@example.com"
    assert test_guest.email_hash == _email_hash("test@example.com")


def test_already_verified_same_email(db: Session, test_guest: Guest):
    """Re-verifying same email on same device -> no-op success."""
    test_guest.verified_email = "already@test.com"
    test_guest.email_hash = _email_hash("already@test.com")
    test_guest.email_verified_at = utcnow()
    db.commit()

    with patch("app.services.email_verification.send_verification_email"):
        code_row = create_verification_code(db, guest_id=test_guest.id, email="already@test.com")

    result = confirm_verification_code(
        db, guest_id=test_guest.id, email="already@test.com", code=code_row.code
    )
    assert result.verified is True
    assert result.merged is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_email_verification.py -v`

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement the verification service**

Create `server/app/services/email_verification.py`:

```python
"""Email verification service — code creation, validation, and guest email linking."""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.rate_limit import mask_fingerprint
from app.core.time import utcnow
from app.models.email_verification_code import EmailVerificationCode
from app.models.guest import Guest
from app.services.email_sender import send_verification_email

_logger = logging.getLogger("app.guest.verify")

MAX_CODES_PER_EMAIL_PER_HOUR = 5
CODE_VALIDITY_MINUTES = 15
MAX_ATTEMPTS = 3


class RateLimitExceededError(Exception):
    pass


class CodeInvalidError(Exception):
    pass


class CodeExpiredError(Exception):
    pass


@dataclass
class VerifyResult:
    verified: bool
    guest_id: int
    merged: bool
    new_token: str | None = None


def _hash_email(email: str) -> str:
    return hashlib.sha256(email.lower().encode()).hexdigest()


def create_verification_code(
    db: Session, *, guest_id: int, email: str
) -> EmailVerificationCode:
    """Generate a 6-digit code, store it, and send it via email."""
    email_lower = email.lower()
    eh = _hash_email(email_lower)
    now = utcnow()

    active_count = (
        db.query(EmailVerificationCode)
        .filter(
            EmailVerificationCode.email_hash == eh,
            EmailVerificationCode.used == False,  # noqa: E712
            EmailVerificationCode.expires_at > now,
        )
        .count()
    )
    if active_count >= MAX_CODES_PER_EMAIL_PER_HOUR:
        _logger.warning(
            "guest.verify action=rate_limited email_hash=%s reason=max_codes_per_hour",
            mask_fingerprint(eh),
        )
        raise RateLimitExceededError("Too many verification codes requested")

    code = str(secrets.randbelow(900000) + 100000)

    row = EmailVerificationCode(
        guest_id=guest_id,
        email_hash=eh,
        code=code,
        expires_at=now + timedelta(minutes=CODE_VALIDITY_MINUTES),
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    send_verification_email(email_lower, code)

    _logger.info(
        "guest.verify action=code_sent guest_id=%s email_hash=%s",
        guest_id,
        mask_fingerprint(eh),
    )
    return row


def confirm_verification_code(
    db: Session, *, guest_id: int, email: str, code: str
) -> VerifyResult:
    """Validate a verification code and set verified_email on the Guest."""
    eh = _hash_email(email.lower())
    now = utcnow()

    row = (
        db.query(EmailVerificationCode)
        .filter(
            EmailVerificationCode.guest_id == guest_id,
            EmailVerificationCode.email_hash == eh,
            EmailVerificationCode.used == False,  # noqa: E712
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )

    if row is None:
        raise CodeInvalidError("No pending verification code found")

    if row.expires_at <= now:
        _logger.warning(
            "guest.verify action=code_expired guest_id=%s email_hash=%s",
            guest_id,
            mask_fingerprint(eh),
        )
        raise CodeExpiredError("Verification code has expired")

    if row.attempts >= MAX_ATTEMPTS:
        raise CodeInvalidError("Too many failed attempts — request a new code")

    if row.code != code:
        row.attempts += 1
        db.commit()
        _logger.warning(
            "guest.verify action=code_failed guest_id=%s email_hash=%s attempts=%s",
            guest_id,
            mask_fingerprint(eh),
            row.attempts,
        )
        raise CodeInvalidError("Incorrect verification code")

    row.used = True
    db.commit()

    guest = db.query(Guest).filter(Guest.id == guest_id).one()

    # Already verified with this email?
    if guest.email_hash == eh:
        _logger.info(
            "guest.verify action=code_verified guest_id=%s email_hash=%s (already verified)",
            guest_id,
            mask_fingerprint(eh),
        )
        return VerifyResult(verified=True, guest_id=guest_id, merged=False)

    # Check if another Guest owns this email
    existing = (
        db.query(Guest)
        .filter(Guest.email_hash == eh, Guest.id != guest_id)
        .first()
    )

    if existing:
        from app.services.guest_merge import merge_guests

        merge_result = merge_guests(db, source_guest_id=guest_id, target_guest_id=existing.id)
        _logger.info(
            "guest.verify action=merge source_guest=%s target_guest=%s email_hash=%s"
            " requests=%s votes=%s profiles=%s",
            merge_result.source_guest_id,
            merge_result.target_guest_id,
            mask_fingerprint(eh),
            merge_result.requests_moved,
            merge_result.votes_moved,
            merge_result.profiles_moved,
        )
        return VerifyResult(
            verified=True,
            guest_id=existing.id,
            merged=True,
            new_token=existing.token,
        )

    # First verification for this email
    guest.verified_email = email.lower()
    guest.email_hash = eh
    guest.email_verified_at = now
    db.commit()

    _logger.info(
        "guest.verify action=code_verified guest_id=%s email_hash=%s",
        guest_id,
        mask_fingerprint(eh),
    )
    return VerifyResult(verified=True, guest_id=guest_id, merged=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_email_verification.py -v`

Expected: Most pass. The merge-related test (`test_already_verified_same_email`) should pass. Merge tests are in Task 6.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/email_verification.py server/tests/test_email_verification.py
git commit -m "feat: add email verification service with code lifecycle"
```

---

## Task 6: Guest Merge Service

**Files:**
- Create: `server/app/services/guest_merge.py`
- Create: `server/tests/test_guest_merge.py`

- [ ] **Step 1: Write failing tests**

Create `server/tests/test_guest_merge.py`:

```python
"""Unit tests for guest merge service."""

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.event import Event
from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.models.request import Request, RequestStatus
from app.models.request_vote import RequestVote
from app.services.guest_merge import merge_guests


def _make_guest(db: Session, token_prefix: str) -> Guest:
    guest = Guest(
        token=token_prefix.ljust(64, "0"),
        fingerprint_hash=f"fp_{token_prefix}",
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


def test_merge_moves_requests(db: Session, test_event: Event):
    """Source's requests reassigned to target."""
    source = _make_guest(db, "src")
    target = _make_guest(db, "tgt")

    req = Request(
        event_id=test_event.id,
        song_title="Move Me",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_move_me",
        guest_id=source.id,
    )
    db.add(req)
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.requests_moved == 1

    db.refresh(req)
    assert req.guest_id == target.id


def test_merge_moves_votes(db: Session, test_event: Event):
    """Source's votes reassigned to target."""
    source = _make_guest(db, "src_v")
    target = _make_guest(db, "tgt_v")

    req = Request(
        event_id=test_event.id,
        song_title="Vote Song",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_vote_song",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    vote = RequestVote(request_id=req.id, guest_id=source.id)
    db.add(vote)
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.votes_moved == 1


def test_merge_deduplicates_votes(db: Session, test_event: Event):
    """Both voted on same request -> one kept, count decremented."""
    source = _make_guest(db, "src_d")
    target = _make_guest(db, "tgt_d")

    req = Request(
        event_id=test_event.id,
        song_title="Both Voted",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_both_voted",
        vote_count=2,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    db.add(RequestVote(request_id=req.id, guest_id=source.id))
    db.add(RequestVote(request_id=req.id, guest_id=target.id))
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.votes_deduped == 1

    db.refresh(req)
    assert req.vote_count == 1


def test_merge_combines_profiles(db: Session, test_event: Event):
    """Same event -> submission_counts added, source profile deleted."""
    source = _make_guest(db, "src_p")
    target = _make_guest(db, "tgt_p")

    db.add(GuestProfile(
        event_id=test_event.id, guest_id=source.id, nickname="SrcNick", submission_count=3
    ))
    db.add(GuestProfile(
        event_id=test_event.id, guest_id=target.id, nickname="TgtNick", submission_count=2
    ))
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.profiles_merged == 1

    remaining = (
        db.query(GuestProfile)
        .filter(GuestProfile.event_id == test_event.id, GuestProfile.guest_id == target.id)
        .one()
    )
    assert remaining.submission_count == 5
    assert remaining.nickname == "TgtNick"


def test_merge_moves_profile_different_event(db: Session, test_event: Event, test_user):
    """Different events -> profile reassigned."""
    from datetime import timedelta

    source = _make_guest(db, "src_pe")
    target = _make_guest(db, "tgt_pe")

    other_event = Event(
        code="OTHER1",
        name="Other Event",
        created_by_user_id=test_user.id,
        expires_at=utcnow() + timedelta(hours=6),
    )
    db.add(other_event)
    db.commit()
    db.refresh(other_event)

    db.add(GuestProfile(
        event_id=other_event.id, guest_id=source.id, nickname="SrcOnly", submission_count=1
    ))
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.profiles_moved == 1


def test_merge_nickname_fallback(db: Session, test_event: Event):
    """Target has no nickname, source does -> source's preserved."""
    source = _make_guest(db, "src_n")
    target = _make_guest(db, "tgt_n")

    db.add(GuestProfile(
        event_id=test_event.id, guest_id=source.id, nickname="SourceNick", submission_count=1
    ))
    db.add(GuestProfile(
        event_id=test_event.id, guest_id=target.id, nickname=None, submission_count=0
    ))
    db.commit()

    merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)

    remaining = (
        db.query(GuestProfile)
        .filter(GuestProfile.event_id == test_event.id, GuestProfile.guest_id == target.id)
        .one()
    )
    assert remaining.nickname == "SourceNick"


def test_merge_deletes_source_guest(db: Session):
    """Source Guest row deleted after merge."""
    source = _make_guest(db, "src_del")
    target = _make_guest(db, "tgt_del")

    merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)

    assert db.query(Guest).filter(Guest.id == source.id).first() is None
    assert db.query(Guest).filter(Guest.id == target.id).first() is not None


def test_merge_returns_correct_counts(db: Session, test_event: Event):
    """MergeResult fields accurate."""
    source = _make_guest(db, "src_cnt")
    target = _make_guest(db, "tgt_cnt")

    req = Request(
        event_id=test_event.id,
        song_title="Count Song",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_count",
        guest_id=source.id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    db.add(RequestVote(request_id=req.id, guest_id=source.id))
    db.add(GuestProfile(
        event_id=test_event.id, guest_id=source.id, submission_count=1
    ))
    db.commit()

    result = merge_guests(db, source_guest_id=source.id, target_guest_id=target.id)
    assert result.requests_moved == 1
    assert result.votes_moved == 1
    assert result.votes_deduped == 0
    assert result.profiles_moved == 1
    assert result.profiles_merged == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_merge.py -v`

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement the merge service**

Create `server/app/services/guest_merge.py`:

```python
"""Guest merge service — consolidates two Guest records into one."""

import logging
from dataclasses import dataclass

from sqlalchemy import case, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.models.request import Request
from app.models.request_vote import RequestVote

_logger = logging.getLogger("app.guest.merge")


@dataclass
class MergeResult:
    source_guest_id: int
    target_guest_id: int
    requests_moved: int
    votes_moved: int
    votes_deduped: int
    profiles_moved: int
    profiles_merged: int


def merge_guests(db: Session, *, source_guest_id: int, target_guest_id: int) -> MergeResult:
    """Merge source Guest into target Guest. Source is deleted after."""
    requests_moved = 0
    votes_moved = 0
    votes_deduped = 0
    profiles_moved = 0
    profiles_merged = 0

    # Step 1: Reassign requests
    req_count = (
        db.query(Request)
        .filter(Request.guest_id == source_guest_id)
        .update({Request.guest_id: target_guest_id}, synchronize_session="fetch")
    )
    requests_moved = req_count

    # Step 2: Reassign votes (with dedup)
    source_votes = (
        db.query(RequestVote).filter(RequestVote.guest_id == source_guest_id).all()
    )
    for vote in source_votes:
        existing_target_vote = (
            db.query(RequestVote)
            .filter(
                RequestVote.request_id == vote.request_id,
                RequestVote.guest_id == target_guest_id,
            )
            .first()
        )
        if existing_target_vote:
            db.delete(vote)
            db.execute(
                update(Request)
                .where(Request.id == vote.request_id)
                .values(
                    vote_count=case(
                        (Request.vote_count > 0, Request.vote_count - 1),
                        else_=0,
                    )
                )
            )
            votes_deduped += 1
        else:
            vote.guest_id = target_guest_id
            votes_moved += 1

    # Step 3: Reassign guest profiles (with merge)
    source_profiles = (
        db.query(GuestProfile).filter(GuestProfile.guest_id == source_guest_id).all()
    )
    for profile in source_profiles:
        target_profile = (
            db.query(GuestProfile)
            .filter(
                GuestProfile.event_id == profile.event_id,
                GuestProfile.guest_id == target_guest_id,
            )
            .first()
        )
        if target_profile:
            target_profile.submission_count += profile.submission_count
            if not target_profile.nickname and profile.nickname:
                target_profile.nickname = profile.nickname
            db.delete(profile)
            profiles_merged += 1
        else:
            profile.guest_id = target_guest_id
            profiles_moved += 1

    # Step 4: Delete source Guest
    source_guest = db.query(Guest).filter(Guest.id == source_guest_id).first()
    if source_guest:
        db.delete(source_guest)

    db.commit()

    return MergeResult(
        source_guest_id=source_guest_id,
        target_guest_id=target_guest_id,
        requests_moved=requests_moved,
        votes_moved=votes_moved,
        votes_deduped=votes_deduped,
        profiles_moved=profiles_moved,
        profiles_merged=profiles_merged,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_guest_merge.py -v`

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/guest_merge.py server/tests/test_guest_merge.py
git commit -m "feat: add guest merge service for cross-device consolidation"
```

---

## Task 7: Verification Endpoints

**Files:**
- Create: `server/app/schemas/verify.py`
- Create: `server/app/api/verify.py`
- Modify: `server/app/api/__init__.py`
- Create: `server/tests/test_verify_endpoints.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `server/app/schemas/verify.py`:

```python
"""Pydantic schemas for email verification."""

from pydantic import BaseModel, EmailStr


class VerifyRequestSchema(BaseModel):
    email: EmailStr


class VerifyConfirmSchema(BaseModel):
    email: EmailStr
    code: str


class VerifyRequestResponse(BaseModel):
    sent: bool


class VerifyConfirmResponse(BaseModel):
    verified: bool
    guest_id: int
    merged: bool
```

- [ ] **Step 2: Write failing integration tests**

Create `server/tests/test_verify_endpoints.py`:

```python
"""Integration tests for email verification endpoints."""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.guest import Guest


def _identify(client: TestClient, fingerprint: str) -> dict:
    """Helper: identify a guest and return {guest_id, cookie}."""
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


def test_request_code_returns_sent(client: TestClient, db: Session):
    """POST /verify/request -> 200 with {sent: true}."""
    guest = _identify(client, "verify_test_fp_1")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        resp = client.post(
            "/api/public/guest/verify/request",
            json={"email": "test@example.com"},
        )
    assert resp.status_code == 200
    assert resp.json()["sent"] is True


def test_request_code_without_cookie_fails(client: TestClient):
    """No wrzdj_guest cookie -> error."""
    client.cookies.clear()
    resp = client.post(
        "/api/public/guest/verify/request",
        json={"email": "test@example.com"},
    )
    assert resp.status_code in (400, 401)


def test_confirm_code_sets_email_on_guest(client: TestClient, db: Session):
    """Correct code -> email on Guest row."""
    guest_info = _identify(client, "verify_test_fp_2")
    client.cookies.set("wrzdj_guest", guest_info["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "verified@test.com"},
        )

    from app.models.email_verification_code import EmailVerificationCode

    code_row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == guest_info["guest_id"])
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    assert code_row is not None

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "verified@test.com", "code": code_row.code},
    )
    assert resp.status_code == 200
    assert resp.json()["verified"] is True

    guest = db.query(Guest).filter(Guest.id == guest_info["guest_id"]).one()
    assert guest.email_verified_at is not None


def test_confirm_code_returns_merged_true(client: TestClient, db: Session):
    """Second device verifies same email -> {merged: true}, new cookie."""
    # Device A
    device_a = _identify(client, "merge_device_a_fp")
    client.cookies.set("wrzdj_guest", device_a["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "shared@test.com"},
        )

    from app.models.email_verification_code import EmailVerificationCode

    code_a = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == device_a["guest_id"])
        .first()
    )
    client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "shared@test.com", "code": code_a.code},
    )

    # Device B
    device_b = _identify(client, "merge_device_b_fp")
    client.cookies.set("wrzdj_guest", device_b["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "shared@test.com"},
        )

    code_b = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == device_b["guest_id"])
        .first()
    )
    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "shared@test.com", "code": code_b.code},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["merged"] is True
    assert data["guest_id"] == device_a["guest_id"]


def test_confirm_wrong_code_returns_error(client: TestClient, db: Session):
    """Wrong code -> 400."""
    guest = _identify(client, "wrong_code_fp")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    with patch("app.services.email_verification.send_verification_email"):
        client.post(
            "/api/public/guest/verify/request",
            json={"email": "wrong@test.com"},
        )

    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": "wrong@test.com", "code": "000000"},
    )
    assert resp.status_code == 400
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_verify_endpoints.py -v`

Expected: FAIL — 404 (routes not registered)

- [ ] **Step 4: Create the verify endpoints**

Create `server/app/api/verify.py`:

```python
"""Public API endpoints for guest email verification."""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.rate_limit import get_guest_id, limiter
from app.schemas.verify import (
    VerifyConfirmResponse,
    VerifyConfirmSchema,
    VerifyRequestResponse,
    VerifyRequestSchema,
)
from app.services.email_verification import (
    CodeExpiredError,
    CodeInvalidError,
    RateLimitExceededError,
    confirm_verification_code,
    create_verification_code,
)

router = APIRouter()


@router.post("/verify/request", response_model=VerifyRequestResponse)
@limiter.limit("10/minute")
def request_verification_code(
    payload: VerifyRequestSchema,
    request: Request,
    db: Session = Depends(get_db),
) -> VerifyRequestResponse:
    """Send a verification code to the provided email."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    try:
        create_verification_code(db, guest_id=guest_id, email=payload.email)
    except RateLimitExceededError:
        raise HTTPException(status_code=429, detail="Too many codes requested")

    return VerifyRequestResponse(sent=True)


@router.post("/verify/confirm", response_model=VerifyConfirmResponse)
@limiter.limit("10/minute")
def confirm_code(
    payload: VerifyConfirmSchema,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Confirm a verification code. May trigger guest merge."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    try:
        result = confirm_verification_code(
            db, guest_id=guest_id, email=payload.email, code=payload.code
        )
    except CodeInvalidError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except CodeExpiredError as e:
        raise HTTPException(status_code=400, detail=str(e))

    response = JSONResponse(content={
        "verified": result.verified,
        "guest_id": result.guest_id,
        "merged": result.merged,
    })

    if result.new_token:
        is_prod = get_settings().env == "production"
        response.set_cookie(
            key="wrzdj_guest",
            value=result.new_token,
            httponly=True,
            secure=is_prod,
            samesite="lax",
            max_age=31536000,
            path="/api/",
        )

    return response
```

- [ ] **Step 5: Register router in __init__.py**

In `server/app/api/__init__.py`, add:

```python
from app.api import (
    ...
    verify,
    ...
)
```

And add the router include after the guest router:
```python
api_router.include_router(verify.router, prefix="/public/guest", tags=["verify"])
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_verify_endpoints.py -v`

Expected: All 5 tests PASS.

- [ ] **Step 7: Run full backend test suite**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest --tb=short -q`

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/app/schemas/verify.py server/app/api/verify.py server/app/api/__init__.py server/tests/test_verify_endpoints.py
git commit -m "feat: add email verification endpoints"
```

---

## Task 8: Alembic Migration

**Files:**
- Create: `server/alembic/versions/037_email_verification.py`

- [ ] **Step 1: Write the migration**

Create `server/alembic/versions/037_email_verification.py`:

```python
"""Email verification: add columns to guests, create verification codes table, drop GuestProfile.email.

Revision ID: 037
Revises: 036
Create Date: 2026-04-27
"""

import sqlalchemy as sa

from alembic import op

revision: str = "037"
down_revision: str | None = "036"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Add email columns to guests
    op.add_column("guests", sa.Column("verified_email", sa.Text(), nullable=True))
    op.add_column("guests", sa.Column("email_hash", sa.String(64), nullable=True))
    op.add_column("guests", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.add_column("guests", sa.Column("nickname", sa.String(30), nullable=True))
    op.create_index(op.f("ix_guests_email_hash"), "guests", ["email_hash"], unique=True)

    # Create email_verification_codes table
    op.create_table(
        "email_verification_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("guest_id", sa.Integer(), nullable=False),
        sa.Column("email_hash", sa.String(64), nullable=False),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("used", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["guest_id"], ["guests.id"], ondelete="CASCADE"),
    )
    op.create_index(
        op.f("ix_email_verification_codes_guest_id"),
        "email_verification_codes",
        ["guest_id"],
    )
    op.create_index(
        op.f("ix_email_verification_codes_email_hash"),
        "email_verification_codes",
        ["email_hash"],
    )

    # Drop email from guest_profiles
    with op.batch_alter_table("guest_profiles") as batch_op:
        batch_op.drop_column("email")


def downgrade() -> None:
    with op.batch_alter_table("guest_profiles") as batch_op:
        batch_op.add_column(sa.Column("email", sa.Text(), nullable=True))

    op.drop_index(
        op.f("ix_email_verification_codes_email_hash"),
        table_name="email_verification_codes",
    )
    op.drop_index(
        op.f("ix_email_verification_codes_guest_id"),
        table_name="email_verification_codes",
    )
    op.drop_table("email_verification_codes")

    op.drop_index(op.f("ix_guests_email_hash"), table_name="guests")
    op.drop_column("guests", "nickname")
    op.drop_column("guests", "email_verified_at")
    op.drop_column("guests", "email_hash")
    op.drop_column("guests", "verified_email")
```

- [ ] **Step 2: Run migration**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/alembic upgrade head`

Expected: Migration runs cleanly.

- [ ] **Step 3: Check for model/migration drift**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/alembic check`

Expected: `No new upgrade operations detected.`

- [ ] **Step 4: Commit**

```bash
git add server/alembic/versions/037_email_verification.py
git commit -m "chore: add Alembic migration 037 for email verification"
```

---

## Task 9: Scenario Tests

**Files:**
- Create: `server/tests/test_cross_device_scenario.py`

- [ ] **Step 1: Write scenario tests**

Create `server/tests/test_cross_device_scenario.py`:

```python
"""Scenario tests for cross-device email merge.

These verify the system solves the actual problem: a guest using
phone and laptop for the same collection event gets unified identity.
"""

from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.email_verification_code import EmailVerificationCode
from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.request_vote import RequestVote


def _identify(client: TestClient, fingerprint: str) -> dict:
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


def _verify_email(client: TestClient, db: Session, guest_id: int, cookie: str, email: str):
    """Helper: request code + confirm it."""
    client.cookies.set("wrzdj_guest", cookie)
    with patch("app.services.email_verification.send_verification_email"):
        client.post("/api/public/guest/verify/request", json={"email": email})
    code_row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.guest_id == guest_id)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )
    resp = client.post(
        "/api/public/guest/verify/confirm",
        json={"email": email, "code": code_row.code},
    )
    return resp.json()


def test_two_devices_same_email_merge(
    client: TestClient, db: Session, test_event: Event, auth_headers: dict
):
    """Phone submits 3 songs, laptop verifies same email -> laptop sees all 3."""
    # Phone
    phone = _identify(client, "phone_fp_merge")
    client.cookies.set("wrzdj_guest", phone["cookie"])

    for i in range(3):
        client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": f"Artist {i}", "title": f"Song {i}", "source": "manual"},
            headers=auth_headers,
        )

    # Verify phone
    _verify_email(client, db, phone["guest_id"], phone["cookie"], "merge@test.com")

    # Laptop
    laptop = _identify(client, "laptop_fp_merge")
    result = _verify_email(client, db, laptop["guest_id"], laptop["cookie"], "merge@test.com")

    assert result["merged"] is True
    assert result["guest_id"] == phone["guest_id"]


def test_merge_dedup_same_vote(
    client: TestClient, db: Session, test_event: Event
):
    """Both devices voted on same song -> one vote after merge."""
    phone = _identify(client, "phone_fp_vote")
    laptop = _identify(client, "laptop_fp_vote")

    req = Request(
        event_id=test_event.id,
        song_title="Shared Vote Song",
        artist="Artist",
        source="manual",
        status=RequestStatus.NEW.value,
        dedupe_key="dk_shared_vote",
        vote_count=2,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    db.add(RequestVote(request_id=req.id, guest_id=phone["guest_id"]))
    db.add(RequestVote(request_id=req.id, guest_id=laptop["guest_id"]))
    db.commit()

    _verify_email(client, db, phone["guest_id"], phone["cookie"], "voter@test.com")
    result = _verify_email(client, db, laptop["guest_id"], laptop["cookie"], "voter@test.com")

    assert result["merged"] is True

    db.refresh(req)
    assert req.vote_count == 1

    vote_count = (
        db.query(RequestVote).filter(RequestVote.request_id == req.id).count()
    )
    assert vote_count == 1


def test_unverified_guest_unaffected(client: TestClient, db: Session, test_event: Event):
    """Guest without email -> no merge, works as before."""
    guest = _identify(client, "no_email_fp")
    client.cookies.set("wrzdj_guest", guest["cookie"])

    resp = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "no_email_fp", "fingerprint_components": {}},
    )
    assert resp.status_code == 200
    assert resp.json()["guest_id"] == guest["guest_id"]
```

- [ ] **Step 2: Run scenario tests**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_cross_device_scenario.py -v`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/tests/test_cross_device_scenario.py
git commit -m "test: add cross-device email merge scenario tests"
```

---

## Task 10: Frontend — API Client Methods

**Files:**
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Add verification methods to ApiClient**

Find the `ApiClient` class in `dashboard/lib/api.ts` and add two new methods. These are public endpoints, so use raw `fetch` with `credentials: "include"` (not `this.fetch()` which adds Bearer auth):

```typescript
  async requestVerificationCode(email: string): Promise<{ sent: boolean }> {
    const resp = await fetch(`${this.baseUrl}/api/public/guest/verify/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new ApiError(data.detail || 'Failed to send code', resp.status);
    }
    return resp.json();
  }

  async confirmVerificationCode(
    email: string,
    code: string
  ): Promise<{ verified: boolean; guest_id: number; merged: boolean }> {
    const resp = await fetch(`${this.baseUrl}/api/public/guest/verify/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new ApiError(data.detail || 'Verification failed', resp.status);
    }
    return resp.json();
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat: add verification API methods to frontend client"
```

---

## Task 11: Frontend — EmailVerification Component

**Files:**
- Create: `dashboard/app/collect/[code]/components/EmailVerification.tsx`

- [ ] **Step 1: Create the component**

Create `dashboard/app/collect/[code]/components/EmailVerification.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../../../lib/api';

type VerifyState = 'input' | 'code_sent' | 'verified';

interface Props {
  isVerified: boolean;
  onVerified: () => void;
}

export default function EmailVerification({ isVerified, onVerified }: Props) {
  const [state, setState] = useState<VerifyState>(isVerified ? 'verified' : 'input');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer
  useEffect(() => {
    if (state !== 'code_sent' || expiresAt === 0) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setError('Code expired — request a new one');
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state, expiresAt]);

  const sendCode = useCallback(async () => {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.requestVerificationCode(email.trim());
      setState('code_sent');
      setExpiresAt(Date.now() + 15 * 60 * 1000);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send code');
    } finally {
      setSending(false);
    }
  }, [email]);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d?$/.test(value)) return;
      const next = [...digits];
      next[index] = value;
      setDigits(next);
      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits]
  );

  const handleDigitKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const confirmCode = useCallback(async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await apiClient.confirmVerificationCode(email.trim(), code);
      if (result.verified) {
        setState('verified');
        onVerified();
        if (result.merged) {
          window.location.reload();
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setConfirming(false);
    }
  }, [digits, email, onVerified]);

  // Auto-submit when all 6 digits entered
  useEffect(() => {
    if (digits.every((d) => d !== '') && state === 'code_sent') {
      confirmCode();
    }
  }, [digits, state, confirmCode]);

  if (state === 'verified') {
    return (
      <div className="email-verified-badge">
        <span>&#10003;</span> Email verified
      </div>
    );
  }

  if (state === 'code_sent') {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return (
      <div className="email-verify-code">
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          Code sent to {email}
        </p>
        <div className="verify-digits">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleDigitKeyDown(i, e)}
              className="verify-digit-input"
              disabled={confirming}
              autoComplete="one-time-code"
            />
          ))}
          <span className="verify-timer">
            {mins}:{secs.toString().padStart(2, '0')}
          </span>
        </div>
        {error && <p className="collection-fieldset-error">{error}</p>}
        <button
          type="button"
          className="btn-link"
          onClick={sendCode}
          disabled={sending || secondsLeft > 14 * 60}
          style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}
        >
          {sending ? 'Sending...' : "Didn't get it? Resend"}
        </button>
      </div>
    );
  }

  return (
    <div className="email-verify-input">
      <h4 style={{ marginBottom: '0.25rem' }}>Verify your email</h4>
      <ul className="collect-optin-features">
        <li>See your picks across all your devices</li>
        <li>Track your leaderboard position</li>
        <li>Get notified about event changes</li>
      </ul>
      <div className="form-group" style={{ marginBottom: '0.25rem' }}>
        <input
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }}
        />
      </div>
      {error && <p className="collection-fieldset-error">{error}</p>}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={sendCode}
        disabled={sending || !email.trim()}
      >
        {sending ? 'Sending...' : 'Send Code'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add "dashboard/app/collect/[code]/components/EmailVerification.tsx"
git commit -m "feat: add EmailVerification component with 3-state flow"
```

---

## Task 12: Frontend — Integrate into FeatureOptInPanel & Pages

**Files:**
- Modify: `dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Update FeatureOptInPanel**

Replace the email input section in `FeatureOptInPanel.tsx` with the `EmailVerification` component. Remove the `hasEmail` prop. Add `emailVerified` and `onVerified` props.

The updated component should:
- Keep the nickname section as-is
- Replace the email input + label with `<EmailVerification isVerified={emailVerified} onVerified={onVerified} />`
- Remove email state, email validation, and email from the payload

- [ ] **Step 2: Update collect page to wire verification state**

In `dashboard/app/collect/[code]/page.tsx`, update the state and props:
- Change `hasEmail` state to `emailVerified` state
- Set `emailVerified` based on `CollectProfileResponse.email_verified`
- Pass `onVerified={() => setEmailVerified(true)}` to FeatureOptInPanel

- [ ] **Step 3: Add verification CTA to join page**

In `dashboard/app/join/[code]/page.tsx`, after the request submission success state (where `submitted` is true and the request list is shown), add a small verification prompt. Import `EmailVerification` and render it conditionally:

```typescript
import EmailVerification from '../../collect/[code]/components/EmailVerification';
```

After the request list section, add:
```tsx
{showRequestList && !emailVerified && (
  <div style={{ margin: '1rem 0', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '8px' }}>
    <EmailVerification isVerified={false} onVerified={() => setEmailVerified(true)} />
  </div>
)}
```

Add `emailVerified` state: `const [emailVerified, setEmailVerified] = useState(false);`

- [ ] **Step 4: Verify TypeScript compiles and dev server runs**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add "dashboard/app/collect/[code]/components/FeatureOptInPanel.tsx" "dashboard/app/collect/[code]/page.tsx" "dashboard/app/join/[code]/page.tsx"
git commit -m "feat: integrate email verification into collect and join flows"
```

---

## Task 13: CI Checks & Final Verification

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

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: address CI check issues"
```
