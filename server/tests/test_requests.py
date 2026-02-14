"""Tests for song request endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request
from app.models.user import User
from app.services.auth import get_password_hash


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

    def test_submit_request_with_metadata(self, client: TestClient, test_event: Event):
        """Test submitting a request with genre/bpm/key metadata."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "DJ Pierre",
                "title": "Acid Phase",
                "source": "spotify",
                "genre": "Acid House",
                "bpm": 126,
                "musical_key": "F Minor",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["genre"] == "Acid House"
        assert data["bpm"] == 126.0
        assert data["musical_key"] == "4A"  # F Minor -> 4A in Camelot

    def test_submit_request_metadata_optional(self, client: TestClient, test_event: Event):
        """Test that metadata fields are optional and default to null."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "Plain Artist", "title": "Plain Song"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["genre"] is None
        assert data["bpm"] is None
        assert data["musical_key"] is None

    def test_submit_request_key_normalization(self, client: TestClient, test_event: Event):
        """Test that musical key is normalized to Camelot notation."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Artist",
                "title": "Key Test",
                "musical_key": "D Minor",
            },
        )
        assert response.status_code == 200
        assert response.json()["musical_key"] == "7A"

    def test_submit_request_bpm_validation(self, client: TestClient, test_event: Event):
        """Test BPM validation boundaries."""
        # BPM too low
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "A", "title": "T", "bpm": 0},
        )
        assert response.status_code == 422

        # BPM too high
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "A", "title": "T", "bpm": 1000},
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
        """Test marking a request as played (via valid transition path)."""
        # Must follow valid path: NEW -> ACCEPTED -> PLAYING -> PLAYED
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "playing"},
            headers=auth_headers,
        )
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


class TestStatusStateMachine:
    """Tests for request status transition validation."""

    def test_invalid_new_to_played(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """NEW -> PLAYED is not a valid transition."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "Cannot transition" in response.json()["detail"]

    def test_invalid_new_to_playing(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """NEW -> PLAYING is not a valid transition."""
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "playing"},
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_invalid_played_to_any(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """PLAYED is a terminal state — no transitions allowed."""
        # Move to PLAYED via valid path
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "playing"},
            headers=auth_headers,
        )
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )
        # Try to transition from PLAYED
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "new"},
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_rejected_to_new(self, client: TestClient, auth_headers: dict, test_request: Request):
        """REJECTED -> NEW is valid (re-queue)."""
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "rejected"},
            headers=auth_headers,
        )
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "new"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "new"

    def test_accepted_to_rejected(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """ACCEPTED -> REJECTED is valid."""
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "rejected"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "rejected"


class TestDeleteRequest:
    """Tests for DELETE /api/requests/{id} endpoint."""

    def test_delete_request_success(
        self, client: TestClient, auth_headers: dict, test_request: Request
    ):
        """Test deleting a request."""
        response = client.delete(
            f"/api/requests/{test_request.id}",
            headers=auth_headers,
        )
        assert response.status_code == 204

        # Verify it's gone
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "accepted"},
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_delete_request_not_found(self, client: TestClient, auth_headers: dict):
        """Test deleting a nonexistent request."""
        response = client.delete(
            "/api/requests/99999",
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_delete_request_unauthorized(
        self, client: TestClient, db: Session, test_request: Request
    ):
        """Test deleting another user's request returns 403."""
        other_user = User(
            username="otheruser",
            password_hash=get_password_hash("otherpassword123"),
            role="dj",
        )
        db.add(other_user)
        db.commit()

        login_resp = client.post(
            "/api/auth/login",
            data={"username": "otheruser", "password": "otherpassword123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        response = client.delete(
            f"/api/requests/{test_request.id}",
            headers=other_headers,
        )
        assert response.status_code == 403

    def test_delete_request_no_auth(self, client: TestClient, test_request: Request):
        """Test deleting without auth fails."""
        response = client.delete(f"/api/requests/{test_request.id}")
        assert response.status_code == 401


class TestRefreshMetadata:
    """Tests for POST /api/requests/{id}/refresh-metadata endpoint."""

    def test_refresh_metadata_success(
        self, client: TestClient, auth_headers: dict, test_request: Request, db: Session
    ):
        """Test refreshing metadata clears existing fields."""
        # Set some metadata first
        test_request.genre = "House"
        test_request.bpm = 128.0
        test_request.musical_key = "8A"
        db.commit()

        response = client.post(
            f"/api/requests/{test_request.id}/refresh-metadata",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        # Metadata should be cleared (re-enrichment happens in background)
        assert data["genre"] is None
        assert data["bpm"] is None
        assert data["musical_key"] is None

    def test_refresh_metadata_not_found(self, client: TestClient, auth_headers: dict):
        """Test refreshing metadata of a nonexistent request."""
        response = client.post(
            "/api/requests/99999/refresh-metadata",
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_refresh_metadata_unauthorized(
        self, client: TestClient, db: Session, test_request: Request
    ):
        """Test refreshing another user's request returns 403."""
        other_user = User(
            username="otheruser2",
            password_hash=get_password_hash("otherpassword123"),
            role="dj",
        )
        db.add(other_user)
        db.commit()

        login_resp = client.post(
            "/api/auth/login",
            data={"username": "otheruser2", "password": "otherpassword123"},
        )
        other_headers = {"Authorization": f"Bearer {login_resp.json()['access_token']}"}

        response = client.post(
            f"/api/requests/{test_request.id}/refresh-metadata",
            headers=other_headers,
        )
        assert response.status_code == 403

    def test_refresh_metadata_no_auth(self, client: TestClient, test_request: Request):
        """Test refreshing without auth fails."""
        response = client.post(f"/api/requests/{test_request.id}/refresh-metadata")
        assert response.status_code == 401
