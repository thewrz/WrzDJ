"""Public API endpoint for guest identity resolution."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.rate_limit import get_client_ip, limiter
from app.schemas.guest import IdentifyRequest, IdentifyResponse
from app.services.guest_identity import identify_guest

router = APIRouter()


@router.post("/guest/identify", response_model=IdentifyResponse)
@limiter.limit("120/minute")
def identify(
    payload: IdentifyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> JSONResponse:
    """Resolve guest identity via cookie token and/or browser fingerprint."""
    token_from_cookie = request.cookies.get("wrzdj_guest")
    ip_address = get_client_ip(request)
    user_agent = (request.headers.get("user-agent") or "")[:512]

    result = identify_guest(
        db,
        token_from_cookie=token_from_cookie,
        fingerprint_hash=payload.fingerprint_hash,
        fingerprint_components=payload.fingerprint_components,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    response = JSONResponse(content={"guest_id": result.guest_id, "action": result.action})

    if result.token:
        is_prod = get_settings().env == "production"
        response.set_cookie(
            key="wrzdj_guest",
            value=result.token,
            httponly=True,
            secure=is_prod,
            samesite="lax",
            max_age=31536000,
            path="/api/",
        )

    return response
