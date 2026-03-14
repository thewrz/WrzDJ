"""Merge and deduplicate search results across Spotify, Beatport, and Tidal."""

from app.schemas.beatport import BeatportSearchResult
from app.schemas.search import SearchResult
from app.schemas.tidal import TidalSearchResult
from app.services.track_normalizer import artist_match_score, fuzzy_match_score


def _is_duplicate(
    candidate: SearchResult,
    existing: list[SearchResult],
    threshold: float,
) -> bool:
    """Check if a candidate result is a duplicate of any existing result."""
    for result in existing:
        title_score = fuzzy_match_score(candidate.title, result.title)
        artist_score = artist_match_score(candidate.artist, result.artist)
        combined = title_score * 0.6 + artist_score * 0.4
        if combined >= threshold:
            return True
    return False


def tidal_to_search_result(t: TidalSearchResult) -> SearchResult:
    """Convert a TidalSearchResult to the unified SearchResult format."""
    return SearchResult(
        artist=t.artist,
        title=t.title,
        album=t.album,
        popularity=0,
        spotify_id=None,
        album_art=t.cover_url,
        preview_url=None,
        url=t.tidal_url,
        source="tidal",
        genre=None,
        bpm=int(t.bpm) if t.bpm else None,
        key=t.key,
    )


def merge_search_results(
    spotify_results: list[SearchResult],
    beatport_results: list[BeatportSearchResult] | None = None,
    tidal_results: list[TidalSearchResult] | None = None,
    dedup_threshold: float = 0.8,
    max_beatport_extras: int = 5,
    max_tidal_extras: int = 5,
) -> list[SearchResult]:
    """Merge search results from multiple sources, deduplicating by fuzzy match.

    Spotify results come first (ordered by popularity). Unique Beatport
    results are appended next, then unique Tidal results.
    """
    merged: list[SearchResult] = list(spotify_results)

    # Append unique Beatport results (dedup against Spotify only, not other Beatport)
    if beatport_results:
        dedup_base = list(spotify_results)
        added = 0
        for bp in beatport_results:
            converted = SearchResult(
                artist=bp.artist,
                title=bp.title,
                album=None,
                popularity=0,
                spotify_id=None,
                album_art=bp.cover_url,
                preview_url=None,
                url=bp.beatport_url,
                source="beatport",
                genre=bp.genre,
                bpm=bp.bpm,
                key=bp.key,
            )
            if not _is_duplicate(converted, dedup_base, dedup_threshold):
                merged.append(converted)
                added += 1
                if added >= max_beatport_extras:
                    break

    # Append unique Tidal results (dedup against all prior results)
    if tidal_results:
        dedup_base = list(merged)
        added = 0
        for t in tidal_results:
            converted = tidal_to_search_result(t)
            if not _is_duplicate(converted, dedup_base, dedup_threshold):
                merged.append(converted)
                added += 1
                if added >= max_tidal_extras:
                    break

    return merged
