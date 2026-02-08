"""Tidal OAuth and sync API endpoints.

Uses device code OAuth flow for authentication since third-party OAuth
doesn't have access to playlist creation scopes.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.user import User
from app.schemas.tidal import (
    TidalEventSettings,
    TidalEventSettingsUpdate,
    TidalManualLink,
    TidalSearchResult,
    TidalStatus,
    TidalSyncResult,
)
from app.services.tidal import (
    cancel_device_login,
    check_device_login,
    disconnect_tidal,
    manual_link_track,
    search_tidal_tracks,
    start_device_login,
    sync_request_to_tidal,
)

settings = get_settings()

router = APIRouter()


@router.post("/auth/start")
def start_auth(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Start Tidal device login flow.

    Returns a URL and code for the user to visit and authorize.
    The frontend should poll /auth/check to wait for completion.
    """
    result = start_device_login(current_user)
    return {
        "verification_url": result["verification_url"],
        "user_code": result["user_code"],
        "message": "Visit the URL and enter the code to link your Tidal account",
    }


@router.get("/auth/check")
def check_auth(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Check if device login is complete.

    Returns:
    - complete: true if login succeeded
    - pending: true if still waiting for user
    - error: error message if login failed
    """
    return check_device_login(db, current_user)


@router.post("/auth/cancel")
def cancel_auth(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    """Cancel pending device login."""
    cancel_device_login(current_user)
    return {"status": "ok", "message": "Login cancelled"}


@router.get("/status", response_model=TidalStatus)
async def get_status(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TidalStatus:
    """Check if current user has linked Tidal account."""
    if not current_user.tidal_access_token:
        return TidalStatus(linked=False)

    expires_at = None
    if current_user.tidal_token_expires_at:
        expires_at = current_user.tidal_token_expires_at.isoformat() + "Z"

    return TidalStatus(
        linked=True,
        user_id=current_user.tidal_user_id,
        expires_at=expires_at,
    )


@router.post("/disconnect")
def disconnect(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Unlink Tidal account from current user."""
    disconnect_tidal(db, current_user)
    return {"status": "ok", "message": "Tidal account disconnected"}


@router.get("/search", response_model=list[TidalSearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
async def search(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> list[TidalSearchResult]:
    """Search Tidal for tracks."""
    if not current_user.tidal_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidal account not linked",
        )
    return await search_tidal_tracks(db, current_user, q, limit)


@router.get("/events/{event_id}/settings", response_model=TidalEventSettings)
def get_event_settings(
    event_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TidalEventSettings:
    """Get Tidal sync settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return TidalEventSettings(
        tidal_sync_enabled=event.tidal_sync_enabled,
        tidal_playlist_id=event.tidal_playlist_id,
    )


@router.put("/events/{event_id}/settings", response_model=TidalEventSettings)
def update_event_settings(
    event_id: int,
    settings_update: TidalEventSettingsUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TidalEventSettings:
    """Update Tidal sync settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check if user has Tidal linked before enabling sync
    if settings_update.tidal_sync_enabled and not current_user.tidal_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot enable Tidal sync without linked Tidal account",
        )

    event.tidal_sync_enabled = settings_update.tidal_sync_enabled
    db.commit()
    db.refresh(event)

    return TidalEventSettings(
        tidal_sync_enabled=event.tidal_sync_enabled,
        tidal_playlist_id=event.tidal_playlist_id,
    )


@router.post("/requests/{request_id}/sync", response_model=TidalSyncResult)
async def sync_request(
    request_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TidalSyncResult:
    """Manually trigger Tidal sync for a request."""
    song_request = db.query(SongRequest).filter(SongRequest.id == request_id).first()
    if not song_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event = song_request.event
    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return await sync_request_to_tidal(db, song_request)


@router.post("/requests/{request_id}/link", response_model=TidalSyncResult)
async def link_track(
    request_id: int,
    link_data: TidalManualLink,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> TidalSyncResult:
    """Manually link a Tidal track to a request."""
    song_request = db.query(SongRequest).filter(SongRequest.id == request_id).first()
    if not song_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event = song_request.event
    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return await manual_link_track(db, song_request, link_data.tidal_track_id)
