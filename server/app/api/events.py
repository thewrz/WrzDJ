import json
from datetime import datetime
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db, get_owned_event
from app.core.config import get_settings
from app.core.rate_limit import get_client_fingerprint, limiter
from app.models.event import Event
from app.models.request import RequestStatus
from app.models.user import User
from app.schemas.common import AcceptAllResponse
from app.schemas.event import (
    DisplaySettingsResponse,
    DisplaySettingsUpdate,
    EventCreate,
    EventOut,
    EventUpdate,
)
from app.schemas.request import RequestCreate, RequestOut
from app.schemas.search import SearchResult
from app.services.event import (
    EventLookupResult,
    archive_event,
    compute_event_status,
    create_event,
    delete_event,
    get_archived_events_for_user,
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
from app.services.now_playing import (
    get_manual_hide_setting,
    get_play_history,
    set_now_playing_visibility,
)
from app.services.request import accept_all_new_requests, create_request, get_requests_for_event
from app.services.sync.orchestrator import sync_requests_batch
from app.services.sync.registry import get_connected_adapters

router = APIRouter()
settings = get_settings()

# Maximum number of requests to export in a single CSV
# Set to 10,000 to prevent memory issues and excessive download times
MAX_EXPORT_REQUESTS = 10000

# Maximum number of play history entries to export in a single CSV
MAX_EXPORT_PLAY_HISTORY = 10000


def _content_disposition(filename: str) -> str:
    """Build an RFC 6266 Content-Disposition header value for a download."""
    safe_filename = filename.replace('"', '\\"')
    ascii_filename = quote(filename, safe="")
    return f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{ascii_filename}"


def _get_base_url(request: Request | None) -> str | None:
    """Get the base URL for constructing public URLs."""
    if settings.public_url:
        return settings.public_url.rstrip("/")
    if request:
        return str(request.base_url).rstrip("/")
    return None


def _get_api_base_url(request: Request) -> str:
    """Get the API server's own base URL for constructing asset URLs (uploads, etc.)."""
    return str(request.base_url).rstrip("/")


def _get_banner_urls(event, request: Request | None) -> tuple[str | None, str | None]:
    """Get banner and kiosk banner URLs for an event."""
    if not event.banner_filename:
        return None, None
    if not request:
        return None, None
    api_base = _get_api_base_url(request)
    banner_url = f"{api_base}/uploads/{event.banner_filename}"
    stem = event.banner_filename.rsplit(".", 1)[0]
    kiosk_url = f"{api_base}/uploads/{stem}_kiosk.webp"
    return banner_url, kiosk_url


def _event_to_out(
    event,
    request: Request | None = None,
    request_count: int | None = None,
    include_status: bool = False,
) -> EventOut:
    """Convert Event model to EventOut schema with join_url."""
    base_url = _get_base_url(request)
    join_url = f"{base_url}/join/{event.code}" if base_url else None

    event_status = compute_event_status(event) if include_status else None

    banner_url, banner_kiosk_url = _get_banner_urls(event, request)
    banner_colors = json.loads(event.banner_colors) if event.banner_colors else None

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
        tidal_sync_enabled=event.tidal_sync_enabled,
        tidal_playlist_id=event.tidal_playlist_id,
        beatport_sync_enabled=event.beatport_sync_enabled,
        beatport_playlist_id=event.beatport_playlist_id,
        banner_url=banner_url,
        banner_kiosk_url=banner_kiosk_url,
        banner_colors=banner_colors,
        requests_open=event.requests_open,
    )


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_new_event(
    event_data: EventCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> EventOut:
    event = create_event(db, event_data.name, current_user, event_data.expires_hours)
    return _event_to_out(event, request)


@router.get("", response_model=list[EventOut])
@limiter.limit("60/minute")
def list_events(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[EventOut]:
    events = get_events_for_user(db, current_user)
    return [_event_to_out(e, request) for e in events]


@router.get("/archived", response_model=list[EventOut])
@limiter.limit("60/minute")
def list_archived_events(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
@limiter.limit("60/minute")
def get_event(code: str, request: Request, db: Session = Depends(get_db)) -> EventOut:
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

    return _event_to_out(event, request)


@router.get("/{code}/search", response_model=list[SearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
def event_search(
    code: str,
    request: Request,
    q: str = Query(..., min_length=2, max_length=200),
    db: Session = Depends(get_db),
) -> list[SearchResult]:
    """Public search endpoint for event guests. Searches Spotify first,
    falls back to Beatport if the event owner has it linked and enabled."""
    from app.services.beatport import search_beatport_tracks
    from app.services.search_merge import merge_search_results
    from app.services.spotify import search_songs

    event_obj, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result in (EventLookupResult.EXPIRED, EventLookupResult.ARCHIVED):
        raise HTTPException(status_code=410, detail="Event has expired")

    # Always search Spotify
    spotify_results = search_songs(db, q)

    # Check if owner has Beatport linked and sync enabled
    owner = event_obj.created_by
    if owner and owner.beatport_access_token and event_obj.beatport_sync_enabled:
        beatport_results = search_beatport_tracks(db, owner, q, limit=10)
        return merge_search_results(spotify_results, beatport_results)

    return spotify_results


@router.patch("/{code}", response_model=EventOut)
def update_event_endpoint(
    event_data: EventUpdate,
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> EventOut:
    updated = update_event(
        db,
        event,
        name=event_data.name,
        expires_at=event_data.expires_at,
    )
    return _event_to_out(updated, request)


@router.delete("/{code}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event_endpoint(
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> None:
    """Delete an event and all its requests."""
    delete_event(db, event)


@router.post("/{code}/archive", response_model=EventOut)
def archive_event_endpoint(
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> EventOut:
    """Archive an event."""
    if event.archived_at is not None:
        raise HTTPException(status_code=400, detail="Event is already archived")

    archived = archive_event(db, event)
    return _event_to_out(archived, request, include_status=True)


@router.post("/{code}/unarchive", response_model=EventOut)
def unarchive_event_endpoint(
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> EventOut:
    """Unarchive an event."""
    if event.archived_at is None:
        raise HTTPException(status_code=400, detail="Event is not archived")

    unarchived = unarchive_event(db, event)
    return _event_to_out(unarchived, request, include_status=True)


@router.patch("/{code}/display-settings", response_model=DisplaySettingsResponse)
def update_display_settings(
    settings: DisplaySettingsUpdate,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> DisplaySettingsResponse:
    """Update display settings for an event (e.g., hide/show now playing on kiosk)."""
    if settings.now_playing_hidden is not None:
        set_now_playing_visibility(db, event.id, settings.now_playing_hidden)

    if settings.now_playing_auto_hide_minutes is not None:
        event.now_playing_auto_hide_minutes = settings.now_playing_auto_hide_minutes

    if settings.requests_open is not None:
        event.requests_open = settings.requests_open

    db.commit()

    hidden = get_manual_hide_setting(db, event.id)
    return DisplaySettingsResponse(
        status="ok",
        now_playing_hidden=hidden,
        now_playing_auto_hide_minutes=event.now_playing_auto_hide_minutes,
        requests_open=event.requests_open,
    )


@router.get("/{code}/display-settings", response_model=DisplaySettingsResponse)
def get_display_settings(
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> DisplaySettingsResponse:
    """Get current display settings for an event."""
    hidden = get_manual_hide_setting(db, event.id)

    return DisplaySettingsResponse(
        status="ok",
        now_playing_hidden=hidden,
        now_playing_auto_hide_minutes=event.now_playing_auto_hide_minutes,
        requests_open=event.requests_open,
    )


@router.get("/{code}/export/csv")
@limiter.limit("5/minute")
def export_event_csv(
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Export event requests as CSV. Owner can export regardless of event status."""
    # Get all requests for the event (no status filter, limited for safety)
    requests = get_requests_for_event(db, event, status=None, since=None, limit=MAX_EXPORT_REQUESTS)

    # Generate CSV content
    csv_content = export_requests_to_csv(event, requests)
    filename = generate_export_filename(event)

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": _content_disposition(filename)},
    )


@router.get("/{code}/export/play-history/csv")
@limiter.limit("5/minute")
def export_play_history_csv(
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Export play history as CSV. Owner can export regardless of event status."""
    # Get all play history entries for the event (limited for safety)
    history_items, _ = get_play_history(db, event.id, limit=MAX_EXPORT_PLAY_HISTORY, offset=0)

    # Generate CSV content
    csv_content = export_play_history_to_csv(event, history_items)
    filename = generate_play_history_export_filename(event)

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": _content_disposition(filename)},
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

    if not event.requests_open:
        raise HTTPException(status_code=403, detail="Requests are closed for this event")

    song_request, is_duplicate = create_request(
        db=db,
        event=event,
        artist=request_data.artist,
        title=request_data.title,
        note=request_data.note,
        source=request_data.source.value,
        source_url=request_data.source_url,
        artwork_url=request_data.artwork_url,
        client_fingerprint=get_client_fingerprint(request),
        raw_search_query=request_data.raw_search_query,
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
        vote_count=song_request.vote_count,
    )


@router.post("/{code}/requests/accept-all", response_model=AcceptAllResponse)
@limiter.limit("10/minute")
def accept_all_requests_endpoint(
    request: Request,
    background_tasks: BackgroundTasks,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> AcceptAllResponse:
    """Accept all NEW requests for an event in one operation."""
    accepted = accept_all_new_requests(db, event)

    # Trigger batch sync — one background task for all accepted requests
    # Uses sequential search + batch playlist add to avoid API rate limiting
    if accepted and get_connected_adapters(event.created_by):
        background_tasks.add_task(sync_requests_batch, db, accepted)

    return AcceptAllResponse(status="ok", accepted_count=len(accepted))


@router.get("/{code}/requests", response_model=list[RequestOut])
@limiter.limit("60/minute")
def get_event_requests(
    request: Request,
    status: RequestStatus | None = None,
    since: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> list[RequestOut]:
    # Owner can view requests regardless of event status
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
            tidal_track_id=r.tidal_track_id,
            tidal_sync_status=r.tidal_sync_status,
            raw_search_query=r.raw_search_query,
            sync_results_json=r.sync_results_json,
            vote_count=r.vote_count,
        )
        for r in requests
    ]


@router.post("/{code}/banner", response_model=EventOut)
@limiter.limit("10/minute")
def upload_banner(
    request: Request,
    file: UploadFile = File(...),
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> EventOut:
    """Upload a custom banner image for the event."""
    from app.services.banner import (
        delete_banner_files,
        process_banner_upload,
        save_banner_to_event,
    )

    # Delete old banner files if replacing
    delete_banner_files(event.banner_filename)

    try:
        banner_filename, _kiosk_filename, colors = process_banner_upload(file, event.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    save_banner_to_event(db, event, banner_filename, colors)

    return _event_to_out(event, request)


@router.delete("/{code}/banner", response_model=EventOut)
def delete_banner(
    request: Request,
    event: Event = Depends(get_owned_event),
    db: Session = Depends(get_db),
) -> EventOut:
    """Delete the event's custom banner image."""
    from app.services.banner import delete_banner_from_event

    delete_banner_from_event(db, event)

    return _event_to_out(event, request)
