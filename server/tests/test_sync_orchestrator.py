"""Tests for sync orchestrator."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.models.user import User
from app.services.sync.base import SyncResult, SyncStatus, TrackMatch
from app.services.sync.orchestrator import (
    MultiSyncResult,
    _is_already_synced,
    _persist_sync_result,
    enrich_request_metadata,
    sync_request_to_services,
    sync_requests_batch,
)
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


def _make_accepted_request(db: Session, event: Event, title: str, artist: str, key: str) -> Request:
    """Helper to create accepted requests for batch tests."""
    request = Request(
        event_id=event.id,
        song_title=title,
        artist=artist,
        source="spotify",
        status=RequestStatus.ACCEPTED.value,
        dedupe_key=key,
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
        self.search_calls = []
        self.batch_add_calls = []

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

    def search_track(self, db, user, normalized, intent=None):
        self.search_calls.append(normalized)
        return TrackMatch(
            service=self._name,
            track_id=f"track_{normalized.raw_title.lower().replace(' ', '_')}",
            title=normalized.raw_title,
            artist=normalized.raw_artist,
            match_confidence=0.95,
        )

    def ensure_playlist(self, db, user, event):
        return event.tidal_playlist_id or "mock_playlist"

    def add_to_playlist(self, db, user, playlist_id, track_id):
        return True

    def add_tracks_to_playlist(self, db, user, playlist_id, track_ids):
        self.batch_add_calls.append(track_ids)
        return True


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
        # Error is now sanitized — generic message instead of raw exception
        assert result.results[0].error == "Sync operation failed"

    def test_adapter_exception_error_is_sanitized(self, db, accepted_request):
        """httpx exceptions produce sanitized error messages."""
        import httpx

        class HttpxFailingAdapter(MockAdapter):
            def sync_track(self, db, user, event, normalized, intent=None):
                raise httpx.ConnectError("Bearer sk-secret at api.beatport.com")

        adapter = HttpxFailingAdapter("tidal")
        register_adapter(adapter)

        result = sync_request_to_services(db, accepted_request)

        assert len(result.results) == 1
        assert result.results[0].status == SyncStatus.ERROR
        assert "Bearer" not in result.results[0].error
        assert result.results[0].error == "External API connection failed"

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


class TestIsAlreadySynced:
    def test_tidal_legacy_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_synced")
        request.tidal_sync_status = TidalSyncStatus.SYNCED.value
        db.commit()
        assert _is_already_synced(request, "tidal") is True

    def test_tidal_legacy_not_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_none")
        assert _is_already_synced(request, "tidal") is False

    def test_tidal_legacy_error_not_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_err")
        request.tidal_sync_status = TidalSyncStatus.ERROR.value
        db.commit()
        assert _is_already_synced(request, "tidal") is False

    def test_json_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_json")
        request.sync_results_json = json.dumps([{"service": "beatport", "status": "added"}])
        db.commit()
        assert _is_already_synced(request, "beatport") is True

    def test_json_not_found_not_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_nf")
        request.sync_results_json = json.dumps([{"service": "beatport", "status": "not_found"}])
        db.commit()
        assert _is_already_synced(request, "beatport") is False

    def test_different_service_not_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_diff")
        request.sync_results_json = json.dumps([{"service": "tidal", "status": "added"}])
        db.commit()
        assert _is_already_synced(request, "beatport") is False

    def test_invalid_json_not_synced(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "dedup_bad")
        request.sync_results_json = "not json"
        db.commit()
        assert _is_already_synced(request, "tidal") is False


class TestPersistSyncResult:
    def test_persist_added(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "persist_add")
        result = SyncResult(
            service="tidal",
            status=SyncStatus.ADDED,
            track_match=TrackMatch(
                service="tidal",
                track_id="123",
                title="Strobe",
                artist="deadmau5",
                match_confidence=0.95,
            ),
            playlist_id="playlist_abc",
        )
        _persist_sync_result(request, result)
        db.commit()

        data = json.loads(request.sync_results_json)
        assert len(data) == 1
        assert data[0]["service"] == "tidal"
        assert data[0]["status"] == "added"
        assert data[0]["track_id"] == "123"
        assert request.tidal_track_id == "123"
        assert request.tidal_sync_status == TidalSyncStatus.SYNCED.value

    def test_persist_upserts_same_service(self, db, tidal_event):
        """Second result for same service replaces the first."""
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "persist_ups")
        # First: error
        _persist_sync_result(
            request, SyncResult(service="tidal", status=SyncStatus.ERROR, error="failed")
        )
        # Second: success
        _persist_sync_result(
            request,
            SyncResult(
                service="tidal",
                status=SyncStatus.ADDED,
                track_match=TrackMatch(
                    service="tidal",
                    track_id="456",
                    title="Strobe",
                    artist="deadmau5",
                    match_confidence=0.9,
                ),
            ),
        )
        db.commit()

        data = json.loads(request.sync_results_json)
        assert len(data) == 1  # Replaced, not appended
        assert data[0]["status"] == "added"
        assert data[0]["track_id"] == "456"

    def test_persist_multiple_services(self, db, tidal_event):
        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "persist_multi")
        _persist_sync_result(
            request,
            SyncResult(
                service="tidal",
                status=SyncStatus.ADDED,
                track_match=TrackMatch(
                    service="tidal",
                    track_id="1",
                    title="Strobe",
                    artist="deadmau5",
                    match_confidence=0.9,
                ),
            ),
        )
        _persist_sync_result(request, SyncResult(service="beatport", status=SyncStatus.NOT_FOUND))
        db.commit()

        data = json.loads(request.sync_results_json)
        assert len(data) == 2
        services = {d["service"] for d in data}
        assert services == {"tidal", "beatport"}


class TestSyncRequestsBatch:
    def test_batch_happy_path(self, db, tidal_event, tidal_user):
        """Batch sync: all tracks found, single batch add."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_1")
        r2 = _make_accepted_request(db, tidal_event, "Ghosts", "deadmau5", "batch_2")
        r3 = _make_accepted_request(db, tidal_event, "Faxing Berlin", "deadmau5", "batch_3")

        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1, r2, r3])

        # Verify single batch add call with all 3 track IDs
        assert len(adapter.batch_add_calls) == 1
        assert len(adapter.batch_add_calls[0]) == 3

        # Verify all requests have synced status
        for r in [r1, r2, r3]:
            db.refresh(r)
            assert r.tidal_sync_status == TidalSyncStatus.SYNCED.value
            data = json.loads(r.sync_results_json)
            assert data[0]["status"] == "added"

    def test_batch_partial_not_found(self, db, tidal_event, tidal_user):
        """Some tracks found, some not — found tracks still batch-added."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_p1")
        r2 = _make_accepted_request(db, tidal_event, "Unknown", "Nobody", "batch_p2")

        class PartialAdapter(MockAdapter):
            def search_track(self, db, user, normalized, intent=None):
                if "Unknown" in normalized.raw_title:
                    return None
                return super().search_track(db, user, normalized, intent)

        adapter = PartialAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1, r2])

        # r1 synced, r2 not found
        db.refresh(r1)
        assert r1.tidal_sync_status == TidalSyncStatus.SYNCED.value

        db.refresh(r2)
        assert r2.tidal_sync_status == TidalSyncStatus.NOT_FOUND.value

        # Only 1 track in batch add
        assert len(adapter.batch_add_calls) == 1
        assert len(adapter.batch_add_calls[0]) == 1

    def test_batch_skips_already_synced(self, db, tidal_event, tidal_user):
        """Requests already synced are skipped entirely."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_s1")
        r1.tidal_sync_status = TidalSyncStatus.SYNCED.value
        db.commit()

        r2 = _make_accepted_request(db, tidal_event, "Ghosts", "deadmau5", "batch_s2")

        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1, r2])

        # Only r2 was searched (r1 skipped)
        assert len(adapter.search_calls) == 1
        assert adapter.search_calls[0].raw_title == "Ghosts"

        # Only 1 track in batch add
        assert len(adapter.batch_add_calls) == 1
        assert len(adapter.batch_add_calls[0]) == 1

    def test_batch_all_already_synced(self, db, tidal_event, tidal_user):
        """When all requests are already synced, no API calls made."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_a1")
        r1.tidal_sync_status = TidalSyncStatus.SYNCED.value
        db.commit()

        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1])

        assert len(adapter.search_calls) == 0
        assert len(adapter.batch_add_calls) == 0

    def test_batch_add_failure(self, db, tidal_event, tidal_user):
        """When batch add fails, all found requests get ERROR status."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_f1")
        r2 = _make_accepted_request(db, tidal_event, "Ghosts", "deadmau5", "batch_f2")

        class FailAddAdapter(MockAdapter):
            def add_tracks_to_playlist(self, db, user, playlist_id, track_ids):
                self.batch_add_calls.append(track_ids)
                return False

        adapter = FailAddAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1, r2])

        for r in [r1, r2]:
            db.refresh(r)
            assert r.tidal_sync_status == TidalSyncStatus.ERROR.value

    def test_batch_playlist_failure(self, db, tidal_event, tidal_user):
        """When playlist creation fails, all found tracks get ERROR."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_pl1")

        class NoPlaylistAdapter(MockAdapter):
            def ensure_playlist(self, db, user, event):
                return None

        adapter = NoPlaylistAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1])

        db.refresh(r1)
        assert r1.tidal_sync_status == TidalSyncStatus.ERROR.value

    def test_batch_empty_list(self, db):
        """Empty request list is a no-op."""
        adapter = MockAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [])

        assert len(adapter.search_calls) == 0

    def test_batch_no_adapters(self, db, tidal_event, tidal_user):
        """No adapters registered — no-op."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_na1")
        sync_requests_batch(db, [r1])

        db.refresh(r1)
        assert r1.tidal_sync_status is None

    def test_batch_search_exception(self, db, tidal_event, tidal_user):
        """Search exception for one track doesn't block others."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_e1")
        r2 = _make_accepted_request(db, tidal_event, "BadTrack", "Error", "batch_e2")

        class PartialErrorAdapter(MockAdapter):
            def search_track(self, db, user, normalized, intent=None):
                self.search_calls.append(normalized)
                if "BadTrack" in normalized.raw_title:
                    raise RuntimeError("API timeout")
                return super().search_track(db, user, normalized, intent)

        adapter = PartialErrorAdapter("tidal")
        register_adapter(adapter)

        sync_requests_batch(db, [r1, r2])

        # r1 succeeded, r2 got error
        db.refresh(r1)
        assert r1.tidal_sync_status == TidalSyncStatus.SYNCED.value

        db.refresh(r2)
        assert r2.tidal_sync_status == TidalSyncStatus.ERROR.value

    def test_batch_sync_disabled_skipped(self, db, tidal_event, tidal_user):
        """Adapters with sync disabled are skipped in batch mode too."""
        r1 = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "batch_dis1")

        adapter = MockAdapter("tidal", sync_enabled=False)
        register_adapter(adapter)

        sync_requests_batch(db, [r1])

        assert len(adapter.search_calls) == 0
        db.refresh(r1)
        assert r1.tidal_sync_status is None


class TestEnrichRequestMetadata:
    """Tests for enrich_request_metadata background task."""

    def test_skips_when_all_metadata_present(self, db, tidal_event):
        """Requests with genre, bpm, and key are skipped entirely."""
        request = _make_accepted_request(db, tidal_event, "Test Song", "Test Artist", "enrich_skip")
        request.genre = "country"
        request.bpm = 120.0
        request.musical_key = "8A"
        db.commit()

        enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.genre == "country"
        assert request.bpm == 120.0
        assert request.musical_key == "8A"

    def test_skips_nonexistent_request(self, db):
        """Non-existent request ID is a no-op."""
        enrich_request_metadata(db, 999999)  # Should not raise

    def test_musicbrainz_fills_genre_first(self, db, tidal_event):
        """MusicBrainz is tried first for genre (before Beatport)."""
        request = _make_accepted_request(db, tidal_event, "Test Song", "Radiohead", "enrich_mb")
        db.commit()

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value="alternative rock",
        ):
            enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.genre == "alternative rock"

    def test_musicbrainz_skipped_when_genre_present(self, db, tidal_event):
        """MusicBrainz is not called when genre already exists."""
        request = _make_accepted_request(db, tidal_event, "Test Song", "Artist", "enrich_mb_skip")
        request.genre = "country"
        db.commit()

        with patch("app.services.sync.orchestrator.lookup_artist_genre") as mock_mb:
            enrich_request_metadata(db, request.id)
            mock_mb.assert_not_called()

    def test_beatport_fills_bpm_key_and_backfills_genre(self, db, tidal_event, tidal_user):
        """Beatport fills BPM/key (and genre when MusicBrainz missed)."""
        tidal_user.beatport_access_token = "fake_bp_token"
        db.commit()

        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "enrich_bp")
        db.commit()

        from app.schemas.beatport import BeatportSearchResult

        mock_results = [
            BeatportSearchResult(
                track_id="123",
                title="Strobe",
                artist="deadmau5",
                genre="Progressive House",
                bpm=128,
                key="F Minor",
            )
        ]

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value=None,
        ):
            with patch(
                "app.services.beatport.search_beatport_tracks",
                return_value=mock_results,
            ):
                enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.genre == "Progressive House"  # Backfilled by Beatport
        assert request.bpm == 128.0
        assert request.musical_key == "4A"  # F Minor -> 4A in Camelot

    def test_beatport_skips_genre_when_musicbrainz_filled(self, db, tidal_event, tidal_user):
        """Beatport doesn't overwrite genre already set by MusicBrainz."""
        tidal_user.beatport_access_token = "fake_bp_token"
        db.commit()

        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "enrich_bp_nogenre")
        db.commit()

        from app.schemas.beatport import BeatportSearchResult

        mock_results = [
            BeatportSearchResult(
                track_id="123",
                title="Strobe",
                artist="deadmau5",
                genre="Progressive House",
                bpm=128,
                key="F Minor",
            )
        ]

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value="electronic",
        ):
            with patch(
                "app.services.beatport.search_beatport_tracks",
                return_value=mock_results,
            ):
                enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.genre == "electronic"  # MusicBrainz's genre kept
        assert request.bpm == 128.0  # Beatport's BPM used
        assert request.musical_key == "4A"  # Beatport's key used

    def test_tidal_fills_bpm_key_when_beatport_missing(self, db, tidal_event, tidal_user):
        """Tidal provides BPM/key when Beatport is not connected."""
        # User has Tidal but no Beatport
        assert tidal_user.beatport_access_token is None

        request = _make_accepted_request(db, tidal_event, "Test Song", "Artist", "enrich_tidal")
        db.commit()

        from app.schemas.tidal import TidalSearchResult

        mock_results = [
            TidalSearchResult(
                track_id="999",
                title="Test Song",
                artist="Artist",
                bpm=120.0,
                key="D Minor",
            )
        ]

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value="pop",
        ):
            with patch(
                "app.services.tidal.search_tidal_tracks",
                return_value=mock_results,
            ):
                enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.genre == "pop"  # From MusicBrainz
        assert request.bpm == 120.0  # From Tidal
        assert request.musical_key == "7A"  # D Minor -> 7A from Tidal

    def test_tidal_skipped_when_beatport_filled_bpm_key(self, db, tidal_event, tidal_user):
        """Tidal is not called when Beatport already provided BPM + key."""
        tidal_user.beatport_access_token = "fake_bp_token"
        db.commit()

        request = _make_accepted_request(db, tidal_event, "Strobe", "deadmau5", "enrich_skip_tidal")
        db.commit()

        from app.schemas.beatport import BeatportSearchResult

        mock_bp_results = [
            BeatportSearchResult(
                track_id="123",
                title="Strobe",
                artist="deadmau5",
                genre="Progressive House",
                bpm=128,
                key="F Minor",
            )
        ]

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value=None,
        ):
            with patch(
                "app.services.beatport.search_beatport_tracks",
                return_value=mock_bp_results,
            ):
                with patch(
                    "app.services.tidal.search_tidal_tracks",
                ) as mock_tidal:
                    enrich_request_metadata(db, request.id)
                    mock_tidal.assert_not_called()

    def test_tidal_enrichment_failure_is_graceful(self, db, tidal_event, tidal_user):
        """Tidal enrichment exceptions don't crash the task."""
        request = _make_accepted_request(db, tidal_event, "Song", "Artist", "enrich_tidal_fail")
        db.commit()

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            return_value=None,
        ):
            with patch(
                "app.services.tidal.search_tidal_tracks",
                side_effect=RuntimeError("Tidal API down"),
            ):
                enrich_request_metadata(db, request.id)  # Should not raise

        db.refresh(request)
        assert request.bpm is None  # Gracefully degraded

    def test_normalizes_key_from_enrichment(self, db, tidal_event):
        """Musical key from enrichment is normalized to Camelot notation."""
        request = _make_accepted_request(db, tidal_event, "Test Song", "Artist", "enrich_key_norm")
        request.musical_key = "D Minor"
        db.commit()

        enrich_request_metadata(db, request.id)

        db.refresh(request)
        assert request.musical_key == "7A"  # D Minor = 7A

    def test_musicbrainz_failure_is_graceful(self, db, tidal_event):
        """MusicBrainz exceptions don't crash the enrichment task."""
        request = _make_accepted_request(db, tidal_event, "Test Song", "Artist", "enrich_mb_fail")
        db.commit()

        with patch(
            "app.services.sync.orchestrator.lookup_artist_genre",
            side_effect=RuntimeError("Network error"),
        ):
            enrich_request_metadata(db, request.id)  # Should not raise

        db.refresh(request)
        assert request.genre is None  # Gracefully degraded
