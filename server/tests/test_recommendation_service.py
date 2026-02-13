"""Tests for recommendation engine orchestrator."""

from unittest.mock import MagicMock, patch

from app.services.recommendation.scorer import EventProfile, TrackProfile
from app.services.recommendation.service import (
    RecommendationResult,
    _build_beatport_queries,
    _build_tidal_queries,
    _deduplicate_against_requests,
    _deduplicate_against_template,
    _deduplicate_candidates,
    _is_blocked_genre,
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


class TestBuildBeatportQueries:
    def test_genre_based_queries(self):
        profile = EventProfile(
            dominant_genres=["Tech House", "Progressive House", "Minimal"],
            track_count=10,
        )
        queries = _build_beatport_queries(profile)
        assert "Tech House" in queries
        assert "Progressive House" in queries
        assert "Minimal" in queries

    def test_bpm_query_added(self):
        profile = EventProfile(
            avg_bpm=128.0,
            dominant_genres=["House"],
            track_count=5,
        )
        queries = _build_beatport_queries(profile)
        assert any("128" in q for q in queries)

    def test_empty_profile(self):
        profile = EventProfile(track_count=0)
        queries = _build_beatport_queries(profile)
        assert queries == []

    def test_max_three_queries(self):
        profile = EventProfile(
            avg_bpm=128.0,
            dominant_genres=["A", "B", "C"],
            track_count=10,
        )
        queries = _build_beatport_queries(profile)
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
        queries = _build_beatport_queries(profile, template_tracks=template_tracks)
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
        queries = _build_beatport_queries(profile, template_tracks=template_tracks)
        assert "Unknown" not in queries
        assert "Various Artists" not in queries
        assert "Real Artist" in queries

    def test_genres_preferred_over_artists(self):
        """When genres exist, use them instead of artist fallback."""
        profile = EventProfile(dominant_genres=["Tech House"], avg_bpm=128.0, track_count=5)
        template_tracks = [
            TrackProfile(title="Song", artist="deadmau5", genre="Tech House"),
        ]
        queries = _build_beatport_queries(profile, template_tracks=template_tracks)
        assert "Tech House" in queries
        # Artist shouldn't be in queries when genres are available
        assert "deadmau5" not in queries

    def test_no_bpm_only_fallback_without_genres(self):
        """BPM-only query should NOT be generated when there are no genres."""
        profile = EventProfile(avg_bpm=128.0, track_count=5)
        queries = _build_beatport_queries(profile)
        # Without genres or template tracks, should return empty
        assert queries == []


class TestBuildTidalQueries:
    def test_artist_from_requests(self):
        """Builds queries from request artists, not genres."""
        profile = EventProfile(
            dominant_genres=["Country", "Pop"],
            track_count=5,
        )
        requests = [
            MagicMock(artist="Luke Bryan"),
            MagicMock(artist="Luke Bryan"),
            MagicMock(artist="Morgan Wallen"),
        ]
        queries = _build_tidal_queries(profile, requests=requests)
        assert "Luke Bryan" in queries
        assert "Morgan Wallen" in queries
        # Genre strings should NOT be in Tidal queries
        assert "Country" not in queries
        assert "Pop" not in queries

    def test_artist_from_template_tracks(self):
        """Builds queries from template track artists."""
        profile = EventProfile(dominant_genres=["House"], track_count=3)
        template_tracks = [
            TrackProfile(title="Song 1", artist="deadmau5", bpm=128.0),
            TrackProfile(title="Song 2", artist="deadmau5", bpm=130.0),
            TrackProfile(title="Song 3", artist="Zedd", bpm=126.0),
        ]
        queries = _build_tidal_queries(profile, template_tracks=template_tracks)
        assert queries[0] == "deadmau5"  # Most frequent first
        assert "Zedd" in queries

    def test_skips_unknown_artists(self):
        profile = EventProfile(track_count=2)
        requests = [
            MagicMock(artist="Unknown"),
            MagicMock(artist="Various Artists"),
            MagicMock(artist="Real Artist"),
        ]
        queries = _build_tidal_queries(profile, requests=requests)
        assert "Unknown" not in queries
        assert "Various Artists" not in queries
        assert "Real Artist" in queries

    def test_empty_sources(self):
        profile = EventProfile(track_count=0)
        queries = _build_tidal_queries(profile)
        assert queries == []

    def test_max_three_queries(self):
        profile = EventProfile(track_count=5)
        requests = [MagicMock(artist=f"Artist {i}") for i in range(10)]
        queries = _build_tidal_queries(profile, requests=requests)
        assert len(queries) <= 3

    def test_combines_requests_and_template(self):
        """Artists from both requests and templates are merged."""
        profile = EventProfile(track_count=3)
        requests = [MagicMock(artist="Artist A")]
        template_tracks = [
            TrackProfile(title="Song", artist="Artist B", bpm=128.0),
        ]
        queries = _build_tidal_queries(profile, requests=requests, template_tracks=template_tracks)
        assert "Artist A" in queries
        assert "Artist B" in queries


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


class TestIsBlockedGenre:
    def test_exact_match(self):
        assert _is_blocked_genre("DJ Tools") is True
        assert _is_blocked_genre("karaoke") is True
        assert _is_blocked_genre("Stems") is True

    def test_compound_genre(self):
        assert _is_blocked_genre("DJ Tools / Acapellas") is True
        assert _is_blocked_genre("Acapellas/DJ Tools") is True

    def test_none_and_empty(self):
        assert _is_blocked_genre(None) is False
        assert _is_blocked_genre("") is False

    def test_normal_genre_passes(self):
        assert _is_blocked_genre("House") is False
        assert _is_blocked_genre("Country") is False
        assert _is_blocked_genre("Tech House") is False


class TestCoverDetection:
    def test_cover_artist_filtered(self):
        """Cover version with same title but different artist is removed."""
        candidates = [
            TrackProfile(
                title="Save A Horse Ride A Cowboy",
                artist="Big",
                source="tidal",
            ),
        ]
        requests = [
            MagicMock(
                song_title="Save A Horse Ride A Cowboy",
                artist="Big & Rich",
            ),
        ]
        result = _deduplicate_against_requests(candidates, requests)
        assert len(result) == 0

    def test_same_artist_not_filtered(self):
        """Same title and artist should be filtered as dupe, not cover."""
        candidates = [
            TrackProfile(title="Some Song", artist="Real Artist", source="tidal"),
        ]
        requests = [MagicMock(song_title="Some Song", artist="Real Artist")]
        result = _deduplicate_against_requests(candidates, requests)
        assert len(result) == 0

    def test_different_title_and_artist_passes(self):
        """Completely different track should pass through."""
        candidates = [
            TrackProfile(title="New Song", artist="New Artist", source="tidal"),
        ]
        requests = [MagicMock(song_title="Old Song", artist="Old Artist")]
        result = _deduplicate_against_requests(candidates, requests)
        assert len(result) == 1
