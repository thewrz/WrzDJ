"""Soundcharts API client for genre/BPM/key-filtered song discovery.

Uses the POST /api/v2/top/songs endpoint to find tracks matching an
event's musical profile. Returns artist+title pairs for resolution
to playable Tidal track IDs.

API docs: https://developers.soundcharts.com/documentation/reference/song/get-songs
Free tier: 1000 calls/month (1 call per recommendation generation).
"""

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.services.recommendation.camelot import parse_key

logger = logging.getLogger(__name__)

BASE_URL = "https://customer.api.soundcharts.com"
REQUEST_TIMEOUT = 15


# Camelot position → (pitch_class 0-11, mode 0=minor/1=major)
# Derived from _KEY_DEFINITIONS in camelot.py
_CAMELOT_TO_PITCH: dict[tuple[int, str], tuple[int, int]] = {
    # Minor keys (A ring) — mode=0
    (1, "A"): (8, 0),  # Ab/G# minor
    (2, "A"): (3, 0),  # Eb/D# minor
    (3, "A"): (10, 0),  # Bb/A# minor
    (4, "A"): (5, 0),  # F minor
    (5, "A"): (0, 0),  # C minor
    (6, "A"): (7, 0),  # G minor
    (7, "A"): (2, 0),  # D minor
    (8, "A"): (9, 0),  # A minor
    (9, "A"): (4, 0),  # E minor
    (10, "A"): (11, 0),  # B minor
    (11, "A"): (6, 0),  # F#/Gb minor
    (12, "A"): (1, 0),  # Db/C# minor
    # Major keys (B ring) — mode=1
    (1, "B"): (11, 1),  # B major
    (2, "B"): (6, 1),  # F#/Gb major
    (3, "B"): (1, 1),  # Db/C# major
    (4, "B"): (8, 1),  # Ab/G# major
    (5, "B"): (3, 1),  # Eb/D# major
    (6, "B"): (10, 1),  # Bb/A# major
    (7, "B"): (5, 1),  # F major
    (8, "B"): (0, 1),  # C major
    (9, "B"): (7, 1),  # G major
    (10, "B"): (2, 1),  # D major
    (11, "B"): (9, 1),  # A major
    (12, "B"): (4, 1),  # E major
}

# Reverse mapping: (pitch_class, mode) → human-readable key string
_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


@dataclass(frozen=True)
class SoundchartsTrack:
    """A track discovered via Soundcharts."""

    title: str
    artist: str
    soundcharts_uuid: str


def key_to_soundcharts_filter(key_str: str) -> tuple[int, int] | None:
    """Convert a key string to Soundcharts (pitch_class, mode) filter values.

    Returns (pitch_class 0-11, mode 0=minor/1=major) or None if unparseable.
    """
    pos = parse_key(key_str)
    if pos is None:
        return None
    return _CAMELOT_TO_PITCH.get((pos.number, pos.letter))


def pitch_class_to_key_string(pitch_class: int, mode: int) -> str:
    """Convert Soundcharts pitch_class + mode back to a key string like 'D Minor'."""
    note = _NOTE_NAMES[pitch_class % 12]
    quality = "Major" if mode == 1 else "Minor"
    return f"{note} {quality}"


def _build_request_body(
    genres: list[str],
    bpm_min: float | None = None,
    bpm_max: float | None = None,
    keys: list[str] | None = None,
) -> dict:
    """Build the POST body for /api/v2/top/songs."""
    filters = []

    if genres:
        filters.append(
            {
                "type": "songGenres",
                "data": {"values": genres, "operator": "in"},
            }
        )

    if bpm_min is not None and bpm_max is not None:
        filters.append(
            {
                "type": "tempo",
                "data": {"min": int(bpm_min), "max": int(bpm_max)},
            }
        )

    if keys:
        pitch_classes: set[int] = set()
        modes: set[int] = set()
        for key_str in keys:
            result = key_to_soundcharts_filter(key_str)
            if result:
                pitch_classes.add(result[0])
                modes.add(result[1])
        if pitch_classes:
            filters.append(
                {
                    "type": "songKey",
                    "data": {"values": sorted(pitch_classes), "operator": "in"},
                }
            )
        if modes:
            filters.append(
                {
                    "type": "songMode",
                    "data": {"values": sorted(modes), "operator": "in"},
                }
            )

    return {
        "sort": {
            "platform": "spotify",
            "metricType": "streams",
            "period": "month",
            "sortBy": "total",
            "order": "desc",
        },
        "filters": filters,
    }


def discover_songs(
    genres: list[str],
    bpm_min: float | None = None,
    bpm_max: float | None = None,
    keys: list[str] | None = None,
    limit: int = 50,
) -> list[SoundchartsTrack]:
    """Discover songs via Soundcharts filtered by genre, BPM, and key.

    Returns up to `limit` tracks sorted by Spotify streams (popularity).
    Returns empty list if Soundcharts is not configured or API fails.
    """
    settings = get_settings()
    if not settings.soundcharts_app_id or not settings.soundcharts_api_key:
        logger.debug("Soundcharts not configured, skipping discovery")
        return []

    body = _build_request_body(genres, bpm_min, bpm_max, keys)

    try:
        response = httpx.post(
            f"{BASE_URL}/api/v2/top/songs",
            params={"offset": 0, "limit": limit},
            json=body,
            headers={
                "x-app-id": settings.soundcharts_app_id,
                "x-api-key": settings.soundcharts_api_key,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.warning(
            "Soundcharts API error %s: %s", e.response.status_code, e.response.text[:200]
        )
        return []
    except httpx.HTTPError as e:
        logger.warning("Soundcharts request failed: %s", e)
        return []

    data = response.json()
    tracks = []
    for item in data.get("items", []):
        song = item.get("song", {})
        name = song.get("name")
        artist_raw = song.get("creditName")
        artist = artist_raw.get("name", "") if isinstance(artist_raw, dict) else artist_raw
        uuid = song.get("uuid")
        if name and artist and uuid:
            tracks.append(
                SoundchartsTrack(
                    title=name,
                    artist=artist,
                    soundcharts_uuid=uuid,
                )
            )

    logger.info(
        "Soundcharts discovered %d tracks (genres=%s, bpm=%s-%s, keys=%s)",
        len(tracks),
        genres,
        bpm_min,
        bpm_max,
        keys,
    )
    return tracks
