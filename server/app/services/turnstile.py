"""Cloudflare Turnstile CAPTCHA verification."""

import httpx

from app.core.config import get_settings

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile_token(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Turnstile token with Cloudflare.

    Returns True if valid, False otherwise.
    Skips verification in dev if no secret key is configured.
    """
    settings = get_settings()

    if not settings.turnstile_secret_key:
        # No key configured — skip verification (dev mode)
        return True

    data = {
        "secret": settings.turnstile_secret_key,
        "response": token,
    }
    if remote_ip:
        data["remoteip"] = remote_ip

    async with httpx.AsyncClient() as client:
        resp = await client.post(VERIFY_URL, data=data)
        result = resp.json()

    return result.get("success", False)
