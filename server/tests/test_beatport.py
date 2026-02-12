"""Tests for Beatport service layer."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.auth import get_password_hash
from app.services.beatport import (
    _parse_duration,
    _refresh_token_if_needed,
    disconnect_beatport,
    search_beatport_tracks,
)


@pytest.fixture
def beatport_user(db: Session) -> User:
    """User with Beatport tokens."""
    user = User(
        username="beatport_user",
        password_hash=get_password_hash("testpassword123"),
        beatport_access_token="bp_access_token_123",
        beatport_refresh_token="bp_refresh_token_456",
        beatport_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def beatport_user_expired(db: Session) -> User:
    """User with expired Beatport tokens."""
    user = User(
        username="beatport_expired",
        password_hash=get_password_hash("testpassword123"),
        beatport_access_token="bp_expired_token",
        beatport_refresh_token="bp_refresh_token_789",
        beatport_token_expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def beatport_user_no_token(db: Session) -> User:
    """User without Beatport tokens."""
    user = User(
        username="beatport_notoken",
        password_hash=get_password_hash("testpassword123"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


MOCK_SEARCH_RESPONSE = {
    "results": [
        {
            "id": 12345,
            "name": "Strobe",
            "slug": "strobe",
            "mix_name": "Original Mix",
            "artists": [{"name": "deadmau5"}],
            "label": {"name": "mau5trap"},
            "genre": {"name": "Progressive House"},
            "bpm": 128,
            "key": {"name": "A min"},
            "length": "10:33",
            "image": {"uri": "https://geo-media.beatport.com/image/12345.jpg"},
            "new_release_date": "2009-09-14",
        }
    ]
}


class TestSearchBeatportTracks:
    @patch("app.services.beatport.httpx.Client")
    def test_search_success(self, mock_client_cls, db: Session, beatport_user: User):
        """Successful search returns parsed results."""
        mock_response = MagicMock()
        mock_response.json.return_value = MOCK_SEARCH_RESPONSE
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "deadmau5 Strobe")

        assert len(results) == 1
        assert results[0].track_id == "12345"
        assert results[0].title == "Strobe"
        assert results[0].artist == "deadmau5"
        assert results[0].mix_name == "Original Mix"
        assert results[0].label == "mau5trap"
        assert results[0].genre == "Progressive House"
        assert results[0].bpm == 128
        assert results[0].key == "A min"
        assert results[0].duration_seconds == 633
        assert "beatport.com/track/strobe/12345" in results[0].beatport_url

    @patch("app.services.beatport.httpx.Client")
    def test_search_empty(self, mock_client_cls, db: Session, beatport_user: User):
        """Empty search results return empty list."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"results": []}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "nonexistent track xyz")
        assert results == []

    def test_search_no_token(self, db: Session, beatport_user_no_token: User):
        """No token returns empty list without making API calls."""
        results = search_beatport_tracks(db, beatport_user_no_token, "deadmau5 Strobe")
        assert results == []


class TestBeatportUrlFormat:
    def test_url_format(self):
        """Beatport URL has correct format."""
        from app.services.beatport import BEATPORT_TRACK_URL

        url = BEATPORT_TRACK_URL.format(slug="strobe", track_id="12345")
        assert url == "https://www.beatport.com/track/strobe/12345"


class TestDisconnect:
    def test_disconnect_clears_tokens(self, db: Session, beatport_user: User):
        """Disconnect clears all Beatport token columns."""
        assert beatport_user.beatport_access_token is not None

        disconnect_beatport(db, beatport_user)

        db.refresh(beatport_user)
        assert beatport_user.beatport_access_token is None
        assert beatport_user.beatport_refresh_token is None
        assert beatport_user.beatport_token_expires_at is None


class TestSearchIncludesMixName:
    @patch("app.services.beatport.httpx.Client")
    def test_mix_name_captured(self, mock_client_cls, db: Session, beatport_user: User):
        """Beatport-specific mix_name field is captured."""
        response_data = {
            "results": [
                {
                    "id": 99999,
                    "name": "Levels",
                    "slug": "levels",
                    "mix_name": "Extended Mix",
                    "artists": [{"name": "Avicii"}],
                    "length": "6:30",
                },
            ]
        }
        mock_response = MagicMock()
        mock_response.json.return_value = response_data
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "Avicii Levels")
        assert results[0].mix_name == "Extended Mix"


class TestTokenRefresh:
    @patch("app.services.beatport.httpx.Client")
    def test_refresh_on_expiry(self, mock_client_cls, db: Session, beatport_user_expired: User):
        """Expired token triggers refresh, then search succeeds."""
        # First call: token refresh
        refresh_response = MagicMock()
        refresh_response.json.return_value = {
            "access_token": "new_access_token",
            "refresh_token": "new_refresh_token",
            "expires_in": 3600,
        }
        refresh_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = refresh_response
        mock_client_cls.return_value = mock_client

        result = _refresh_token_if_needed(db, beatport_user_expired)

        assert result is True
        db.refresh(beatport_user_expired)
        assert beatport_user_expired.beatport_access_token == "new_access_token"
        assert beatport_user_expired.beatport_refresh_token == "new_refresh_token"
        # SQLite returns naive datetimes, so compare without timezone
        expires = beatport_user_expired.beatport_token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        assert expires > datetime.now(UTC)


class TestParseDuration:
    def test_minutes_seconds(self):
        assert _parse_duration("5:30") == 330

    def test_hours_minutes_seconds(self):
        assert _parse_duration("1:05:30") == 3930

    def test_none(self):
        assert _parse_duration(None) is None

    def test_invalid(self):
        assert _parse_duration("invalid") is None
