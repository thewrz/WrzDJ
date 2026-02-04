"""Basic API tests."""
import pytest
from fastapi.testclient import TestClient


def test_health_check():
    """Test that the health endpoint works."""
    from app.main import app

    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_login_invalid_credentials():
    """Test that login fails with invalid credentials."""
    from app.main import app

    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        data={"username": "nonexistent", "password": "wrong"},
    )
    assert response.status_code == 401


def test_events_requires_auth():
    """Test that events endpoint requires authentication."""
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/events")
    assert response.status_code == 401


def test_search_requires_query():
    """Test that search requires a query parameter."""
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/search")
    assert response.status_code == 422  # Validation error
