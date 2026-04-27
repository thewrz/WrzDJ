"""Rate limiting middleware using slowapi."""

from __future__ import annotations

import ipaddress
import logging
from functools import lru_cache
from typing import TYPE_CHECKING

from fastapi import Request, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.core.config import get_settings

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


@lru_cache(maxsize=1)
def _get_trusted_proxies() -> tuple[
    frozenset[str],
    tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...],
]:
    """Return trusted proxy IPs and CIDR networks from settings (cached)."""
    settings = get_settings()
    exact = set()
    networks = []
    for entry in settings.trusted_proxies.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "/" in entry:
            networks.append(ipaddress.ip_network(entry, strict=False))
        else:
            exact.add(entry)
    return frozenset(exact), tuple(networks)


def _is_trusted_proxy(ip: str) -> bool:
    """Check if an IP is in the trusted proxies list (exact match or CIDR)."""
    exact, networks = _get_trusted_proxies()
    if ip in exact:
        return True
    if networks:
        try:
            addr = ipaddress.ip_address(ip)
            return any(addr in net for net in networks)
        except ValueError:
            return False
    return False


def get_client_ip(request: Request) -> str:
    """Get client IP, preferring X-Real-IP set by nginx over X-Forwarded-For.

    Priority:
    1. X-Real-IP (nginx overwrites this with the actual connecting client IP)
    2. X-Forwarded-For first entry (only if direct connection is a trusted proxy)
    3. Direct connection IP
    """
    direct_ip = get_remote_address(request)

    # Prefer X-Real-IP — nginx sets this to the real client IP and it cannot be
    # spoofed by the client (nginx overwrites, not appends)
    real_ip = request.headers.get("X-Real-IP")
    if real_ip and _is_trusted_proxy(direct_ip):
        return real_ip.strip()

    # Fallback: X-Forwarded-For from a trusted proxy
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for and _is_trusted_proxy(direct_ip):
        return forwarded_for.split(",")[0].strip()

    return direct_ip


MAX_FINGERPRINT_LENGTH = 64

_fp_logger = logging.getLogger("app.fingerprint")


def mask_fingerprint(fp: str) -> str:
    """Return a short, non-reversible tag for a fingerprint — safe for logs
    and activity-log messages.

    SHA-256 truncated to 12 hex chars: enough to correlate actions by the
    same guest across events in logs, but not enough to recover the original
    IP. The raw value stays in the DB for legitimate abuse investigation.
    """
    import hashlib

    return hashlib.sha256(fp.encode("utf-8")).hexdigest()[:12]


def _fp_source(request: Request) -> str:
    """Identify which header/layer supplied the fingerprint for this request."""
    direct_ip = get_remote_address(request)
    if request.headers.get("X-Real-IP") and _is_trusted_proxy(direct_ip):
        return "x-real-ip"
    if request.headers.get("X-Forwarded-For") and _is_trusted_proxy(direct_ip):
        return "x-forwarded-for"
    return "direct"


def get_client_fingerprint(
    request: Request,
    *,
    action: str | None = None,
    event_code: str | None = None,
) -> str:
    """Extract client fingerprint (IP) from the request, truncated to safe length.

    When `action` is provided, emits a structured INFO log line:
        action=collect.vote event=PB5TTP source=x-real-ip fp=a1b2c3d4e5f6

    The logged `fp` is a hashed tag — the raw IP stays in the DB for
    legitimate abuse investigation but never appears in log output.
    """
    raw = get_client_ip(request)[:MAX_FINGERPRINT_LENGTH]
    if action is not None:
        _fp_logger.info(
            "fp_resolve action=%s event=%s source=%s fp=%s",
            action,
            event_code or "-",
            _fp_source(request),
            mask_fingerprint(raw),
        )
    return raw


# Create limiter instance with IP-based key function
limiter = Limiter(key_func=get_client_ip, enabled=get_settings().is_rate_limit_enabled)


def get_guest_id(request: Request, db: Session) -> int | None:
    """Read wrzdj_guest cookie and return the Guest.id, or None."""
    from app.models.guest import Guest

    token = request.cookies.get("wrzdj_guest")
    if not token:
        return None
    guest = db.query(Guest).filter(Guest.token == token).first()
    return guest.id if guest else None


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> Response:
    """Custom handler for rate limit exceeded errors."""
    retry_after = 60  # Default to 60 seconds

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "retry_after": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )
