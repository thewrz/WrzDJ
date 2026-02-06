"""Tidal OAuth and sync API endpoints."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.user import User
from app.schemas.tidal import (
    TidalAuthUrl,
    TidalEventSettings,
    TidalEventSettingsUpdate,
    TidalManualLink,
    TidalSearchResult,
    TidalStatus,
    TidalSyncResult,
)
from app.services.tidal import (
    disconnect_tidal,
    exchange_code_for_tokens,
    generate_oauth_url,
    manual_link_track,
    refresh_token_if_needed,
    search_tidal_tracks,
    sync_request_to_tidal,
)

settings = get_settings()

router = APIRouter()


@router.get("/auth/url", response_model=TidalAuthUrl)
def get_auth_url(
    current_user: User = Depends(get_current_user),
) -> TidalAuthUrl:
    """Generate Tidal OAuth authorization URL.

    Returns a URL to redirect the user to for Tidal account linking.
    """
    try:
        auth_url, state = generate_oauth_url(current_user)
        return TidalAuthUrl(auth_url=auth_url, state=state)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/auth/callback")
async def auth_callback(
    code: str = Query(None),
    state: str = Query(...),
    error: str = Query(None),
    error_description: str = Query(None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Handle OAuth callback from Tidal.

    Exchanges authorization code for tokens and redirects to dashboard.
    """
    # Get frontend URL for redirects
    frontend_url = settings.public_url or "http://localhost:3000"

    # Handle OAuth errors from Tidal
    if error:
        error_msg = error_description or error
        return RedirectResponse(url=f"{frontend_url}/events?tidal_error={error_msg}")

    if not code:
        return RedirectResponse(url=f"{frontend_url}/events?tidal_error=missing_code")

    user = await exchange_code_for_tokens(db, code, state)
    if not user:
        return RedirectResponse(url=f"{frontend_url}/events?tidal_error=invalid_state")

    return RedirectResponse(url=f"{frontend_url}/events?tidal_connected=true")


@router.get("/status", response_model=TidalStatus)
async def get_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TidalStatus:
    """Check if current user has linked Tidal account."""
    if not current_user.tidal_access_token:
        return TidalStatus(linked=False)

    # Check if token needs refresh
    await refresh_token_if_needed(db, current_user)

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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TidalSearchResult]:
    """Search Tidal for tracks.

    Used for manual track linking when auto-match fails.
    """
    if not current_user.tidal_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tidal account not linked",
        )

    await refresh_token_if_needed(db, current_user)
    return await search_tidal_tracks(current_user, q, limit)


@router.get("/events/{event_id}/settings", response_model=TidalEventSettings)
def get_event_settings(
    event_id: int,
    current_user: User = Depends(get_current_user),
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
    settings: TidalEventSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TidalEventSettings:
    """Update Tidal sync settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check if user has Tidal linked before enabling sync
    if settings.tidal_sync_enabled and not current_user.tidal_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot enable Tidal sync without linked Tidal account",
        )

    event.tidal_sync_enabled = settings.tidal_sync_enabled
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TidalSyncResult:
    """Manually link a Tidal track to a request.

    Used when auto-search fails and DJ manually selects the correct track.
    """
    song_request = db.query(SongRequest).filter(SongRequest.id == request_id).first()
    if not song_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event = song_request.event
    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return await manual_link_track(db, song_request, link_data.tidal_track_id)
