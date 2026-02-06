"""Tests for event endpoints."""

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.user import User


class TestCreateEvent:
    """Tests for POST /api/events endpoint."""

    def test_create_event_success(self, client: TestClient, auth_headers: dict):
        """Test creating an event succeeds."""
        response = client.post(
            "/api/events",
            json={"name": "My DJ Set", "expires_hours": 4},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "My DJ Set"
        assert "code" in data
        assert len(data["code"]) == 6
        assert data["is_active"] is True

    def test_create_event_no_auth(self, client: TestClient):
        """Test creating an event without auth fails."""
        response = client.post(
            "/api/events",
            json={"name": "My DJ Set"},
        )
        assert response.status_code == 401

    def test_create_event_default_expiry(self, client: TestClient, auth_headers: dict):
        """Test creating an event with default expiry."""
        response = client.post(
            "/api/events",
            json={"name": "Default Expiry Event"},
            headers=auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        # Default is 6 hours
        expires_at = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
        assert expires_at > datetime.now(expires_at.tzinfo)


class TestListEvents:
    """Tests for GET /api/events endpoint."""

    def test_list_events_empty(self, client: TestClient, auth_headers: dict):
        """Test listing events when none exist."""
        response = client.get("/api/events", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    def test_list_events_with_event(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test listing events returns user's events."""
        response = client.get("/api/events", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["code"] == test_event.code

    def test_list_events_no_auth(self, client: TestClient):
        """Test listing events without auth fails."""
        response = client.get("/api/events")
        assert response.status_code == 401


class TestGetEvent:
    """Tests for GET /api/events/{code} endpoint."""

    def test_get_event_success(self, client: TestClient, test_event: Event):
        """Test getting an event by code."""
        response = client.get(f"/api/events/{test_event.code}")
        assert response.status_code == 200
        data = response.json()
        assert data["code"] == test_event.code
        assert data["name"] == test_event.name

    def test_get_event_not_found(self, client: TestClient):
        """Test getting a nonexistent event returns 404."""
        response = client.get("/api/events/NOTFND")
        assert response.status_code == 404
        assert response.json()["detail"] == "Event not found"


class TestUpdateEvent:
    """Tests for PATCH /api/events/{code} endpoint."""

    def test_update_event_name(self, client: TestClient, auth_headers: dict, test_event: Event):
        """Test updating event name."""
        response = client.patch(
            f"/api/events/{test_event.code}",
            json={"name": "Updated Name"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Name"

    def test_update_event_expiry(self, client: TestClient, auth_headers: dict, test_event: Event):
        """Test updating event expiry."""
        new_expiry = (datetime.utcnow() + timedelta(hours=12)).isoformat()
        response = client.patch(
            f"/api/events/{test_event.code}",
            json={"expires_at": new_expiry},
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_update_event_no_auth(self, client: TestClient, test_event: Event):
        """Test updating event without auth fails."""
        response = client.patch(
            f"/api/events/{test_event.code}",
            json={"name": "Hacked Name"},
        )
        assert response.status_code == 401


class TestDeleteEvent:
    """Tests for DELETE /api/events/{code} endpoint."""

    def test_delete_event_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test deleting an event."""
        response = client.delete(
            f"/api/events/{test_event.code}",
            headers=auth_headers,
        )
        assert response.status_code == 204

        # Verify event is deleted
        event = db.query(Event).filter(Event.code == test_event.code).first()
        assert event is None

    def test_delete_event_no_auth(self, client: TestClient, test_event: Event):
        """Test deleting event without auth fails."""
        response = client.delete(f"/api/events/{test_event.code}")
        assert response.status_code == 401

    def test_delete_event_not_found(self, client: TestClient, auth_headers: dict):
        """Test deleting nonexistent event."""
        response = client.delete(
            "/api/events/NOTFND",
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestExpiredEvents:
    """Tests for expired event handling with 410 Gone status."""

    def test_get_expired_event_returns_410(self, client: TestClient, db: Session, test_user: User):
        """Test that getting an expired event returns 410 Gone."""
        # Create an expired event
        expired_event = Event(
            code="EXPIR1",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(f"/api/events/{expired_event.code}")
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has expired"

    def test_submit_request_to_expired_event_returns_410(
        self, client: TestClient, db: Session, test_user: User
    ):
        """Test that submitting a request to expired event returns 410."""
        expired_event = Event(
            code="EXPIR2",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.post(
            f"/api/events/{expired_event.code}/requests",
            json={"artist": "Test Artist", "title": "Test Song"},
        )
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has expired"

    def test_owner_can_view_requests_for_expired_event(
        self, client: TestClient, db: Session, test_user: User, auth_headers: dict
    ):
        """Test that owner can still view requests for expired events."""
        expired_event = Event(
            code="EXPIR3",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(
            f"/api/events/{expired_event.code}/requests",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_kiosk_display_expired_event_returns_410(
        self, client: TestClient, db: Session, test_user: User
    ):
        """Test that kiosk display for expired event returns 410."""
        expired_event = Event(
            code="EXPIR4",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(f"/api/public/events/{expired_event.code}/display")
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has expired"

    def test_404_vs_410_distinction(self, client: TestClient, db: Session, test_user: User):
        """Test that 404 is for not found and 410 is for expired."""
        # Non-existent event should be 404
        response = client.get("/api/events/NOEXST")
        assert response.status_code == 404
        assert response.json()["detail"] == "Event not found"

        # Expired event should be 410
        expired_event = Event(
            code="EXPIR5",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(f"/api/events/{expired_event.code}")
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has expired"


class TestArchiveEvents:
    """Tests for event archiving functionality."""

    def test_archive_event_success(self, client: TestClient, auth_headers: dict, test_event: Event):
        """Test archiving an event."""
        response = client.post(
            f"/api/events/{test_event.code}/archive",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["archived_at"] is not None
        assert data["status"] == "archived"

    def test_archive_event_no_auth(self, client: TestClient, test_event: Event):
        """Test archiving without auth fails."""
        response = client.post(f"/api/events/{test_event.code}/archive")
        assert response.status_code == 401

    def test_archive_already_archived_event(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test archiving an already archived event returns 400."""
        test_event.archived_at = datetime.utcnow()
        db.commit()

        response = client.post(
            f"/api/events/{test_event.code}/archive",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Event is already archived"

    def test_unarchive_event_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test unarchiving an event."""
        # First archive it
        test_event.archived_at = datetime.utcnow()
        db.commit()

        response = client.post(
            f"/api/events/{test_event.code}/unarchive",
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["archived_at"] is None

    def test_unarchive_not_archived_event(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test unarchiving a non-archived event returns 400."""
        response = client.post(
            f"/api/events/{test_event.code}/unarchive",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "Event is not archived"

    def test_get_archived_event_returns_410(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that getting an archived event returns 410."""
        test_event.archived_at = datetime.utcnow()
        db.commit()

        response = client.get(f"/api/events/{test_event.code}")
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has been archived"

    def test_submit_request_to_archived_event_returns_410(
        self, client: TestClient, test_event: Event, db: Session
    ):
        """Test that submitting to archived event returns 410."""
        test_event.archived_at = datetime.utcnow()
        db.commit()

        response = client.post(
            f"/api/events/{test_event.code}/requests",
            json={"artist": "Test Artist", "title": "Test Song"},
        )
        assert response.status_code == 410
        assert response.json()["detail"] == "Event has been archived"

    def test_list_archived_events(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test listing archived and expired events."""
        # Create an archived event
        archived_event = Event(
            code="ARCHV1",
            name="Archived Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
            archived_at=datetime.utcnow(),
        )
        db.add(archived_event)

        # Create an expired event
        expired_event = Event(
            code="EXPRD1",
            name="Expired Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get("/api/events/archived", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()

        # Should have both archived and expired events
        assert len(data) == 2
        codes = [e["code"] for e in data]
        assert "ARCHV1" in codes
        assert "EXPRD1" in codes

        # Verify status fields
        for event in data:
            assert event["status"] in ["archived", "expired"]
            assert "request_count" in event

    def test_archived_events_include_request_count(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test that archived events listing includes request counts."""
        # Create an archived event with requests
        archived_event = Event(
            code="ARCHV2",
            name="Archived With Requests",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
            archived_at=datetime.utcnow(),
        )
        db.add(archived_event)
        db.flush()

        # Add some requests
        for i in range(3):
            req = Request(
                event_id=archived_event.id,
                song_title=f"Song {i}",
                artist="Artist",
                source="manual",
                status=RequestStatus.NEW.value,
                dedupe_key=f"dedupe_key_{i}",
            )
            db.add(req)
        db.commit()

        response = client.get("/api/events/archived", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()

        archived = next(e for e in data if e["code"] == "ARCHV2")
        assert archived["request_count"] == 3


class TestCsvExport:
    """Tests for CSV export functionality."""

    def test_export_csv_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test exporting event requests as CSV."""
        # Add a request to the event
        req = Request(
            event_id=test_event.id,
            song_title="Export Test Song",
            artist="Export Artist",
            source="manual",
            status=RequestStatus.NEW.value,
            note="Test note",
            dedupe_key="export_dedupe_key_123",
        )
        db.add(req)
        db.commit()

        response = client.get(
            f"/api/events/{test_event.code}/export/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/csv; charset=utf-8"
        assert "attachment" in response.headers["content-disposition"]
        assert test_event.code in response.headers["content-disposition"]

        # Verify CSV content
        content = response.text
        assert "Request ID" in content
        assert "Song Title" in content
        assert "Export Test Song" in content
        assert "Export Artist" in content
        assert "Test note" in content

    def test_export_csv_no_auth(self, client: TestClient, test_event: Event):
        """Test exporting without auth fails."""
        response = client.get(f"/api/events/{test_event.code}/export/csv")
        assert response.status_code == 401

    def test_export_csv_not_owner(
        self, client: TestClient, db: Session, test_user: User, auth_headers: dict
    ):
        """Test exporting event you don't own fails."""
        # Create another user and their event
        from app.services.auth import get_password_hash

        other_user = User(
            username="otheruser",
            password_hash=get_password_hash("otherpassword"),
        )
        db.add(other_user)
        db.flush()

        other_event = Event(
            code="OTHER1",
            name="Other User Event",
            created_by_user_id=other_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
        )
        db.add(other_event)
        db.commit()

        response = client.get(
            f"/api/events/{other_event.code}/export/csv",
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_export_csv_expired_event(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test that owner can export CSV for expired events."""
        expired_event = Event(
            code="EXPCSV",
            name="Expired CSV Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(
            f"/api/events/{expired_event.code}/export/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_export_csv_archived_event(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test that owner can export CSV for archived events."""
        archived_event = Event(
            code="ARCSV1",
            name="Archived CSV Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
            archived_at=datetime.utcnow(),
        )
        db.add(archived_event)
        db.commit()

        response = client.get(
            f"/api/events/{archived_event.code}/export/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_export_csv_empty_event(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test exporting an event with no requests."""
        response = client.get(
            f"/api/events/{test_event.code}/export/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200
        content = response.text
        # Should have header row but no data rows
        assert "Request ID" in content
        lines = content.strip().split("\n")
        assert len(lines) == 1  # Just the header


class TestPlayHistoryCsvExport:
    """Tests for play history CSV export functionality."""

    def test_export_play_history_csv_success(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test exporting play history as CSV."""
        from datetime import datetime

        from app.models.play_history import PlayHistory

        # Add play history entries
        entry1 = PlayHistory(
            event_id=test_event.id,
            title="First Song",
            artist="Artist One",
            album="Album One",
            source="stagelinq",
            matched_request_id=None,
            started_at=datetime.utcnow(),
            ended_at=datetime.utcnow(),
            play_order=1,
        )
        entry2 = PlayHistory(
            event_id=test_event.id,
            title="Second Song",
            artist="Artist Two",
            album=None,
            source="manual",
            matched_request_id=42,
            started_at=datetime.utcnow(),
            ended_at=None,
            play_order=2,
        )
        db.add_all([entry1, entry2])
        db.commit()

        response = client.get(
            f"/api/events/{test_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/csv; charset=utf-8"
        assert "attachment" in response.headers["content-disposition"]
        assert "play_history" in response.headers["content-disposition"]

        # Verify CSV content
        content = response.text
        assert "Title" in content
        assert "Artist" in content
        assert "Source" in content
        assert "Was Requested" in content
        assert "First Song" in content
        assert "Second Song" in content
        assert "Live" in content  # stagelinq -> Live
        assert "Manual" in content  # manual -> Manual

    def test_export_play_history_csv_no_auth(self, client: TestClient, test_event: Event):
        """Test exporting play history without auth fails."""
        response = client.get(f"/api/events/{test_event.code}/export/play-history/csv")
        assert response.status_code == 401

    def test_export_play_history_csv_not_owner(
        self, client: TestClient, db: Session, test_user: User, auth_headers: dict
    ):
        """Test exporting play history for event you don't own fails."""
        from app.services.auth import get_password_hash

        other_user = User(
            username="otheruser2",
            password_hash=get_password_hash("otherpassword"),
        )
        db.add(other_user)
        db.flush()

        other_event = Event(
            code="OTHER2",
            name="Other User Event",
            created_by_user_id=other_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
        )
        db.add(other_event)
        db.commit()

        response = client.get(
            f"/api/events/{other_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 404

    def test_export_play_history_csv_includes_both_sources(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test that export includes both stagelinq and manual sources."""
        from datetime import datetime

        from app.models.play_history import PlayHistory

        # Add stagelinq entry (live DJ tracking)
        stagelinq_entry = PlayHistory(
            event_id=test_event.id,
            title="Live Track",
            artist="DJ Artist",
            album=None,
            source="stagelinq",
            matched_request_id=None,
            started_at=datetime.utcnow(),
            ended_at=datetime.utcnow(),
            play_order=1,
        )
        # Add manual entry (DJ marked request as played)
        manual_entry = PlayHistory(
            event_id=test_event.id,
            title="Requested Track",
            artist="Requested Artist",
            album=None,
            source="manual",
            matched_request_id=99,
            started_at=datetime.utcnow(),
            ended_at=datetime.utcnow(),
            play_order=2,
        )
        db.add_all([stagelinq_entry, manual_entry])
        db.commit()

        response = client.get(
            f"/api/events/{test_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200

        content = response.text
        lines = content.strip().split("\n")
        # Header + 2 data rows
        assert len(lines) == 3

        # Verify both sources are present
        assert "Live" in content  # stagelinq -> Live
        assert "Manual" in content  # manual -> Manual

    def test_export_play_history_csv_was_requested_column(
        self, client: TestClient, auth_headers: dict, test_event: Event, db: Session
    ):
        """Test that Was Requested column shows Yes/No correctly."""
        from datetime import datetime

        from app.models.play_history import PlayHistory

        # Entry with matched request
        requested = PlayHistory(
            event_id=test_event.id,
            title="Requested Song",
            artist="Artist",
            album=None,
            source="stagelinq",
            matched_request_id=42,
            started_at=datetime.utcnow(),
            ended_at=datetime.utcnow(),
            play_order=1,
        )
        # Entry without matched request
        not_requested = PlayHistory(
            event_id=test_event.id,
            title="DJ Choice",
            artist="Artist",
            album=None,
            source="stagelinq",
            matched_request_id=None,
            started_at=datetime.utcnow(),
            ended_at=datetime.utcnow(),
            play_order=2,
        )
        db.add_all([requested, not_requested])
        db.commit()

        response = client.get(
            f"/api/events/{test_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200

        content = response.text
        # Both Yes and No should be present
        assert "Yes" in content
        assert "No" in content

    def test_export_play_history_csv_empty(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test exporting play history when no tracks played."""
        response = client.get(
            f"/api/events/{test_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200
        content = response.text
        # Should have header row but no data rows
        assert "Title" in content
        lines = content.strip().split("\n")
        assert len(lines) == 1  # Just the header

    def test_export_play_history_csv_expired_event(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test that owner can export play history CSV for expired events."""
        expired_event = Event(
            code="EXPHIS",
            name="Expired Play History Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() - timedelta(hours=1),
        )
        db.add(expired_event)
        db.commit()

        response = client.get(
            f"/api/events/{expired_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_export_play_history_csv_archived_event(
        self, client: TestClient, auth_headers: dict, db: Session, test_user: User
    ):
        """Test that owner can export play history CSV for archived events."""
        archived_event = Event(
            code="ARCHIS",
            name="Archived Play History Event",
            created_by_user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=6),
            archived_at=datetime.utcnow(),
        )
        db.add(archived_event)
        db.commit()

        response = client.get(
            f"/api/events/{archived_event.code}/export/play-history/csv",
            headers=auth_headers,
        )
        assert response.status_code == 200
