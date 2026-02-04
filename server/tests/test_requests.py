"""Tests for song request endpoints."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus


class TestSubmitRequest:
    """Tests for POST /api/events/{code}/requests endpoint."""

    def test_submit_request_success(self, client: TestClient, test_event: Event):
        """Test submitting a song request."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Test Song",
                "source": "spotify",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["artist"] == "Test Artist"
        assert data["song_title"] == "Test Song"
        assert data["status"] == "new"
        assert data["is_duplicate"] is False

    def test_submit_request_with_note(self, client: TestClient, test_event: Event):
        """Test submitting a request with a note."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Artist With Note",
                "title": "Song With Note",
                "source": "manual",
                "note": "Please play this for my birthday!",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["note"] == "Please play this for my birthday!"

    def test_submit_request_with_source_url(self, client: TestClient, test_event: Event):
        """Test submitting a request with source URL."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Spotify Artist",
                "title": "Spotify Song",
                "source": "spotify",
                "source_url": "https://open.spotify.com/track/abc123",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["source_url"] == "https://open.spotify.com/track/abc123"

    def test_submit_request_duplicate(self, client: TestClient, test_event: Event):
        """Test submitting a duplicate request."""
        # First request
        client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "Dupe Artist", "title": "Dupe Song", "source": "manual"},
        )
        # Second request with same artist/title
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "Dupe Artist", "title": "Dupe Song", "source": "manual"},
        )
        assert response.status_code == 200
        assert response.json()["is_duplicate"] is True

    def test_submit_request_event_not_found(self, client: TestClient):
        """Test submitting to nonexistent event."""
        response = client.post(
            "/api/events/NOTFOUND/requests",
            json={"artist": "Artist", "title": "Song", "source": "manual"},
        )
        assert response.status_code == 404

    def test_submit_request_missing_fields(self, client: TestClient, test_event: Event):
        """Test submitting request with missing required fields."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "Only Artist"},
        )
        assert response.status_code == 422


class TestListRequests:
    """Tests for GET /api/events/{code}/requests endpoint."""

    def test_list_requests_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, test_request: Request
    ):
        """Test listing requests for an event."""
        response = client.get(
            f"/api/events/{test_event.code}/requests",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == test_request.id

    def test_list_requests_filter_by_status(
        self, client: TestClient, auth_headers: dict, test_event: Event, test_request: Request
    ):
        """Test filtering requests by status."""
        response = client.get(
            f"/api/events/{test_event.code}/requests?status=new",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1

        response = client.get(
            f"/api/events/{test_event.code}/requests?status=played",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert len(response.json()) == 0

    def test_list_requests_no_auth(self, client: TestClient, test_event: Event):
        """Test listing requests without auth fails."""
        response = client.get(f"/api/events/{test_event.code}/requests")
        assert response.status_code == 401


class TestUpdateRequestStatus:
    """Tests for PATCH /api/requests/{id} endpoint."""

    def test_update_status_to_accepted(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """Test accepting a request."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "accepted"

    def test_update_status_to_playing(
        self, client: TestClient, auth_headers: dict, test_request: Request, db: Session
    ):
        """Test setting a request to playing updates now_playing."""
        # First accept it
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        # Then set to playing
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "playing"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "playing"

    def test_update_status_to_played(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """Test marking a request as played."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "played"

    def test_update_status_to_rejected(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """Test rejecting a request."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "rejected"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "rejected"

    def test_update_status_no_auth(self, client: TestClient, test_request: Request):
        """Test updating status without auth fails."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
        )
        assert response.status_code == 401

    def test_update_status_not_found(self, client: TestClient, auth_headers: dict):
        """Test updating nonexistent request."""
        response = client.patch(
            "/api/requests/99999",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        assert response.status_code == 404
