"""Public API endpoints for pre-event song collection (no authentication required)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import limiter
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.schemas.collect import (
    CollectEventPreview,
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
)
from app.services.system_settings import get_system_settings

router = APIRouter()


def _get_event_or_404(db: Session, code: str) -> Event:
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.get("/{code}", response_model=CollectEventPreview)
@limiter.limit("120/minute")
def preview(code: str, request: Request, db: Session = Depends(get_db)):
    event = _get_event_or_404(db, code)
    settings = get_system_settings(db)
    return CollectEventPreview(
        code=event.code,
        name=event.name,
        banner_filename=event.banner_filename,
        submission_cap_per_guest=event.submission_cap_per_guest,
        registration_enabled=settings.registration_enabled,
        phase=event.phase,
        collection_opens_at=event.collection_opens_at,
        live_starts_at=event.live_starts_at,
        expires_at=event.expires_at,
    )


@router.get("/{code}/leaderboard", response_model=CollectLeaderboardResponse)
@limiter.limit("120/minute")
def leaderboard(
    code: str,
    request: Request,
    tab: Literal["trending", "all"] = "trending",
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)

    q = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
    )
    if tab == "trending":
        q = q.filter(SongRequest.vote_count >= 1).order_by(
            SongRequest.vote_count.desc(), SongRequest.created_at.desc()
        )
    else:
        q = q.order_by(SongRequest.created_at.desc())

    rows = q.limit(200).all()
    return CollectLeaderboardResponse(
        requests=[
            CollectLeaderboardRow(
                id=r.id,
                title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                vote_count=r.vote_count,
                nickname=r.nickname,
                status=r.status,
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=len(rows),
    )
