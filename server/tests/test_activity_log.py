"""Tests for activity log."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.activity_log import get_recent_activity, log_activity


class TestActivityLogService:
    def test_log_entry_created(self, db: Session):
        entry = log_activity(db, "info", "bridge", "Bridge connected")
        assert entry.id is not None
        assert entry.level == "info"
        assert entry.source == "bridge"
        assert entry.message == "Bridge connected"

    def test_get_recent_entries(self, db: Session):
        log_activity(db, "info", "system", "First")
        log_activity(db, "warning", "tidal", "Second")
        log_activity(db, "error", "beatport", "Third")

        entries = get_recent_activity(db, limit=2)
        assert len(entries) == 2
        # Newest first
        assert entries[0].message == "Third"
        assert entries[1].message == "Second"

    def test_filters_by_event_code(self, db: Session):
        log_activity(db, "info", "bridge", "Event A", event_code="AAAAAA")
        log_activity(db, "info", "bridge", "Event B", event_code="BBBBBB")

        entries = get_recent_activity(db, event_code="AAAAAA")
        assert len(entries) == 1
        assert entries[0].event_code == "AAAAAA"


class TestActivityLogAPI:
    def test_api_returns_log_entries(
        self, client: TestClient, auth_headers: dict, test_user: User, db: Session
    ):
        log_activity(db, "info", "system", "Test activity", user_id=test_user.id)
        response = client.get("/api/events/activity", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["source"] == "system"

    def test_dj_can_access_own_logs(
        self, client: TestClient, auth_headers: dict, test_user: User, db: Session
    ):
        log_activity(db, "warning", "tidal", "Sync failed", user_id=test_user.id)
        response = client.get("/api/events/activity", headers=auth_headers)
        assert response.status_code == 200
        assert len(response.json()) >= 1
