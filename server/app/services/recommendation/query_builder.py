"""Search query builders for the recommendation engine.

Generates genre-based queries for Beatport and artist-based queries
for Tidal from an EventProfile and/or template tracks.
"""

from __future__ import annotations

from app.services.recommendation.scorer import EventProfile, TrackProfile
from app.services.track_normalizer import split_artists

# Maximum number of search queries per source
MAX_SEARCH_QUERIES = 3


def build_beatport_queries(
    profile: EventProfile,
    template_tracks: list[TrackProfile] | None = None,
) -> list[str]:
    """Generate search queries for Beatport from an event profile.

    Genre-based text queries work well for Beatport (genre catalog).
    Falls back to artist names from template tracks when genres are
    unavailable (e.g., Tidal playlists).
    """
    queries = []

    # Genre-based queries (best signal)
    for genre in profile.dominant_genres[:MAX_SEARCH_QUERIES]:
        queries.append(genre)

    # If we have no genres but have template tracks, use top artists
    if not queries and template_tracks:
        artist_counts: dict[str, int] = {}
        for t in template_tracks:
            if t.artist and t.artist.lower() not in ("unknown", "various artists"):
                artist_counts[t.artist] = artist_counts.get(t.artist, 0) + 1
        # Sort by frequency, take top artists as search queries
        top_artists = sorted(artist_counts, key=artist_counts.get, reverse=True)  # type: ignore[arg-type]
        for artist in top_artists[:MAX_SEARCH_QUERIES]:
            queries.append(artist)

    # If we have BPM info and still have room, add a BPM-targeted query
    if profile.avg_bpm and len(queries) < MAX_SEARCH_QUERIES:
        bpm_str = str(int(profile.avg_bpm))
        if profile.dominant_genres:
            queries.append(f"{profile.dominant_genres[0]} {bpm_str} bpm")

    return queries[:MAX_SEARCH_QUERIES]


def build_tidal_queries(
    profile: EventProfile,
    requests: list | None = None,
    template_tracks: list[TrackProfile] | None = None,
) -> list[str]:
    """Generate artist-based search queries for Tidal text search.

    Tidal's search API is a general text search -- genre strings like
    "Country" produce irrelevant results.  Use artist names instead.
    """
    artist_counts: dict[str, int] = {}

    # Collect artists from accepted requests (split multi-artist strings)
    if requests:
        for req in requests:
            artist = getattr(req, "artist", None)
            if artist:
                for individual in split_artists(artist):
                    key = individual.strip().lower()
                    if key not in ("unknown", "various artists", ""):
                        artist_counts[individual.strip()] = (
                            artist_counts.get(individual.strip(), 0) + 1
                        )

    # Collect artists from template tracks (split multi-artist strings)
    if template_tracks:
        for t in template_tracks:
            if t.artist:
                for individual in split_artists(t.artist):
                    key = individual.strip().lower()
                    if key not in ("unknown", "various artists", ""):
                        artist_counts[individual.strip()] = (
                            artist_counts.get(individual.strip(), 0) + 1
                        )

    top_artists = sorted(artist_counts, key=artist_counts.get, reverse=True)  # type: ignore[arg-type]
    return top_artists[:MAX_SEARCH_QUERIES]
