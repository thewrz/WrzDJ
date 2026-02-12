"""Vote service for managing request upvotes."""

from sqlalchemy import case, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.request import Request
from app.models.request_vote import RequestVote


class RequestNotFoundError(Exception):
    """Raised when a request does not exist."""


def add_vote(db: Session, request_id: int, client_fingerprint: str) -> tuple[Request, bool]:
    """
    Add a vote for a request.
    Returns (request, is_new_vote). Idempotent: duplicate votes are no-ops.
    Uses database constraints for concurrency safety.
    """
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        raise RequestNotFoundError

    # Check if already voted
    existing = (
        db.query(RequestVote)
        .filter(
            RequestVote.request_id == request_id,
            RequestVote.client_fingerprint == client_fingerprint,
        )
        .first()
    )

    if existing:
        return song_request, False

    try:
        vote = RequestVote(
            request_id=request_id,
            client_fingerprint=client_fingerprint,
        )
        db.add(vote)
        db.flush()  # Force unique constraint check before updating count

        # Atomic increment via SQL expression to prevent race conditions
        db.execute(
            update(Request)
            .where(Request.id == request_id)
            .values(vote_count=Request.vote_count + 1)
        )
        db.commit()
        db.refresh(song_request)
        return song_request, True
    except IntegrityError:
        # Unique constraint violation: another request already voted
        db.rollback()
        song_request = db.query(Request).filter(Request.id == request_id).first()
        return song_request, False


def remove_vote(db: Session, request_id: int, client_fingerprint: str) -> tuple[Request, bool]:
    """
    Remove a vote for a request.
    Returns (request, was_removed). Idempotent: removing non-existent vote is a no-op.
    """
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        raise RequestNotFoundError

    existing = (
        db.query(RequestVote)
        .filter(
            RequestVote.request_id == request_id,
            RequestVote.client_fingerprint == client_fingerprint,
        )
        .first()
    )

    if not existing:
        return song_request, False

    try:
        db.delete(existing)
        # Atomic decrement, clamped to 0 at SQL level
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


def has_voted(db: Session, request_id: int, client_fingerprint: str) -> bool:
    """Check if a fingerprint has voted for a request."""
    return (
        db.query(RequestVote)
        .filter(
            RequestVote.request_id == request_id,
            RequestVote.client_fingerprint == client_fingerprint,
        )
        .first()
        is not None
    )


def get_vote_count(db: Session, request_id: int) -> int:
    """Get the current vote count for a request."""
    song_request = db.query(Request).filter(Request.id == request_id).first()
    if not song_request:
        return 0
    return song_request.vote_count
