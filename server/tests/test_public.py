"""Tests for public/kiosk endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.now_playing import NowPlaying
from app.models.request import Request, RequestStatus


class TestMyRequests:
    """Tests for GET /api/public/events/{code}/my-requests endpoint."""

    def test_my_requests_returns_own_requests(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that my-requests returns only requests matching the client fingerprint."""
        # TestClient default host is "testclient" — fingerprint derived from that
        req1 = Request(
            event_id=test_event.id,
            song_title="My Song",
            artist="My Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="my_req_001",
            client_fingerprint="testclient",
        )
        req2 = Request(
            event_id=test_event.id,
            song_title="Other Song",
            artist="Other Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="other_req_001",
            client_fingerprint="someone_else",
        )
        db.add_all([req1, req2])
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/my-requests")
        assert response.status_code == 200
        data = response.json()
        assert len(data["requests"]) == 1
        assert data["requests"][0]["title"] == "My Song"

    def test_my_requests_returns_all_statuses(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that my-requests includes all statuses, not just new/accepted."""
        statuses = [
            RequestStatus.NEW,
            RequestStatus.ACCEPTED,
            RequestStatus.PLAYING,
            RequestStatus.PLAYED,
            RequestStatus.REJECTED,
        ]
        for i, status in enumerate(statuses):
            req = Request(
                event_id=test_event.id,
                song_title=f"Song {status.value}",
                artist="Artist",
                source="spotify",
                status=status.value,
                dedupe_key=f"status_test_{i}",
                client_fingerprint="testclient",
            )
            db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/my-requests")
        assert response.status_code == 200
        data = response.json()
        assert len(data["requests"]) == 5
        returned_statuses = {r["status"] for r in data["requests"]}
        assert returned_statuses == {"new", "accepted", "playing", "played", "rejected"}

    def test_my_requests_empty(self, client: TestClient, test_event: Event):
        """Test that my-requests returns empty list when no requests match."""
        response = client.get(f"/api/public/events/{test_event.code}/my-requests")
        assert response.status_code == 200
        data = response.json()
        assert data["requests"] == []

    def test_my_requests_event_not_found(self, client: TestClient):
        """Test my-requests for nonexistent event."""
        response = client.get("/api/public/events/NOTFOUND/my-requests")
        assert response.status_code == 404

    def test_my_requests_includes_metadata(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that my-requests includes all expected fields."""
        req = Request(
            event_id=test_event.id,
            song_title="Detailed Song",
            artist="Detailed Artist",
            artwork_url="https://example.com/art.jpg",
            source="spotify",
            status=RequestStatus.ACCEPTED.value,
            dedupe_key="detailed_test_001",
            client_fingerprint="testclient",
            vote_count=5,
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/my-requests")
        assert response.status_code == 200
        data = response.json()
        r = data["requests"][0]
        assert r["title"] == "Detailed Song"
        assert r["artist"] == "Detailed Artist"
        assert r["artwork_url"] == "https://example.com/art.jpg"
        assert r["status"] == "accepted"
        assert r["vote_count"] == 5
        assert "created_at" in r


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
        # Create a playing request
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

        # Set now_playing via NowPlaying table (single source of truth)
        np = NowPlaying(
            event_id=test_event.id,
            title="Now Playing Song",
            artist="Playing Artist",
            matched_request_id=request.id,
            source="manual",
        )
        db.add(np)
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
