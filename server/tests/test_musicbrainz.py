"""Tests for the MusicBrainz artist genre enrichment service."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services.musicbrainz import (
    USER_AGENT,
    _throttled_get,
    lookup_artist_genre,
    lookup_artist_genres,
)


@pytest.fixture(autouse=True)
def _reset_throttle():
    """Reset the throttle timer between tests."""
    import app.services.musicbrainz as mb

    mb._last_request_time = 0.0
    yield


def _mock_search_response(artists):
    """Build a mock artist search response."""
    return {"artists": artists}


def _mock_artist_response(genres):
    """Build a mock artist lookup response with genres."""
    return {"id": "test-mbid", "name": "Test Artist", "genres": genres}


class TestLookupArtistGenre:
    def test_returns_top_genre(self):
        search_data = _mock_search_response([{"id": "abc-123", "name": "Radiohead", "score": 100}])
        artist_data = _mock_artist_response(
            [
                {"name": "alternative rock", "count": 15},
                {"name": "art rock", "count": 10},
                {"name": "electronic", "count": 5},
            ]
        )

        with patch("app.services.musicbrainz._throttled_get") as mock_get:
            mock_get.side_effect = [search_data, artist_data]
            result = lookup_artist_genre("Radiohead")

        assert result == "alternative rock"

    def test_returns_none_on_empty_artist_name(self):
        assert lookup_artist_genre("") is None
        assert lookup_artist_genre("   ") is None

    def test_returns_none_when_search_fails(self):
        with patch("app.services.musicbrainz._throttled_get", return_value=None):
            result = lookup_artist_genre("Nonexistent")

        assert result is None

    def test_returns_none_when_no_results(self):
        with patch(
            "app.services.musicbrainz._throttled_get",
            return_value=_mock_search_response([]),
        ):
            result = lookup_artist_genre("Nonexistent")

        assert result is None

    def test_returns_none_when_score_too_low(self):
        search_data = _mock_search_response([{"id": "abc-123", "name": "Close Match", "score": 50}])
        with patch("app.services.musicbrainz._throttled_get", return_value=search_data):
            result = lookup_artist_genre("Something Else")

        assert result is None

    def test_returns_none_when_no_genres(self):
        search_data = _mock_search_response(
            [{"id": "abc-123", "name": "Obscure Artist", "score": 95}]
        )
        artist_data = _mock_artist_response([])

        with patch("app.services.musicbrainz._throttled_get") as mock_get:
            mock_get.side_effect = [search_data, artist_data]
            result = lookup_artist_genre("Obscure Artist")

        assert result is None

    def test_returns_none_when_artist_lookup_fails(self):
        search_data = _mock_search_response([{"id": "abc-123", "name": "Radiohead", "score": 100}])
        with patch("app.services.musicbrainz._throttled_get") as mock_get:
            mock_get.side_effect = [search_data, None]
            result = lookup_artist_genre("Radiohead")

        assert result is None


class TestLookupArtistGenres:
    def test_returns_genres_sorted_by_count(self):
        search_data = _mock_search_response([{"id": "abc-123", "name": "Daft Punk", "score": 100}])
        artist_data = _mock_artist_response(
            [
                {"name": "house", "count": 5},
                {"name": "electronic", "count": 20},
                {"name": "french house", "count": 10},
            ]
        )

        with patch("app.services.musicbrainz._throttled_get") as mock_get:
            mock_get.side_effect = [search_data, artist_data]
            result = lookup_artist_genres("Daft Punk")

        assert result == ["electronic", "french house", "house"]

    def test_skips_genres_without_name(self):
        search_data = _mock_search_response([{"id": "abc-123", "name": "Artist", "score": 95}])
        artist_data = _mock_artist_response(
            [
                {"name": "rock", "count": 10},
                {"name": "", "count": 5},
                {"count": 3},
            ]
        )

        with patch("app.services.musicbrainz._throttled_get") as mock_get:
            mock_get.side_effect = [search_data, artist_data]
            result = lookup_artist_genres("Artist")

        assert result == ["rock"]


class TestThrottledGet:
    def test_sends_user_agent_header(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {"test": True}
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.musicbrainz.httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.get.return_value = mock_response
            mock_client_cls.return_value = mock_client

            result = _throttled_get("http://example.com", {"q": "test"})

        mock_client.get.assert_called_once()
        call_kwargs = mock_client.get.call_args
        assert call_kwargs.kwargs["headers"]["User-Agent"] == USER_AGENT
        assert result == {"test": True}

    def test_returns_none_on_http_error(self):
        with patch("app.services.musicbrainz.httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__ = MagicMock(return_value=mock_client)
            mock_client.__exit__ = MagicMock(return_value=False)
            mock_client.get.side_effect = httpx.HTTPStatusError(
                "503", request=MagicMock(), response=MagicMock()
            )
            mock_client_cls.return_value = mock_client

            result = _throttled_get("http://example.com", {})

        assert result is None
