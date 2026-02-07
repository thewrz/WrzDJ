"""Public API endpoints for request voting."""

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import limiter
from app.models.request import Request as SongRequest
from app.schemas.vote import VoteResponse
from app.services.event import EventLookupResult, get_event_by_code_with_status
from app.services.vote import RequestNotFoundError, add_vote, has_voted, remove_vote

router = APIRouter()

MAX_FINGERPRINT_LENGTH = 64


def _get_client_fingerprint(request: Request) -> str:
    """Extract client fingerprint (IP) from the request, truncated to safe length."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        ip = forwarded_for.split(",")[0].strip()
        return ip[:MAX_FINGERPRINT_LENGTH]
    host = request.client.host if request.client else "unknown"
    return host[:MAX_FINGERPRINT_LENGTH]


def _validate_request_votable(db: Session, request_id: int) -> SongRequest:
    """Validate that a request exists and its event is active."""
    song_request = db.query(SongRequest).filter(SongRequest.id == request_id).first()
    if not song_request:
        raise HTTPException(status_code=404, detail="Request not found")

    event = song_request.event
    _, lookup_result = get_event_by_code_with_status(db, event.code)

    if lookup_result in (EventLookupResult.EXPIRED, EventLookupResult.ARCHIVED):
        raise HTTPException(status_code=410, detail="This event is no longer accepting votes")

    return song_request


@router.post("/{request_id}/vote", response_model=VoteResponse)
@limiter.limit("10/minute")
def vote_for_request(
    request_id: int = Path(..., gt=0),
    request: Request = None,
    db: Session = Depends(get_db),
) -> VoteResponse:
    """Upvote a song request. Idempotent: voting twice has no effect."""
    _validate_request_votable(db, request_id)
    client_fingerprint = _get_client_fingerprint(request)

    try:
        song_request, is_new = add_vote(db, request_id, client_fingerprint)
    except RequestNotFoundError:
        raise HTTPException(status_code=404, detail="Request not found")

    return VoteResponse(
        status="voted" if is_new else "already_voted",
        vote_count=song_request.vote_count,
        has_voted=True,
    )


@router.delete("/{request_id}/vote", response_model=VoteResponse)
@limiter.limit("10/minute")
def unvote_request(
    request_id: int = Path(..., gt=0),
    request: Request = None,
    db: Session = Depends(get_db),
) -> VoteResponse:
    """Remove vote from a song request. Idempotent."""
    _validate_request_votable(db, request_id)
    client_fingerprint = _get_client_fingerprint(request)

    try:
        song_request, was_removed = remove_vote(db, request_id, client_fingerprint)
    except RequestNotFoundError:
        raise HTTPException(status_code=404, detail="Request not found")

    return VoteResponse(
        status="unvoted" if was_removed else "not_voted",
        vote_count=song_request.vote_count,
        has_voted=has_voted(db, request_id, client_fingerprint),
    )
