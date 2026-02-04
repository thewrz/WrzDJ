import secrets
import string
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.user import User


def generate_event_code(length: int = 6) -> str:
    """Generate a random alphanumeric event code."""
    alphabet = string.ascii_uppercase + string.digits
    # Remove confusing characters
    alphabet = alphabet.replace("0", "").replace("O", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_event(db: Session, name: str, user: User, expires_hours: int = 6) -> Event:
    """Create a new event with a unique code."""
    # Generate a unique code
    while True:
        code = generate_event_code()
        existing = db.query(Event).filter(Event.code == code).first()
        if not existing:
            break

    expires_at = datetime.utcnow() + timedelta(hours=expires_hours)
    event = Event(
        code=code, name=name, created_by_user_id=user.id, expires_at=expires_at
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_event_by_code(db: Session, code: str) -> Event | None:
    """Get an active event by its code."""
    return (
        db.query(Event)
        .filter(
            Event.code == code.upper(),
            Event.is_active == True,
            Event.expires_at > datetime.utcnow(),
        )
        .first()
    )


def get_events_for_user(db: Session, user: User) -> list[Event]:
    """Get all events created by a user."""
    return db.query(Event).filter(Event.created_by_user_id == user.id).order_by(Event.created_at.desc()).all()


def deactivate_event(db: Session, event: Event) -> Event:
    """Deactivate an event."""
    event.is_active = False
    db.commit()
    db.refresh(event)
    return event


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
    from app.models.request import Request
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
