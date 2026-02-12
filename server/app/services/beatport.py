"""Beatport API v4 integration for catalog search.

Uses OAuth2 authorization code flow for authentication.
Beatport's API is currently read-only for third-party apps —
track search and catalog access works, but playlist creation/editing
is not yet available. When Beatport opens write APIs, the stub
methods in the adapter can be implemented.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.request import Request as SongRequest
from app.models.user import User
from app.schemas.beatport import BeatportSearchResult

logger = logging.getLogger(__name__)

BEATPORT_API_BASE = "https://api.beatport.com/v4"
BEATPORT_AUTH_URL = "https://account.beatport.com/authorize"
BEATPORT_TOKEN_URL = "https://account.beatport.com/o/token/"  # nosec B105
BEATPORT_TRACK_URL = "https://www.beatport.com/track/{slug}/{track_id}"

# HTTP timeout for Beatport API calls
HTTP_TIMEOUT = 15.0


def get_auth_url(state: str) -> str:
    """Build Beatport OAuth2 authorization URL."""
    settings = get_settings()
    params = {
        "client_id": settings.beatport_client_id,
        "response_type": "code",
        "redirect_uri": settings.beatport_redirect_uri,
        "state": state,
    }
    return f"{BEATPORT_AUTH_URL}?{urlencode(params)}"


def exchange_code_for_tokens(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    settings = get_settings()
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        response = client.post(
            BEATPORT_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.beatport_redirect_uri,
                "client_id": settings.beatport_client_id,
                "client_secret": settings.beatport_client_secret,
            },
        )
        response.raise_for_status()
        return response.json()


def _refresh_token_if_needed(db: Session, user: User) -> bool:
    """Refresh Beatport token if expired. Returns True if token is valid."""
    if not user.beatport_access_token:
        return False

    # Compare timezone-safe (SQLite returns naive datetimes)
    if user.beatport_token_expires_at:
        expires = user.beatport_token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        if expires > datetime.now(UTC):
            return True

    if not user.beatport_refresh_token:
        return False

    settings = get_settings()
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.post(
                BEATPORT_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": user.beatport_refresh_token,
                    "client_id": settings.beatport_client_id,
                    "client_secret": settings.beatport_client_secret,
                },
            )
            response.raise_for_status()
            data = response.json()

        user.beatport_access_token = data["access_token"]
        if "refresh_token" in data:
            user.beatport_refresh_token = data["refresh_token"]
        expires_in = data.get("expires_in", 3600)
        user.beatport_token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
        db.commit()
        return True
    except httpx.HTTPError:
        logger.exception("Beatport token refresh failed")
        return False


def save_tokens(db: Session, user: User, token_data: dict) -> None:
    """Save Beatport OAuth tokens to the user model."""
    user.beatport_access_token = token_data["access_token"]
    user.beatport_refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    user.beatport_token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    db.commit()


def disconnect_beatport(db: Session, user: User) -> None:
    """Clear all Beatport tokens from user."""
    user.beatport_access_token = None
    user.beatport_refresh_token = None
    user.beatport_token_expires_at = None
    db.commit()


def search_beatport_tracks(
    db: Session, user: User, query: str, limit: int = 10
) -> list[BeatportSearchResult]:
    """Search Beatport catalog for tracks."""
    if not _refresh_token_if_needed(db, user):
        return []

    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.get(
                f"{BEATPORT_API_BASE}/catalog/tracks/",
                params={"q": query, "per_page": limit},
                headers={"Authorization": f"Bearer {user.beatport_access_token}"},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError:
        logger.exception("Beatport search failed")
        return []

    results = []
    for track in data.get("results", []):
        artists = ", ".join(a.get("name", "") for a in track.get("artists", []))
        genre_name = None
        if track.get("genre"):
            genre_name = track["genre"].get("name")

        # Build Beatport URL from slug and ID
        track_id = str(track.get("id", ""))
        slug = track.get("slug", "untitled")
        beatport_url = BEATPORT_TRACK_URL.format(slug=slug, track_id=track_id)

        # Cover art
        cover_url = None
        if track.get("image"):
            cover_url = track["image"].get("uri")

        results.append(
            BeatportSearchResult(
                track_id=track_id,
                title=track.get("name", ""),
                artist=artists,
                mix_name=track.get("mix_name"),
                label=track.get("label", {}).get("name") if track.get("label") else None,
                genre=genre_name,
                bpm=track.get("bpm"),
                key=track.get("key", {}).get("name") if track.get("key") else None,
                duration_seconds=_parse_duration(track.get("length")),
                cover_url=cover_url,
                beatport_url=beatport_url,
                release_date=track.get("new_release_date") or track.get("publish_date"),
            )
        )

    return results


def get_beatport_track(db: Session, user: User, track_id: str) -> BeatportSearchResult | None:
    """Fetch a single track from Beatport by ID."""
    if not _refresh_token_if_needed(db, user):
        return None

    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.get(
                f"{BEATPORT_API_BASE}/catalog/tracks/{track_id}/",
                headers={"Authorization": f"Bearer {user.beatport_access_token}"},
            )
            response.raise_for_status()
            track = response.json()
    except httpx.HTTPError:
        logger.exception("Beatport track fetch failed for %s", track_id)
        return None

    artists = ", ".join(a.get("name", "") for a in track.get("artists", []))
    genre_name = None
    if track.get("genre"):
        genre_name = track["genre"].get("name")

    slug = track.get("slug", "untitled")
    beatport_url = BEATPORT_TRACK_URL.format(slug=slug, track_id=track_id)

    cover_url = None
    if track.get("image"):
        cover_url = track["image"].get("uri")

    return BeatportSearchResult(
        track_id=str(track.get("id", track_id)),
        title=track.get("name", ""),
        artist=artists,
        mix_name=track.get("mix_name"),
        label=track.get("label", {}).get("name") if track.get("label") else None,
        genre=genre_name,
        bpm=track.get("bpm"),
        key=track.get("key", {}).get("name") if track.get("key") else None,
        duration_seconds=_parse_duration(track.get("length")),
        cover_url=cover_url,
        beatport_url=beatport_url,
        release_date=track.get("new_release_date") or track.get("publish_date"),
    )


def _parse_duration(length_str: str | None) -> int | None:
    """Parse Beatport duration string (e.g., '5:30' or '05:30') to seconds."""
    if not length_str:
        return None
    try:
        parts = length_str.split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except (ValueError, IndexError):
        pass
    return None


def manual_link_beatport_track(
    db: Session,
    request: SongRequest,
    track: BeatportSearchResult,
) -> None:
    """Manually link a Beatport track to a request.

    Updates the sync_results_json with a 'matched' entry for Beatport,
    replacing any existing Beatport entry.
    """
    existing: list[dict] = []
    if request.sync_results_json:
        try:
            existing = json.loads(request.sync_results_json)
        except (json.JSONDecodeError, TypeError):
            existing = []

    # Remove old Beatport entry if any
    existing = [r for r in existing if r.get("service") != "beatport"]
    existing.append(
        {
            "service": "beatport",
            "status": "matched",
            "track_id": track.track_id,
            "track_title": track.title,
            "track_artist": track.artist,
            "confidence": 1.0,
            "url": track.beatport_url,
            "duration_seconds": track.duration_seconds,
            "playlist_id": None,
            "error": None,
        }
    )
    request.sync_results_json = json.dumps(existing)
    db.commit()
