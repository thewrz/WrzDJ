"""Rate limiting middleware using slowapi."""

from fastapi import Request, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.core.config import get_settings


def get_client_ip(request: Request) -> str:
    """Get client IP, respecting X-Forwarded-For header from trusted proxies."""
    # Check for forwarded IP (set by nginx/load balancer)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the first IP in the chain (original client)
        return forwarded_for.split(",")[0].strip()
    # Fall back to direct connection IP
    return get_remote_address(request)


# Create limiter instance with IP-based key function
limiter = Limiter(key_func=get_client_ip, enabled=get_settings().is_rate_limit_enabled)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """Custom handler for rate limit exceeded errors."""
    # Parse retry-after from the exception message if available
    retry_after = 60  # Default to 60 seconds
    if hasattr(exc, "detail") and "Retry after" in str(exc.detail):
        try:
            # Extract seconds from message like "Rate limit exceeded: 5 per 1 minute"
            retry_after = 60
        except (ValueError, IndexError):
            pass

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "retry_after": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )
