from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.lockout import lockout_manager
from app.core.rate_limit import get_client_ip, limiter
from app.models.user import User
from app.schemas.auth import Token
from app.schemas.user import UserOut
from app.services.auth import authenticate_user, create_access_token

router = APIRouter()
settings = get_settings()


@router.post("/login", response_model=Token)
@limiter.limit(lambda: f"{settings.login_rate_limit_per_minute}/minute")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    client_ip = get_client_ip(request)
    username = form_data.username

    # Check lockout status
    if settings.is_lockout_enabled:
        is_locked, seconds_remaining = lockout_manager.is_locked_out(client_ip, username)
        if is_locked:
            mins = seconds_remaining // 60 + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Try again in {mins} minutes.",
                headers={"Retry-After": str(seconds_remaining)},
            )

    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        # Record failed attempt
        if settings.is_lockout_enabled:
            is_locked, lockout_seconds = lockout_manager.record_failure(client_ip, username)
            if is_locked:
                mins = lockout_seconds // 60
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many failed attempts. Try again in {mins} minutes.",
                    headers={"Retry-After": str(lockout_seconds)},
                )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Clear lockout on success
    if settings.is_lockout_enabled:
        lockout_manager.record_success(client_ip, username)

    access_token = create_access_token(data={"sub": user.username})
    return Token(access_token=access_token)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
