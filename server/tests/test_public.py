"""Tests for public/kiosk endpoints."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.now_playing import NowPlaying
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

    def test_kiosk_display_nickname_in_queue(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that nickname appears in accepted queue items."""
        request = Request(
            event_id=test_event.id,
            song_title="Party Song",
            artist="DJ Artist",
            source="manual",
            status=RequestStatus.ACCEPTED.value,
            dedupe_key="nickname_queue_test",
            nickname="Sarah",
        )
        db.add(request)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert len(data["accepted_queue"]) == 1
        assert data["accepted_queue"][0]["nickname"] == "Sarah"

    def test_kiosk_display_null_nickname(self, client: TestClient, test_event: Event, db: Session):
        """Test that nickname is null when not provided."""
        request = Request(
            event_id=test_event.id,
            song_title="No Name Song",
            artist="Anonymous",
            source="manual",
            status=RequestStatus.ACCEPTED.value,
            dedupe_key="no_nickname_test",
        )
        db.add(request)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/display")
        assert response.status_code == 200
        data = response.json()
        assert data["accepted_queue"][0]["nickname"] is None


class TestGuestRequestList:
    """Tests for GET /api/public/events/{code}/requests endpoint."""

    def test_nickname_in_guest_list(self, client: TestClient, test_event: Event, db: Session):
        """Test that nicknames appear in guest request list."""
        request = Request(
            event_id=test_event.id,
            song_title="My Jam",
            artist="Cool Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="guest_nick_test",
            nickname="Mike",
        )
        db.add(request)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        data = response.json()
        assert len(data["requests"]) == 1
        assert data["requests"][0]["nickname"] == "Mike"

    def test_no_nickname_in_guest_list(self, client: TestClient, test_event: Event, db: Session):
        """Test that nickname is null when not set."""
        request = Request(
            event_id=test_event.id,
            song_title="Anonymous Song",
            artist="Unknown",
            source="spotify",
            status=RequestStatus.ACCEPTED.value,
            dedupe_key="guest_no_nick_test",
        )
        db.add(request)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        data = response.json()
        assert data["requests"][0]["nickname"] is None


class TestSubmitRequestNickname:
    """Tests for nickname field in POST /api/events/{code}/requests."""

    def test_submit_with_nickname(self, client: TestClient, test_event: Event, db: Session):
        """Test submitting a request with a nickname."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Test Song",
                "nickname": "Sarah",
                "source": "manual",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "Sarah"

    def test_submit_without_nickname(self, client: TestClient, test_event: Event, db: Session):
        """Test submitting a request without a nickname."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Test Song No Nick",
                "source": "manual",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] is None

    def test_nickname_max_length(self, client: TestClient, test_event: Event, db: Session):
        """Test that nickname rejects values over 30 chars."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Long Nick Song",
                "nickname": "A" * 31,
                "source": "manual",
            },
        )
        assert response.status_code == 422

    def test_nickname_whitespace_normalized(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that nickname whitespace is normalized."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Whitespace Nick Song",
                "nickname": "  Sarah  ",
                "source": "manual",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] == "Sarah"

    def test_empty_nickname_becomes_null(self, client: TestClient, test_event: Event, db: Session):
        """Test that empty string nickname becomes null."""
        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={
                "artist": "Test Artist",
                "title": "Empty Nick Song",
                "nickname": "   ",
                "source": "manual",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["nickname"] is None
