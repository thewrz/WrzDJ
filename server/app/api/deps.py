from collections.abc import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.event import Event
from app.models.user import User, UserRole
from app.services.auth import decode_token, get_user_by_username
from app.services.event import get_event_by_code_for_owner

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token_data = decode_token(token)
    if token_data is None or token_data.username is None:
        raise credentials_exception
    user = get_user_by_username(db, token_data.username)
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Reject pending users from accessing DJ features."""
    if current_user.role == UserRole.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account pending approval",
        )
    return current_user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Only allow admin users."""
    if current_user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def get_owned_event(
    code: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> Event:
    """Get an event owned by the current user, or raise 404."""
    event = get_event_by_code_for_owner(db, code, current_user)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event
