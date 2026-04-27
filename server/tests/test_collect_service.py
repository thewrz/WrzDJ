from datetime import timedelta

import pytest

from app.core.time import utcnow
from app.models.event import Event
from app.models.guest_profile import GuestProfile
from app.services import collect as collect_service


def _enable_collection(db, event: Event):
    now = utcnow()
    event.collection_opens_at = now - timedelta(hours=1)
    event.live_starts_at = now + timedelta(hours=1)
    event.submission_cap_per_guest = 3
    db.commit()
    db.refresh(event)


def test_upsert_profile_creates_row(db, test_event: Event):
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, fingerprint="fp1", nickname="Alex"
    )
    assert profile.nickname == "Alex"
    assert profile.submission_count == 0


def test_upsert_profile_updates_nickname(db, test_event: Event):
    collect_service.upsert_profile(db, event_id=test_event.id, fingerprint="fp2", nickname="Old")
    profile = collect_service.upsert_profile(
        db, event_id=test_event.id, fingerprint="fp2", nickname="NewName"
    )
    assert profile.nickname == "NewName"


def test_check_and_increment_submission_count_blocks_at_cap(db, test_event: Event):
    _enable_collection(db, test_event)
    for _ in range(3):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp3"
        )
    with pytest.raises(collect_service.SubmissionCapExceeded):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp3"
        )


def test_check_and_increment_allows_unlimited_when_cap_zero(db, test_event: Event):
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 0
    db.commit()
    for _ in range(20):
        collect_service.check_and_increment_submission_count(
            db, event=test_event, fingerprint="fp4"
        )
    profile = (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == test_event.id,
            GuestProfile.client_fingerprint == "fp4",
        )
        .one()
    )
    assert profile.submission_count == 20
