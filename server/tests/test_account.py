"""Tests for self-service credential management (password + email change)."""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.pending_email_change import PendingEmailChange
from app.models.user import User
from app.services.account import (  # noqa: F401
    EmailTakenError,
    TokenExpiredError,
    TokenNotFoundError,
    TokenUsedError,
    change_password,
    confirm_email_change,
    get_active_pending_email_change,
    invalidate_pending_email_changes,
    request_email_change,
)
from app.services.auth import verify_password

# ── change_password ────────────────────────────────────────────────────────────


def test_change_password_success(db: Session, test_user: User) -> None:
    change_password(db, test_user, "testpassword123", "newpassword456")
    db.refresh(test_user)
    assert verify_password("newpassword456", test_user.password_hash)


def test_change_password_wrong_current(db: Session, test_user: User) -> None:
    original_hash = test_user.password_hash
    with pytest.raises(ValueError, match="incorrect_password"):
        change_password(db, test_user, "wrongpassword", "newpassword456")
    db.refresh(test_user)
    assert test_user.password_hash == original_hash


def test_change_password_bumps_token_version(db: Session, test_user: User) -> None:
    original_tv = test_user.token_version
    change_password(db, test_user, "testpassword123", "newpassword456")
    db.refresh(test_user)
    assert test_user.token_version == original_tv + 1


def test_change_password_invalidates_pending_email(db: Session, test_user: User) -> None:
    pending = PendingEmailChange(
        user_id=test_user.id,
        new_email="new@example.com",
        token="a" * 64,
        expires_at=utcnow() + timedelta(hours=24),
        used=False,
    )
    db.add(pending)
    db.commit()

    change_password(db, test_user, "testpassword123", "newpassword456")

    db.refresh(pending)
    assert pending.used is True
