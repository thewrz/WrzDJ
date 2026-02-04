from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.models.request import RequestStatus
from app.models.user import User
from app.schemas.event import EventCreate, EventOut, EventUpdate
from app.schemas.request import RequestCreate, RequestOut
from app.services.event import (
    create_event,
    delete_event,
    get_event_by_code,
    get_event_by_code_for_owner,
    get_events_for_user,
    update_event,
)
from app.services.request import create_request, get_requests_for_event

router = APIRouter()
settings = get_settings()


def _event_to_out(event, request: Request | None = None) -> EventOut:
    """Convert Event model to EventOut schema with join_url."""
    # Use configured PUBLIC_URL if set, otherwise fall back to request base_url
    if settings.public_url:
        base_url = settings.public_url.rstrip("/")
    elif request:
        base_url = str(request.base_url).rstrip("/")
    else:
        base_url = None
    join_url = f"{base_url}/join/{event.code}" if base_url else None
    return EventOut(
        id=event.id,
        code=event.code,
        name=event.name,
        created_at=event.created_at,
        expires_at=event.expires_at,
        is_active=event.is_active,
        join_url=join_url,
    )


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_new_event(
    event_data: EventCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventOut:
    event = create_event(db, event_data.name, current_user, event_data.expires_hours)
    return _event_to_out(event, request)


@router.get("", response_model=list[EventOut])
def list_events(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[EventOut]:
    events = get_events_for_user(db, current_user)
    return [_event_to_out(e, request) for e in events]


@router.get("/{code}", response_model=EventOut)
def get_event(code: str, request: Request, db: Session = Depends(get_db)) -> EventOut:
    event = get_event_by_code(db, code)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or expired")
    return _event_to_out(event, request)


@router.patch("/{code}", response_model=EventOut)
def update_event_endpoint(
    code: str,
    event_data: EventUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventOut:
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    updated = update_event(
        db,
        event,
        name=event_data.name,
        expires_at=event_data.expires_at,
    )
    return _event_to_out(updated, request)


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_endpoint(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an event and all its requests."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    delete_event(db, event)


@router.post("/{code}/requests", response_model=RequestOut)
def submit_request(
    code: str,
    request_data: RequestCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> RequestOut:
    event = get_event_by_code(db, code)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or expired")

    # Get client fingerprint from IP
    client_ip = request.client.host if request.client else None

    song_request, is_duplicate = create_request(
        db=db,
        event=event,
        artist=request_data.artist,
        title=request_data.title,
        note=request_data.note,
        source=request_data.source.value,
        source_url=request_data.source_url,
        client_fingerprint=client_ip,
    )

    return RequestOut(
        id=song_request.id,
        event_id=song_request.event_id,
        song_title=song_request.song_title,
        artist=song_request.artist,
        source=song_request.source,
        source_url=song_request.source_url,
        note=song_request.note,
        status=song_request.status,
        created_at=song_request.created_at,
        updated_at=song_request.updated_at,
        is_duplicate=is_duplicate,
    )


@router.get("/{code}/requests", response_model=list[RequestOut])
def get_event_requests(
    code: str,
    status: RequestStatus | None = None,
    since: datetime | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[RequestOut]:
    event = get_event_by_code(db, code)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or expired")

    # Verify ownership
    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view requests")

    requests = get_requests_for_event(db, event, status, since, limit)
    return [
        RequestOut(
            id=r.id,
            event_id=r.event_id,
            song_title=r.song_title,
            artist=r.artist,
            source=r.source,
            source_url=r.source_url,
            note=r.note,
            status=r.status,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in requests
    ]
