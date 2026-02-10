"""Bridge API endpoints for StageLinQ integration."""

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin, get_db
from app.core.bridge_auth import verify_bridge_api_key
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.models.user import User
from app.schemas.now_playing import (
    BridgeStatusPayload,
    NowPlayingBridgePayload,
    NowPlayingResponse,
    PlayHistoryEntry,
    PlayHistoryResponse,
)
from app.services.event import EventLookupResult, get_event_by_code_with_status
from app.services.now_playing import (
    clear_now_playing,
    get_now_playing,
    get_play_history,
    handle_now_playing_update,
    update_bridge_status,
)

router = APIRouter()


# --- Bridge API Key retrieval (JWT auth, for GUI) ---


@router.get("/bridge/apikey")
def get_bridge_api_key(
    _user: User = Depends(get_current_admin),
) -> dict:
    """
    Return the server's bridge API key to an admin user.

    The GUI uses this so the DJ doesn't have to manually paste the key.
    Restricted to admins to prevent non-owners from impersonating the bridge.
    """
    settings = get_settings()
    if not settings.bridge_api_key:
        raise HTTPException(status_code=503, detail="Bridge API key not configured on server")
    return {"bridge_api_key": settings.bridge_api_key}


# --- Bridge Endpoints (API key auth) ---


@router.post("/bridge/nowplaying")
@limiter.limit("60/minute")
def post_now_playing(
    request: Request,
    payload: NowPlayingBridgePayload,
    db: Session = Depends(get_db),
    _: None = Depends(verify_bridge_api_key),
) -> dict:
    """
    Bridge reports a new track playing.

    Called when the DJ loads/plays a new track on their equipment.
    Archives the previous track to play history and updates now_playing.
    Rate limited to 60 requests per minute.
    """
    result = handle_now_playing_update(
        db,
        payload.event_code,
        payload.title,
        payload.artist,
        payload.album,
        payload.deck,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "ok"}


@router.post("/bridge/status")
@limiter.limit("30/minute")
def post_bridge_status(
    request: Request,
    payload: BridgeStatusPayload,
    db: Session = Depends(get_db),
    _: None = Depends(verify_bridge_api_key),
) -> dict:
    """
    Bridge reports connection status.

    Called when bridge connects/disconnects from DJ equipment.
    Rate limited to 30 requests per minute.
    """
    success = update_bridge_status(db, payload.event_code, payload.connected, payload.device_name)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "ok"}


@router.delete("/bridge/nowplaying/{code}")
@limiter.limit("60/minute")
def delete_now_playing(
    request: Request,
    code: str = Path(..., min_length=1, max_length=10),
    db: Session = Depends(get_db),
    _: None = Depends(verify_bridge_api_key),
) -> dict:
    """
    Bridge signals track ended / deck cleared.

    Archives current track to history and clears now_playing.
    Rate limited to 60 requests per minute.
    """
    success = clear_now_playing(db, code)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "ok"}


# --- Public Endpoints (no auth, for kiosk + guest UI) ---


@router.get("/public/e/{code}/nowplaying", response_model=NowPlayingResponse | None)
@limiter.limit("60/minute")
def get_public_now_playing(
    request: Request,
    code: str,
    db: Session = Depends(get_db),
) -> NowPlayingResponse | None:
    """
    Get current now-playing track for public display.

    Returns the track currently playing from StageLinQ, or None if nothing playing.
    """
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")
    if lookup_result in (EventLookupResult.EXPIRED, EventLookupResult.ARCHIVED):
        raise HTTPException(status_code=410, detail="Event has expired")

    now_playing = get_now_playing(db, event.id)
    if not now_playing or not now_playing.title:
        return None

    return NowPlayingResponse.model_validate(now_playing)


@router.get("/public/e/{code}/history", response_model=PlayHistoryResponse)
@limiter.limit("60/minute")
def get_public_history(
    request: Request,
    code: str,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> PlayHistoryResponse:
    """
    Get play history for public display.

    Returns the list of tracks played during the event, newest first.
    """
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")
    if lookup_result in (EventLookupResult.EXPIRED, EventLookupResult.ARCHIVED):
        raise HTTPException(status_code=410, detail="Event has expired")

    # Clamp limit to prevent abuse
    limit = min(max(1, limit), 100)
    offset = max(0, offset)

    items, total = get_play_history(db, event.id, limit=limit, offset=offset)
    return PlayHistoryResponse(
        items=[PlayHistoryEntry.model_validate(item) for item in items],
        total=total,
    )
