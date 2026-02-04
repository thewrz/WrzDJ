"""Public API endpoints for kiosk display (no authentication required)."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.models.request import RequestStatus
from app.services.event import get_event_by_code

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


class KioskDisplayResponse(BaseModel):
    event: PublicEventInfo
    qr_join_url: str
    accepted_queue: list[PublicRequestInfo]
    now_playing: PublicRequestInfo | None
    updated_at: datetime


@router.get("/events/{code}/display", response_model=KioskDisplayResponse)
def get_kiosk_display(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
) -> KioskDisplayResponse:
    """Get public kiosk display data for an event."""
    event = get_event_by_code(db, code)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or expired")

    # Build join URL using PUBLIC_URL if set, otherwise use request base
    if settings.public_url:
        base_url = settings.public_url.rstrip("/")
    else:
        base_url = str(request.base_url).rstrip("/")
    qr_join_url = f"{base_url}/join/{event.code}"

    # Get accepted requests (status = 'accepted') ordered by updated_at
    accepted_requests = [
        r for r in event.requests
        if r.status == RequestStatus.ACCEPTED.value
    ]
    accepted_requests.sort(key=lambda r: r.updated_at)

    accepted_queue = [
        PublicRequestInfo(
            id=r.id,
            title=r.song_title,
            artist=r.artist,
            artwork_url=r.artwork_url,
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

    return KioskDisplayResponse(
        event=PublicEventInfo(code=event.code, name=event.name),
        qr_join_url=qr_join_url,
        accepted_queue=accepted_queue,
        now_playing=now_playing,
        updated_at=datetime.utcnow(),
    )
