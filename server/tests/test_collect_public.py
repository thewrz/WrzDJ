"""Tests for the public collect preview and leaderboard endpoints."""

from datetime import timedelta

from app.core.time import utcnow
from app.models.event import Event


def _enable_collection(db, event: Event):
    now = utcnow()
    event.collection_opens_at = now - timedelta(hours=1)
    event.live_starts_at = now + timedelta(hours=1)
    db.commit()
    db.refresh(event)


def test_collect_preview_returns_phase(client, db, test_event: Event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}")
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == test_event.code
    assert body["phase"] == "collection"
    assert body["submission_cap_per_guest"] == 15


def test_collect_preview_404_for_unknown_code(client):
    r = client.get("/api/public/collect/ZZZZZZ")
    assert r.status_code == 404


def test_collect_leaderboard_empty(client, db, test_event: Event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard")
    assert r.status_code == 200
    body = r.json()
    assert body["requests"] == []
    assert body["total"] == 0


def test_collect_leaderboard_trending_sorts_by_votes(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    # collection_requests fixture creates 3 requests with vote_count 5, 2, 0
    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=trending")
    assert r.status_code == 200
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert votes == sorted(votes, reverse=True)
    # vote_count 0 excluded from trending
    assert 0 not in votes


def test_collect_leaderboard_all_tab_includes_zero_votes(
    client, db, test_event, collection_requests
):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    votes = [row["vote_count"] for row in r.json()["requests"]]
    assert 0 in votes


def test_collect_profile_set_nickname(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "DancingQueen"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["nickname"] == "DancingQueen"
    assert body["has_email"] is False
    assert body["submission_count"] == 0
    assert body["submission_cap"] == 15


def test_collect_profile_invalid_nickname_rejected(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "<script>alert(1)</script>"},
    )
    assert r.status_code == 422


def test_collect_profile_accepts_email(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "A", "email": "guest@example.com"},
    )
    assert r.status_code == 200
    assert r.json()["has_email"] is True


def test_collect_profile_me_empty_when_no_interactions(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.get(f"/api/public/collect/{test_event.code}/profile/me")
    assert r.status_code == 200
    body = r.json()
    assert body["submitted"] == []
    assert body["upvoted"] == []
    assert body["is_top_contributor"] is False


def test_collect_submit_creates_request_in_collection_phase(client, db, test_event):
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={
            "song_title": "Mr. Brightside",
            "artist": "The Killers",
            "source": "spotify",
            "source_url": "https://open.spotify.com/track/abc",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] > 0

    from app.models.request import Request as SongRequest

    row = db.query(SongRequest).filter(SongRequest.id == body["id"]).one()
    assert row.submitted_during_collection is True
    assert row.status == "new"


def test_collect_submit_rejected_during_live_phase(client, db, test_event):
    # event without collection fields → phase == "live"
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "A", "artist": "B", "source": "spotify"},
    )
    assert r.status_code == 409
    assert "Collection" in r.json()["detail"]


def test_collect_submit_blocked_at_cap(client, db, test_event):
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 2
    db.commit()
    for _ in range(2):
        r = client.post(
            f"/api/public/collect/{test_event.code}/requests",
            json={"song_title": "A", "artist": "B", "source": "spotify"},
        )
        assert r.status_code == 201
    r3 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "C", "artist": "D", "source": "spotify"},
    )
    assert r3.status_code == 429
    assert "Picks limit reached" in r3.json()["detail"]


def test_collect_vote_increments_count(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    req = collection_requests[0]
    before = req.vote_count
    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    assert r.status_code == 200
    db.refresh(req)
    assert req.vote_count == before + 1


def test_collect_vote_is_idempotent(client, db, test_event, collection_requests):
    _enable_collection(db, test_event)
    req = collection_requests[0]
    client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    before = db.query(type(req)).filter(type(req).id == req.id).one().vote_count
    client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": req.id},
    )
    after = db.query(type(req)).filter(type(req).id == req.id).one().vote_count
    assert after == before


def test_collect_leaderboard_all_tab_sorts_alphabetically(client, db, test_event):
    """The All tab should sort alphabetically (case-insensitive) by song title
    so guests can scan and upvote existing submissions without recency bias.
    """
    from datetime import timedelta

    from app.core.time import utcnow
    from app.models.request import Request as SongRequest
    from app.models.request import RequestStatus

    _enable_collection(db, test_event)
    now = utcnow()
    # Intentionally insert out of order, with mixed casing.
    for idx, title in enumerate(["zebra stripes", "Alpha Song", "mango tango"]):
        db.add(
            SongRequest(
                event_id=test_event.id,
                song_title=title,
                artist=f"Artist {idx}",
                source="spotify",
                status=RequestStatus.NEW.value,
                vote_count=0,
                dedupe_key=f"dk_alpha_{idx}",
                submitted_during_collection=True,
                created_at=now - timedelta(seconds=idx),
            )
        )
    db.commit()

    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    titles = [row["title"] for row in r.json()["requests"]]
    assert titles == ["Alpha Song", "mango tango", "zebra stripes"]


def test_collect_my_picks_voted_request_ids_includes_self_votes(
    client, db, test_event, collection_requests
):
    """voted_request_ids must include votes on own submissions, so the UI
    can disable the vote button for them even though they don't appear in
    the `upvoted` section (which is de-duped against `submitted`).
    """
    _enable_collection(db, test_event)
    from app.core.rate_limit import MAX_FINGERPRINT_LENGTH

    # TestClient's default remote host is "testclient"; take first N chars.
    fp = "testclient"[:MAX_FINGERPRINT_LENGTH]

    # Mark one collection request as submitted by this client so the backend
    # puts it under `submitted` (de-duped out of `upvoted`).
    target = collection_requests[0]
    target.client_fingerprint = fp
    db.commit()

    # Cast a vote on that same request.
    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": target.id},
    )
    assert r.status_code == 200

    me = client.get(f"/api/public/collect/{test_event.code}/profile/me")
    assert me.status_code == 200
    body = me.json()

    # The submission is in `submitted`, NOT in `upvoted` (dedupe behavior).
    assert any(s["id"] == target.id for s in body["submitted"])
    assert not any(u["id"] == target.id for u in body["upvoted"])
    # But voted_request_ids MUST include it — this is the fix.
    assert target.id in body["voted_request_ids"]
