"""Tests for user registration and public settings."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.system_settings import SystemSettings
from app.models.user import User
from app.services.auth import get_password_hash


class TestPublicSettings:
    def test_returns_registration_status(self, client: TestClient, db: Session):
        response = client.get("/api/auth/settings")
        assert response.status_code == 200
        data = response.json()
        assert "registration_enabled" in data
        assert "turnstile_site_key" in data

    def test_reflects_disabled_registration(self, client: TestClient, db: Session):
        settings = SystemSettings(id=1, registration_enabled=False, search_rate_limit_per_minute=30)
        db.add(settings)
        db.commit()

        response = client.get("/api/auth/settings")
        assert response.status_code == 200
        assert response.json()["registration_enabled"] is False


class TestRegistration:
    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_success_creates_pending_user(self, mock_turnstile, client: TestClient, db: Session):
        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

        user = db.query(User).filter(User.username == "newuser").first()
        assert user is not None
        assert user.role == "pending"
        assert user.email == "new@example.com"

    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_duplicate_username_409(self, mock_turnstile, client: TestClient, db: Session):
        user = User(
            username="existing",
            password_hash=get_password_hash("password123"),
            role="dj",
        )
        db.add(user)
        db.commit()

        response = client.post(
            "/api/auth/register",
            json={
                "username": "existing",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 409
        assert "username" in response.json()["detail"].lower()

    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_duplicate_email_409(self, mock_turnstile, client: TestClient, db: Session):
        user = User(
            username="other",
            password_hash=get_password_hash("password123"),
            role="dj",
            email="taken@example.com",
        )
        db.add(user)
        db.commit()

        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "taken@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 409
        assert "email" in response.json()["detail"].lower()

    def test_password_mismatch_422(self, client: TestClient, db: Session):
        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "differentpass",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 422

    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=False,
    )
    def test_invalid_turnstile_400(self, mock_turnstile, client: TestClient, db: Session):
        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "bad-token",
            },
        )
        assert response.status_code == 400
        assert "captcha" in response.json()["detail"].lower()

    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_disabled_registration_403(self, mock_turnstile, client: TestClient, db: Session):
        settings = SystemSettings(id=1, registration_enabled=False, search_rate_limit_per_minute=30)
        db.add(settings)
        db.commit()

        response = client.post(
            "/api/auth/register",
            json={
                "username": "newuser",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 403

    @patch(
        "app.api.auth.verify_turnstile_token",
        new_callable=AsyncMock,
        return_value=True,
    )
    def test_pending_user_can_login_but_not_create_events(
        self, mock_turnstile, client: TestClient, db: Session
    ):
        # Register
        client.post(
            "/api/auth/register",
            json={
                "username": "pendingdj",
                "email": "pending@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )

        # Login
        login_resp = client.post(
            "/api/auth/login",
            data={"username": "pendingdj", "password": "password123"},
        )
        assert login_resp.status_code == 200
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Can access /me
        me_resp = client.get("/api/auth/me", headers=headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["role"] == "pending"

        # Cannot create events
        event_resp = client.post(
            "/api/events",
            headers=headers,
            json={"name": "My Event"},
        )
        assert event_resp.status_code == 403

    def test_invalid_username_chars_422(self, client: TestClient, db: Session):
        response = client.post(
            "/api/auth/register",
            json={
                "username": "bad user!",
                "email": "new@example.com",
                "password": "password123",
                "confirm_password": "password123",
                "turnstile_token": "fake-token",
            },
        )
        assert response.status_code == 422
