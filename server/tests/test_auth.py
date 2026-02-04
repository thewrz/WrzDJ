"""Tests for authentication endpoints."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User


class TestLogin:
    """Tests for /api/auth/login endpoint."""

    def test_login_success(self, client: TestClient, test_user: User):
        """Test successful login returns access token."""
        response = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client: TestClient, test_user: User):
        """Test login with wrong password fails."""
        response = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "wrongpassword"},
        )
        assert response.status_code == 401
        # Error message should be generic (prevent user enumeration)
        assert "password" in response.json()["detail"].lower() or "incorrect" in response.json()["detail"].lower()

    def test_login_nonexistent_user(self, client: TestClient):
        """Test login with nonexistent user fails."""
        response = client.post(
            "/api/auth/login",
            data={"username": "nonexistent", "password": "testpassword123"},
        )
        assert response.status_code == 401
        # Error message should be same as wrong password (prevent user enumeration)
        assert "password" in response.json()["detail"].lower() or "incorrect" in response.json()["detail"].lower()

    def test_login_empty_username(self, client: TestClient):
        """Test login with empty username fails."""
        response = client.post(
            "/api/auth/login",
            data={"username": "", "password": "testpassword123"},
        )
        assert response.status_code == 422 or response.status_code == 401

    def test_login_empty_password(self, client: TestClient, test_user: User):
        """Test login with empty password fails."""
        response = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": ""},
        )
        assert response.status_code == 422 or response.status_code == 401


class TestAuthMe:
    """Tests for /api/auth/me endpoint."""

    def test_me_authenticated(self, client: TestClient, auth_headers: dict):
        """Test /me returns user info when authenticated."""
        response = client.get("/api/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"
        assert "id" in data

    def test_me_no_token(self, client: TestClient):
        """Test /me rejects requests without token."""
        response = client.get("/api/auth/me")
        assert response.status_code == 401

    def test_me_invalid_token(self, client: TestClient):
        """Test /me rejects requests with invalid token."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalidtoken"},
        )
        assert response.status_code == 401

    def test_me_malformed_auth_header(self, client: TestClient):
        """Test /me rejects malformed Authorization header."""
        response = client.get(
            "/api/auth/me",
            headers={"Authorization": "NotBearer token"},
        )
        assert response.status_code == 401
