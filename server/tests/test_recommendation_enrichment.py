"""Tests for track metadata enrichment from Tidal and Beatport."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.recommendation.enrichment import (
    enrich_event_tracks,
    enrich_from_beatport,
    enrich_from_tidal,
    enrich_track,
)
from app.services.recommendation.scorer import TrackProfile


def _make_user(tidal=True, beatport=True):
    user = MagicMock()
    user.tidal_access_token = "tok" if tidal else None
    user.tidal_refresh_token = "ref" if tidal else None
    user.beatport_access_token = "tok" if beatport else None
    return user


def _make_tidal_track(name="Test Track", artist_name="Test Artist", bpm=128, key="C maj"):
    track = MagicMock()
    track.name = name
    track.id = 12345
    track.bpm = bpm
    track.key = key
    track.duration = 300
    track.artist = SimpleNamespace(name=artist_name)
    track.album = MagicMock()
    track.album.name = "Test Album"
    track.album.image.return_value = "https://tidal.com/cover.jpg"
    return track


class TestEnrichFromTidal:
    @patch("app.services.recommendation.enrichment.get_tidal_session")
    def test_returns_profile_on_match(self, mock_session):
        session = MagicMock()
        track = _make_tidal_track()
        session.search.return_value = {"tracks": [track]}
        mock_session.return_value = session

        db = MagicMock()
        user = _make_user()

        result = enrich_from_tidal(db, user, "Test Track", "Test Artist")
        assert result is not None
        assert result.source == "tidal"
        assert result.bpm == 128.0
        assert result.track_id == "12345"

    @patch("app.services.recommendation.enrichment.get_tidal_session")
    def test_returns_none_when_no_session(self, mock_session):
        mock_session.return_value = None
        db = MagicMock()
        user = _make_user()
        assert enrich_from_tidal(db, user, "T", "A") is None

    @patch("app.services.recommendation.enrichment.get_tidal_session")
    def test_returns_none_on_no_results(self, mock_session):
        session = MagicMock()
        session.search.return_value = {"tracks": []}
        mock_session.return_value = session
        db = MagicMock()
        user = _make_user()
        assert enrich_from_tidal(db, user, "Nonexistent", "Nobody") is None

    @patch("app.services.recommendation.enrichment.get_tidal_session")
    def test_handles_missing_bpm(self, mock_session):
        session = MagicMock()
        track = _make_tidal_track(bpm=None)
        session.search.return_value = {"tracks": [track]}
        mock_session.return_value = session
        db = MagicMock()
        user = _make_user()

        result = enrich_from_tidal(db, user, "Test Track", "Test Artist")
        assert result is not None
        assert result.bpm is None

    @patch("app.services.recommendation.enrichment.get_tidal_session")
    def test_handles_exception(self, mock_session):
        session = MagicMock()
        session.search.side_effect = Exception("API error")
        mock_session.return_value = session
        db = MagicMock()
        user = _make_user()
        assert enrich_from_tidal(db, user, "T", "A") is None


class TestEnrichFromBeatport:
    @patch("app.services.recommendation.enrichment.search_beatport_tracks")
    def test_returns_profile_on_match(self, mock_search):
        from app.schemas.beatport import BeatportSearchResult

        mock_search.return_value = [
            BeatportSearchResult(
                track_id="999",
                title="Test Track",
                artist="Test Artist",
                genre="Tech House",
                bpm=126,
                key="8A",
                duration_seconds=360,
                cover_url="https://bp.com/cover.jpg",
                beatport_url="https://beatport.com/track/test/999",
            )
        ]
        db = MagicMock()
        user = _make_user()

        result = enrich_from_beatport(db, user, "Test Track", "Test Artist")
        assert result is not None
        assert result.source == "beatport"
        assert result.bpm == 126.0
        assert result.genre == "Tech House"
        assert result.key == "8A"

    @patch("app.services.recommendation.enrichment.search_beatport_tracks")
    def test_returns_none_on_no_results(self, mock_search):
        mock_search.return_value = []
        db = MagicMock()
        user = _make_user()
        assert enrich_from_beatport(db, user, "T", "A") is None

    @patch("app.services.recommendation.enrichment.search_beatport_tracks")
    def test_returns_none_on_low_match(self, mock_search):
        from app.schemas.beatport import BeatportSearchResult

        mock_search.return_value = [
            BeatportSearchResult(
                track_id="1",
                title="Completely Different",
                artist="Unknown DJ",
            )
        ]
        db = MagicMock()
        user = _make_user()
        assert enrich_from_beatport(db, user, "My Song", "My Artist") is None


class TestEnrichTrack:
    @patch("app.services.recommendation.enrichment.enrich_from_beatport")
    @patch("app.services.recommendation.enrichment.enrich_from_tidal")
    def test_merges_both_sources(self, mock_tidal, mock_bp):
        mock_bp.return_value = TrackProfile(
            title="Track", artist="Artist", bpm=128.0, key=None, genre="House", source="beatport"
        )
        mock_tidal.return_value = TrackProfile(
            title="Track",
            artist="Artist",
            bpm=127.0,
            key="8A",
            source="tidal",
            cover_url="https://tidal.com/cover.jpg",
        )
        db = MagicMock()
        user = _make_user()

        result = enrich_track(db, user, "Track", "Artist")
        assert result.bpm == 128.0  # Beatport preferred
        assert result.key == "8A"  # Filled from Tidal
        assert result.genre == "House"  # From Beatport

    @patch("app.services.recommendation.enrichment.enrich_from_beatport")
    @patch("app.services.recommendation.enrichment.enrich_from_tidal")
    def test_beatport_only(self, mock_tidal, mock_bp):
        mock_bp.return_value = TrackProfile(
            title="Track", artist="Artist", bpm=128.0, genre="Techno", source="beatport"
        )
        mock_tidal.return_value = None
        db = MagicMock()
        user = _make_user()

        result = enrich_track(db, user, "Track", "Artist")
        assert result.source == "beatport"
        assert result.bpm == 128.0

    @patch("app.services.recommendation.enrichment.enrich_from_beatport")
    @patch("app.services.recommendation.enrichment.enrich_from_tidal")
    def test_tidal_only(self, mock_tidal, mock_bp):
        mock_bp.return_value = None
        mock_tidal.return_value = TrackProfile(
            title="Track", artist="Artist", bpm=130.0, key="9A", source="tidal"
        )
        db = MagicMock()
        user = _make_user()

        result = enrich_track(db, user, "Track", "Artist")
        assert result.source == "tidal"
        assert result.bpm == 130.0

    @patch("app.services.recommendation.enrichment.enrich_from_beatport")
    @patch("app.services.recommendation.enrichment.enrich_from_tidal")
    def test_neither_service(self, mock_tidal, mock_bp):
        mock_bp.return_value = None
        mock_tidal.return_value = None
        db = MagicMock()
        user = _make_user()

        result = enrich_track(db, user, "Unknown", "Unknown")
        assert result.title == "Unknown"
        assert result.artist == "Unknown"
        assert result.bpm is None

    def test_skips_beatport_when_not_connected(self):
        db = MagicMock()
        user = _make_user(beatport=False, tidal=False)
        with (
            patch("app.services.recommendation.enrichment.enrich_from_beatport") as mock_bp,
            patch("app.services.recommendation.enrichment.enrich_from_tidal") as mock_tidal,
        ):
            mock_bp.return_value = None
            mock_tidal.return_value = None
            result = enrich_track(db, user, "T", "A")
            mock_bp.assert_not_called()
            mock_tidal.assert_not_called()
            assert result.title == "T"


class TestEnrichEventTracks:
    @patch("app.services.recommendation.enrichment.enrich_track")
    def test_enriches_list(self, mock_enrich):
        mock_enrich.return_value = TrackProfile(title="T", artist="A", bpm=128.0)
        db = MagicMock()
        user = _make_user()

        requests = [
            SimpleNamespace(song_title="Song 1", artist="Artist 1"),
            SimpleNamespace(song_title="Song 2", artist="Artist 2"),
        ]
        result = enrich_event_tracks(db, user, requests)
        assert len(result) == 2
        assert mock_enrich.call_count == 2

    @patch("app.services.recommendation.enrichment.enrich_track")
    def test_caps_at_30(self, mock_enrich):
        mock_enrich.return_value = TrackProfile(title="T", artist="A")
        db = MagicMock()
        user = _make_user()

        requests = [SimpleNamespace(song_title=f"S{i}", artist=f"A{i}") for i in range(50)]
        result = enrich_event_tracks(db, user, requests)
        assert len(result) == 30
        assert mock_enrich.call_count == 30

    @patch("app.services.recommendation.enrichment.enrich_track")
    def test_empty_requests(self, mock_enrich):
        db = MagicMock()
        user = _make_user()
        result = enrich_event_tracks(db, user, [])
        assert result == []
        mock_enrich.assert_not_called()
