"""Rate limiting middleware using slowapi.

Identity is `guest_id` only (cookie + ThumbmarkJS reconciliation in
app/services/guest_identity.py). The slowapi rate-limiter is the lone
IP consumer in this codebase — IP is read ephemerally per request as
the rate-limit bucket key and is never stored, never logged.

To restore IP-based identity, see docs/RECOVERY-IP-IDENTITY.md.
"""

from __future__ import annotations

import ipaddress
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
    """EPHEMERAL ONLY — never store or log this value.

    Used solely as the slowapi rate-limit bucket key. To restore IP-based
    identity, see docs/RECOVERY-IP-IDENTITY.md.

    Priority:
    1. X-Real-IP (nginx overwrites this with the actual connecting client IP)
    2. X-Forwarded-For first entry (only if direct connection is a trusted proxy)
    3. Direct connection IP
    """
    direct_ip = get_remote_address(request)

    real_ip = request.headers.get("X-Real-IP")
    if real_ip and _is_trusted_proxy(direct_ip):
        return real_ip.strip()

    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for and _is_trusted_proxy(direct_ip):
        return forwarded_for.split(",")[0].strip()

    return direct_ip


# Create limiter instance with IP-based key function (ephemeral, in-memory).
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
