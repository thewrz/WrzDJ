"""Tests for play history functionality."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.play_history import PlayHistory, PlaySource
from app.models.request import Request, RequestStatus
from app.services.play_history import add_manual_play, get_play_history, get_play_history_count


class TestPlayHistoryService:
    """Tests for the play history service layer."""

    def test_add_manual_play_creates_entry(
        self, db: Session, test_event: Event, test_request: Request
    ):
        """Test that add_manual_play creates a play history entry."""
        entry = add_manual_play(db, test_event, test_request)

        assert entry.id is not None
        assert entry.event_id == test_event.id
        assert entry.title == test_request.song_title
        assert entry.artist == test_request.artist
        assert entry.source == PlaySource.MANUAL.value
        assert entry.source_request_id == test_request.id
        assert entry.played_at is not None

    def test_add_manual_play_is_idempotent(
        self, db: Session, test_event: Event, test_request: Request
    ):
        """Test that calling add_manual_play twice returns the same entry."""
        entry1 = add_manual_play(db, test_event, test_request)
        entry2 = add_manual_play(db, test_event, test_request)

        assert entry1.id == entry2.id

    def test_get_play_history_returns_entries(
        self, db: Session, test_event: Event, test_request: Request
    ):
        """Test that get_play_history returns entries in descending order."""
        add_manual_play(db, test_event, test_request)

        history = get_play_history(db, test_event)

        assert len(history) == 1
        assert history[0].title == test_request.song_title

    def test_get_play_history_respects_limit(
        self, db: Session, test_event: Event
    ):
        """Test that get_play_history respects the limit parameter."""
        # Create multiple requests and play them
        for i in range(5):
            request = Request(
                event_id=test_event.id,
                song_title=f"Song {i}",
                artist=f"Artist {i}",
                source="manual",
                status=RequestStatus.PLAYED.value,
                dedupe_key=f"dedupe_key_{i}_12345678",
            )
            db.add(request)
            db.commit()
            db.refresh(request)
            add_manual_play(db, test_event, request)

        history = get_play_history(db, test_event, limit=3)

        assert len(history) == 3

    def test_get_play_history_respects_offset(
        self, db: Session, test_event: Event
    ):
        """Test that get_play_history respects the offset parameter."""
        # Create multiple requests and play them
        requests = []
        for i in range(5):
            request = Request(
                event_id=test_event.id,
                song_title=f"Song {i}",
                artist=f"Artist {i}",
                source="manual",
                status=RequestStatus.PLAYED.value,
                dedupe_key=f"dedupe_key_{i}_12345678",
            )
            db.add(request)
            db.commit()
            db.refresh(request)
            add_manual_play(db, test_event, request)
            requests.append(request)

        history_all = get_play_history(db, test_event, limit=10, offset=0)
        history_offset = get_play_history(db, test_event, limit=10, offset=2)

        assert len(history_all) == 5
        assert len(history_offset) == 3

    def test_get_play_history_count(
        self, db: Session, test_event: Event, test_request: Request
    ):
        """Test that get_play_history_count returns correct count."""
        assert get_play_history_count(db, test_event) == 0

        add_manual_play(db, test_event, test_request)

        assert get_play_history_count(db, test_event) == 1


class TestPlayHistoryAPI:
    """Tests for the play history API endpoint."""

    def test_get_history_empty(self, client: TestClient, test_event: Event):
        """Test getting history when none exists."""
        response = client.get(f"/api/public/events/{test_event.code}/history")

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_get_history_with_entries(
        self, client: TestClient, test_event: Event, db: Session, test_request: Request
    ):
        """Test getting history with entries."""
        add_manual_play(db, test_event, test_request)

        response = client.get(f"/api/public/events/{test_event.code}/history")

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["title"] == test_request.song_title
        assert data["items"][0]["artist"] == test_request.artist
        assert data["total"] == 1

    def test_get_history_respects_limit(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that the limit parameter works."""
        # Create multiple history entries
        for i in range(5):
            request = Request(
                event_id=test_event.id,
                song_title=f"Song {i}",
                artist=f"Artist {i}",
                source="manual",
                status=RequestStatus.PLAYED.value,
                dedupe_key=f"dedupe_key_{i}_12345678",
            )
            db.add(request)
            db.commit()
            db.refresh(request)
            add_manual_play(db, test_event, request)

        response = client.get(f"/api/public/events/{test_event.code}/history?limit=3")

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 3
        assert data["limit"] == 3
        assert data["total"] == 5

    def test_get_history_event_not_found(self, client: TestClient):
        """Test getting history for nonexistent event."""
        response = client.get("/api/public/events/NOTFOUND/history")

        assert response.status_code == 404


class TestPlayedStatusIntegration:
    """Tests for the integration between request status updates and play history."""

    def test_marking_as_played_creates_history(
        self, client: TestClient, auth_headers: dict, test_request: Request, db: Session
    ):
        """Test that marking a request as played creates a history entry."""
        # Verify no history initially
        history_before = get_play_history(db, test_request.event)
        assert len(history_before) == 0

        # Mark request as played
        response = client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )
        assert response.status_code == 200

        # Verify history entry was created
        history_after = get_play_history(db, test_request.event)
        assert len(history_after) == 1
        assert history_after[0].title == test_request.song_title
        assert history_after[0].source_request_id == test_request.id

    def test_marking_as_played_twice_creates_one_entry(
        self, client: TestClient, auth_headers: dict, test_request: Request, db: Session
    ):
        """Test that marking a request as played twice only creates one history entry."""
        # Mark as played twice
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )
        client.patch(
            f"/api/requests/{test_request.id}",
            json={"status": "played"},
            headers=auth_headers,
        )

        # Should still only have one entry due to idempotency
        history = get_play_history(db, test_request.event)
        assert len(history) == 1
