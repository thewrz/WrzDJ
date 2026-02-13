"""Template playlist conversion to TrackProfile lists.

Converts tracks from Tidal or Beatport playlists into TrackProfile
objects suitable for building an EventProfile for recommendations.
"""

import logging

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.recommendation.scorer import TrackProfile

logger = logging.getLogger(__name__)

# Maximum tracks to use from a template playlist
MAX_TEMPLATE_TRACKS = 50


def tidal_get_playlist_tracks(db: Session, user: User, playlist_id: str) -> list:
    """Fetch raw tidalapi.Track objects from a Tidal playlist."""
    from app.services.tidal import get_playlist_tracks

    return get_playlist_tracks(db, user, playlist_id)


def beatport_get_playlist_tracks(db: Session, user: User, playlist_id: str) -> list:
    """Fetch BeatportSearchResult objects from a Beatport playlist."""
    from app.services.beatport import get_playlist_tracks

    return get_playlist_tracks(db, user, playlist_id)


def tracks_from_tidal_playlist(db: Session, user: User, playlist_id: str) -> list[TrackProfile]:
    """Convert a Tidal playlist into a list of TrackProfile objects."""
    from app.services.tidal import _get_artist_name

    raw_tracks = tidal_get_playlist_tracks(db, user, playlist_id)

    profiles = []
    for track in raw_tracks[:MAX_TEMPLATE_TRACKS]:
        try:
            artist_name = _get_artist_name(track)
            title = track.name or "Unknown"

            cover_url = None
            try:
                if track.album:
                    cover_url = track.album.image(640)
            except Exception:  # nosec B110 - cover art is optional
                pass

            profiles.append(
                TrackProfile(
                    title=title,
                    artist=artist_name,
                    bpm=float(track.bpm) if track.bpm else None,
                    key=getattr(track, "key", None),
                    source="tidal",
                    track_id=str(track.id),
                    url=f"https://tidal.com/browse/track/{track.id}",
                    cover_url=cover_url,
                    duration_seconds=track.duration if track.duration else None,
                )
            )
        except Exception as e:
            logger.warning("Failed to convert Tidal track: %s", e)
            continue

    return profiles


def tracks_from_beatport_playlist(db: Session, user: User, playlist_id: str) -> list[TrackProfile]:
    """Convert a Beatport playlist into a list of TrackProfile objects."""
    results = beatport_get_playlist_tracks(db, user, playlist_id)

    profiles = []
    for r in results[:MAX_TEMPLATE_TRACKS]:
        profiles.append(
            TrackProfile(
                title=r.title,
                artist=r.artist,
                bpm=float(r.bpm) if r.bpm else None,
                key=r.key,
                genre=r.genre,
                source="beatport",
                track_id=r.track_id,
                url=r.beatport_url,
                cover_url=r.cover_url,
                duration_seconds=r.duration_seconds,
            )
        )

    return profiles
