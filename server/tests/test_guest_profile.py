import pytest
from sqlalchemy.exc import IntegrityError

from app.models.event import Event
from app.models.guest_profile import GuestProfile


def test_guest_profile_defaults(db, test_event: Event):
    profile = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="fp_abc",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    assert profile.nickname is None
    assert profile.email is None
    assert profile.submission_count == 0
    assert profile.created_at is not None


def test_guest_profile_uniqueness(db, test_event: Event):
    db.add(GuestProfile(event_id=test_event.id, client_fingerprint="fp_same"))
    db.commit()
    db.add(GuestProfile(event_id=test_event.id, client_fingerprint="fp_same"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_guest_profile_email_is_encrypted_at_rest(db, test_event: Event):
    profile = GuestProfile(
        event_id=test_event.id,
        client_fingerprint="fp_enc",
        email="guest@example.com",
    )
    db.add(profile)
    db.commit()

    raw = db.execute(
        __import__("sqlalchemy").text("SELECT email FROM guest_profiles WHERE id = :id"),
        {"id": profile.id},
    ).scalar()
    assert raw != "guest@example.com"
    assert raw is not None

    db.refresh(profile)
    assert profile.email == "guest@example.com"
