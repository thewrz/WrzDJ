"""Tests for now_playing service functions."""
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session


def utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)

from app.models.event import Event
from app.models.now_playing import NowPlaying
from app.models.play_history import PlayHistory
from app.models.request import Request, RequestStatus
from app.models.user import User
from app.services.auth import get_password_hash
from app.services.now_playing import (
    archive_to_history,
    clear_now_playing,
    fuzzy_match_accepted_request,
    fuzzy_match_score,
    get_next_play_order,
    get_now_playing,
    get_play_history,
    handle_now_playing_update,
    update_bridge_status,
)


@pytest.fixture
def test_user(db: Session) -> User:
    """Create a test user."""
    user = User(
        username="testuser",
        password_hash=get_password_hash("testpassword123"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def test_event(db: Session, test_user: User) -> Event:
    """Create a test event."""
    event = Event(
        code="TEST01",
        name="Test Event",
        created_by_user_id=test_user.id,
        expires_at=utcnow() + timedelta(hours=6),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@pytest.fixture
def accepted_request(db: Session, test_event: Event) -> Request:
    """Create an accepted request."""
    request = Request(
        event_id=test_event.id,
        song_title="Blue Monday",
        artist="New Order",
        source="spotify",
        status=RequestStatus.ACCEPTED.value,
        dedupe_key="test_dedupe_key_12345678",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


class TestFuzzyMatchScore:
    """Tests for fuzzy_match_score function."""

    def test_exact_match(self):
        """Exact matches return 1.0."""
        assert fuzzy_match_score("Blue Monday", "Blue Monday") == 1.0

    def test_case_insensitive(self):
        """Matching is case-insensitive."""
        assert fuzzy_match_score("BLUE MONDAY", "blue monday") == 1.0

    def test_whitespace_trimmed(self):
        """Leading/trailing whitespace is trimmed."""
        assert fuzzy_match_score("  Blue Monday  ", "Blue Monday") == 1.0

    def test_partial_match(self):
        """Similar strings return scores above 0.5."""
        score = fuzzy_match_score("Blue Monday", "Blue Monday (Original)")
        assert 0.5 < score < 1.0

    def test_no_match(self):
        """Completely different strings return low scores."""
        score = fuzzy_match_score("Blue Monday", "Sandstorm")
        assert score < 0.3


class TestFuzzyMatchAcceptedRequest:
    """Tests for fuzzy_match_accepted_request function."""

    def test_exact_match(self, db: Session, test_event: Event, accepted_request: Request):
        """Finds exact match in accepted requests."""
        result = fuzzy_match_accepted_request(
            db, test_event.id, "Blue Monday", "New Order"
        )
        assert result is not None
        assert result.id == accepted_request.id

    def test_fuzzy_match(self, db: Session, test_event: Event, accepted_request: Request):
        """Finds fuzzy match with similar title."""
        result = fuzzy_match_accepted_request(
            db, test_event.id, "Blue Monday (Extended)", "New Order"
        )
        assert result is not None
        assert result.id == accepted_request.id

    def test_no_match_below_threshold(self, db: Session, test_event: Event, accepted_request: Request):
        """Returns None when no match above threshold."""
        result = fuzzy_match_accepted_request(
            db, test_event.id, "Sandstorm", "Darude"
        )
        assert result is None

    def test_only_matches_accepted(self, db: Session, test_event: Event):
        """Only matches against accepted requests, not new/playing/played."""
        # Create a playing request
        playing_request = Request(
            event_id=test_event.id,
            song_title="Sandstorm",
            artist="Darude",
            status=RequestStatus.PLAYING.value,
            dedupe_key="playing_dedupe_key",
        )
        db.add(playing_request)
        db.commit()

        result = fuzzy_match_accepted_request(
            db, test_event.id, "Sandstorm", "Darude"
        )
        assert result is None  # Should not match playing request


class TestGetNextPlayOrder:
    """Tests for get_next_play_order function."""

    def test_first_entry(self, db: Session, test_event: Event):
        """First play_order is 1."""
        order = get_next_play_order(db, test_event.id)
        assert order == 1

    def test_increments(self, db: Session, test_event: Event):
        """Increments from existing entries."""
        # Add some history
        for i in range(3):
            history = PlayHistory(
                event_id=test_event.id,
                title=f"Track {i}",
                artist="Artist",
                started_at=utcnow(),
                play_order=i + 1,
            )
            db.add(history)
        db.commit()

        order = get_next_play_order(db, test_event.id)
        assert order == 4


class TestArchiveToHistory:
    """Tests for archive_to_history function."""

    def test_creates_history_entry(self, db: Session, test_event: Event):
        """Creates a history entry from now_playing."""
        now_playing = NowPlaying(
            event_id=test_event.id,
            title="Test Track",
            artist="Test Artist",
            album="Test Album",
            deck="1",
            spotify_track_id="sp123",
            album_art_url="https://example.com/art.jpg",
            spotify_uri="spotify:track:sp123",
            source="stagelinq",
            started_at=utcnow() - timedelta(minutes=5),
        )
        db.add(now_playing)
        db.commit()

        history = archive_to_history(db, now_playing)
        db.commit()

        assert history.event_id == test_event.id
        assert history.title == "Test Track"
        assert history.artist == "Test Artist"
        assert history.album == "Test Album"
        assert history.deck == "1"
        assert history.spotify_track_id == "sp123"
        assert history.source == "stagelinq"
        assert history.play_order == 1
        assert history.ended_at is not None

    def test_preserves_matched_request_id(self, db: Session, test_event: Event, accepted_request: Request):
        """Preserves matched_request_id in history."""
        now_playing = NowPlaying(
            event_id=test_event.id,
            title="Test Track",
            artist="Test Artist",
            source="stagelinq",
            matched_request_id=accepted_request.id,
            started_at=utcnow(),
        )
        db.add(now_playing)
        db.commit()

        history = archive_to_history(db, now_playing)
        db.commit()

        assert history.matched_request_id == accepted_request.id


class TestHandleNowPlayingUpdate:
    """Tests for handle_now_playing_update function."""

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_creates_now_playing(self, mock_spotify, db: Session, test_event: Event):
        """Creates a new now_playing record."""
        mock_spotify.return_value = None

        result = handle_now_playing_update(
            db, "TEST01", "New Track", "New Artist", "Test Album", "1"
        )

        assert result is not None
        assert result.title == "New Track"
        assert result.artist == "New Artist"
        assert result.album == "Test Album"
        assert result.deck == "1"
        assert result.source == "stagelinq"

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_archives_previous_track(self, mock_spotify, db: Session, test_event: Event):
        """Archives previous track when new track arrives."""
        mock_spotify.return_value = None

        # First track
        handle_now_playing_update(db, "TEST01", "First Track", "First Artist")

        # Second track should archive the first
        handle_now_playing_update(db, "TEST01", "Second Track", "Second Artist")

        # Check history
        items, total = get_play_history(db, test_event.id)
        assert total == 1
        assert items[0].title == "First Track"
        assert items[0].ended_at is not None

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_auto_matches_request(self, mock_spotify, db: Session, test_event: Event, accepted_request: Request):
        """Auto-matches accepted requests."""
        mock_spotify.return_value = None

        result = handle_now_playing_update(
            db, "TEST01", "Blue Monday", "New Order"
        )

        # Check request was matched
        db.refresh(accepted_request)
        assert accepted_request.status == RequestStatus.PLAYING.value
        assert result.matched_request_id == accepted_request.id

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_transitions_request_to_played(self, mock_spotify, db: Session, test_event: Event, accepted_request: Request):
        """Transitions matched request to played when next track arrives."""
        mock_spotify.return_value = None

        # First track matches request
        handle_now_playing_update(db, "TEST01", "Blue Monday", "New Order")

        # Second track should transition request to played
        handle_now_playing_update(db, "TEST01", "Sandstorm", "Darude")

        db.refresh(accepted_request)
        assert accepted_request.status == RequestStatus.PLAYED.value

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_adds_spotify_data(self, mock_spotify, db: Session, test_event: Event):
        """Adds Spotify album art data."""
        mock_spotify.return_value = {
            "spotify_track_id": "sp123",
            "album_art_url": "https://example.com/art.jpg",
            "spotify_uri": "spotify:track:sp123",
        }

        result = handle_now_playing_update(db, "TEST01", "Test Track", "Test Artist")

        assert result.spotify_track_id == "sp123"
        assert result.album_art_url == "https://example.com/art.jpg"
        assert result.spotify_uri == "spotify:track:sp123"

    def test_event_not_found(self, db: Session):
        """Returns None for non-existent event."""
        result = handle_now_playing_update(db, "INVALID", "Test", "Test")
        assert result is None


class TestUpdateBridgeStatus:
    """Tests for update_bridge_status function."""

    def test_updates_status(self, db: Session, test_event: Event):
        """Updates bridge connection status."""
        success = update_bridge_status(db, "TEST01", True, "SC6000")

        assert success
        now_playing = get_now_playing(db, test_event.id)
        assert now_playing.bridge_connected is True
        assert now_playing.bridge_device_name == "SC6000"
        assert now_playing.bridge_last_seen is not None

    def test_creates_placeholder_if_needed(self, db: Session, test_event: Event):
        """Creates placeholder now_playing if none exists."""
        success = update_bridge_status(db, "TEST01", True, "Prime 4")

        assert success
        now_playing = get_now_playing(db, test_event.id)
        assert now_playing is not None
        assert now_playing.title == ""  # Placeholder
        assert now_playing.bridge_connected is True

    def test_event_not_found(self, db: Session):
        """Returns False for non-existent event."""
        success = update_bridge_status(db, "INVALID", True)
        assert success is False


class TestClearNowPlaying:
    """Tests for clear_now_playing function."""

    @patch("app.services.now_playing.lookup_spotify_album_art")
    def test_archives_and_clears(self, mock_spotify, db: Session, test_event: Event):
        """Archives current track and clears now_playing."""
        mock_spotify.return_value = None

        # Set up now_playing
        handle_now_playing_update(db, "TEST01", "Test Track", "Test Artist")

        # Clear it
        success = clear_now_playing(db, "TEST01")

        assert success
        now_playing = get_now_playing(db, test_event.id)
        assert now_playing.title == ""  # Cleared

        # Check history
        items, _ = get_play_history(db, test_event.id)
        assert len(items) == 1
        assert items[0].title == "Test Track"


class TestGetPlayHistory:
    """Tests for get_play_history function."""

    def test_returns_empty_for_no_history(self, db: Session, test_event: Event):
        """Returns empty list when no history."""
        items, total = get_play_history(db, test_event.id)
        assert items == []
        assert total == 0

    def test_returns_history_newest_first(self, db: Session, test_event: Event):
        """Returns history ordered by play_order descending."""
        # Add history
        for i in range(5):
            history = PlayHistory(
                event_id=test_event.id,
                title=f"Track {i + 1}",
                artist="Artist",
                started_at=utcnow(),
                play_order=i + 1,
            )
            db.add(history)
        db.commit()

        items, total = get_play_history(db, test_event.id)
        assert total == 5
        assert len(items) == 5
        assert items[0].title == "Track 5"  # Newest first
        assert items[4].title == "Track 1"

    def test_pagination(self, db: Session, test_event: Event):
        """Supports pagination."""
        # Add history
        for i in range(10):
            history = PlayHistory(
                event_id=test_event.id,
                title=f"Track {i + 1}",
                artist="Artist",
                started_at=utcnow(),
                play_order=i + 1,
            )
            db.add(history)
        db.commit()

        # Get page 2 (offset=3, limit=3)
        items, total = get_play_history(db, test_event.id, limit=3, offset=3)
        assert total == 10
        assert len(items) == 3
        assert items[0].title == "Track 7"  # 10, 9, 8, [7, 6, 5]
