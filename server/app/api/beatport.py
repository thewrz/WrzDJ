"""Beatport OAuth and sync API endpoints.

Uses server-side OAuth2 login: the backend authenticates with Beatport
using the user's credentials, obtains tokens, and stores them.
No browser popup or postMessage required.
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.user import User
from app.schemas.beatport import (
    BeatportEventSettings,
    BeatportEventSettingsUpdate,
    BeatportLogin,
    BeatportManualLink,
    BeatportSearchResult,
    BeatportStatus,
)
from app.schemas.common import StatusMessageResponse
from app.services.beatport import (
    disconnect_beatport,
    get_beatport_track,
    login_and_get_tokens,
    manual_link_beatport_track,
    save_tokens,
    search_beatport_tracks,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


@router.post("/auth/login")
@limiter.limit("5/minute")
def login_beatport(
    request: Request,
    login_data: BeatportLogin,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> StatusMessageResponse:
    """Authenticate with Beatport using username/password.

    The backend logs in to Beatport server-side, obtains an authorization
    code, exchanges it for tokens, and stores them on the user.
    """
    if not settings.beatport_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Beatport integration not configured",
        )

    try:
        token_data = login_and_get_tokens(login_data.username, login_data.password)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Beatport username or password",
            )
        logger.error(
            "Beatport login HTTP error: %s %s", e.response.status_code, e.response.text[:200]
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to authenticate with Beatport",
        )
    except ValueError as e:
        logger.error("Beatport login flow error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to complete Beatport authentication flow",
        )
    except httpx.HTTPError as e:
        logger.error("Beatport login network error: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Beatport — try again later",
        )

    save_tokens(db, current_user, token_data)
    return StatusMessageResponse(status="ok", message="Beatport account linked")


@router.get("/status", response_model=BeatportStatus)
def get_status(
    current_user: User = Depends(get_current_active_user),
) -> BeatportStatus:
    """Check if current user has linked Beatport account."""
    configured = bool(settings.beatport_client_id)
    if not current_user.beatport_access_token:
        return BeatportStatus(linked=False, configured=configured)

    expires_at = None
    if current_user.beatport_token_expires_at:
        expires_at = current_user.beatport_token_expires_at.isoformat() + "Z"

    return BeatportStatus(
        linked=True,
        expires_at=expires_at,
        configured=configured,
        subscription=current_user.beatport_subscription,
    )


@router.post("/disconnect", response_model=StatusMessageResponse)
@limiter.limit("10/minute")
def disconnect(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> StatusMessageResponse:
    """Unlink Beatport account from current user."""
    disconnect_beatport(db, current_user)
    return StatusMessageResponse(status="ok", message="Beatport account disconnected")


@router.get("/search", response_model=list[BeatportSearchResult])
@limiter.limit(lambda: f"{settings.search_rate_limit_per_minute}/minute")
def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> list[BeatportSearchResult]:
    """Search Beatport for tracks."""
    if not current_user.beatport_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Beatport account not linked",
        )
    return search_beatport_tracks(db, current_user, q, limit)


@router.get("/events/{event_id}/settings", response_model=BeatportEventSettings)
def get_event_settings(
    event_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> BeatportEventSettings:
    """Get Beatport sync settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return BeatportEventSettings(beatport_sync_enabled=event.beatport_sync_enabled)


@router.put("/events/{event_id}/settings", response_model=BeatportEventSettings)
def update_event_settings(
    event_id: int,
    settings_update: BeatportEventSettingsUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> BeatportEventSettings:
    """Update Beatport sync settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if settings_update.beatport_sync_enabled and not current_user.beatport_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot enable Beatport sync without linked Beatport account",
        )

    event.beatport_sync_enabled = settings_update.beatport_sync_enabled
    db.commit()
    db.refresh(event)

    return BeatportEventSettings(beatport_sync_enabled=event.beatport_sync_enabled)


@router.post("/requests/{request_id}/link", response_model=StatusMessageResponse)
@limiter.limit("10/minute")
def link_track(
    request: Request,
    request_id: int,
    link_data: BeatportManualLink,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> StatusMessageResponse:
    """Manually link a Beatport track to a request.

    Verifies the track exists on Beatport, then stores the
    Beatport URL and metadata in sync_results_json.
    """
    song_request = db.query(SongRequest).filter(SongRequest.id == request_id).first()
    if not song_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event = song_request.event
    if event.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not current_user.beatport_access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Beatport account not linked",
        )

    # Verify the track exists on Beatport
    track = get_beatport_track(db, current_user, link_data.beatport_track_id)
    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found on Beatport",
        )

    manual_link_beatport_track(db, song_request, track)
    return StatusMessageResponse(status="linked", message="Beatport track linked")
