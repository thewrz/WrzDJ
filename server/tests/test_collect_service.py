from datetime import timedelta

import pytest

from app.core.time import utcnow
from app.models.event import Event
from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.services import collect as collect_service


def _enable_collection(db, event: Event):
    now = utcnow()
    event.collection_opens_at = now - timedelta(hours=1)
    event.live_starts_at = now + timedelta(hours=1)
    event.submission_cap_per_guest = 3
    db.commit()
    db.refresh(event)


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


def test_upsert_profile_creates_row(db, test_event: Event):
    guest = _make_guest(db, "a")
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, guest_id=guest.id, nickname="Alex"
    )
    assert profile.nickname == "Alex"
    assert profile.submission_count == 0


def test_upsert_profile_updates_nickname(db, test_event: Event):
    guest = _make_guest(db, "a")
    collect_service.upsert_profile(db, event_id=test_event.id, guest_id=guest.id, nickname="Old")
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, guest_id=guest.id, nickname="NewName"
    )
    assert profile.nickname == "NewName"


def test_check_and_increment_submission_count_blocks_at_cap(db, test_event: Event):
    _enable_collection(db, test_event)
    guest = _make_guest(db, "a")
    for _ in range(3):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, guest_id=guest.id
        )
    with pytest.raises(collect_service.SubmissionCapExceeded):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, guest_id=guest.id
        )


def test_check_and_increment_allows_unlimited_when_cap_zero(db, test_event: Event):
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 0
    db.commit()
    guest = _make_guest(db, "a")
    for _ in range(20):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, guest_id=guest.id
        )
    profile = (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == test_event.id,
            GuestProfile.guest_id == guest.id,
        )
        .one()
    )
    assert profile.submission_count == 20
