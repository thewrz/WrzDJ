"""Unit tests for guest identity resolution service."""

import json
import secrets

from sqlalchemy.orm import Session

from app.models.guest import Guest
from app.services.guest_identity import identify_guest


def test_create_guest_new_visitor(db: Session):
    """No cookie, no fingerprint match -> new Guest created."""
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="brand_new_fp",
        fingerprint_components={"screen": "1170x2532"},
        user_agent="Mozilla/5.0 Safari/17.4",
    )
    assert result.guest_id is not None
    assert result.action == "create"
    assert result.token is not None
    assert len(result.token) == 64

    guest = db.query(Guest).filter(Guest.id == result.guest_id).one()
    assert guest.fingerprint_hash == "brand_new_fp"
    assert json.loads(guest.fingerprint_components) == {"screen": "1170x2532"}


def test_cookie_hit_returns_existing(db: Session, test_guest: Guest):
    """Valid cookie -> returns existing Guest, updates last_seen_at."""
    old_last_seen = test_guest.last_seen_at

    result = identify_guest(
        db,
        token_from_cookie=test_guest.token,
        fingerprint_hash="fp_test_hash_123",
        fingerprint_components={"screen": "1170x2532"},
        user_agent="Mozilla/5.0 Safari/17.4",
    )
    assert result.guest_id == test_guest.id
    assert result.action == "cookie_hit"
    assert result.token is None

    db.refresh(test_guest)
    assert test_guest.last_seen_at >= old_last_seen


def test_cookie_hit_updates_ua(db: Session, test_guest: Guest):
    """Cookie hit from new UA -> field updated, guest_id unchanged."""
    result = identify_guest(
        db,
        token_from_cookie=test_guest.token,
        fingerprint_hash="fp_test_hash_123",
        fingerprint_components={"screen": "1170x2532"},
        user_agent="Mozilla/5.0 Chrome/125.0",
    )
    assert result.guest_id == test_guest.id

    db.refresh(test_guest)
    assert "Chrome" in test_guest.user_agent


def test_expired_token_ignored(db: Session):
    """Cookie present but token not in DB -> treated as new visitor."""
    result = identify_guest(
        db,
        token_from_cookie="nonexistent_token_" + "x" * 46,
        fingerprint_hash="some_fp_hash_1234",
        fingerprint_components={},
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
        user_agent="Mozilla/5.0",
    )
    guest = db.query(Guest).filter(Guest.id == result.guest_id).one()
    assert json.loads(guest.fingerprint_components) == components
