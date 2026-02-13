"""Tests for recommendation engine orchestrator."""

from unittest.mock import MagicMock, patch

from app.services.recommendation.scorer import EventProfile, TrackProfile
from app.services.recommendation.service import (
    RecommendationResult,
    _build_search_queries,
    _deduplicate_against_requests,
    _deduplicate_against_template,
    _deduplicate_candidates,
    generate_recommendations,
)


def _make_user(tidal=True, beatport=True):
    user = MagicMock()
    user.tidal_access_token = "tok" if tidal else None
    user.beatport_access_token = "tok" if beatport else None
    return user


def _make_event(code="TEST1"):
    event = MagicMock()
    event.id = 1
    event.code = code
    return event


class TestBuildSearchQueries:
    def test_genre_based_queries(self):
        profile = EventProfile(
            dominant_genres=["Tech House", "Progressive House", "Minimal"],
            track_count=10,
        )
        queries = _build_search_queries(profile)
        assert "Tech House" in queries
        assert "Progressive House" in queries
        assert "Minimal" in queries

    def test_bpm_query_added(self):
        profile = EventProfile(
            avg_bpm=128.0,
            dominant_genres=["House"],
            track_count=5,
        )
        queries = _build_search_queries(profile)
        assert any("128" in q for q in queries)

    def test_empty_profile(self):
        profile = EventProfile(track_count=0)
        queries = _build_search_queries(profile)
        assert queries == []

    def test_max_three_queries(self):
        profile = EventProfile(
            avg_bpm=128.0,
            dominant_genres=["A", "B", "C"],
            track_count=10,
        )
        queries = _build_search_queries(profile)
        assert len(queries) <= 3

    def test_artist_fallback_when_no_genres(self):
        """When no genres available, use top artists from template tracks."""
        profile = EventProfile(avg_bpm=128.0, track_count=5)
        template_tracks = [
            TrackProfile(title="Song 1", artist="deadmau5", bpm=128.0),
            TrackProfile(title="Song 2", artist="deadmau5", bpm=130.0),
            TrackProfile(title="Song 3", artist="Boris Brejcha", bpm=126.0),
            TrackProfile(title="Song 4", artist="Stephan Bodzin", bpm=125.0),
            TrackProfile(title="Song 5", artist="deadmau5", bpm=132.0),
        ]
        queries = _build_search_queries(profile, template_tracks=template_tracks)
        assert len(queries) >= 1
        # deadmau5 appears most, should be first
        assert queries[0] == "deadmau5"
        assert "Boris Brejcha" in queries or "Stephan Bodzin" in queries

    def test_artist_fallback_skips_unknown(self):
        """Unknown and Various Artists should not be used as queries."""
        profile = EventProfile(avg_bpm=120.0, track_count=3)
        template_tracks = [
            TrackProfile(title="Song 1", artist="Unknown"),
            TrackProfile(title="Song 2", artist="Various Artists"),
            TrackProfile(title="Song 3", artist="Real Artist", bpm=120.0),
        ]
        queries = _build_search_queries(profile, template_tracks=template_tracks)
        assert "Unknown" not in queries
        assert "Various Artists" not in queries
        assert "Real Artist" in queries

    def test_genres_preferred_over_artists(self):
        """When genres exist, use them instead of artist fallback."""
        profile = EventProfile(dominant_genres=["Tech House"], avg_bpm=128.0, track_count=5)
        template_tracks = [
            TrackProfile(title="Song", artist="deadmau5", genre="Tech House"),
        ]
        queries = _build_search_queries(profile, template_tracks=template_tracks)
        assert "Tech House" in queries
        # Artist shouldn't be in queries when genres are available
        assert "deadmau5" not in queries

    def test_no_bpm_only_fallback_without_genres(self):
        """BPM-only query should NOT be generated when there are no genres."""
        profile = EventProfile(avg_bpm=128.0, track_count=5)
        queries = _build_search_queries(profile)
        # Without genres or template tracks, should return empty
        assert queries == []


class TestDeduplicateAgainstTemplate:
    def test_removes_template_tracks(self):
        candidates = [
            TrackProfile(title="Strobe", artist="deadmau5", source="beatport"),
            TrackProfile(title="New Track", artist="New Artist", source="beatport"),
        ]
        template = [
            TrackProfile(title="Strobe", artist="deadmau5", source="tidal"),
        ]
        result = _deduplicate_against_template(candidates, template)
        assert len(result) == 1
        assert result[0].title == "New Track"

    def test_empty_template(self):
        candidates = [TrackProfile(title="Track", artist="Artist")]
        result = _deduplicate_against_template(candidates, [])
        assert len(result) == 1


class TestDeduplicateAgainstRequests:
    def test_removes_existing_tracks(self):
        candidates = [
            TrackProfile(title="Already Requested", artist="Same Artist"),
            TrackProfile(title="New Track", artist="Different Artist"),
        ]
        requests = [MagicMock(song_title="Already Requested", artist="Same Artist")]
        result = _deduplicate_against_requests(candidates, requests)
        assert len(result) == 1
        assert result[0].title == "New Track"

    def test_empty_requests(self):
        candidates = [TrackProfile(title="Track", artist="Artist")]
        result = _deduplicate_against_requests(candidates, [])
        assert len(result) == 1


class TestDeduplicateCandidates:
    def test_removes_duplicate_candidates(self):
        candidates = [
            TrackProfile(title="Same Track", artist="Same Artist", source="beatport"),
            TrackProfile(title="Same Track", artist="Same Artist", source="tidal"),
            TrackProfile(title="Different Track", artist="Other Artist"),
        ]
        result = _deduplicate_candidates(candidates)
        assert len(result) == 2

    def test_no_duplicates(self):
        candidates = [
            TrackProfile(title="Strobe", artist="deadmau5"),
            TrackProfile(title="Clarity", artist="Zedd"),
        ]
        result = _deduplicate_candidates(candidates)
        assert len(result) == 2


class TestGenerateRecommendations:
    @patch("app.services.recommendation.service._search_candidates")
    @patch("app.services.recommendation.service.enrich_event_tracks")
    @patch("app.services.recommendation.service._get_accepted_played_requests")
    def test_full_pipeline(self, mock_requests, mock_enrich, mock_search):
        mock_requests.return_value = [
            MagicMock(song_title="Song", artist="Artist", status="accepted"),
        ]
        mock_enrich.return_value = [
            TrackProfile(title="Song", artist="Artist", bpm=128.0, key="8A", genre="House"),
        ]
        mock_search.return_value = (
            [
                TrackProfile(
                    title="Suggestion",
                    artist="DJ",
                    bpm=127.0,
                    key="8A",
                    genre="House",
                    source="beatport",
                ),
            ],
            ["beatport"],
            1,
        )

        db = MagicMock()
        # Mock the dedup query to return no existing requests for the candidate
        db.query.return_value.filter.return_value.all.return_value = [
            MagicMock(song_title="Song", artist="Artist"),
        ]

        user = _make_user(tidal=False)
        event = _make_event()

        result = generate_recommendations(db, user, event)
        assert isinstance(result, RecommendationResult)
        assert len(result.suggestions) > 0
        assert result.enriched_count == 1
        assert "beatport" in result.services_used

    def test_no_services_connected(self):
        db = MagicMock()
        user = _make_user(tidal=False, beatport=False)
        event = _make_event()

        result = generate_recommendations(db, user, event)
        assert result.suggestions == []
        assert result.services_used == []
        assert result.event_profile.track_count == 0

    @patch("app.services.recommendation.service._search_candidates")
    @patch("app.services.recommendation.service.enrich_event_tracks")
    @patch("app.services.recommendation.service._get_accepted_played_requests")
    def test_no_accepted_requests(self, mock_requests, mock_enrich, mock_search):
        mock_requests.return_value = []
        mock_search.return_value = ([], [], 0)
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        user = _make_user()
        event = _make_event()

        result = generate_recommendations(db, user, event)
        assert result.suggestions == []
        assert result.event_profile.track_count == 0
        mock_enrich.assert_not_called()

    @patch("app.services.recommendation.service._search_candidates")
    @patch("app.services.recommendation.service.enrich_event_tracks")
    @patch("app.services.recommendation.service._get_accepted_played_requests")
    def test_dedup_excludes_existing(self, mock_requests, mock_enrich, mock_search):
        mock_requests.return_value = [
            MagicMock(song_title="Existing Song", artist="Existing Artist"),
        ]
        mock_enrich.return_value = [
            TrackProfile(title="Existing Song", artist="Existing Artist", bpm=128.0),
        ]
        # Search returns the same track that already exists
        mock_search.return_value = (
            [
                TrackProfile(
                    title="Existing Song", artist="Existing Artist", bpm=128.0, source="beatport"
                ),
            ],
            ["beatport"],
            1,
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [
            MagicMock(song_title="Existing Song", artist="Existing Artist"),
        ]
        user = _make_user()
        event = _make_event()

        result = generate_recommendations(db, user, event)
        # The existing song should be deduped out
        assert len(result.suggestions) == 0
