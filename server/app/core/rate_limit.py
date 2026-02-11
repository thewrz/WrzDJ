"""Rate limiting middleware using slowapi."""

import ipaddress
from functools import lru_cache

from fastapi import Request, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from app.core.config import get_settings


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


def get_client_fingerprint(request: Request) -> str:
    """Extract client fingerprint (IP) from the request, truncated to safe length."""
    return get_client_ip(request)[:MAX_FINGERPRINT_LENGTH]


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
