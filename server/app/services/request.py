import hashlib
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.services.vote import add_vote


def compute_dedupe_key(artist: str, title: str) -> str:
    """Compute a deduplication key from normalized artist and title."""
    normalized = f"{artist.lower().strip()}:{title.lower().strip()}"
    return hashlib.sha256(normalized.encode()).hexdigest()[:32]


def create_request(
    db: Session,
    event: Event,
    artist: str,
    title: str,
    note: str | None = None,
    source: str = "manual",
    source_url: str | None = None,
    artwork_url: str | None = None,
    client_fingerprint: str | None = None,
) -> tuple[Request, bool]:
    """
    Create a new song request.
    Returns (request, is_duplicate).
    """
    dedupe_key = compute_dedupe_key(artist, title)

    # Check for duplicate in last 6 hours
    six_hours_ago = datetime.utcnow() - timedelta(hours=6)
    existing = (
        db.query(Request)
        .filter(
            Request.event_id == event.id,
            Request.dedupe_key == dedupe_key,
            Request.created_at > six_hours_ago,
        )
        .first()
    )

    if existing:
        # Auto-vote for the existing request when a duplicate is submitted
        if client_fingerprint:
            add_vote(db, existing.id, client_fingerprint)
            db.refresh(existing)
        return existing, True

    request = Request(
        event_id=event.id,
        song_title=title,
        artist=artist,
        note=note,
        source=source,
        source_url=source_url,
        artwork_url=artwork_url,
        client_fingerprint=client_fingerprint,
        dedupe_key=dedupe_key,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request, False


def get_requests_for_event(
    db: Session,
    event: Event,
    status: RequestStatus | None = None,
    since: datetime | None = None,
    limit: int = 100,
) -> list[Request]:
    """Get requests for an event with optional filters."""
    query = db.query(Request).filter(Request.event_id == event.id)

    if status:
        query = query.filter(Request.status == status.value)

    if since:
        query = query.filter(Request.created_at > since)

    return query.order_by(Request.created_at.desc()).limit(limit).all()


def update_request_status(db: Session, request: Request, status: RequestStatus) -> Request:
    """Update the status of a request."""
    request.status = status.value
    request.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(request)
    return request


def get_request_by_id(db: Session, request_id: int) -> Request | None:
    """Get a request by its ID."""
    return db.query(Request).filter(Request.id == request_id).first()
