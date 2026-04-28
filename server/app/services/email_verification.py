"""Email verification service — code creation, validation, and guest email linking."""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.rate_limit import mask_fingerprint
from app.core.time import utcnow
from app.models.email_verification_code import EmailVerificationCode
from app.models.guest import Guest
from app.models.guest_profile import GuestProfile
from app.services.email_sender import send_verification_email

_logger = logging.getLogger("app.guest.verify")

MAX_CODES_PER_EMAIL_PER_HOUR = 5
CODE_VALIDITY_MINUTES = 15
MAX_ATTEMPTS = 3


class RateLimitExceededError(Exception):
    pass


class CodeInvalidError(Exception):
    pass


class CodeExpiredError(Exception):
    pass


@dataclass
class VerifyResult:
    verified: bool
    guest_id: int
    merged: bool
    new_token: str | None = None


def _hash_email(email: str) -> str:
    return hashlib.sha256(email.lower().encode()).hexdigest()


def create_verification_code(db: Session, *, guest_id: int, email: str) -> EmailVerificationCode:
    """Generate a 6-digit code, store it, and send it via email."""
    email_lower = email.lower()
    eh = _hash_email(email_lower)
    now = utcnow()

    active_count = (
        db.query(EmailVerificationCode)
        .filter(
            EmailVerificationCode.email_hash == eh,
            EmailVerificationCode.used == False,  # noqa: E712
            EmailVerificationCode.expires_at > now,
        )
        .count()
    )
    if active_count >= MAX_CODES_PER_EMAIL_PER_HOUR:
        _logger.warning(
            "guest.verify action=rate_limited email_hash=%s reason=max_codes_per_hour",
            mask_fingerprint(eh),
        )
        raise RateLimitExceededError("Too many verification codes requested")

    code = str(secrets.randbelow(900000) + 100000)

    row = EmailVerificationCode(
        guest_id=guest_id,
        email_hash=eh,
        code=code,
        expires_at=now + timedelta(minutes=CODE_VALIDITY_MINUTES),
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    send_verification_email(email_lower, code)

    _logger.info(
        "guest.verify action=code_sent guest_id=%s email_hash=%s",
        guest_id,
        mask_fingerprint(eh),
    )
    return row


def _link_orphan_profiles_to_guest(db: Session, *, fingerprint: str | None, guest_id: int) -> int:
    """Link guest_profiles rows with matching client_fingerprint and
    guest_id IS NULL to the verified guest. Returns count of rows updated.
    The caller is responsible for committing.
    """
    if not fingerprint:
        return 0
    count = (
        db.query(GuestProfile)
        .filter(
            GuestProfile.client_fingerprint == fingerprint,
            GuestProfile.guest_id.is_(None),
        )
        .update({"guest_id": guest_id}, synchronize_session=False)
    )
    if count:
        _logger.info(
            "guest.verify action=link_orphans guest_id=%s count=%s",
            guest_id,
            count,
        )
    return count


def confirm_verification_code(
    db: Session,
    *,
    guest_id: int,
    email: str,
    code: str,
    request_fingerprint: str | None = None,
) -> VerifyResult:
    """Validate a verification code and set verified_email on the Guest.

    When `request_fingerprint` is provided, also link any orphan
    GuestProfile rows (matching fingerprint, guest_id IS NULL) to the
    verified guest. This closes the gap where a profile was created
    before the wrzdj_guest cookie was set.
    """
    eh = _hash_email(email.lower())
    now = utcnow()

    row = (
        db.query(EmailVerificationCode)
        .filter(
            EmailVerificationCode.guest_id == guest_id,
            EmailVerificationCode.email_hash == eh,
            EmailVerificationCode.used == False,  # noqa: E712
        )
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )

    if row is None:
        raise CodeInvalidError("No pending verification code found")

    if row.expires_at <= now:
        _logger.warning(
            "guest.verify action=code_expired guest_id=%s email_hash=%s",
            guest_id,
            mask_fingerprint(eh),
        )
        raise CodeExpiredError("Verification code has expired")

    if row.attempts >= MAX_ATTEMPTS:
        raise CodeInvalidError("Too many failed attempts — request a new code")

    if row.code != code:
        row.attempts += 1
        db.commit()
        _logger.warning(
            "guest.verify action=code_failed guest_id=%s email_hash=%s attempts=%s",
            guest_id,
            mask_fingerprint(eh),
            row.attempts,
        )
        raise CodeInvalidError("Incorrect verification code")

    row.used = True
    db.commit()

    guest = db.query(Guest).filter(Guest.id == guest_id).one()

    # Already verified with this email?
    if guest.email_hash == eh:
        _link_orphan_profiles_to_guest(db, fingerprint=request_fingerprint, guest_id=guest_id)
        db.commit()
        _logger.info(
            "guest.verify action=code_verified guest_id=%s email_hash=%s (already verified)",
            guest_id,
            mask_fingerprint(eh),
        )
        return VerifyResult(verified=True, guest_id=guest_id, merged=False)

    # Check if another Guest owns this email
    existing = db.query(Guest).filter(Guest.email_hash == eh, Guest.id != guest_id).first()

    if existing:
        from app.services.guest_merge import merge_guests

        merge_result = merge_guests(db, source_guest_id=guest_id, target_guest_id=existing.id)
        _link_orphan_profiles_to_guest(db, fingerprint=request_fingerprint, guest_id=existing.id)
        db.commit()
        _logger.info(
            "guest.verify action=merge source_guest=%s target_guest=%s email_hash=%s"
            " requests=%s votes=%s profiles=%s",
            merge_result.source_guest_id,
            merge_result.target_guest_id,
            mask_fingerprint(eh),
            merge_result.requests_moved,
            merge_result.votes_moved,
            merge_result.profiles_moved,
        )
        return VerifyResult(
            verified=True,
            guest_id=existing.id,
            merged=True,
            new_token=existing.token,
        )

    # First verification for this email
    guest.verified_email = email.lower()
    guest.email_hash = eh
    guest.email_verified_at = now
    _link_orphan_profiles_to_guest(db, fingerprint=request_fingerprint, guest_id=guest_id)
    db.commit()

    _logger.info(
        "guest.verify action=code_verified guest_id=%s email_hash=%s",
        guest_id,
        mask_fingerprint(eh),
    )
    return VerifyResult(verified=True, guest_id=guest_id, merged=False)
