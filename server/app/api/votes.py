"""Public API endpoints for request voting.

Identity is `guest_id` only — the wrzdj_guest cookie is required.
See docs/RECOVERY-IP-IDENTITY.md.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.rate_limit import get_guest_id, limiter
from app.models.request import Request as SongRequest
from app.schemas.vote import VoteResponse
from app.services.event import EventLookupResult, get_event_by_code_with_status
from app.services.vote import RequestNotFoundError, add_vote, has_voted, remove_vote

router = APIRouter()


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
    """Upvote a song request. Idempotent: voting twice has no effect.

    Requires a guest cookie. Anonymous callers receive 401.
    """
    _validate_request_votable(db, request_id)
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=401, detail="Guest identity required")

    try:
        song_request, is_new = add_vote(db, request_id, guest_id=guest_id)
    except RequestNotFoundError:
        raise HTTPException(status_code=404, detail="Request not found") from None

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
    """Remove vote from a song request. Idempotent.

    Requires a guest cookie. Anonymous callers receive 401.
    """
    _validate_request_votable(db, request_id)
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=401, detail="Guest identity required")

    try:
        song_request, was_removed = remove_vote(db, request_id, guest_id=guest_id)
    except RequestNotFoundError:
        raise HTTPException(status_code=404, detail="Request not found") from None

    return VoteResponse(
        status="unvoted" if was_removed else "not_voted",
        vote_count=song_request.vote_count,
        has_voted=has_voted(db, request_id, guest_id=guest_id),
    )
