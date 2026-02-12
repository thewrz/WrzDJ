"""Tests for Beatport API endpoints."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.user import User
from app.services.auth import get_password_hash


@pytest.fixture
def bp_api_user(db: Session) -> User:
    user = User(
        username="bp_api_user",
        password_hash=get_password_hash("testpassword123"),
        role="dj",
        beatport_access_token="bp_token_api",
        beatport_refresh_token="bp_refresh_api",
        beatport_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def bp_api_headers(client: TestClient, bp_api_user: User) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        data={"username": "bp_api_user", "password": "testpassword123"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def bp_api_event(db: Session, bp_api_user: User) -> Event:
    event = Event(
        code="BPAPI1",
        name="BP API Test Event",
        created_by_user_id=bp_api_user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=6),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


class TestBeatportStatus:
    def test_not_linked(self, client: TestClient, auth_headers: dict[str, str]):
        """User without Beatport tokens shows not linked."""
        response = client.get("/api/beatport/status", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["linked"] is False

    def test_linked(self, client: TestClient, bp_api_headers: dict[str, str]):
        """User with Beatport tokens shows linked."""
        response = client.get("/api/beatport/status", headers=bp_api_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["linked"] is True
        assert data["expires_at"] is not None


class TestBeatportDisconnect:
    def test_disconnect(self, client: TestClient, bp_api_headers: dict[str, str], db: Session):
        """Disconnect clears tokens."""
        response = client.post("/api/beatport/disconnect", headers=bp_api_headers)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestBeatportEventSettings:
    def test_get_settings(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_event: Event,
    ):
        response = client.get(
            f"/api/beatport/events/{bp_api_event.id}/settings",
            headers=bp_api_headers,
        )
        assert response.status_code == 200
        assert response.json()["beatport_sync_enabled"] is False

    def test_update_settings(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_event: Event,
    ):
        response = client.put(
            f"/api/beatport/events/{bp_api_event.id}/settings",
            json={"beatport_sync_enabled": True},
            headers=bp_api_headers,
        )
        assert response.status_code == 200
        assert response.json()["beatport_sync_enabled"] is True

    def test_cannot_enable_without_token(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        test_event: Event,
    ):
        """Cannot enable sync without linked Beatport account."""
        response = client.put(
            f"/api/beatport/events/{test_event.id}/settings",
            json={"beatport_sync_enabled": True},
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_not_found(self, client: TestClient, bp_api_headers: dict[str, str]):
        response = client.get(
            "/api/beatport/events/99999/settings",
            headers=bp_api_headers,
        )
        assert response.status_code == 404


class TestBeatportSearch:
    def test_requires_auth(self, client: TestClient):
        """Search requires authentication."""
        response = client.get("/api/beatport/search?q=test")
        assert response.status_code in (401, 403)

    def test_requires_linked_account(self, client: TestClient, auth_headers: dict[str, str]):
        """Search requires linked Beatport account."""
        response = client.get(
            "/api/beatport/search?q=test",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "not linked" in response.json()["detail"]

    def test_rejects_query_over_200_chars(self, client: TestClient, bp_api_headers: dict[str, str]):
        """Search rejects query longer than 200 characters."""
        long_query = "a" * 201
        response = client.get(
            f"/api/beatport/search?q={long_query}",
            headers=bp_api_headers,
        )
        assert response.status_code == 422

    def test_accepts_200_char_query(self, client: TestClient, bp_api_headers: dict[str, str]):
        """Search accepts query of exactly 200 characters (doesn't return 422)."""
        query_200 = "a" * 200
        response = client.get(
            f"/api/beatport/search?q={query_200}",
            headers=bp_api_headers,
        )
        # Should not be a validation error — may be 200 or other non-422 status
        assert response.status_code != 422


class TestBeatportAuthStateValidation:
    def test_start_auth_stores_state_on_user(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Start auth stores state on user model."""
        from unittest.mock import patch

        with patch("app.api.beatport.settings") as mock_settings:
            mock_settings.beatport_client_id = "test-bp-client-id"
            mock_settings.beatport_redirect_uri = "http://localhost:3000/callback"
            response = client.get("/api/beatport/auth/start", headers=bp_api_headers)
        assert response.status_code == 200
        state = response.json()["state"]
        assert state is not None

        db.refresh(bp_api_user)
        assert bp_api_user.beatport_oauth_state == state

    def test_callback_rejects_missing_state(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Callback rejects request when user has no pending state."""
        bp_api_user.beatport_oauth_state = None
        db.commit()

        response = client.post(
            "/api/beatport/auth/callback",
            json={"code": "test-code", "state": "some-state"},
            headers=bp_api_headers,
        )
        assert response.status_code == 400
        assert "No pending OAuth flow" in response.json()["detail"]

    def test_callback_rejects_wrong_state(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Callback rejects incorrect state parameter."""
        bp_api_user.beatport_oauth_state = "correct-state-value"
        db.commit()

        response = client.post(
            "/api/beatport/auth/callback",
            json={"code": "test-code", "state": "wrong-state-value"},
            headers=bp_api_headers,
        )
        assert response.status_code == 400
        assert "Invalid state" in response.json()["detail"]

    def test_callback_accepts_correct_state(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Callback accepts correct state and clears it after use."""
        bp_api_user.beatport_oauth_state = "valid-state-123"
        db.commit()

        from unittest.mock import patch

        with patch("app.api.beatport.exchange_code_for_tokens") as mock_exchange:
            mock_exchange.return_value = {
                "access_token": "new-token",
                "refresh_token": "new-refresh",
                "expires_in": 3600,
            }
            response = client.post(
                "/api/beatport/auth/callback",
                json={"code": "auth-code", "state": "valid-state-123"},
                headers=bp_api_headers,
            )

        assert response.status_code == 200
        db.refresh(bp_api_user)
        assert bp_api_user.beatport_oauth_state is None  # Cleared after use

    def test_callback_rejects_reused_state(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Second callback with same state is rejected (state cleared after first use)."""
        bp_api_user.beatport_oauth_state = "one-time-state"
        db.commit()

        from unittest.mock import patch

        with patch("app.api.beatport.exchange_code_for_tokens") as mock_exchange:
            mock_exchange.return_value = {
                "access_token": "token",
                "refresh_token": "refresh",
                "expires_in": 3600,
            }
            # First call succeeds
            response1 = client.post(
                "/api/beatport/auth/callback",
                json={"code": "code1", "state": "one-time-state"},
                headers=bp_api_headers,
            )
            assert response1.status_code == 200

        # Second call with same state fails
        response2 = client.post(
            "/api/beatport/auth/callback",
            json={"code": "code2", "state": "one-time-state"},
            headers=bp_api_headers,
        )
        assert response2.status_code == 400


class TestBeatportAuthCallbackBody:
    def test_callback_accepts_json_body(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Callback accepts code and state as JSON body."""
        bp_api_user.beatport_oauth_state = "json-body-state"
        db.commit()

        from unittest.mock import patch

        with patch("app.api.beatport.exchange_code_for_tokens") as mock_exchange:
            mock_exchange.return_value = {
                "access_token": "t",
                "refresh_token": "r",
                "expires_in": 3600,
            }
            response = client.post(
                "/api/beatport/auth/callback",
                json={"code": "test-code", "state": "json-body-state"},
                headers=bp_api_headers,
            )
        assert response.status_code == 200

    def test_callback_rejects_query_params_only(
        self,
        client: TestClient,
        bp_api_headers: dict[str, str],
        bp_api_user: User,
        db: Session,
    ):
        """Callback rejects old-style query parameter format."""
        bp_api_user.beatport_oauth_state = "query-state"
        db.commit()

        response = client.post(
            "/api/beatport/auth/callback?code=test&state=query-state",
            headers=bp_api_headers,
        )
        assert response.status_code == 422  # Missing body
