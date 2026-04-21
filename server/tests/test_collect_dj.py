from datetime import timedelta

from app.core.time import utcnow


def test_patch_collection_sets_dates(client, db, auth_headers, test_event):
    now = utcnow()
    payload = {
        "collection_opens_at": (now + timedelta(hours=1)).isoformat(),
        "live_starts_at": (now + timedelta(hours=3)).isoformat(),
        "submission_cap_per_guest": 10,
    }
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json=payload,
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    db.refresh(test_event)
    assert test_event.submission_cap_per_guest == 10
    assert test_event.collection_opens_at is not None


def test_patch_collection_rejects_bad_ordering(client, auth_headers, test_event):
    now = utcnow()
    payload = {
        "collection_opens_at": (now + timedelta(days=2)).isoformat(),
        "live_starts_at": (now + timedelta(days=1)).isoformat(),
    }
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json=payload,
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_patch_collection_requires_ownership(client, db, admin_user, test_event):
    # test_event is owned by test_user; create a different non-admin user
    from app.models.user import User
    from app.services.auth import create_access_token

    other = User(username="otherdj", password_hash="x", role="dj")
    db.add(other)
    db.commit()
    db.refresh(other)
    token = create_access_token(data={"sub": other.username, "tv": other.token_version})
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"submission_cap_per_guest": 5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_patch_collection_override_accepted(client, db, auth_headers, test_event):
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"collection_phase_override": "force_live"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    db.refresh(test_event)
    assert test_event.collection_phase_override == "force_live"


def test_patch_collection_override_bad_value(client, auth_headers, test_event):
    r = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"collection_phase_override": "skydiving"},
        headers=auth_headers,
    )
    assert r.status_code == 422


def test_pending_review_returns_collection_news_sorted_by_votes(
    client, auth_headers, test_event, collection_requests
):
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers=auth_headers,
    )
    assert r.status_code == 200
    rows = r.json()["requests"]
    # collection_requests fixture has vote_count 5, 2, 0
    assert [row["vote_count"] for row in rows] == [5, 2, 0]


def test_pending_review_excludes_accepted(
    client, db, auth_headers, test_event, collection_requests
):
    collection_requests[0].status = "accepted"
    db.commit()
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers=auth_headers,
    )
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert 5 not in votes  # that request is now accepted


def test_pending_review_requires_ownership(client, db, test_event):
    from app.models.user import User
    from app.services.auth import create_access_token

    other = User(username="otherdj2", password_hash="x", role="dj")
    db.add(other)
    db.commit()
    db.refresh(other)
    token = create_access_token(data={"sub": other.username, "tv": other.token_version})
    r = client.get(
        f"/api/events/{test_event.code}/pending-review",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403
