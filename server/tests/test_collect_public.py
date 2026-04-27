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
    for i in range(2):
        r = client.post(
            f"/api/public/collect/{test_event.code}/requests",
            json={"song_title": f"Song {i}", "artist": f"Artist {i}", "source": "spotify"},
        )
        assert r.status_code == 201
    r3 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Song 99", "artist": "Artist 99", "source": "spotify"},
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


def test_collect_self_vote_blocked_not_in_voted_ids(client, db, test_event):
    """Self-voting is blocked, so voted_request_ids should not include
    own submissions (since the vote was rejected).
    """
    _enable_collection(db, test_event)

    target = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "My Song", "artist": "My Artist", "source": "spotify"},
    )
    assert target.status_code == 201
    target_id = target.json()["id"]

    # Self-vote should be rejected.
    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": target_id},
    )
    assert r.status_code == 409

    me = client.get(f"/api/public/collect/{test_event.code}/profile/me")
    assert me.status_code == 200
    body = me.json()

    assert any(s["id"] == target_id for s in body["submitted"])
    assert target_id not in body["voted_request_ids"]


def test_collect_activity_log_entries_for_state_changes(client, db, test_event):
    """Submit, vote, and profile-set should each write one ActivityLog row
    tagged with the masked fingerprint so DJs can audit guest activity.
    """
    from app.models.activity_log import ActivityLog
    from app.models.request import Request as SongRequest
    from app.services.dedup import compute_dedupe_key

    _enable_collection(db, test_event)

    # 1. Submit a song.
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Log Me", "artist": "Audit", "source": "spotify"},
    )
    assert r.status_code == 201

    # 2. Vote on a DIFFERENT request (not our own — self-voting is blocked).
    key = compute_dedupe_key("Other", "Song")
    other_row = SongRequest(
        event_id=test_event.id,
        song_title="Song",
        artist="Other",
        source="spotify",
        status="new",
        dedupe_key=key,
        client_fingerprint="someone-else",
        submitted_during_collection=True,
    )
    db.add(other_row)
    db.commit()
    db.refresh(other_row)

    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": other_row.id},
    )
    assert r.status_code == 200

    # 2b. Vote again — idempotent, should NOT create a second activity row.
    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": other_row.id},
    )
    assert r.status_code == 200

    # 3. Set a nickname.
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "LogTester"},
    )
    assert r.status_code == 200

    rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.event_code == test_event.code)
        .filter(ActivityLog.source == "collect")
        .order_by(ActivityLog.id.asc())
        .all()
    )
    assert len(rows) == 3, (
        f"expected 3 collect activity rows, got {len(rows)}: {[r.message for r in rows]}"
    )
    assert "submitted" in rows[0].message
    assert "'Log Me'" in rows[0].message
    assert "voted" in rows[1].message
    assert "updated profile" in rows[2].message
    import re

    for row in rows:
        assert re.search(r"\[[0-9a-f]{12}\]", row.message), f"missing masked fp: {row.message}"


def test_collect_get_profile_does_not_create_row(client, db, test_event):
    """GET /profile returns defaults without creating a GuestProfile row —
    reads should not have write side effects, and ActivityLog must stay clean.
    """
    from app.models.activity_log import ActivityLog
    from app.models.guest_profile import GuestProfile

    _enable_collection(db, test_event)

    before_rows = db.query(GuestProfile).count()
    before_log = db.query(ActivityLog).count()

    r = client.get(f"/api/public/collect/{test_event.code}/profile")
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "nickname": None,
        "has_email": False,
        "submission_count": 0,
        "submission_cap": test_event.submission_cap_per_guest,
    }

    assert db.query(GuestProfile).count() == before_rows, (
        "GET /profile must not create a GuestProfile row"
    )
    assert db.query(ActivityLog).count() == before_log, "GET /profile must not write to ActivityLog"


def test_collect_get_profile_returns_existing_state(client, db, test_event):
    """When a GuestProfile exists, GET returns its fields faithfully."""
    _enable_collection(db, test_event)

    # POST a real nickname + email first.
    r = client.post(
        f"/api/public/collect/{test_event.code}/profile",
        json={"nickname": "Reader", "email": "reader@example.com"},
    )
    assert r.status_code == 200

    # Now read it back via GET.
    r = client.get(f"/api/public/collect/{test_event.code}/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["nickname"] == "Reader"
    assert body["has_email"] is True
    assert body["submission_cap"] == test_event.submission_cap_per_guest


# ── Dedup tests ──────────────────────────────────────────────────────────────


def test_collect_submit_same_user_duplicate_returns_409(client, db, test_event):
    """Same fingerprint submitting the same song twice → 409."""
    _enable_collection(db, test_event)
    payload = {"song_title": "Mr. Brightside", "artist": "The Killers", "source": "spotify"}
    r1 = client.post(f"/api/public/collect/{test_event.code}/requests", json=payload)
    assert r1.status_code == 201

    r2 = client.post(f"/api/public/collect/{test_event.code}/requests", json=payload)
    assert r2.status_code == 409
    assert "already" in r2.json()["detail"].lower()


def test_collect_submit_same_user_duplicate_case_insensitive(client, db, test_event):
    """Dedup is case-insensitive: 'The Killers' == 'the killers'."""
    _enable_collection(db, test_event)
    r1 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Mr. Brightside", "artist": "The Killers", "source": "spotify"},
    )
    assert r1.status_code == 201

    r2 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "mr. brightside", "artist": "the killers", "source": "spotify"},
    )
    assert r2.status_code == 409


def test_collect_submit_different_user_duplicate_auto_votes(client, db, test_event):
    """Different fingerprint submitting the same song → 200, is_duplicate=true, vote added."""
    _enable_collection(db, test_event)
    from app.models.request import Request as SongRequest
    from app.services.dedup import compute_dedupe_key

    key = compute_dedupe_key("The Killers", "Mr. Brightside")
    row = SongRequest(
        event_id=test_event.id,
        song_title="Mr. Brightside",
        artist="The Killers",
        source="spotify",
        status="new",
        dedupe_key=key,
        client_fingerprint="other-user-ip",
        submitted_during_collection=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    original_votes = row.vote_count

    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Mr. Brightside", "artist": "The Killers", "source": "spotify"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_duplicate"] is True
    assert body["id"] == row.id

    db.refresh(row)
    assert row.vote_count == original_votes + 1


def test_collect_submit_different_user_duplicate_no_pick_slot(client, db, test_event):
    """Duplicate submission by different user must NOT consume a pick slot."""
    _enable_collection(db, test_event)
    test_event.submission_cap_per_guest = 1
    db.commit()

    from app.models.request import Request as SongRequest
    from app.services.dedup import compute_dedupe_key

    key = compute_dedupe_key("The Killers", "Mr. Brightside")
    db.add(
        SongRequest(
            event_id=test_event.id,
            song_title="Mr. Brightside",
            artist="The Killers",
            source="spotify",
            status="new",
            dedupe_key=key,
            client_fingerprint="other-user-ip",
            submitted_during_collection=True,
        )
    )
    db.commit()

    # This is a duplicate → should not consume the only pick slot
    r1 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Mr. Brightside", "artist": "The Killers", "source": "spotify"},
    )
    assert r1.status_code == 200
    assert r1.json()["is_duplicate"] is True

    # Now submit a genuinely new song → should succeed (pick slot still available)
    r2 = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "Somebody Told Me", "artist": "The Killers", "source": "spotify"},
    )
    assert r2.status_code == 201


def test_collect_submit_new_request_returns_is_duplicate_false(client, db, test_event):
    """Fresh submission returns is_duplicate=false."""
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "New Song", "artist": "New Artist", "source": "spotify"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["is_duplicate"] is False


# ── Self-vote tests ──────────────────────────────────────────────────────────


def test_collect_vote_self_vote_blocked(client, db, test_event):
    """Submitter cannot vote on their own request → 409."""
    _enable_collection(db, test_event)
    r = client.post(
        f"/api/public/collect/{test_event.code}/requests",
        json={"song_title": "My Song", "artist": "My Artist", "source": "spotify"},
    )
    assert r.status_code == 201
    request_id = r.json()["id"]

    r2 = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": request_id},
    )
    assert r2.status_code == 409
    assert "own" in r2.json()["detail"].lower()


def test_collect_vote_other_user_still_works(client, db, test_event):
    """Voting on someone else's request still works normally."""
    _enable_collection(db, test_event)
    from app.models.request import Request as SongRequest
    from app.services.dedup import compute_dedupe_key

    key = compute_dedupe_key("Other Artist", "Other Song")
    row = SongRequest(
        event_id=test_event.id,
        song_title="Other Song",
        artist="Other Artist",
        source="spotify",
        status="new",
        dedupe_key=key,
        client_fingerprint="different-user",
        submitted_during_collection=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    r = client.post(
        f"/api/public/collect/{test_event.code}/vote",
        json={"request_id": row.id},
    )
    assert r.status_code == 200
    db.refresh(row)
    assert row.vote_count == 1
