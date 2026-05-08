"""Self-service credential management: password change, email change."""

from sqlalchemy.orm import Session

from app.models.pending_email_change import PendingEmailChange
from app.models.user import User
from app.services.auth import get_password_hash, verify_password


class AccountError(Exception):
    """Base exception for account service errors."""

    pass


class TokenNotFoundError(AccountError):
    """Raised when email change confirmation token not found."""

    pass


class TokenExpiredError(AccountError):
    """Raised when email change confirmation token has expired."""

    pass


class TokenUsedError(AccountError):
    """Raised when email change confirmation token has already been used."""

    pass


class EmailTakenError(AccountError):
    """Raised when target email is already in use by another user."""

    pass


def invalidate_pending_email_changes(db: Session, user_id: int) -> None:
    """Mark all pending, unused email changes for a user as used (invalidated).

    Called on password change to revoke any in-flight email change confirmations.
    """
    db.query(PendingEmailChange).filter(
        PendingEmailChange.user_id == user_id,
        PendingEmailChange.used.is_(False),
    ).update({"used": True})


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    """Change a user's password after verifying the current password.

    - Verifies current password is correct
    - Updates password hash
    - Bumps token_version to invalidate all existing JWT tokens
    - Invalidates any pending email change confirmations

    Args:
        db: Database session
        user: User model instance
        current_password: User's current password (plaintext)
        new_password: New password (plaintext)

    Raises:
        ValueError: If current password is incorrect
    """
    if not verify_password(current_password, user.password_hash):
        raise ValueError("incorrect_password")

    user.password_hash = get_password_hash(new_password)
    invalidate_pending_email_changes(db, user.id)
    user.token_version += 1
    db.commit()


# Stubs — implemented in Tasks 3 and 4
def request_email_change(db: Session, user: User, current_password: str, new_email: str) -> None:
    """Request to change the user's email address.

    Verifies password, validates email is not taken, generates confirmation token,
    sends confirmation email with link to `confirm_email_change`.

    Stub for Task 3 (request_email_change).

    Args:
        db: Database session
        user: User model instance
        current_password: User's current password (plaintext)
        new_email: Desired new email address

    Raises:
        ValueError: If current password is incorrect
        EmailTakenError: If new_email is already in use
    """
    raise NotImplementedError


def get_active_pending_email_change(db: Session, user_id: int) -> "PendingEmailChange | None":
    """Get the active (unused, not expired) pending email change for a user.

    Stub for Task 4 (get_active_pending_email_change).

    Args:
        db: Database session
        user_id: User ID

    Returns:
        PendingEmailChange if one exists and is valid, None otherwise
    """
    raise NotImplementedError


def confirm_email_change(db: Session, token: str) -> User:
    """Confirm an email change using a confirmation token.

    Validates token exists, is not expired, not already used, then updates the
    user's email and marks the token as used.

    Stub for Task 4 (confirm_email_change).

    Args:
        db: Database session
        token: Email change confirmation token

    Returns:
        Updated User model

    Raises:
        TokenNotFoundError: If token does not exist
        TokenExpiredError: If token has expired
        TokenUsedError: If token has already been used
    """
    raise NotImplementedError
