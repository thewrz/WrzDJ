"""Tests for batch request operations (reject-all, bulk delete)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.request_vote import RequestVote
from app.models.user import User
from app.services.auth import get_password_hash
from app.services.request import bulk_delete_requests, reject_all_new_requests


def _create_request(db: Session, event: Event, title: str, status: str = "new") -> Request:
    """Helper to create a request with a unique dedupe key."""
    r = Request(
        event_id=event.id,
        song_title=title,
        artist="Artist",
        source="manual",
        status=status,
        dedupe_key=f"dedupe_{title}_{status}",
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


class TestRejectAllNewRequests:
    """Tests for reject_all_new_requests service function."""

    def test_rejects_all_new(self, db: Session, test_event: Event):
        _create_request(db, test_event, "Song A", "new")
        _create_request(db, test_event, "Song B", "new")
        _create_request(db, test_event, "Song C", "accepted")

        count = reject_all_new_requests(db, test_event)
        assert count == 2

        remaining_new = (
            db.query(Request)
            .filter(Request.event_id == test_event.id, Request.status == "new")
            .count()
        )
        assert remaining_new == 0

    def test_does_not_reject_non_new(self, db: Session, test_event: Event):
        _create_request(db, test_event, "Accepted", "accepted")
        _create_request(db, test_event, "Rejected", "rejected")
        _create_request(db, test_event, "Playing", "playing")

        count = reject_all_new_requests(db, test_event)
        assert count == 0

    def test_returns_zero_for_empty_event(self, db: Session, test_event: Event):
        count = reject_all_new_requests(db, test_event)
        assert count == 0

    def test_sets_rejected_status(self, db: Session, test_event: Event):
        req = _create_request(db, test_event, "Song", "new")
        reject_all_new_requests(db, test_event)
        db.refresh(req)
        assert req.status == RequestStatus.REJECTED.value


class TestBulkDeleteRequests:
    """Tests for bulk_delete_requests service function."""

    def test_deletes_all_when_no_status_filter(self, db: Session, test_event: Event):
        _create_request(db, test_event, "A", "new")
        _create_request(db, test_event, "B", "accepted")
        _create_request(db, test_event, "C", "rejected")

        count = bulk_delete_requests(db, test_event)
        assert count == 3

        remaining = db.query(Request).filter(Request.event_id == test_event.id).count()
        assert remaining == 0

    def test_deletes_only_matching_status(self, db: Session, test_event: Event):
        _create_request(db, test_event, "A", "new")
        _create_request(db, test_event, "B", "rejected")
        _create_request(db, test_event, "C", "rejected")

        count = bulk_delete_requests(db, test_event, status="rejected")
        assert count == 2

        remaining = db.query(Request).filter(Request.event_id == test_event.id).count()
        assert remaining == 1

    def test_returns_zero_for_empty_event(self, db: Session, test_event: Event):
        count = bulk_delete_requests(db, test_event)
        assert count == 0

    def test_cascades_vote_deletion(self, db: Session, test_event: Event):
        req = _create_request(db, test_event, "Song", "new")
        vote = RequestVote(
            request_id=req.id,
            client_fingerprint="test-fp",
        )
        db.add(vote)
        db.commit()

        count = bulk_delete_requests(db, test_event)
        assert count == 1
        assert db.query(RequestVote).count() == 0


class TestRejectAllEndpoint:
    """Tests for POST /api/events/{code}/requests/reject-all."""

    def test_reject_all_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        _create_request(db, test_event, "A", "new")
        _create_request(db, test_event, "B", "new")

        response = client.post(
            f"/api/events/{test_event.code}/requests/reject-all",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["count"] == 2

    def test_reject_all_returns_zero_when_none_new(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        _create_request(db, test_event, "Accepted", "accepted")

        response = client.post(
            f"/api/events/{test_event.code}/requests/reject-all",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["count"] == 0

    def test_reject_all_requires_auth(self, client: TestClient, test_event: Event):
        response = client.post(
            f"/api/events/{test_event.code}/requests/reject-all",
        )
        assert response.status_code == 401

    def test_reject_all_requires_event_ownership(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Another DJ cannot reject requests on someone else's event."""
        other_user = User(
            username="otherdj",
            password_hash=get_password_hash("otherpassword123"),
            role="dj",
        )
        db.add(other_user)
        db.commit()

        login_resp = client.post(
            "/api/auth/login",
            data={"username": "otherdj", "password": "otherpassword123"},
        )
        assert login_resp.status_code == 200
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        response = client.post(
            f"/api/events/{test_event.code}/requests/reject-all",
            headers=other_headers,
        )
        # get_owned_event returns 404 for non-owners (doesn't leak event existence)
        assert response.status_code == 404


class TestBulkDeleteEndpoint:
    """Tests for DELETE /api/events/{code}/requests/bulk."""

    def test_bulk_delete_all(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        _create_request(db, test_event, "A", "new")
        _create_request(db, test_event, "B", "rejected")

        response = client.delete(
            f"/api/events/{test_event.code}/requests/bulk",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["count"] == 2

    def test_bulk_delete_with_status_filter(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        _create_request(db, test_event, "A", "new")
        _create_request(db, test_event, "B", "rejected")

        response = client.delete(
            f"/api/events/{test_event.code}/requests/bulk?status=rejected",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["count"] == 1

        remaining = db.query(Request).filter(Request.event_id == test_event.id).count()
        assert remaining == 1

    def test_bulk_delete_requires_auth(self, client: TestClient, test_event: Event):
        response = client.delete(
            f"/api/events/{test_event.code}/requests/bulk",
        )
        assert response.status_code == 401

    def test_bulk_delete_empty_returns_zero(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        response = client.delete(
            f"/api/events/{test_event.code}/requests/bulk",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["count"] == 0
