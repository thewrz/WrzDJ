"""Tests for Soundcharts → Tidal candidate resolution pipeline."""

from unittest.mock import MagicMock, patch

from app.schemas.tidal import TidalSearchResult
from app.services.recommendation.scorer import EventProfile
from app.services.recommendation.soundcharts_candidates import (
    BPM_RANGE_OFFSET,
    search_candidates_via_soundcharts,
)
from app.services.soundcharts import SoundchartsTrack


def _make_user():
    user = MagicMock()
    user.tidal_access_token = "tok"
    return user


def _make_tidal_result(title="Song", artist="Artist", track_id="123"):
    return TidalSearchResult(
        track_id=track_id,
        title=title,
        artist=artist,
        bpm=128.0,
        key="D Minor",
        duration_seconds=240,
        cover_url="https://example.com/cover.jpg",
        tidal_url=f"https://tidal.com/browse/track/{track_id}",
    )


class TestSearchCandidatesViaSoundcharts:
    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_full_pipeline(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = [
            SoundchartsTrack(title="Country Roads", artist="John Denver", soundcharts_uuid="a"),
            SoundchartsTrack(title="Jolene", artist="Dolly Parton", soundcharts_uuid="b"),
        ]
        mock_tidal_search.side_effect = [
            [_make_tidal_result("Country Roads", "John Denver", "111")],
            [_make_tidal_result("Jolene", "Dolly Parton", "222")],
        ]

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            avg_bpm=120.0,
            dominant_genres=["Country"],
            dominant_keys=["G Major"],
            track_count=5,
        )

        candidates, total_searched = search_candidates_via_soundcharts(db, user, profile)

        assert len(candidates) == 2
        assert total_searched == 2
        assert candidates[0].title == "Country Roads"
        assert candidates[0].source == "tidal"
        assert candidates[0].track_id == "111"
        assert candidates[1].title == "Jolene"

        # Verify discover_songs was called with correct args
        mock_discover.assert_called_once_with(
            genres=["Country"],
            bpm_min=120.0 - BPM_RANGE_OFFSET,
            bpm_max=120.0 + BPM_RANGE_OFFSET,
            keys=["G Major"],
            limit=25,
        )

    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_tidal_not_found_skipped(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = [
            SoundchartsTrack(title="Rare Song", artist="Unknown Artist", soundcharts_uuid="x"),
            SoundchartsTrack(title="Found Song", artist="Known Artist", soundcharts_uuid="y"),
        ]
        mock_tidal_search.side_effect = [
            [],  # Not found on Tidal
            [_make_tidal_result("Found Song", "Known Artist", "333")],
        ]

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            dominant_genres=["Pop"],
            track_count=3,
        )

        candidates, total_searched = search_candidates_via_soundcharts(db, user, profile)

        assert len(candidates) == 1
        assert total_searched == 2
        assert candidates[0].title == "Found Song"

    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_soundcharts_empty_returns_empty(self, mock_discover):
        mock_discover.return_value = []

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            dominant_genres=["Country"],
            track_count=5,
        )

        candidates, total_searched = search_candidates_via_soundcharts(db, user, profile)
        assert candidates == []
        assert total_searched == 0

    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_bpm_range_calculation(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = []

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            avg_bpm=100.0,
            dominant_genres=["Rock"],
            track_count=5,
        )

        search_candidates_via_soundcharts(db, user, profile)

        call_kwargs = mock_discover.call_args
        assert call_kwargs.kwargs["bpm_min"] == 100.0 - BPM_RANGE_OFFSET
        assert call_kwargs.kwargs["bpm_max"] == 100.0 + BPM_RANGE_OFFSET

    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_no_bpm_sends_none(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = []

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            dominant_genres=["Pop"],
            track_count=3,
        )

        search_candidates_via_soundcharts(db, user, profile)

        call_kwargs = mock_discover.call_args
        assert call_kwargs.kwargs["bpm_min"] is None
        assert call_kwargs.kwargs["bpm_max"] is None

    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_key_filter_passed(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = []

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            dominant_genres=["House"],
            dominant_keys=["D Minor", "G Major"],
            track_count=5,
        )

        search_candidates_via_soundcharts(db, user, profile)

        call_kwargs = mock_discover.call_args
        assert call_kwargs.kwargs["keys"] == ["D Minor", "G Major"]

    @patch("app.services.tidal.search_tidal_tracks")
    @patch("app.services.recommendation.soundcharts_candidates.discover_songs")
    def test_no_keys_sends_none(self, mock_discover, mock_tidal_search):
        mock_discover.return_value = []

        db = MagicMock()
        user = _make_user()
        profile = EventProfile(
            dominant_genres=["Pop"],
            track_count=3,
        )

        search_candidates_via_soundcharts(db, user, profile)

        call_kwargs = mock_discover.call_args
        assert call_kwargs.kwargs["keys"] is None
