from datetime import timedelta

from app.core.time import utcnow
from app.models.event import Event


def _make_event(**kwargs) -> Event:
    now = utcnow()
    defaults = dict(
        code="ABCDEF",
        name="Test Event",
        created_by_user_id=1,
        expires_at=now + timedelta(days=30),
    )
    defaults.update(kwargs)
    return Event(**defaults)


def test_phase_no_collection_set_is_live():
    ev = _make_event()
    assert ev.phase == "live"


def test_phase_no_collection_after_expiry_is_closed():
    ev = _make_event(expires_at=utcnow() - timedelta(hours=1))
    assert ev.phase == "closed"


def test_phase_pre_announce_when_before_collection_opens():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now + timedelta(hours=1),
        live_starts_at=now + timedelta(days=1),
    )
    assert ev.phase == "pre_announce"


def test_phase_collection_when_between_opens_and_live():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(hours=1),
        live_starts_at=now + timedelta(hours=1),
    )
    assert ev.phase == "collection"


def test_phase_live_when_past_live_starts_at():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(days=2),
        live_starts_at=now - timedelta(hours=1),
    )
    assert ev.phase == "live"


def test_phase_override_force_live_wins():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(hours=1),
        live_starts_at=now + timedelta(hours=1),
        collection_phase_override="force_live",
    )
    assert ev.phase == "live"


def test_phase_override_force_collection_wins():
    now = utcnow()
    ev = _make_event(
        collection_opens_at=now - timedelta(days=2),
        live_starts_at=now - timedelta(hours=1),
        collection_phase_override="force_collection",
    )
    assert ev.phase == "collection"
