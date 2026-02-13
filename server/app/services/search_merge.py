"""Merge and deduplicate Spotify + Beatport search results."""

from app.schemas.beatport import BeatportSearchResult
from app.schemas.search import SearchResult
from app.services.track_normalizer import fuzzy_match_score


def merge_search_results(
    spotify_results: list[SearchResult],
    beatport_results: list[BeatportSearchResult],
    dedup_threshold: float = 0.8,
    max_beatport_extras: int = 5,
) -> list[SearchResult]:
    """Merge Spotify and Beatport results, deduplicating by fuzzy match.

    Spotify results come first (ordered by popularity). Unique Beatport
    results are appended after, up to max_beatport_extras.
    """
    # Convert Beatport results to SearchResult format
    converted_bp: list[SearchResult] = []
    for bp in beatport_results:
        converted_bp.append(
            SearchResult(
                artist=bp.artist,
                title=bp.title,
                album=None,
                popularity=0,
                spotify_id=None,
                album_art=bp.cover_url,
                preview_url=None,
                url=bp.beatport_url,
                source="beatport",
            )
        )

    # Filter out Beatport duplicates
    unique_bp: list[SearchResult] = []
    for bp_result in converted_bp:
        is_duplicate = False
        for sp_result in spotify_results:
            title_score = fuzzy_match_score(bp_result.title, sp_result.title)
            artist_score = fuzzy_match_score(bp_result.artist, sp_result.artist)
            combined = title_score * 0.6 + artist_score * 0.4
            if combined >= dedup_threshold:
                is_duplicate = True
                break
        if not is_duplicate:
            unique_bp.append(bp_result)
            if len(unique_bp) >= max_beatport_extras:
                break

    return list(spotify_results) + unique_bp
