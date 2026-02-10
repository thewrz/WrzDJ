"""Security headers middleware for FastAPI."""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.config import get_settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking - allow framing only from same origin
        response.headers["X-Frame-Options"] = "SAMEORIGIN"

        # Control referrer information sent to other sites
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Prevent XSS attacks in older browsers (modern browsers use CSP)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Disable caching for API responses by default
        # Individual endpoints can override this
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store, max-age=0"

        # Production-only headers (defense-in-depth alongside nginx)
        settings = get_settings()
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'"
            )

        return response
