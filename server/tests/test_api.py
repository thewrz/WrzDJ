"""Basic API tests."""

from fastapi.testclient import TestClient


def test_health_check(client: TestClient):
    """Test that the health endpoint works."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_login_invalid_credentials(client: TestClient):
    """Test that login fails with invalid credentials."""
    response = client.post(
        "/api/auth/login",
        data={"username": "nonexistent", "password": "wrong"},
    )
    assert response.status_code == 401


def test_events_requires_auth(client: TestClient):
    """Test that events endpoint requires authentication."""
    response = client.get("/api/events")
    assert response.status_code == 401


def test_search_requires_query(client: TestClient):
    """Test that search requires a query parameter."""
    response = client.get("/api/search")
    assert response.status_code == 422  # Validation error
