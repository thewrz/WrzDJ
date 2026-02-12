"""Tests for sync orchestrator."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.models.user import User
from app.services.sync.base import SyncResult, SyncStatus, TrackMatch
from app.services.sync.orchestrator import MultiSyncResult, sync_request_to_services
from app.services.sync.registry import _clear_adapters, register_adapter


@pytest.fixture
def tidal_user(db: Session) -> User:
    from app.services.auth import get_password_hash

    user = User(
        username="sync_orch_user",
        password_hash=get_password_hash("testpassword123"),
        tidal_access_token="test_access_token",
        tidal_refresh_token="test_refresh_token",
        tidal_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
        tidal_user_id="12345",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def tidal_event(db: Session, tidal_user: User) -> Event:
    event = Event(
        code="ORCH01",
        name="Orchestrator Test Event",
        created_by_user_id=tidal_user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=6),
        tidal_sync_enabled=True,
        tidal_playlist_id="playlist_orch",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@pytest.fixture
def accepted_request(db: Session, tidal_event: Event) -> Request:
    request = Request(
        event_id=tidal_event.id,
        song_title="Strobe",
        artist="deadmau5",
        source="spotify",
        status=RequestStatus.ACCEPTED.value,
        dedupe_key="orch_test_dedupe_key",
        raw_search_query="deadmau5 Strobe",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


@pytest.fixture
def accepted_request_no_query(db: Session, tidal_event: Event) -> Request:
    request = Request(
        event_id=tidal_event.id,
        song_title="Alive",
        artist="Daft Punk",
        source="manual",
        status=RequestStatus.ACCEPTED.value,
        dedupe_key="orch_test_no_query",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


class MockAdapter:
    """Mock adapter for testing."""

    def __init__(self, name="mock_service", connected=True, sync_result=None, sync_enabled=True):
        self._name = name
        self._connected = connected
        self._sync_result = sync_result
        self._sync_enabled = sync_enabled

    @property
    def service_name(self):
        return self._name

    def is_connected(self, user):
        return self._connected

    def is_sync_enabled(self, event):
        return self._sync_enabled

    def sync_track(self, db, user, event, normalized, intent=None):
        if self._sync_result:
            return self._sync_result
        return SyncResult(
            service=self._name,
            status=SyncStatus.ADDED,
            track_match=TrackMatch(
                service=self._name,
                track_id="mock_track_123",
                title="Strobe",
                artist="deadmau5",
                match_confidence=0.95,
            ),
            playlist_id="mock_playlist_456",
        )


@pytest.fixture(autouse=True)
def clean_registry():
    _clear_adapters()
    yield
    _clear_adapters()


class TestMultiSyncResult:
    def test_any_added_true(self):
        r = MultiSyncResult(
            results=[
                SyncResult(service="a", status=SyncStatus.ADDED),
                SyncResult(service="b", status=SyncStatus.NOT_FOUND),
            ]
        )
        assert r.any_added is True

    def test_any_added_false(self):
        r = MultiSyncResult(
            results=[
                SyncResult(service="a", status=SyncStatus.NOT_FOUND),
            ]
        )
        assert r.any_added is False

    def test_all_not_found_true(self):
        r = MultiSyncResult(
            results=[
                SyncResult(service="a", status=SyncStatus.NOT_FOUND),
                SyncResult(service="b", status=SyncStatus.NOT_FOUND),
            ]
        )
        assert r.all_not_found is True

    def test_all_not_found_false_when_empty(self):
        r = MultiSyncResult(results=[])
        assert r.all_not_found is False


class TestSyncRequestToServices:
    def test_happy_path(self, db, accepted_request):
        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 1
        assert result.results[0].status == SyncStatus.ADDED
        assert result.any_added is True

        # Check JSON persisted
        db.refresh(accepted_request)
        assert accepted_request.sync_results_json is not None
        data = json.loads(accepted_request.sync_results_json)
        assert len(data) == 1
        assert data[0]["service"] == "tidal"
        assert data[0]["status"] == "added"
        assert data[0]["track_id"] == "mock_track_123"

    def test_backward_compat_tidal_columns(self, db, accepted_request):
        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        sync_request_to_services(db, accepted_request)

        db.refresh(accepted_request)
        assert accepted_request.tidal_track_id == "mock_track_123"
        assert accepted_request.tidal_sync_status == TidalSyncStatus.SYNCED.value

    def test_no_connected_adapters(self, db, accepted_request):
        # No adapters registered
        result = sync_request_to_services(db, accepted_request)
        assert len(result.results) == 0

    def test_adapter_not_found(self, db, accepted_request):
        adapter = MockAdapter(
            "tidal",
            sync_result=SyncResult(service="tidal", status=SyncStatus.NOT_FOUND),
        )
        register_adapter(adapter)

        sync_request_to_services(db, accepted_request)

        db.refresh(accepted_request)
        assert accepted_request.tidal_sync_status == TidalSyncStatus.NOT_FOUND.value

    def test_adapter_error(self, db, accepted_request):
        adapter = MockAdapter(
            "tidal",
            sync_result=SyncResult(
                service="tidal",
                status=SyncStatus.ERROR,
                error="Connection failed",
            ),
        )
        register_adapter(adapter)

        sync_request_to_services(db, accepted_request)

        db.refresh(accepted_request)
        assert accepted_request.tidal_sync_status == TidalSyncStatus.ERROR.value

    def test_no_raw_search_query(self, db, accepted_request_no_query):
        """Intent should be None when no raw_search_query is set."""
        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        result = sync_request_to_services(db, accepted_request_no_query)

        assert len(result.results) == 1
        assert result.any_added is True

    def test_multiple_adapters(self, db, accepted_request):
        """Multiple adapters sync independently."""
        tidal = MockAdapter("tidal")
        beatport = MockAdapter(
            "beatport",
            sync_result=SyncResult(service="beatport", status=SyncStatus.NOT_FOUND),
        )
        register_adapter(tidal)
        register_adapter(beatport)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 2
        services = {r.service for r in result.results}
        assert services == {"tidal", "beatport"}

    def test_adapter_exception_caught(self, db, accepted_request):
        """Adapter exceptions are caught and converted to ERROR results."""

        class FailingAdapter(MockAdapter):
            def sync_track(self, db, user, event, normalized, intent=None):
                raise RuntimeError("Connection reset")

        adapter = FailingAdapter("tidal")
        register_adapter(adapter)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 1
        assert result.results[0].status == SyncStatus.ERROR
        assert "Connection reset" in result.results[0].error

    def test_disconnected_adapter_skipped(self, db, accepted_request):
        """Disconnected adapters are not included."""
        connected = MockAdapter("tidal", connected=True)
        disconnected = MockAdapter("beatport", connected=False)
        register_adapter(connected)
        register_adapter(disconnected)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 1
        assert result.results[0].service == "tidal"

    def test_sync_disabled_adapter_skipped(self, db, accepted_request):
        """Adapters where sync is disabled for the event are skipped."""
        enabled = MockAdapter("tidal", sync_enabled=True)
        disabled = MockAdapter("beatport", sync_enabled=False)
        register_adapter(enabled)
        register_adapter(disabled)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 1
        assert result.results[0].service == "tidal"
