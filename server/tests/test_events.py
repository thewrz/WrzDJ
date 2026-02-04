"""Tests for event endpoints."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event
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
        """Test getting a nonexistent event."""
        response = client.get("/api/events/NOTFOUND")
        assert response.status_code == 404


class TestUpdateEvent:
    """Tests for PATCH /api/events/{code} endpoint."""

    def test_update_event_name(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
        """Test updating event name."""
        response = client.patch(
            f"/api/events/{test_event.code}",
            json={"name": "Updated Name"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Name"

    def test_update_event_expiry(
        self, client: TestClient, auth_headers: dict, test_event: Event
    ):
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
            "/api/events/NOTFOUND",
            headers=auth_headers,
        )
        assert response.status_code == 404
