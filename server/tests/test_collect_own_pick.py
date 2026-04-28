"""F5 regression — 'own pick' check must survive cookie-clear.

The if/elif structure used in collect.py let a guest who cleared cookies
(new guest_id, same fingerprint) bypass the 'can't vote on own pick'
guard and the 'you already picked this one' guard.
"""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.event import Event
from app.models.user import User
from app.services.auth import get_password_hash


@pytest.fixture
def collection_event(db: Session) -> Event:
    """An event in collection phase, owned by a fresh DJ user."""
    user = User(
        username="djowner_f5",
        password_hash=get_password_hash("pw_f5_test_value"),
        role="dj",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    now = utcnow()
    event = Event(
        code="F5COL1",
        name="Collection Test",
        created_by_user_id=user.id,
        expires_at=now + timedelta(days=2),
        collection_opens_at=now - timedelta(hours=1),
        live_starts_at=now + timedelta(hours=12),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def test_collect_vote_blocks_own_pick_after_cookie_clear(client, collection_event):
    """Submit as guest A, clear cookies, identify as guest B (different
    fingerprint so reconcile fails), then attempt to vote on the row.

    The fingerprint is identical (TestClient host stays 'testclient'),
    so the fp-based fallback must kick in even though guest_ids differ.
    """
    # Identity A — submit
    client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_owner_A", "fingerprint_components": {}},
    )
    submit_resp = client.post(
        f"/api/public/collect/{collection_event.code}/requests",
        json={"song_title": "Own Pick", "artist": "Self", "source": "manual"},
    )
    assert submit_resp.status_code == 201, submit_resp.json()
    request_id = submit_resp.json()["id"]

    # Force a different guest identity, but TestClient IP stays the same
    cookie_a = client.cookies.get("wrzdj_guest")
    client.cookies.clear()
    client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_owner_B_distinct", "fingerprint_components": {}},
    )
    cookie_b = client.cookies.get("wrzdj_guest")
    assert cookie_a != cookie_b, "Expected a fresh guest identity after cookie clear"

    vote_resp = client.post(
        f"/api/public/collect/{collection_event.code}/vote",
        json={"request_id": request_id},
    )
    assert vote_resp.status_code == 409, vote_resp.json()
    assert "own" in vote_resp.json()["detail"].lower()


def test_collect_submit_blocks_own_dup_after_cookie_clear(client, collection_event):
    """Same scenario for submit — duplicate of your own pick must 409,
    not silently auto-upvote your own row from a fresh guest_id."""
    client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_dup_A", "fingerprint_components": {}},
    )
    first = client.post(
        f"/api/public/collect/{collection_event.code}/requests",
        json={"song_title": "Same Song", "artist": "Same Artist", "source": "manual"},
    )
    assert first.status_code == 201

    cookie_a = client.cookies.get("wrzdj_guest")
    client.cookies.clear()
    client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fp_dup_B_distinct", "fingerprint_components": {}},
    )
    cookie_b = client.cookies.get("wrzdj_guest")
    assert cookie_a != cookie_b, "Expected a fresh guest identity after cookie clear"

    second = client.post(
        f"/api/public/collect/{collection_event.code}/requests",
        json={"song_title": "Same Song", "artist": "Same Artist", "source": "manual"},
    )
    assert second.status_code == 409, second.json()
    assert "already picked" in second.json()["detail"].lower()
