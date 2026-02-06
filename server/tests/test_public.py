"""Tests for public/kiosk endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus


class TestKioskDisplay:
    """Tests for GET /api/public/events/{code}/display endpoint."""

    def test_kiosk_display_success(self, client: TestClient, test_event: Event):
        """Test getting kiosk display data."""
        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert data["event"]["code"] == test_event.code
        assert data["event"]["name"] == test_event.name
        assert "qr_join_url" in data
        assert "accepted_queue" in data
        assert "now_playing" in data
        assert "updated_at" in data

    def test_kiosk_display_event_not_found(self, client: TestClient):
        """Test kiosk display for nonexistent event."""
        response = client.get("/api/public/events/NOTFOUND/display")
        assert response.status_code == 404

    def test_kiosk_display_accepted_queue(self, client: TestClient, test_event: Event, db: Session):
        """Test that accepted requests appear in queue."""
        # Create an accepted request
        request = Request(
            event_id=test_event.id,
            song_title="Accepted Song",
            artist="Queue Artist",
            source="manual",
            status=RequestStatus.ACCEPTED.value,
            dedupe_key="accepted_queue_test_123",
        )
        db.add(request)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert len(data["accepted_queue"]) == 1
        assert data["accepted_queue"][0]["title"] == "Accepted Song"
        assert data["accepted_queue"][0]["artist"] == "Queue Artist"

    def test_kiosk_display_now_playing(self, client: TestClient, test_event: Event, db: Session):
        """Test that now_playing shows the current song."""
        # Create a playing request and set as now_playing
        request = Request(
            event_id=test_event.id,
            song_title="Now Playing Song",
            artist="Playing Artist",
            source="manual",
            status=RequestStatus.PLAYING.value,
            dedupe_key="now_playing_test_123",
        )
        db.add(request)
        db.commit()
        db.refresh(request)

        # Set as now_playing on event
        test_event.now_playing_request_id = request.id
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert data["now_playing"] is not None
        assert data["now_playing"]["title"] == "Now Playing Song"
        assert data["now_playing"]["artist"] == "Playing Artist"

    def test_kiosk_display_no_now_playing(self, client: TestClient, test_event: Event):
        """Test kiosk display when nothing is playing."""
        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert data["now_playing"] is None

    def test_kiosk_display_qr_url_format(self, client: TestClient, test_event: Event):
        """Test QR join URL is properly formatted."""
        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert test_event.code in data["qr_join_url"]
        assert "/join/" in data["qr_join_url"]
