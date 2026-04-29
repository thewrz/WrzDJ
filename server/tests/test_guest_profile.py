import pytest
from sqlalchemy.exc import IntegrityError

from app.core.time import utcnow
from app.models.event import Event
from app.models.guest import Guest
from app.models.guest_profile import GuestProfile


def _make_guest(db, suffix: str) -> Guest:
    g = Guest(
        token=suffix.ljust(64, "0"),
        fingerprint_hash=f"fp_{suffix}",
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def test_guest_profile_defaults(db, test_event: Event):
    guest = _make_guest(db, "a")
    profile = GuestProfile(
        event_id=test_event.id,
        guest_id=guest.id,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    assert profile.nickname is None
    assert profile.submission_count == 0
    assert profile.created_at is not None


def test_guest_profile_uniqueness_by_guest_id(db, test_event: Event):
    """One profile per (event_id, guest_id). The IP-based unique constraint is gone."""
    guest = _make_guest(db, "a")
    db.add(GuestProfile(event_id=test_event.id, guest_id=guest.id))
    db.commit()
    db.add(GuestProfile(event_id=test_event.id, guest_id=guest.id))
    with pytest.raises(IntegrityError):
        db.commit()


def test_guest_profile_has_no_email_column(test_event: Event):
    """GuestProfile no longer stores email — verified_email lives on Guest instead."""
    assert not hasattr(GuestProfile, "email")
