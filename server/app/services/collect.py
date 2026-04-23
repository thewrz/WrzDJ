"""Service layer for pre-event collection."""

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.guest_profile import GuestProfile


class SubmissionCapExceeded(Exception):
    """Raised when a guest has hit their per-event submission cap."""


def get_profile(db: Session, *, event_id: int, fingerprint: str) -> GuestProfile | None:
    return (
        db.query(GuestProfile)
        .filter(
            GuestProfile.event_id == event_id,
            GuestProfile.client_fingerprint == fingerprint,
        )
        .one_or_none()
    )


def upsert_profile(
    db: Session,
    *,
    event_id: int,
    fingerprint: str,
    nickname: str | None = None,
    email: str | None = None,
) -> GuestProfile:
    profile = get_profile(db, event_id=event_id, fingerprint=fingerprint)
    if profile is None:
        profile = GuestProfile(
            event_id=event_id,
            client_fingerprint=fingerprint,
            nickname=nickname,
            email=email,
        )
        db.add(profile)
    else:
        if nickname is not None:
            profile.nickname = nickname
        if email is not None:
            profile.email = email
    db.commit()
    db.refresh(profile)
    return profile


def check_and_increment_submission_count(
    db: Session, *, event: Event, fingerprint: str
) -> GuestProfile:
    """Atomically enforce the per-guest cap, incrementing submission_count on success.

    Raises SubmissionCapExceeded when the cap would be exceeded. cap == 0 means
    unlimited (explicit by design).
    """
    profile = get_profile(db, event_id=event.id, fingerprint=fingerprint)
    if profile is None:
        profile = GuestProfile(
            event_id=event.id,
            client_fingerprint=fingerprint,
        )
        db.add(profile)
        db.flush()

    cap = event.submission_cap_per_guest
    if cap != 0 and profile.submission_count >= cap:
        db.rollback()
        raise SubmissionCapExceeded()

    profile.submission_count += 1
    db.commit()
    db.refresh(profile)
    return profile
