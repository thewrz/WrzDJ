"""Public API endpoints for pre-event song collection (no authentication required)."""

import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import get_client_fingerprint, limiter, mask_fingerprint
from app.models.event import Event
from app.models.request import Request as SongRequest
from app.models.request import RequestStatus
from app.models.request_vote import RequestVote
from app.schemas.collect import (
    CollectEventPreview,
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
    CollectMyPicksItem,
    CollectMyPicksResponse,
    CollectProfileRequest,
    CollectProfileResponse,
    CollectSubmitRequest,
    CollectVoteRequest,
)
from app.services import collect as collect_service
from app.services.activity_log import log_activity
from app.services.system_settings import get_system_settings
from app.services.vote import add_vote

router = APIRouter()


def _get_event_or_404(db: Session, code: str) -> Event:
    event = db.query(Event).filter(Event.code == code).one_or_none()
    if event is None or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _banner_url_for_event(event: Event, request: Request) -> str | None:
    """Build a public URL for the event's banner image, or None if not set."""
    if not event.banner_filename:
        return None
    base = str(request.base_url).rstrip("/")
    if request.headers.get("x-forwarded-proto") == "https" and base.startswith("http://"):
        base = "https://" + base[len("http://") :]
    return f"{base}/uploads/{event.banner_filename}"


def _banner_colors_for_event(event: Event) -> list[str] | None:
    """Parse the stored JSON-encoded banner_colors string into a list, or None."""
    if not event.banner_colors:
        return None
    import json as _json

    try:
        value = _json.loads(event.banner_colors)
        if isinstance(value, list) and all(isinstance(c, str) for c in value):
            return value
    except (_json.JSONDecodeError, TypeError):
        pass
    return None


@router.get("/{code}", response_model=CollectEventPreview)
@limiter.limit("120/minute")
def preview(code: str, request: Request, db: Session = Depends(get_db)):
    event = _get_event_or_404(db, code)
    settings = get_system_settings(db)
    return CollectEventPreview(
        code=event.code,
        name=event.name,
        banner_filename=event.banner_filename,
        banner_url=_banner_url_for_event(event, request),
        banner_colors=_banner_colors_for_event(event),
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
        # "All" is the discovery view — alphabetical makes it easy to scan
        # and upvote existing submissions rather than recency bias.
        q = q.order_by(func.lower(SongRequest.song_title).asc())

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


@router.post("/{code}/profile", response_model=CollectProfileResponse)
@limiter.limit("5/minute")
def set_profile(
    code: str,
    payload: CollectProfileRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    fingerprint = get_client_fingerprint(request, action="collect.set_profile", event_code=code)
    profile = collect_service.upsert_profile(
        db,
        event_id=event.id,
        fingerprint=fingerprint,
        nickname=payload.nickname,
        email=payload.email,
    )
    if payload.nickname is not None or payload.email is not None:
        _parts = []
        if payload.nickname is not None:
            _parts.append("nickname")
        if payload.email is not None:
            _parts.append("email")
        log_activity(
            db,
            level="info",
            source="collect",
            message=f"Guest [{mask_fingerprint(fingerprint)}] updated profile: {', '.join(_parts)}",
            event_code=code,
        )
    return CollectProfileResponse(
        nickname=profile.nickname,
        has_email=profile.email is not None,
        submission_count=profile.submission_count,
        submission_cap=event.submission_cap_per_guest,
    )


@router.get("/{code}/profile/me", response_model=CollectMyPicksResponse)
@limiter.limit("60/minute")
def my_picks(code: str, request: Request, db: Session = Depends(get_db)):
    event = _get_event_or_404(db, code)
    fingerprint = get_client_fingerprint(request, action="collect.my_picks", event_code=code)

    submitted = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.client_fingerprint == fingerprint)
        .order_by(SongRequest.created_at.desc())
        .all()
    )

    # All request_ids this fingerprint has voted on (scoped to this event below).
    # Used both for the `upvoted` section AND the full `voted_request_ids` list.
    voted_rows = (
        db.query(RequestVote.request_id)
        .join(SongRequest, SongRequest.id == RequestVote.request_id)
        .filter(RequestVote.client_fingerprint == fingerprint)
        .filter(SongRequest.event_id == event.id)
        .all()
    )
    upvoted_request_ids = [row[0] for row in voted_rows]
    upvoted: list[SongRequest] = []
    if upvoted_request_ids:
        upvoted = (
            db.query(SongRequest)
            .filter(SongRequest.event_id == event.id)
            .filter(SongRequest.id.in_(upvoted_request_ids))
            .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
            .all()
        )

    # Gamification: top contributor = this fingerprint has the most submissions
    # in this event (among collection submissions).
    top_fingerprint_row = (
        db.query(
            SongRequest.client_fingerprint,
            func.count(SongRequest.id).label("n"),
        )
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.client_fingerprint.isnot(None))
        .group_by(SongRequest.client_fingerprint)
        .order_by(desc("n"))
        .first()
    )
    is_top = (
        top_fingerprint_row is not None
        and top_fingerprint_row[0] == fingerprint
        and top_fingerprint_row[1] > 0
    )

    # First-to-suggest: among submitted rows, the ones where no earlier row in the
    # event shares the same dedupe_key.
    first_suggestion_ids: list[int] = []
    for r in submitted:
        earlier = (
            db.query(SongRequest.id)
            .filter(SongRequest.event_id == event.id)
            .filter(SongRequest.dedupe_key == r.dedupe_key)
            .filter(SongRequest.created_at < r.created_at)
            .first()
        )
        if earlier is None:
            first_suggestion_ids.append(r.id)

    def _to_row(r: SongRequest, interaction: str) -> CollectMyPicksItem:
        return CollectMyPicksItem(
            id=r.id,
            title=r.song_title,
            artist=r.artist,
            artwork_url=r.artwork_url,
            vote_count=r.vote_count,
            nickname=r.nickname,
            status=r.status,
            created_at=r.created_at,
            interaction=interaction,
        )

    submitted_ids = {s.id for s in submitted}
    return CollectMyPicksResponse(
        submitted=[_to_row(r, "submitted") for r in submitted],
        upvoted=[_to_row(r, "upvoted") for r in upvoted if r.id not in submitted_ids],
        is_top_contributor=is_top,
        first_suggestion_ids=first_suggestion_ids,
        voted_request_ids=upvoted_request_ids,
    )


def _compute_dedupe_key(song_title: str, artist: str) -> str:
    raw = f"{song_title.strip().lower()}|{artist.strip().lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


@router.post("/{code}/requests", status_code=201)
@limiter.limit("10/minute")
def submit(
    code: str,
    payload: CollectSubmitRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    if event.phase != "collection":
        raise HTTPException(status_code=409, detail="Collection has ended")

    fingerprint = get_client_fingerprint(request, action="collect.submit", event_code=code)
    try:
        collect_service.check_and_increment_submission_count(
            db, event=event, fingerprint=fingerprint
        )
    except collect_service.SubmissionCapExceeded:
        raise HTTPException(status_code=429, detail="Picks limit reached") from None

    if payload.nickname:
        collect_service.upsert_profile(
            db,
            event_id=event.id,
            fingerprint=fingerprint,
            nickname=payload.nickname,
        )

    row = SongRequest(
        event_id=event.id,
        song_title=payload.song_title,
        artist=payload.artist,
        source=payload.source,
        source_url=payload.source_url,
        artwork_url=payload.artwork_url,
        note=payload.note,
        nickname=payload.nickname,
        status=RequestStatus.NEW.value,
        dedupe_key=_compute_dedupe_key(payload.song_title, payload.artist),
        client_fingerprint=fingerprint,
        submitted_during_collection=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    log_activity(
        db,
        level="info",
        source="collect",
        message=(
            f"Guest [{mask_fingerprint(fingerprint)}] submitted "
            f"'{row.song_title}' by {row.artist} (req #{row.id})"
        ),
        event_code=code,
    )
    return {"id": row.id}


@router.post("/{code}/vote")
@limiter.limit("60/minute")
def vote(
    code: str,
    payload: CollectVoteRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event = _get_event_or_404(db, code)
    if event.phase not in ("collection", "live"):
        raise HTTPException(status_code=409, detail="Voting is closed")
    fingerprint = get_client_fingerprint(request, action="collect.vote", event_code=code)
    row = (
        db.query(SongRequest)
        .filter(SongRequest.id == payload.request_id)
        .filter(SongRequest.event_id == event.id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    _, is_new_vote = add_vote(db, request_id=row.id, client_fingerprint=fingerprint)
    if is_new_vote:
        log_activity(
            db,
            level="info",
            source="collect",
            message=(
                f"Guest [{mask_fingerprint(fingerprint)}] voted on "
                f"'{row.song_title}' (req #{row.id})"
            ),
            event_code=code,
        )
    return {"ok": True}
