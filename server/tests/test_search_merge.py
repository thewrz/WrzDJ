"""Tests for search merge and deduplication logic."""

from app.schemas.beatport import BeatportSearchResult
from app.schemas.search import SearchResult
from app.services.search_merge import merge_search_results


def _spotify(title: str, artist: str, popularity: int = 50) -> SearchResult:
    return SearchResult(
        title=title,
        artist=artist,
        album="Test Album",
        popularity=popularity,
        spotify_id=f"sp_{title.lower().replace(' ', '_')}",
        source="spotify",
    )


def _beatport(title: str, artist: str) -> BeatportSearchResult:
    return BeatportSearchResult(
        track_id=f"bp_{title.lower().replace(' ', '_')}",
        title=title,
        artist=artist,
        cover_url="https://img.beatport.com/test.jpg",
        beatport_url=f"https://www.beatport.com/track/{title.lower().replace(' ', '-')}/123",
    )


class TestMergeSearchResults:
    def test_spotify_only_when_no_beatport(self):
        """No Beatport results -> all source='spotify'."""
        spotify = [_spotify("Strobe", "deadmau5"), _spotify("Faxing Berlin", "deadmau5")]
        result = merge_search_results(spotify, [])
        assert len(result) == 2
        assert all(r.source == "spotify" for r in result)

    def test_beatport_appended_after_spotify(self):
        """Unique Beatport tracks appear after Spotify results."""
        spotify = [_spotify("Strobe", "deadmau5")]
        beatport = [_beatport("Acid Phase", "DJ Pierre")]
        result = merge_search_results(spotify, beatport)
        assert len(result) == 2
        assert result[0].source == "spotify"
        assert result[1].source == "beatport"
        assert result[1].title == "Acid Phase"

    def test_duplicate_removed_by_fuzzy_match(self):
        """Same track on both services -> only Spotify version kept."""
        spotify = [_spotify("Strobe", "deadmau5")]
        beatport = [_beatport("Strobe", "deadmau5")]
        result = merge_search_results(spotify, beatport)
        assert len(result) == 1
        assert result[0].source == "spotify"

    def test_dedup_threshold(self):
        """Tracks with combined fuzzy score >= threshold are considered duplicates."""
        spotify = [_spotify("Strobe (Original Mix)", "deadmau5")]
        beatport = [_beatport("Strobe", "deadmau5")]
        # "Strobe" vs "Strobe (Original Mix)" scores ~0.67 combined, so 0.6 catches it
        result = merge_search_results(spotify, beatport, dedup_threshold=0.6)
        assert len(result) == 1
        assert result[0].source == "spotify"

    def test_dedup_threshold_high_keeps_both(self):
        """High threshold lets similar-but-not-identical tracks through."""
        spotify = [_spotify("Strobe (Original Mix)", "deadmau5")]
        beatport = [_beatport("Strobe", "deadmau5")]
        # At 0.8 threshold, these are NOT considered duplicates (combined ~0.67)
        result = merge_search_results(spotify, beatport, dedup_threshold=0.8)
        assert len(result) == 2

    def test_beatport_result_converted_to_search_result(self):
        """BeatportSearchResult mapped to SearchResult correctly."""
        beatport = [_beatport("Acid Phase", "DJ Pierre")]
        result = merge_search_results([], beatport)
        assert len(result) == 1
        r = result[0]
        assert r.source == "beatport"
        assert r.spotify_id is None
        assert r.popularity == 0
        assert r.album_art == "https://img.beatport.com/test.jpg"
        assert (r.url or "").startswith("https://www.beatport.com/")

    def test_empty_spotify_returns_beatport_only(self):
        """If Spotify returns nothing, Beatport fills in."""
        beatport = [
            _beatport("Acid Phase", "DJ Pierre"),
            _beatport("Move Your Body", "Marshall Jefferson"),
        ]
        result = merge_search_results([], beatport)
        assert len(result) == 2
        assert all(r.source == "beatport" for r in result)

    def test_max_results_cap(self):
        """Total unique Beatport extras capped at max_beatport_extras."""
        spotify = [_spotify(f"Song {i}", f"Artist {i}") for i in range(20)]
        beatport = [_beatport(f"BP Track {i}", f"BP Artist {i}") for i in range(10)]
        result = merge_search_results(spotify, beatport, max_beatport_extras=5)
        beatport_count = sum(1 for r in result if r.source == "beatport")
        assert beatport_count == 5
        assert len(result) == 25
