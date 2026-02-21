"""Bridge integration — handles now-playing updates from DJ equipment."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.now_playing import NowPlaying
from app.models.request import Request, RequestStatus
from app.services.play_history_service import archive_to_history

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


def handle_now_playing_update(
    db: Session,
    event_code: str,
    title: str,
    artist: str,
    album: str | None = None,
    deck: str | None = None,
) -> NowPlaying | None:
    """Handle a new track from the bridge.

    Flow:
    1. Archive previous track to play_history (if exists)
    2. Transition matched request from "playing" -> "played"
    3. Upsert now_playing with new track
    4. Spotify album art lookup
    5. Fuzzy match against accepted requests -> set to "playing"
    """
    from app.services.now_playing import (
        fuzzy_match_pending_request,
        get_event_by_code_for_bridge,
        get_now_playing,
        lookup_spotify_album_art,
    )

    event = get_event_by_code_for_bridge(db, event_code)
    if not event:
        logger.warning(f"Event not found for code: {event_code}")
        return None

    # Step 1: Archive previous track if exists
    existing = get_now_playing(db, event.id)
    if existing and existing.title:
        archive_to_history(db, existing)

    # Step 2: Transition ALL playing requests for this event to played
    # (handles both bridge-matched and manually-playing requests)
    playing_requests = (
        db.query(Request)
        .filter(
            Request.event_id == event.id,
            Request.status == RequestStatus.PLAYING.value,
        )
        .all()
    )
    for req in playing_requests:
        req.status = RequestStatus.PLAYED.value
        req.updated_at = _utcnow()
        logger.info(f"Marked request {req.id} as played (bridge override)")

    # Clear System A pointer so it doesn't conflict
    if event.now_playing_request_id is not None:
        event.now_playing_request_id = None
        event.now_playing_updated_at = _utcnow()

    # Step 3: Upsert now_playing
    if existing:
        existing.title = title
        existing.artist = artist
        existing.album = album
        existing.deck = deck
        existing.source = "stagelinq"
        existing.started_at = _utcnow()
        existing.spotify_track_id = None
        existing.album_art_url = None
        existing.spotify_uri = None
        existing.matched_request_id = None
        now_playing = existing
    else:
        now_playing = NowPlaying(
            event_id=event.id,
            title=title,
            artist=artist,
            album=album,
            deck=deck,
            source="stagelinq",
            started_at=_utcnow(),
        )
        db.add(now_playing)

    # Step 4: Spotify album art lookup
    spotify_data = lookup_spotify_album_art(title, artist)
    if spotify_data:
        now_playing.spotify_track_id = spotify_data["spotify_track_id"]
        now_playing.album_art_url = spotify_data["album_art_url"]
        now_playing.spotify_uri = spotify_data["spotify_uri"]

    # Step 5: Fuzzy match against new/accepted requests
    matched_request = fuzzy_match_pending_request(db, event.id, title, artist)
    if matched_request:
        matched_request.status = RequestStatus.PLAYING.value
        matched_request.updated_at = _utcnow()
        now_playing.matched_request_id = matched_request.id
        logger.info(f"Auto-matched request {matched_request.id} as playing")

    db.commit()
    db.refresh(now_playing)
    return now_playing


def update_bridge_status(
    db: Session,
    event_code: str,
    connected: bool,
    device_name: str | None = None,
) -> bool:
    """Update bridge connection status for an event."""
    from app.services.now_playing import get_event_by_code_for_bridge, get_now_playing

    event = get_event_by_code_for_bridge(db, event_code)
    if not event:
        return False

    now_playing = get_now_playing(db, event.id)
    if now_playing:
        now_playing.bridge_connected = connected
        now_playing.bridge_device_name = device_name
        now_playing.bridge_last_seen = _utcnow() if connected else now_playing.bridge_last_seen
    else:
        # Create a placeholder now_playing for status tracking
        now_playing = NowPlaying(
            event_id=event.id,
            title="",
            artist="",
            bridge_connected=connected,
            bridge_device_name=device_name,
            bridge_last_seen=_utcnow() if connected else None,
        )
        db.add(now_playing)

    # Log bridge connection/disconnection
    try:
        from app.services.activity_log import log_activity

        if connected:
            device_info = f" ({device_name})" if device_name else ""
            log_activity(
                db,
                "info",
                "bridge",
                f"Bridge connected{device_info}",
                event_code=event_code,
                user_id=event.created_by_user_id,
            )
        else:
            log_activity(
                db,
                "warning",
                "bridge",
                "Bridge disconnected",
                event_code=event_code,
                user_id=event.created_by_user_id,
            )
    except Exception:
        pass  # nosec B110

    db.commit()
    return True


def clear_now_playing(db: Session, event_code: str) -> bool:
    """Clear now_playing for an event (bridge disconnect or deck cleared)."""
    from app.services.now_playing import get_event_by_code_for_bridge, get_now_playing

    event = get_event_by_code_for_bridge(db, event_code)
    if not event:
        return False

    existing = get_now_playing(db, event.id)
    if existing and existing.title:
        archive_to_history(db, existing)

        # Mark matched request as played if exists
        if existing.matched_request_id:
            request = db.query(Request).filter(Request.id == existing.matched_request_id).first()
            if request and request.status == RequestStatus.PLAYING.value:
                request.status = RequestStatus.PLAYED.value
                request.updated_at = _utcnow()

        # Clear the now_playing fields but keep connection status
        existing.title = ""
        existing.artist = ""
        existing.album = None
        existing.deck = None
        existing.spotify_track_id = None
        existing.album_art_url = None
        existing.spotify_uri = None
        existing.matched_request_id = None
        existing.started_at = _utcnow()

        db.commit()
    return True
