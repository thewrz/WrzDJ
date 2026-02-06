from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.request import RequestStatus
from app.models.user import User
from app.schemas.event import EventCreate, EventOut, EventUpdate
from app.schemas.request import RequestCreate, RequestOut
from app.services.event import (
    EventLookupResult,
    archive_event,
    compute_event_status,
    create_event,
    delete_event,
    get_archived_events_for_user,
    get_event_by_code_for_owner,
    get_event_by_code_with_status,
    get_events_for_user,
    get_expired_events_for_user,
    unarchive_event,
    update_event,
)
from app.services.export import (
    export_play_history_to_csv,
    export_requests_to_csv,
    generate_export_filename,
    generate_play_history_export_filename,
)
from app.services.now_playing import get_play_history
from app.services.request import create_request, get_requests_for_event

router = APIRouter()
settings = get_settings()

# Maximum number of requests to export in a single CSV
# Set to 10,000 to prevent memory issues and excessive download times
MAX_EXPORT_REQUESTS = 10000


def _event_to_out(
    event,
    request: Request | None = None,
    request_count: int | None = None,
    include_status: bool = False,
) -> EventOut:
    """Convert Event model to EventOut schema with join_url."""
    # Use configured PUBLIC_URL if set, otherwise fall back to request base_url
    if settings.public_url:
        base_url = settings.public_url.rstrip("/")
    elif request:
        base_url = str(request.base_url).rstrip("/")
    else:
        base_url = None
    join_url = f"{base_url}/join/{event.code}" if base_url else None

    event_status = compute_event_status(event) if include_status else None

    return EventOut(
        id=event.id,
        code=event.code,
        name=event.name,
        created_at=event.created_at,
        expires_at=event.expires_at,
        is_active=event.is_active,
        archived_at=event.archived_at,
        status=event_status,
        join_url=join_url,
        request_count=request_count,
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


@router.get("/archived", response_model=list[EventOut])
def list_archived_events(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[EventOut]:
    """List all archived and expired events for the current user."""
    # Get archived events
    archived = get_archived_events_for_user(db, current_user)
    # Get expired (but not archived) events
    expired = get_expired_events_for_user(db, current_user)

    # Combine and convert to EventOut with status and request_count
    result = []
    for event, count in archived:
        result.append(_event_to_out(event, request, request_count=count, include_status=True))
    for event, count in expired:
        result.append(_event_to_out(event, request, request_count=count, include_status=True))

    return result


@router.get("/{code}", response_model=EventOut)
def get_event(code: str, request: Request, db: Session = Depends(get_db)) -> EventOut:
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

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


@router.post("/{code}/archive", response_model=EventOut)
def archive_event_endpoint(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventOut:
    """Archive an event."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.archived_at is not None:
        raise HTTPException(status_code=400, detail="Event is already archived")

    archived = archive_event(db, event)
    return _event_to_out(archived, request, include_status=True)


@router.post("/{code}/unarchive", response_model=EventOut)
def unarchive_event_endpoint(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EventOut:
    """Unarchive an event."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.archived_at is None:
        raise HTTPException(status_code=400, detail="Event is not archived")

    unarchived = unarchive_event(db, event)
    return _event_to_out(unarchived, request, include_status=True)


@router.get("/{code}/export/csv")
@limiter.limit("5/minute")
def export_event_csv(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export event requests as CSV. Owner can export regardless of event status."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all requests for the event (no status filter, limited for safety)
    requests = get_requests_for_event(db, event, status=None, since=None, limit=MAX_EXPORT_REQUESTS)

    # Generate CSV content
    csv_content = export_requests_to_csv(event, requests)
    filename = generate_export_filename(event)

    # Properly encode filename for Content-Disposition header (RFC 6266)
    safe_filename = filename.replace('"', '\\"')
    ascii_filename = quote(filename, safe="")

    content_disposition = (
        f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{ascii_filename}"
    )
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": content_disposition},
    )


# Maximum number of play history entries to export in a single CSV
MAX_EXPORT_PLAY_HISTORY = 10000


@router.get("/{code}/export/play-history/csv")
@limiter.limit("5/minute")
def export_play_history_csv(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export play history as CSV. Owner can export regardless of event status."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all play history entries for the event (limited for safety)
    history_items, _ = get_play_history(db, event.id, limit=MAX_EXPORT_PLAY_HISTORY, offset=0)

    # Generate CSV content
    csv_content = export_play_history_to_csv(event, history_items)
    filename = generate_play_history_export_filename(event)

    # Properly encode filename for Content-Disposition header (RFC 6266)
    safe_filename = filename.replace('"', '\\"')
    ascii_filename = quote(filename, safe="")

    content_disposition = (
        f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{ascii_filename}"
    )
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": content_disposition},
    )


@router.post("/{code}/requests", response_model=RequestOut)
@limiter.limit(lambda: f"{settings.request_rate_limit_per_minute}/minute")
def submit_request(
    code: str,
    request_data: RequestCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> RequestOut:
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

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
        artwork_url=request_data.artwork_url,
        client_fingerprint=client_ip,
    )

    return RequestOut(
        id=song_request.id,
        event_id=song_request.event_id,
        song_title=song_request.song_title,
        artist=song_request.artist,
        source=song_request.source,
        source_url=song_request.source_url,
        artwork_url=song_request.artwork_url,
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
    # Owner can view requests regardless of event status
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    requests = get_requests_for_event(db, event, status, since, limit)
    return [
        RequestOut(
            id=r.id,
            event_id=r.event_id,
            song_title=r.song_title,
            artist=r.artist,
            source=r.source,
            source_url=r.source_url,
            artwork_url=r.artwork_url,
            note=r.note,
            status=r.status,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in requests
    ]
