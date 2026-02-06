"""Tests for Tidal sync functionality."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.models.user import User
from app.services.tidal import (
    disconnect_tidal,
    start_device_login,
    cancel_device_login,
    manual_link_track,
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


class TestTidalManualLink:
    """Tests for manual track linking."""

    @pytest.mark.asyncio
    @patch("app.services.tidal.add_track_to_playlist")
    async def test_manual_link_success(
        self,
        mock_add: MagicMock,
        db: Session,
        tidal_request: Request,
    ):
        """Test successful manual track link."""
        mock_add.return_value = True

        result = await manual_link_track(db, tidal_request, "manual_track_id")

        assert result.status == TidalSyncStatus.SYNCED
        assert result.tidal_track_id == "manual_track_id"

        db.refresh(tidal_request)
        assert tidal_request.tidal_track_id == "manual_track_id"
        assert tidal_request.tidal_sync_status == TidalSyncStatus.SYNCED.value

    @pytest.mark.asyncio
    async def test_manual_link_no_tidal_account(
        self,
        db: Session,
        tidal_request: Request,
    ):
        """Test manual link fails without Tidal account."""
        tidal_request.event.created_by.tidal_access_token = None
        db.commit()

        result = await manual_link_track(db, tidal_request, "track_id")

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
