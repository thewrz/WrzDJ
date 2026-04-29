"""Vote service for managing request upvotes.

Identity is `guest_id` only. See docs/RECOVERY-IP-IDENTITY.md.
"""

from sqlalchemy import case, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.request import Request
from app.models.request_vote import RequestVote


class RequestNotFoundError(Exception):
    """Raised when a request does not exist."""


def _find_existing_vote(
    db: Session,
    request_id: int,
    guest_id: int | None,
) -> RequestVote | None:
    if guest_id is None:
        return None
    return (
        db.query(RequestVote)
        .filter(RequestVote.request_id == request_id, RequestVote.guest_id == guest_id)
        .first()
    )


def add_vote(
    db: Session,
    request_id: int,
    *,
    guest_id: int | None = None,
) -> tuple[Request, bool]:
    """Add a vote for a request.

    Returns (request, is_new_vote). Idempotent: duplicate votes are no-ops.
    Anonymous (no guest_id) callers are no-ops — vote is not recorded.
    """
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        raise RequestNotFoundError

    if guest_id is None:
        return song_request, False

    existing = _find_existing_vote(db, request_id, guest_id)
    if existing:
        return song_request, False

    try:
        vote = RequestVote(
            request_id=request_id,
            guest_id=guest_id,
        )
        db.add(vote)
        db.flush()

        db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(vote_count=Request.vote_count + 1)
        )
        db.commit()
        db.refresh(song_request)
        return song_request, True
    except IntegrityError:
        db.rollback()
        song_request = db.query(Request).filter(Request.id == request_id).first()
        return song_request, False


def remove_vote(
    db: Session,
    request_id: int,
    *,
    guest_id: int | None = None,
) -> tuple[Request, bool]:
    """Remove a vote for a request.

    Returns (request, was_removed). Idempotent.
    """
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        raise RequestNotFoundError

    if guest_id is None:
        return song_request, False

    existing = _find_existing_vote(db, request_id, guest_id)
    if not existing:
        return song_request, False

    try:
        db.delete(existing)
        db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(
                vote_count=case(
                    (Request.vote_count > 0, Request.vote_count - 1),
                    else_=0,
                )
            )
        )
        db.commit()
        db.refresh(song_request)
        return song_request, True
    except SQLAlchemyError:
        db.rollback()
        raise


def has_voted(
    db: Session,
    request_id: int,
    *,
    guest_id: int | None = None,
) -> bool:
    """Check if a guest has voted for a request."""
    return _find_existing_vote(db, request_id, guest_id) is not None


def get_vote_count(db: Session, request_id: int) -> int:
    """Get the current vote count for a request."""
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        return 0
    return song_request.vote_count
