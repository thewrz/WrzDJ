"""Play history management — archiving, ordering, and retrieval."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.now_playing import NowPlaying
from app.models.play_history import PlayHistory


def _utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(UTC)


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
        ended_at=_utcnow(),
        play_order=get_next_play_order(db, now_playing.event_id),
    )
    db.add(history_entry)
    return history_entry


def get_play_history(
    db: Session, event_id: int, limit: int = 20, offset: int = 0
) -> tuple[list[PlayHistory], int]:
    """Get play history for an event, newest first."""
    query = db.query(PlayHistory).filter(PlayHistory.event_id == event_id)
    total = query.count()
    items = query.order_by(PlayHistory.play_order.desc()).offset(offset).limit(limit).all()
    return items, total
