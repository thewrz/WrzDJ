"""Tests for vote service using guest_id."""

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.guest import Guest
from app.models.request import Request
from app.services.vote import add_vote, has_voted, remove_vote


def test_add_vote_by_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """Vote created with guest_id, enforces unique constraint."""
    song_request, is_new = add_vote(db, test_request.id, guest_id=test_guest.id)
    assert is_new is True
    assert song_request.vote_count == 1


def test_duplicate_vote_same_guest(db: Session, test_request: Request, test_guest: Guest):
    """Same guest_id + same request -> rejected."""
    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, is_new = add_vote(db, test_request.id, guest_id=test_guest.id)
    assert is_new is False


def test_different_guests_same_request(db: Session, test_request: Request, test_guest: Guest):
    """Two guest_ids can vote on same request."""
    guest_b = Guest(
        token="b" * 64,
        fingerprint_hash="fp_guest_b",
        created_at=utcnow(),
        last_seen_at=utcnow(),
    )
    db.add(guest_b)
    db.commit()
    db.refresh(guest_b)

    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, is_new = add_vote(db, test_request.id, guest_id=guest_b.id)
    assert is_new is True

    db.refresh(test_request)
    assert test_request.vote_count == 2


def test_has_voted_checks_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """has_voted() queries by guest_id when present."""
    assert has_voted(db, test_request.id, guest_id=test_guest.id) is False
    add_vote(db, test_request.id, guest_id=test_guest.id)
    assert has_voted(db, test_request.id, guest_id=test_guest.id) is True


def test_remove_vote_by_guest_id(db: Session, test_request: Request, test_guest: Guest):
    """Remove a vote using guest_id."""
    add_vote(db, test_request.id, guest_id=test_guest.id)
    _, was_removed = remove_vote(db, test_request.id, guest_id=test_guest.id)
    assert was_removed is True

    db.refresh(test_request)
    assert test_request.vote_count == 0


def test_legacy_vote_still_works(db: Session, test_request: Request):
    """Old vote with only client_fingerprint still works."""
    _, is_new = add_vote(db, test_request.id, client_fingerprint="legacy_ip_addr")
    assert is_new is True
    assert has_voted(db, test_request.id, client_fingerprint="legacy_ip_addr") is True
