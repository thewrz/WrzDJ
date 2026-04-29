"""Public API endpoints for guest email verification."""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.rate_limit import get_guest_id, limiter
from app.schemas.verify import (
    VerifyConfirmResponse,
    VerifyConfirmSchema,
    VerifyRequestResponse,
    VerifyRequestSchema,
)
from app.services.email_sender import EmailNotConfiguredError, EmailSendError
from app.services.email_verification import (
    CodeExpiredError,
    CodeInvalidError,
    RateLimitExceededError,
    confirm_verification_code,
    create_verification_code,
)

router = APIRouter()


@router.post("/verify/request", response_model=VerifyRequestResponse)
@limiter.limit("10/minute")
def request_verification_code(
    payload: VerifyRequestSchema,
    request: Request,
    db: Session = Depends(get_db),
) -> VerifyRequestResponse:
    """Send a verification code to the provided email."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    try:
        create_verification_code(db, guest_id=guest_id, email=payload.email)
    except RateLimitExceededError:
        raise HTTPException(status_code=429, detail="Too many codes requested")
    except (EmailNotConfiguredError, EmailSendError):
        raise HTTPException(status_code=422, detail="Email verification is temporarily unavailable")

    return VerifyRequestResponse(sent=True)


@router.post("/verify/confirm", response_model=VerifyConfirmResponse)
@limiter.limit("10/minute")
def confirm_code(
    payload: VerifyConfirmSchema,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Confirm a verification code. May trigger guest merge."""
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(status_code=400, detail="Guest identity required")

    try:
        result = confirm_verification_code(
            db,
            guest_id=guest_id,
            email=payload.email,
            code=payload.code,
        )
    except CodeInvalidError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except CodeExpiredError as e:
        raise HTTPException(status_code=400, detail=str(e))

    response = JSONResponse(
        content={
            "verified": result.verified,
            "guest_id": result.guest_id,
            "merged": result.merged,
        }
    )

    if result.new_token:
        is_prod = get_settings().env == "production"
        response.set_cookie(
            key="wrzdj_guest",
            value=result.new_token,
            httponly=True,
            secure=is_prod,
            samesite="lax",
            max_age=31536000,
            path="/api/",
        )

    return response
