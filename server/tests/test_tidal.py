"""Tests for Tidal sync functionality."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.models.user import User
from app.schemas.tidal import TidalSearchResult
from app.services.tidal import (
    cancel_device_login,
    disconnect_tidal,
    manual_link_track,
    search_tidal_tracks,
    search_track,
    start_device_login,
    sync_request_to_tidal,
)


@pytest.fixture
def tidal_user(db: Session) -> User:
    """Create a user with linked Tidal account."""
    from app.services.auth import get_password_hash

    user = User(
        username="tidaluser",
        password_hash=get_password_hash("testpassword123"),
        tidal_access_token="test_access_token",
        tidal_refresh_token="test_refresh_token",
        tidal_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
        tidal_user_id="12345",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def tidal_event(db: Session, tidal_user: User) -> Event:
    """Create an event with Tidal sync enabled."""
    event = Event(
        code="TIDAL1",
        name="Tidal Test Event",
        created_by_user_id=tidal_user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=6),
        tidal_sync_enabled=True,
        tidal_playlist_id="playlist123",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@pytest.fixture
def tidal_request(db: Session, tidal_event: Event) -> Request:
    """Create a test request for Tidal sync."""
    request = Request(
        event_id=tidal_event.id,
        song_title="Test Song",
        artist="Test Artist",
        source="spotify",
        status=RequestStatus.ACCEPTED.value,
        dedupe_key="tidal_test_dedupe_key",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


class TestTidalDeviceLogin:
    """Tests for Tidal device login flow."""

    @patch("app.services.tidal.tidalapi.Session")
    def test_start_device_login(self, mock_session_class: MagicMock, test_user: User):
        """Test starting device login flow."""
        mock_session = MagicMock()
        mock_session_class.return_value = mock_session

        mock_login = MagicMock()
        mock_login.verification_uri_complete = "link.tidal.com/ABCDEF"
        mock_login.user_code = "ABCDEF"

        mock_future = MagicMock()
        mock_session.login_oauth.return_value = (mock_login, mock_future)

        result = start_device_login(test_user)

        assert "verification_url" in result
        assert result["verification_url"] == "https://link.tidal.com/ABCDEF"
        assert result["user_code"] == "ABCDEF"

    @patch("app.services.tidal.tidalapi.Session")
    def test_start_device_login_with_https(self, mock_session_class: MagicMock, test_user: User):
        """Test device login with URL that already has https."""
        mock_session = MagicMock()
        mock_session_class.return_value = mock_session

        mock_login = MagicMock()
        mock_login.verification_uri_complete = "https://link.tidal.com/XYZABC"
        mock_login.user_code = "XYZABC"

        mock_future = MagicMock()
        mock_session.login_oauth.return_value = (mock_login, mock_future)

        result = start_device_login(test_user)

        assert result["verification_url"] == "https://link.tidal.com/XYZABC"

    def test_cancel_device_login(self, test_user: User):
        """Test cancelling device login clears state."""
        # This should not raise even if no pending login
        cancel_device_login(test_user)


class TestTidalStatus:
    """Tests for Tidal account status."""

    def test_status_linked(self, client: TestClient, db: Session, tidal_user: User):
        """Test status shows linked account."""
        # Login as tidal user
        response = client.post(
            "/api/auth/login",
            data={"username": "tidaluser", "password": "testpassword123"},
        )
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get("/api/tidal/status", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["linked"] is True
        assert data["user_id"] == "12345"

    def test_status_not_linked(self, client: TestClient, auth_headers: dict):
        """Test status shows unlinked account."""
        response = client.get("/api/tidal/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["linked"] is False

    def test_status_includes_integration_enabled(self, client: TestClient, auth_headers: dict):
        """Test status includes integration_enabled flag."""
        response = client.get("/api/tidal/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["integration_enabled"] is True

    def test_status_disabled_when_admin_disables(
        self, client: TestClient, auth_headers: dict, admin_headers: dict
    ):
        """Test status shows integration_enabled=false when admin disables Tidal."""
        client.patch(
            "/api/admin/integrations/tidal",
            headers=admin_headers,
            json={"enabled": False},
        )
        response = client.get("/api/tidal/status", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["integration_enabled"] is False


class TestTidalDisconnect:
    """Tests for Tidal disconnect."""

    def test_disconnect(self, db: Session, tidal_user: User):
        """Test disconnecting Tidal account."""
        disconnect_tidal(db, tidal_user)

        db.refresh(tidal_user)
        assert tidal_user.tidal_access_token is None
        assert tidal_user.tidal_refresh_token is None
        assert tidal_user.tidal_user_id is None


class TestTidalManualLink:
    """Tests for manual track linking."""

    @patch("app.services.tidal.add_track_to_playlist")
    def test_manual_link_success(
        self,
        mock_add: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test successful manual track link."""
        mock_add.return_value = True

        result = manual_link_track(db, tidal_request, "manual_track_id")

        assert result.status == TidalSyncStatus.SYNCED
        assert result.tidal_track_id == "manual_track_id"

        db.refresh(tidal_request)
        assert tidal_request.tidal_track_id == "manual_track_id"
        assert tidal_request.tidal_sync_status == TidalSyncStatus.SYNCED.value

    def test_manual_link_no_tidal_account(
        self,
        db: Session,
        tidal_request: Request,
    ):
        """Test manual link fails without Tidal account."""
        tidal_request.event.created_by.tidal_access_token = None
        db.commit()

        result = manual_link_track(db, tidal_request, "track_id")

        assert result.status == TidalSyncStatus.ERROR
        assert "not linked" in result.error


class TestTidalEventSettings:
    """Tests for Tidal event settings API."""

    def test_get_event_settings(
        self, client: TestClient, db: Session, tidal_user: User, tidal_event: Event
    ):
        """Test getting event Tidal settings."""
        response = client.post(
            "/api/auth/login",
            data={"username": "tidaluser", "password": "testpassword123"},
        )
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = client.get(
            f"/api/tidal/events/{tidal_event.id}/settings",
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["tidal_sync_enabled"] is True
        assert data["tidal_playlist_id"] == "playlist123"

    def test_update_event_settings(
        self, client: TestClient, db: Session, tidal_user: User, tidal_event: Event
    ):
        """Test updating event Tidal settings."""
        response = client.post(
            "/api/auth/login",
            data={"username": "tidaluser", "password": "testpassword123"},
        )
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        response = client.put(
            f"/api/tidal/events/{tidal_event.id}/settings",
            json={"tidal_sync_enabled": False},
            headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["tidal_sync_enabled"] is False

    def test_enable_sync_without_tidal_account(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test enabling sync fails without Tidal account."""
        response = client.put(
            f"/api/tidal/events/{test_event.id}/settings",
            json={"tidal_sync_enabled": True},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "without linked Tidal account" in response.json()["detail"]


class TestTidalSyncPipeline:
    """Tests for the sync_request_to_tidal pipeline."""

    @patch("app.services.tidal.add_track_to_playlist")
    @patch("app.services.tidal.search_track")
    @patch("app.services.tidal.create_event_playlist")
    def test_happy_path(
        self,
        mock_create_playlist: MagicMock,
        mock_search: MagicMock,
        mock_add: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test full sync: search → create playlist → add track."""
        mock_create_playlist.return_value = "playlist123"
        mock_search.return_value = TidalSearchResult(
            track_id="track789",
            title="Test Song",
            artist="Test Artist",
            tidal_url="https://tidal.com/browse/track/track789",
        )
        mock_add.return_value = True

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.SYNCED
        assert result.tidal_track_id == "track789"
        db.refresh(tidal_request)
        assert tidal_request.tidal_track_id == "track789"
        assert tidal_request.tidal_sync_status == TidalSyncStatus.SYNCED.value

    def test_sync_disabled(self, db: Session, tidal_request: Request):
        """Test sync returns error when sync disabled on event."""
        tidal_request.event.tidal_sync_enabled = False
        db.commit()

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "not enabled" in result.error

    def test_no_tidal_account(self, db: Session, tidal_request: Request):
        """Test sync returns error when user has no Tidal account."""
        tidal_request.event.created_by.tidal_access_token = None
        db.commit()

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "not linked" in result.error

    @patch("app.services.tidal.create_event_playlist")
    def test_playlist_creation_failure(
        self,
        mock_create_playlist: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test sync handles playlist creation failure."""
        mock_create_playlist.return_value = None

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "playlist" in result.error.lower()
        db.refresh(tidal_request)
        assert tidal_request.tidal_sync_status == TidalSyncStatus.ERROR.value

    @patch("app.services.tidal.search_track")
    @patch("app.services.tidal.create_event_playlist")
    def test_track_not_found(
        self,
        mock_create_playlist: MagicMock,
        mock_search: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test sync handles track not found."""
        mock_create_playlist.return_value = "playlist123"
        mock_search.return_value = None

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.NOT_FOUND
        db.refresh(tidal_request)
        assert tidal_request.tidal_sync_status == TidalSyncStatus.NOT_FOUND.value

    @patch("app.services.tidal.add_track_to_playlist")
    @patch("app.services.tidal.search_track")
    @patch("app.services.tidal.create_event_playlist")
    def test_add_to_playlist_failure(
        self,
        mock_create_playlist: MagicMock,
        mock_search: MagicMock,
        mock_add: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test sync handles add-to-playlist failure."""
        mock_create_playlist.return_value = "playlist123"
        mock_search.return_value = TidalSearchResult(
            track_id="track789",
            title="Test Song",
            artist="Test Artist",
        )
        mock_add.return_value = False

        result = sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "add track" in result.error.lower()
        db.refresh(tidal_request)
        assert tidal_request.tidal_sync_status == TidalSyncStatus.ERROR.value


class TestTidalSearch:
    """Tests for Tidal search functions."""

    @patch("app.services.tidal.get_tidal_session")
    def test_search_track_exact_match(self, mock_session_fn: MagicMock, db: Session, tidal_user):
        """Test search_track returns exact match when available."""
        mock_session = MagicMock()
        mock_track = MagicMock()
        mock_track.id = 12345
        mock_track.name = "Strobe"
        mock_track.duration = 600
        mock_track.artist = MagicMock()
        mock_track.artist.name = "deadmau5"
        mock_track.album = MagicMock()
        mock_track.album.name = "For Lack of a Better Name"
        mock_track.album.image.return_value = "https://img.tidal.com/cover.jpg"

        mock_session.search.return_value = {"tracks": [mock_track]}
        mock_session_fn.return_value = mock_session

        result = search_track(db, tidal_user, "deadmau5", "Strobe")

        assert result is not None
        assert result.track_id == "12345"
        assert result.title == "Strobe"
        assert result.artist == "deadmau5"

    @patch("app.services.tidal.get_tidal_session")
    def test_search_track_fallback_to_first(self, mock_session_fn: MagicMock, db, tidal_user):
        """Test search_track falls back to first result if no exact match."""
        mock_session = MagicMock()
        mock_track = MagicMock()
        mock_track.id = 99999
        mock_track.name = "Some Other Track"
        mock_track.duration = 300
        mock_track.artist = MagicMock()
        mock_track.artist.name = "Other Artist"
        mock_track.album = MagicMock()
        mock_track.album.name = "Album"
        mock_track.album.image.return_value = None

        mock_session.search.return_value = {"tracks": [mock_track]}
        mock_session_fn.return_value = mock_session

        result = search_track(db, tidal_user, "deadmau5", "Strobe")

        assert result is not None
        assert result.track_id == "99999"

    @patch("app.services.tidal.get_tidal_session")
    def test_search_track_no_results(self, mock_session_fn: MagicMock, db, tidal_user):
        """Test search_track returns None when no results."""
        mock_session = MagicMock()
        mock_session.search.return_value = {"tracks": []}
        mock_session_fn.return_value = mock_session

        result = search_track(db, tidal_user, "deadmau5", "Nonexistent")

        assert result is None

    @patch("app.services.tidal.get_tidal_session")
    def test_search_track_no_session(self, mock_session_fn: MagicMock, db, tidal_user):
        """Test search_track returns None when no session."""
        mock_session_fn.return_value = None

        result = search_track(db, tidal_user, "deadmau5", "Strobe")

        assert result is None

    @patch("app.services.tidal.get_tidal_session")
    def test_search_tidal_tracks(self, mock_session_fn: MagicMock, db, tidal_user):
        """Test search_tidal_tracks returns list of results."""
        mock_session = MagicMock()
        mock_track1 = MagicMock()
        mock_track1.id = 111
        mock_track1.name = "Track A"
        mock_track1.duration = 200
        mock_track1.artist = MagicMock()
        mock_track1.artist.name = "Artist A"
        mock_track1.album = MagicMock()
        mock_track1.album.name = "Album A"
        mock_track1.album.image.return_value = None

        mock_track2 = MagicMock()
        mock_track2.id = 222
        mock_track2.name = "Track B"
        mock_track2.duration = 300
        mock_track2.artist = MagicMock()
        mock_track2.artist.name = "Artist B"
        mock_track2.album = MagicMock()
        mock_track2.album.name = "Album B"
        mock_track2.album.image.return_value = None

        mock_session.search.return_value = {"tracks": [mock_track1, mock_track2]}
        mock_session_fn.return_value = mock_session

        results = search_tidal_tracks(db, tidal_user, "test", limit=10)

        assert len(results) == 2
        assert results[0].track_id == "111"
        assert results[1].track_id == "222"

    @patch("app.services.tidal.get_tidal_session")
    def test_search_tidal_tracks_no_session(self, mock_session_fn: MagicMock, db, tidal_user):
        """Test search_tidal_tracks returns empty when no session."""
        mock_session_fn.return_value = None

        results = search_tidal_tracks(db, tidal_user, "test")

        assert results == []
