"""Beatport OAuth and sync API endpoints.

Uses OAuth2 authorization code flow for authentication.
Beatport API v4 supports search and catalog access. Playlist write
endpoints exist but are not yet implemented in this adapter.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.user import User
from app.schemas.beatport import (
    BeatportAuthCallback,
    BeatportEventSettings,
    BeatportEventSettingsUpdate,
    BeatportManualLink,
    BeatportSearchResult,
    BeatportStatus,
)
from app.schemas.common import StatusMessageResponse
from app.services.beatport import (
    _generate_pkce_pair,
    disconnect_beatport,
    exchange_code_for_tokens,
    get_auth_url,
    get_beatport_track,
    manual_link_beatport_track,
    save_tokens,
    search_beatport_tracks,
)

settings = get_settings()

router = APIRouter()


@router.get("/auth/start")
@limiter.limit("5/minute")
def start_auth(
    request: Request,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> dict:
    """Start Beatport OAuth2 authorization code flow.

    Returns the URL the frontend should redirect the user to.
    Stores the CSRF state token on the user for callback validation.
    """
    if not settings.beatport_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Beatport integration not configured",
        )
    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = _generate_pkce_pair()
    current_user.beatport_oauth_state = state
    current_user.beatport_oauth_code_verifier = code_verifier
    db.commit()
    auth_url = get_auth_url(state, code_challenge)
    return {
        "auth_url": auth_url,
        "state": state,
    }


@router.post("/auth/callback")
@limiter.limit("5/minute")
def auth_callback(
    request: Request,
    callback_data: BeatportAuthCallback,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> StatusMessageResponse:
    """Exchange authorization code for tokens.

    Validates the CSRF state parameter before exchanging the code.
    """
    # Validate OAuth state to prevent CSRF
    if not current_user.beatport_oauth_state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending OAuth flow — start auth first",
        )
    if not secrets.compare_digest(current_user.beatport_oauth_state, callback_data.state):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter",
        )

    # Retrieve and clear PKCE verifier + state immediately to prevent reuse
    code_verifier = current_user.beatport_oauth_code_verifier
    current_user.beatport_oauth_state = None
    current_user.beatport_oauth_code_verifier = None

    if not code_verifier:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PKCE verifier found — start auth first",
        )

    try:
        token_data = exchange_code_for_tokens(callback_data.code, code_verifier)
    except Exception:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange authorization code",
        )
    save_tokens(db, current_user, token_data)
    return StatusMessageResponse(status="ok", message="Beatport account linked")


@router.get("/status", response_model=BeatportStatus)
def get_status(
    current_user: User = Depends(get_current_active_user),
) -> BeatportStatus:
    """Check if current user has linked Beatport account."""
    if not current_user.beatport_access_token:
        return BeatportStatus(linked=False)

    expires_at = None
    if current_user.beatport_token_expires_at:
        expires_at = current_user.beatport_token_expires_at.isoformat() + "Z"

    return BeatportStatus(linked=True, expires_at=expires_at)


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
