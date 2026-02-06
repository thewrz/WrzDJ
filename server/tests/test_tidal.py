"""Tests for Tidal sync functionality."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.models.user import User
from app.schemas.tidal import TidalSearchResult
from app.services.tidal import (
    disconnect_tidal,
    generate_oauth_url,
    get_tidal_session,
    manual_link_track,
    search_track,
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
        tidal_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
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
        expires_at=datetime.now(timezone.utc) + timedelta(hours=6),
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


class TestTidalOAuth:
    """Tests for Tidal OAuth flow."""

    @patch("app.services.tidal.settings")
    def test_generate_oauth_url(self, mock_settings, test_user: User):
        """Test OAuth URL generation."""
        mock_settings.tidal_client_id = "test_client_id"
        mock_settings.tidal_redirect_uri = "https://app.wrzdj.com/api/tidal/auth/callback"

        auth_url, state = generate_oauth_url(test_user)

        assert "login.tidal.com/authorize" in auth_url
        assert "client_id=test_client_id" in auth_url
        assert "state=" in auth_url
        assert len(state) > 0

    @patch("app.services.tidal.settings")
    def test_generate_oauth_url_missing_credentials(self, mock_settings, test_user: User):
        """Test OAuth URL fails without credentials."""
        mock_settings.tidal_client_id = ""
        mock_settings.tidal_redirect_uri = ""

        with pytest.raises(ValueError, match="Tidal credentials not configured"):
            generate_oauth_url(test_user)


class TestTidalStatus:
    """Tests for Tidal account status."""

    def test_status_linked(
        self, client: TestClient, db: Session, tidal_user: User
    ):
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


class TestTidalDisconnect:
    """Tests for Tidal disconnect."""

    def test_disconnect(self, db: Session, tidal_user: User):
        """Test disconnecting Tidal account."""
        disconnect_tidal(db, tidal_user)

        db.refresh(tidal_user)
        assert tidal_user.tidal_access_token is None
        assert tidal_user.tidal_refresh_token is None
        assert tidal_user.tidal_user_id is None


class TestTidalSync:
    """Tests for Tidal sync functionality."""

    @pytest.mark.asyncio
    @patch("app.services.tidal.get_tidal_session")
    @patch("app.services.tidal.refresh_token_if_needed")
    async def test_sync_request_success(
        self,
        mock_refresh: AsyncMock,
        mock_session: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test successful sync to Tidal."""
        mock_refresh.return_value = True

        # Mock Tidal session and search
        mock_tidal = MagicMock()
        mock_track = MagicMock()
        mock_track.id = "track123"
        mock_track.name = "Test Song"
        mock_track.artist.name = "Test Artist"
        mock_track.album.name = "Test Album"
        mock_track.album.image.return_value = "https://cover.url"
        mock_track.duration = 180

        mock_results = MagicMock()
        mock_results.tracks = [mock_track]
        mock_tidal.search.return_value = mock_results

        mock_playlist = MagicMock()
        mock_tidal.playlist.return_value = mock_playlist

        mock_session.return_value = mock_tidal

        result = await sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.SYNCED
        assert result.tidal_track_id == "track123"

    @pytest.mark.asyncio
    async def test_sync_request_not_enabled(
        self, db: Session, tidal_request: Request
    ):
        """Test sync fails when not enabled."""
        tidal_request.event.tidal_sync_enabled = False
        db.commit()

        result = await sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "not enabled" in result.error

    @pytest.mark.asyncio
    async def test_sync_request_no_tidal_account(
        self, db: Session, tidal_request: Request
    ):
        """Test sync fails without Tidal account."""
        tidal_request.event.created_by.tidal_access_token = None
        db.commit()

        result = await sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.ERROR
        assert "not linked" in result.error

    @pytest.mark.asyncio
    @patch("app.services.tidal.get_tidal_session")
    @patch("app.services.tidal.refresh_token_if_needed")
    async def test_sync_request_track_not_found(
        self,
        mock_refresh: AsyncMock,
        mock_session: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test sync when track not found on Tidal."""
        mock_refresh.return_value = True

        mock_tidal = MagicMock()
        mock_results = MagicMock()
        mock_results.tracks = []  # No tracks found
        mock_tidal.search.return_value = mock_results

        mock_session.return_value = mock_tidal

        result = await sync_request_to_tidal(db, tidal_request)

        assert result.status == TidalSyncStatus.NOT_FOUND


class TestTidalSearch:
    """Tests for Tidal search."""

    @pytest.mark.asyncio
    @patch("app.services.tidal.get_tidal_session")
    async def test_search_track_found(
        self, mock_session: MagicMock, tidal_user: User
    ):
        """Test successful track search."""
        mock_tidal = MagicMock()
        mock_track = MagicMock()
        mock_track.id = "track456"
        mock_track.name = "Found Song"
        mock_track.artist.name = "Found Artist"
        mock_track.album.name = "Found Album"
        mock_track.album.image.return_value = "https://cover.url"
        mock_track.duration = 200

        mock_results = MagicMock()
        mock_results.tracks = [mock_track]
        mock_tidal.search.return_value = mock_results

        mock_session.return_value = mock_tidal

        result = await search_track(tidal_user, "Found Artist", "Found Song")

        assert result is not None
        assert result.track_id == "track456"
        assert result.title == "Found Song"
        assert result.artist == "Found Artist"

    @pytest.mark.asyncio
    @patch("app.services.tidal.get_tidal_session")
    async def test_search_track_not_found(
        self, mock_session: MagicMock, tidal_user: User
    ):
        """Test search when no tracks found."""
        mock_tidal = MagicMock()
        mock_results = MagicMock()
        mock_results.tracks = []
        mock_tidal.search.return_value = mock_results

        mock_session.return_value = mock_tidal

        result = await search_track(tidal_user, "Unknown", "Unknown")

        assert result is None


class TestTidalManualLink:
    """Tests for manual track linking."""

    @pytest.mark.asyncio
    @patch("app.services.tidal.add_track_to_playlist")
    @patch("app.services.tidal.refresh_token_if_needed")
    async def test_manual_link_success(
        self,
        mock_refresh: AsyncMock,
        mock_add: AsyncMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test successful manual track link."""
        mock_refresh.return_value = True
        mock_add.return_value = True

        result = await manual_link_track(db, tidal_request, "manual_track_id")

        assert result.status == TidalSyncStatus.SYNCED
        assert result.tidal_track_id == "manual_track_id"

        db.refresh(tidal_request)
        assert tidal_request.tidal_track_id == "manual_track_id"
        assert tidal_request.tidal_sync_status == TidalSyncStatus.SYNCED.value


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
