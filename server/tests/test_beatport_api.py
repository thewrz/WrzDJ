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
