import secrets
import string
from datetime import datetime, timedelta
from enum import Enum

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request
from app.models.user import User
from app.schemas.event import EventStatus


class EventLookupResult(str, Enum):
    """Result of looking up an event by code."""

    FOUND = "found"
    NOT_FOUND = "not_found"
    EXPIRED = "expired"
    ARCHIVED = "archived"


def generate_event_code(length: int = 6) -> str:
    """Generate a random alphanumeric event code."""
    alphabet = string.ascii_uppercase + string.digits
    # Remove confusing characters
    alphabet = alphabet.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def compute_event_status(event: Event) -> EventStatus:
    """Compute the status of an event based on its state."""
    if event.archived_at is not None:
        return EventStatus.ARCHIVED
    if event.expires_at <= datetime.utcnow() or not event.is_active:
        return EventStatus.EXPIRED
    return EventStatus.ACTIVE


def create_event(db: Session, name: str, user: User, expires_hours: int = 6) -> Event:
    """Create a new event with a unique code."""
    # Generate a unique code
    while True:
        code = generate_event_code()
        existing = db.query(Event).filter(Event.code == code).first()
        if not existing:
            break

    expires_at = datetime.utcnow() + timedelta(hours=expires_hours)
    event = Event(code=code, name=name, created_by_user_id=user.id, expires_at=expires_at)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_event_by_code_with_status(db: Session, code: str) -> tuple[Event | None, EventLookupResult]:
    """
    Get an event by code and return lookup result status.

    Returns:
        Tuple of (event, lookup_result) where lookup_result indicates
        if the event was found, not found, expired, or archived.
    """
    event = db.query(Event).filter(Event.code == code.upper()).first()

    if not event:
        return None, EventLookupResult.NOT_FOUND

    if event.archived_at is not None:
        return event, EventLookupResult.ARCHIVED

    if event.expires_at <= datetime.utcnow() or not event.is_active:
        return event, EventLookupResult.EXPIRED

    return event, EventLookupResult.FOUND


def get_events_for_user(db: Session, user: User) -> list[Event]:
    """Get all events created by a user."""
    return (
        db.query(Event)
        .filter(Event.created_by_user_id == user.id)
        .order_by(Event.created_at.desc())
        .all()
    )


def update_event(
    db: Session,
    event: Event,
    name: str | None = None,
    expires_at: datetime | None = None,
) -> Event:
    """Update an event's properties."""
    if name is not None:
        event.name = name
    if expires_at is not None:
        event.expires_at = expires_at
    db.commit()
    db.refresh(event)
    return event


def get_event_by_code_for_owner(db: Session, code: str, user: User) -> Event | None:
    """Get an event by code, owned by the user (regardless of expiry)."""
    return (
        db.query(Event)
        .filter(
            Event.code == code.upper(),
            Event.created_by_user_id == user.id,
        )
        .first()
    )


def delete_event(db: Session, event: Event) -> None:
    """Delete an event and all its associated requests."""
    # Requests are deleted via cascade, but let's be explicit
    db.query(Request).filter(Request.event_id == event.id).delete()
    db.delete(event)
    db.commit()


def set_now_playing(db: Session, event: Event, request_id: int | None) -> Event:
    """Set the now playing request for an event."""
    event.now_playing_request_id = request_id
    event.now_playing_updated_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return event


def archive_event(db: Session, event: Event) -> Event:
    """Archive an event by setting archived_at timestamp."""
    event.archived_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return event


def unarchive_event(db: Session, event: Event) -> Event:
    """Unarchive an event by clearing archived_at timestamp."""
    event.archived_at = None
    db.commit()
    db.refresh(event)
    return event


def get_archived_events_for_user(db: Session, user: User) -> list[tuple[Event, int]]:
    """
    Get all archived events for a user with request counts.

    Returns:
        List of (event, request_count) tuples for archived events.
    """
    results = (
        db.query(Event, func.count(Request.id).label("request_count"))
        .outerjoin(Request, Request.event_id == Event.id)
        .filter(
            Event.created_by_user_id == user.id,
            Event.archived_at != None,
        )
        .group_by(Event.id)
        .order_by(Event.archived_at.desc())
        .all()
    )
    return [(event, count) for event, count in results]


def get_expired_events_for_user(db: Session, user: User) -> list[tuple[Event, int]]:
    """
    Get all expired (but not archived) events for a user with request counts.

    Returns:
        List of (event, request_count) tuples for expired events.
    """
    results = (
        db.query(Event, func.count(Request.id).label("request_count"))
        .outerjoin(Request, Request.event_id == Event.id)
        .filter(
            Event.created_by_user_id == user.id,
            Event.archived_at == None,
            (Event.expires_at <= datetime.utcnow()) | (Event.is_active == False),
        )
        .group_by(Event.id)
        .order_by(Event.expires_at.desc())
        .all()
    )
    return [(event, count) for event, count in results]
