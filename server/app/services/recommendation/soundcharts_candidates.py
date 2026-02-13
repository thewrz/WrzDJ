"""Bridge between Soundcharts discovery and Tidal playback.

Discovers songs via Soundcharts (genre/BPM/key filters), then resolves
each result to a playable Tidal track ID via individual Tidal searches.
"""

import logging

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.recommendation.scorer import EventProfile, TrackProfile
from app.services.soundcharts import discover_songs

logger = logging.getLogger(__name__)

# Max Soundcharts results to resolve via Tidal (each costs 1 Tidal search)
MAX_TIDAL_LOOKUPS = 25

# BPM range around the event average
BPM_RANGE_OFFSET = 15


def search_candidates_via_soundcharts(
    db: Session,
    user: User,
    profile: EventProfile,
) -> tuple[list[TrackProfile], int]:
    """Discover tracks via Soundcharts and resolve to Tidal playable IDs.

    Returns (candidates, total_searched) where candidates are TrackProfiles
    with Tidal track_id/url, and total_searched is the number of Tidal
    lookups performed.
    """
    from app.services.tidal import search_tidal_tracks

    # Build filter parameters from the event profile
    bpm_min = None
    bpm_max = None
    if profile.avg_bpm:
        bpm_min = profile.avg_bpm - BPM_RANGE_OFFSET
        bpm_max = profile.avg_bpm + BPM_RANGE_OFFSET

    keys = list(profile.dominant_keys) if profile.dominant_keys else None
    genres = list(profile.dominant_genres)

    # Discover via Soundcharts (1 API call)
    sc_tracks = discover_songs(
        genres=genres,
        bpm_min=bpm_min,
        bpm_max=bpm_max,
        keys=keys,
        limit=MAX_TIDAL_LOOKUPS,
    )

    if not sc_tracks:
        return [], 0

    # Resolve each Soundcharts result to a Tidal track
    candidates: list[TrackProfile] = []
    total_searched = 0

    for sc_track in sc_tracks[:MAX_TIDAL_LOOKUPS]:
        query = f"{sc_track.artist} {sc_track.title}"
        results = search_tidal_tracks(db, user, query, limit=1)
        total_searched += 1

        if not results:
            continue

        tidal_result = results[0]
        # Tidal doesn't return genre — infer from the profile's dominant genre
        inferred_genre = profile.dominant_genres[0] if profile.dominant_genres else None
        candidates.append(
            TrackProfile(
                title=tidal_result.title,
                artist=tidal_result.artist,
                bpm=tidal_result.bpm,
                key=tidal_result.key,
                genre=inferred_genre,
                source="tidal",
                track_id=tidal_result.track_id,
                url=tidal_result.tidal_url,
                cover_url=tidal_result.cover_url,
                duration_seconds=tidal_result.duration_seconds,
            )
        )

    logger.info(
        "Soundcharts→Tidal resolved %d/%d tracks (searched=%d)",
        len(candidates),
        len(sc_tracks),
        total_searched,
    )
    return candidates, total_searched
