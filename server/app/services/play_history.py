"""Play history service for tracking played songs."""
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.play_history import PlayHistory, PlaySource
from app.models.request import Request


def add_manual_play(db: Session, event: Event, request: Request) -> PlayHistory:
    """
    Add a manually played song to the play history.

    Idempotent: if an entry already exists for this source_request_id, returns the existing entry.
    """
    existing = (
        db.query(PlayHistory)
        .filter(
            PlayHistory.source_request_id == request.id,
            PlayHistory.source == PlaySource.MANUAL.value,
        )
        .first()
    )

    if existing:
        return existing

    play_entry = PlayHistory(
        event_id=event.id,
        title=request.song_title,
        artist=request.artist,
        album_art_url=request.artwork_url,
        source=PlaySource.MANUAL.value,
        source_request_id=request.id,
        played_at=datetime.utcnow(),
    )
    db.add(play_entry)
    db.commit()
    db.refresh(play_entry)
    return play_entry


def get_play_history(
    db: Session, event: Event, limit: int = 20, offset: int = 0
) -> list[PlayHistory]:
    """
    Get the play history for an event, ordered by played_at descending.

    Args:
        db: Database session
        event: The event to get history for
        limit: Maximum number of entries to return
        offset: Number of entries to skip

    Returns:
        List of PlayHistory entries, most recent first
    """
    return (
        db.query(PlayHistory)
        .filter(PlayHistory.event_id == event.id)
        .order_by(PlayHistory.played_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_play_history_count(db: Session, event: Event) -> int:
    """Get the total count of play history entries for an event."""
    return db.query(PlayHistory).filter(PlayHistory.event_id == event.id).count()
