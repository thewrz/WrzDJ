"""Service for StageLinQ now-playing and play history management."""

import logging
from datetime import UTC, datetime
from difflib import SequenceMatcher

from sqlalchemy.orm import Session


def utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


from datetime import timedelta

from app.models.event import Event
from app.models.now_playing import NowPlaying
from app.models.play_history import PlayHistory
from app.models.request import Request, RequestStatus
from app.services.spotify import _call_spotify_api

# Auto-hide timeout: 60 minutes of no activity (track change, bridge heartbeat, or manual show)
NOW_PLAYING_AUTO_HIDE_MINUTES = 60

logger = logging.getLogger(__name__)


def get_event_by_code_for_bridge(db: Session, code: str) -> Event | None:
    """Get an event by code (regardless of expiry, for bridge use)."""
    return db.query(Event).filter(Event.code == code.upper()).first()


def get_now_playing(db: Session, event_id: int) -> NowPlaying | None:
    """Get the current now-playing track for an event."""
    return db.query(NowPlaying).filter(NowPlaying.event_id == event_id).first()


def is_now_playing_hidden(db: Session, event_id: int) -> bool:
    """
    Check if now playing should be hidden on kiosk.

    Hidden if ANY of these conditions are true:
    1. No track is playing (empty title)
    2. manual_hide_now_playing is True
    3. More than 60 minutes since last activity (started_at or last_shown_at)
    """
    now_playing = get_now_playing(db, event_id)

    # No now_playing record or empty track
    if not now_playing or not now_playing.title:
        return True

    # Manually hidden
    if now_playing.manual_hide_now_playing:
        return True

    # Auto-hide: check if more than 60 minutes since last activity.
    # Activity signals: started_at (track change), last_shown_at (DJ toggle),
    # and bridge_last_seen (bridge heartbeat — proves track is still live).
    now = utcnow()
    last_activity = now_playing.started_at

    # Make timezone-aware if naive (SQLite doesn't preserve timezone)
    if last_activity.tzinfo is None:
        last_activity = last_activity.replace(tzinfo=UTC)

    if now_playing.last_shown_at:
        last_shown = now_playing.last_shown_at
        if last_shown.tzinfo is None:
            last_shown = last_shown.replace(tzinfo=UTC)
        if last_shown > last_activity:
            last_activity = last_shown

    # Bridge heartbeat keeps the timer alive while the bridge is actively connected
    if now_playing.bridge_last_seen:
        bridge_seen = now_playing.bridge_last_seen
        if bridge_seen.tzinfo is None:
            bridge_seen = bridge_seen.replace(tzinfo=UTC)
        if bridge_seen > last_activity:
            last_activity = bridge_seen

    if now - last_activity > timedelta(minutes=NOW_PLAYING_AUTO_HIDE_MINUTES):
        return True

    return False


def get_manual_hide_setting(db: Session, event_id: int) -> bool:
    """
    Get the DJ's manual hide/show preference (not the computed kiosk state).

    Returns the manual_hide_now_playing flag, ignoring auto-hide and track status.
    Used by the dashboard toggle to reflect the DJ's intent.
    """
    now_playing = get_now_playing(db, event_id)
    if not now_playing:
        return False
    return now_playing.manual_hide_now_playing


def set_now_playing_visibility(db: Session, event_id: int, hidden: bool) -> bool:
    """
    Set manual visibility for now playing on kiosk.

    When showing (hidden=False):
    - Set manual_hide_now_playing = False
    - Update last_shown_at to now (resets the 60-minute timer)

    When hiding (hidden=True):
    - Set manual_hide_now_playing = True

    Returns True on success, False if no now_playing record exists.
    """
    now_playing = get_now_playing(db, event_id)

    if not now_playing:
        # Create a placeholder if none exists
        now_playing = NowPlaying(
            event_id=event_id,
            title="",
            artist="",
            manual_hide_now_playing=hidden,
            last_shown_at=utcnow() if not hidden else None,
        )
        db.add(now_playing)
    else:
        now_playing.manual_hide_now_playing = hidden
        if not hidden:
            # When showing, reset the timer
            now_playing.last_shown_at = utcnow()

    db.commit()
    return True


def get_next_play_order(db: Session, event_id: int) -> int:
    """Get the next play_order value for an event's play history."""
    max_order = (
        db.query(PlayHistory.play_order)
        .filter(PlayHistory.event_id == event_id)
        .order_by(PlayHistory.play_order.desc())
        .first()
    )
    return (max_order[0] + 1) if max_order else 1


def archive_to_history(db: Session, now_playing: NowPlaying) -> PlayHistory:
    """Archive current now_playing to play_history."""
    history_entry = PlayHistory(
        event_id=now_playing.event_id,
        title=now_playing.title,
        artist=now_playing.artist,
        album=now_playing.album,
        deck=now_playing.deck,
        spotify_track_id=now_playing.spotify_track_id,
        album_art_url=now_playing.album_art_url,
        spotify_uri=now_playing.spotify_uri,
        matched_request_id=now_playing.matched_request_id,
        source=now_playing.source,
        started_at=now_playing.started_at,
        ended_at=utcnow(),
        play_order=get_next_play_order(db, now_playing.event_id),
    )
    db.add(history_entry)
    return history_entry


def fuzzy_match_score(a: str, b: str) -> float:
    """Compute similarity ratio between two strings (0.0 to 1.0)."""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def fuzzy_match_accepted_request(
    db: Session, event_id: int, title: str, artist: str, threshold: float = 0.8
) -> Request | None:
    """
    Find an accepted request that fuzzy-matches the given track.

    Only matches against requests with status='accepted'.
    Returns the best match above threshold, or None.
    """
    accepted = (
        db.query(Request)
        .filter(
            Request.event_id == event_id,
            Request.status == RequestStatus.ACCEPTED.value,
        )
        .all()
    )

    best_match = None
    best_score = 0.0

    for req in accepted:
        title_score = fuzzy_match_score(req.song_title, title)
        artist_score = fuzzy_match_score(req.artist, artist)
        combined = (title_score + artist_score) / 2

        if combined > threshold and combined > best_score:
            best_match = req
            best_score = combined

    if best_match:
        logger.info(
            f"Fuzzy matched '{title}' by '{artist}' to request "
            f"'{best_match.song_title}' by '{best_match.artist}' (score: {best_score:.2f})"
        )

    return best_match


def lookup_spotify_album_art(title: str, artist: str) -> dict | None:
    """
    Look up album art from Spotify for a track.

    Returns dict with spotify_track_id, album_art_url, spotify_uri, or None on failure.
    """
    try:
        query = f"track:{title} artist:{artist}"
        results = _call_spotify_api(query)
        if results:
            best = results[0]
            return {
                "spotify_track_id": best.spotify_id,
                "album_art_url": best.album_art,
                "spotify_uri": f"spotify:track:{best.spotify_id}" if best.spotify_id else None,
            }
    except Exception as e:
        logger.warning(f"Spotify lookup failed for '{title}' by '{artist}': {e}")
    return None


def handle_now_playing_update(
    db: Session,
    event_code: str,
    title: str,
    artist: str,
    album: str | None = None,
    deck: str | None = None,
) -> NowPlaying | None:
    """
    Handle a new track from the bridge.

    Flow:
    1. Archive previous track to play_history (if exists)
    2. Transition matched request from "playing" → "played"
    3. Upsert now_playing with new track
    4. Spotify album art lookup
    5. Fuzzy match against accepted requests → set to "playing"
    """
    event = get_event_by_code_for_bridge(db, event_code)
    if not event:
        logger.warning(f"Event not found for code: {event_code}")
        return None

    # Step 1: Archive previous track if exists
    existing = get_now_playing(db, event.id)
    if existing and existing.title:
        archive_to_history(db, existing)

        # Step 2: Transition matched request from "playing" → "played"
        if existing.matched_request_id:
            request = db.query(Request).filter(Request.id == existing.matched_request_id).first()
            if request and request.status == RequestStatus.PLAYING.value:
                request.status = RequestStatus.PLAYED.value
                request.updated_at = utcnow()
                logger.info(f"Marked request {request.id} as played")

    # Step 3: Upsert now_playing
    if existing:
        existing.title = title
        existing.artist = artist
        existing.album = album
        existing.deck = deck
        existing.source = "stagelinq"
        existing.started_at = utcnow()
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
            started_at=utcnow(),
        )
        db.add(now_playing)

    # Step 4: Spotify album art lookup
    spotify_data = lookup_spotify_album_art(title, artist)
    if spotify_data:
        now_playing.spotify_track_id = spotify_data["spotify_track_id"]
        now_playing.album_art_url = spotify_data["album_art_url"]
        now_playing.spotify_uri = spotify_data["spotify_uri"]

    # Step 5: Fuzzy match against accepted requests
    matched_request = fuzzy_match_accepted_request(db, event.id, title, artist)
    if matched_request:
        matched_request.status = RequestStatus.PLAYING.value
        matched_request.updated_at = utcnow()
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
    event = get_event_by_code_for_bridge(db, event_code)
    if not event:
        return False

    now_playing = get_now_playing(db, event.id)
    if now_playing:
        now_playing.bridge_connected = connected
        now_playing.bridge_device_name = device_name
        now_playing.bridge_last_seen = utcnow() if connected else now_playing.bridge_last_seen
    else:
        # Create a placeholder now_playing for status tracking
        now_playing = NowPlaying(
            event_id=event.id,
            title="",
            artist="",
            bridge_connected=connected,
            bridge_device_name=device_name,
            bridge_last_seen=utcnow() if connected else None,
        )
        db.add(now_playing)

    db.commit()
    return True


def clear_now_playing(db: Session, event_code: str) -> bool:
    """Clear now_playing for an event (bridge disconnect or deck cleared)."""
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
                request.updated_at = utcnow()

        # Clear the now_playing fields but keep connection status
        existing.title = ""
        existing.artist = ""
        existing.album = None
        existing.deck = None
        existing.spotify_track_id = None
        existing.album_art_url = None
        existing.spotify_uri = None
        existing.matched_request_id = None
        existing.started_at = utcnow()

        db.commit()
    return True


def get_play_history(
    db: Session, event_id: int, limit: int = 20, offset: int = 0
) -> tuple[list[PlayHistory], int]:
    """Get play history for an event, newest first."""
    query = db.query(PlayHistory).filter(PlayHistory.event_id == event_id)
    total = query.count()
    items = query.order_by(PlayHistory.play_order.desc()).offset(offset).limit(limit).all()
    return items, total


def add_manual_play(db: Session, event: Event, request: Request) -> PlayHistory:
    """
    Add a manually played song to play history.

    Called when DJ marks a request as "played" without StageLinQ.
    Idempotent: if an entry already exists for this matched_request_id, returns existing.
    """
    # Check for existing entry to ensure idempotency
    existing = (
        db.query(PlayHistory)
        .filter(
            PlayHistory.matched_request_id == request.id,
            PlayHistory.source == "manual",
        )
        .first()
    )
    if existing:
        return existing

    history_entry = PlayHistory(
        event_id=event.id,
        title=request.song_title,
        artist=request.artist,
        album=None,
        deck=None,
        spotify_track_id=None,
        album_art_url=request.artwork_url,
        spotify_uri=None,
        matched_request_id=request.id,
        source="manual",
        started_at=utcnow(),
        ended_at=utcnow(),
        play_order=get_next_play_order(db, event.id),
    )
    db.add(history_entry)
    db.commit()
    db.refresh(history_entry)
    return history_entry
