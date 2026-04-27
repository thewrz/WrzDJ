"""Unit tests for reconciliation confidence scoring."""

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.guest import Guest
from app.services.guest_identity import identify_guest


def _create_guest(db: Session, fingerprint_hash: str, user_agent: str) -> Guest:
    """Helper to create a guest with specific fingerprint and UA."""
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
        user_agent=(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) "
            "AppleWebKit/605.1.15 Version/17.4 Safari/604.1"
        ),
    )
    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash="shared_fp_aaa",
        fingerprint_components={},
        ip_address="10.0.0.2",
        user_agent=(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) "
            "AppleWebKit/605.1.15 Version/17.5 Safari/604.1"
        ),
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
        user_agent=("Mozilla/5.0 (Linux; Android 14) Chrome/125.0.6422.52 Mobile Safari/537.36"),
    )
    assert result.guest_id != guest.id
    assert result.action == "create"


def test_medium_confidence_same_ua_different_version(db: Session):
    """Safari 17 vs Safari 18 -> same family, version within 2 -> re-link."""
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


def test_identical_devices_different_guests_via_cookies(db: Session):
    """Two guests with same fingerprint stay separate when both have cookies."""
    guest_a = _create_guest(
        db,
        fingerprint_hash="school_ipad_fp",
        user_agent="Mozilla/5.0 (iPad; CPU OS 17_4) Version/17.4 Safari/604.1",
    )

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
