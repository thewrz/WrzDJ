"""Public API endpoints for kiosk display (no authentication required)."""

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.rate_limit import get_client_fingerprint, limiter
from app.models.request import Request as SongRequest
from app.models.request import RequestStatus
from app.services.event import EventLookupResult, get_event_by_code_with_status
from app.services.now_playing import is_now_playing_hidden
from app.services.request import get_guest_visible_requests

router = APIRouter()
settings = get_settings()


class PublicEventInfo(BaseModel):
    code: str
    name: str


class PublicRequestInfo(BaseModel):
    id: int
    title: str
    artist: str
    artwork_url: str | None
    vote_count: int = 0


class GuestRequestInfo(PublicRequestInfo):
    status: Literal["new", "accepted"]


class GuestRequestListResponse(BaseModel):
    event: PublicEventInfo
    requests: list[GuestRequestInfo]


class HasRequestedResponse(BaseModel):
    has_requested: bool


class KioskDisplayResponse(BaseModel):
    event: PublicEventInfo
    qr_join_url: str
    accepted_queue: list[PublicRequestInfo]
    now_playing: PublicRequestInfo | None
    now_playing_hidden: bool
    updated_at: datetime
    banner_url: str | None = None
    banner_kiosk_url: str | None = None
    banner_colors: list[str] | None = None


@router.get("/events/{code}/display", response_model=KioskDisplayResponse)
@limiter.limit("60/minute")
def get_kiosk_display(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
) -> KioskDisplayResponse:
    """Get public kiosk display data for an event."""
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

    # Build join URL using PUBLIC_URL if set, otherwise use request base
    if settings.public_url:
        base_url = settings.public_url.rstrip("/")
    else:
        base_url = str(request.base_url).rstrip("/")
    qr_join_url = f"{base_url}/join/{event.code}"

    # Get accepted requests (status = 'accepted') sorted by vote_count desc, then updated_at asc
    accepted_requests = [r for r in event.requests if r.status == RequestStatus.ACCEPTED.value]
    accepted_requests.sort(key=lambda r: (-r.vote_count, r.updated_at))

    accepted_queue = [
        PublicRequestInfo(
            id=r.id,
            title=r.song_title,
            artist=r.artist,
            artwork_url=r.artwork_url,
            vote_count=r.vote_count,
        )
        for r in accepted_requests
    ]

    # Get now playing from event
    now_playing = None
    if event.now_playing:
        now_playing = PublicRequestInfo(
            id=event.now_playing.id,
            title=event.now_playing.song_title,
            artist=event.now_playing.artist,
            artwork_url=event.now_playing.artwork_url,
        )

    # Check if now playing should be hidden (using per-event timeout)
    now_playing_is_hidden = is_now_playing_hidden(
        db, event.id, auto_hide_minutes=event.now_playing_auto_hide_minutes
    )

    # Build banner URLs from API host
    banner_url = None
    banner_kiosk_url = None
    banner_colors = None
    if event.banner_filename:
        scheme = request.headers.get("x-forwarded-proto", "http")
        host = request.headers.get("host", "localhost:8000")
        api_base = f"{scheme}://{host}"
        banner_url = f"{api_base}/uploads/{event.banner_filename}"
        stem = event.banner_filename.rsplit(".", 1)[0]
        banner_kiosk_url = f"{api_base}/uploads/{stem}_kiosk.webp"
        if event.banner_colors:
            banner_colors = json.loads(event.banner_colors)

    return KioskDisplayResponse(
        event=PublicEventInfo(code=event.code, name=event.name),
        qr_join_url=qr_join_url,
        accepted_queue=accepted_queue,
        now_playing=now_playing,
        now_playing_hidden=now_playing_is_hidden,
        updated_at=datetime.utcnow(),
        banner_url=banner_url,
        banner_kiosk_url=banner_kiosk_url,
        banner_colors=banner_colors,
    )


@router.get("/events/{code}/requests", response_model=GuestRequestListResponse)
@limiter.limit("60/minute")
def get_public_requests(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
) -> GuestRequestListResponse:
    """Get publicly visible requests for an event (NEW and ACCEPTED only)."""
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

    requests_list = get_guest_visible_requests(db, event)

    return GuestRequestListResponse(
        event=PublicEventInfo(code=event.code, name=event.name),
        requests=[
            GuestRequestInfo(
                id=r.id,
                title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                vote_count=r.vote_count,
                status=r.status,
            )
            for r in requests_list
        ],
    )


@router.get("/events/{code}/has-requested", response_model=HasRequestedResponse)
@limiter.limit("30/minute")
def check_has_requested(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
) -> HasRequestedResponse:
    """Check if the current client has submitted any requests for this event."""
    event, lookup_result = get_event_by_code_with_status(db, code)

    if lookup_result == EventLookupResult.NOT_FOUND:
        raise HTTPException(status_code=404, detail="Event not found")

    if lookup_result == EventLookupResult.EXPIRED:
        raise HTTPException(status_code=410, detail="Event has expired")

    if lookup_result == EventLookupResult.ARCHIVED:
        raise HTTPException(status_code=410, detail="Event has been archived")

    fingerprint = get_client_fingerprint(request)

    has_requested = (
        db.query(SongRequest)
        .filter(
            SongRequest.event_id == event.id,
            SongRequest.client_fingerprint == fingerprint,
        )
        .first()
        is not None
    )

    return HasRequestedResponse(has_requested=has_requested)
