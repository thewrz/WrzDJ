import logging
import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi import Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.api import api_router
from app.core.config import get_settings
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.core.security_headers import SecurityHeadersMiddleware

# Ensure WebP MIME type is registered (missing on some minimal Docker images)
mimetypes.add_type("image/webp", ".webp")

settings = get_settings()

# Configure app-level logging so module loggers (enrichment, sync, etc.)
# emit INFO-level diagnostics instead of being silenced by Python's default WARNING level.
logging.getLogger("app").setLevel(logging.INFO)

# Explicit CORS methods for non-wildcard origins — must include every HTTP method used by the API
CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

app = FastAPI(
    title="WrzDJ API",
    description="Song request system for DJs",
    version="0.1.0",
    # Disable API docs in production
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

logger = logging.getLogger(__name__)


@app.exception_handler(Exception)
async def global_exception_handler(request: FastAPIRequest, exc: Exception) -> JSONResponse:
    """Catch unhandled exceptions and return a generic 500 response."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    content = {"detail": "Internal server error"}
    if not settings.is_production:
        content["debug"] = str(exc)
    return JSONResponse(status_code=500, content=content)


# Security headers (added first, runs last in middleware chain)
app.add_middleware(SecurityHeadersMiddleware)

# CORS
if settings.cors_origins.strip() == "*":
    # Allow all origins for local development (no credentials needed for Bearer token auth)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    origins = [origin.strip() for origin in settings.cors_origins.split(",")]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=CORS_ALLOW_METHODS,
        allow_headers=["Authorization", "Content-Type", "X-Kiosk-Session"],
    )

# Include API router
app.include_router(api_router, prefix="/api")

# Serve uploaded files (banners, etc.)
uploads_dir = Path(settings.resolved_uploads_dir)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/health")
def health_check():
    return {"status": "ok"}
