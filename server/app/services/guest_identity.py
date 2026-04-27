"""Guest identity resolution service.

Resolves anonymous guests via a two-signal system:
1. Server-assigned HttpOnly cookie token (primary, canonical)
2. ThumbmarkJS browser fingerprint hash (reconciliation fallback)
"""

import json
import logging
import secrets
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.rate_limit import mask_fingerprint
from app.core.time import utcnow
from app.models.guest import Guest

_logger = logging.getLogger("app.guest.identity")


@dataclass
class IdentifyResult:
    guest_id: int
    action: str  # "create", "cookie_hit", "reconcile"
    token: str | None  # set only when a new cookie should be issued


def _compute_confidence(stored_ua: str | None, submitted_ua: str) -> float:
    """Score how likely the submitted UA belongs to the same person as stored_ua.

    Weights: UA family (0.5), UA platform (0.3), version proximity (0.2).
    """
    if not stored_ua:
        return 0.0

    stored_family, stored_platform, stored_version = _parse_ua(stored_ua)
    sub_family, sub_platform, sub_version = _parse_ua(submitted_ua)

    score = 0.0

    if stored_family == sub_family:
        score += 0.5

    if stored_platform == sub_platform:
        score += 0.3

    if stored_version and sub_version:
        try:
            diff = abs(int(stored_version) - int(sub_version))
            if diff <= 2:
                score += 0.2
        except ValueError:
            pass

    return score


def _parse_ua(ua: str) -> tuple[str, str, str]:
    """Extract (browser_family, platform, major_version) from UA string.

    Simple heuristic parser — covers the browsers that matter for mobile
    event guests (Safari, Chrome, Firefox, Samsung).
    """
    ua_lower = ua.lower()

    platform = "unknown"
    if "iphone" in ua_lower or "ipad" in ua_lower:
        platform = "ios"
    elif "android" in ua_lower:
        platform = "android"
    elif "windows" in ua_lower:
        platform = "windows"
    elif "macintosh" in ua_lower or "mac os" in ua_lower:
        platform = "macos"
    elif "linux" in ua_lower:
        platform = "linux"

    family = "unknown"
    version = ""
    if "firefox/" in ua_lower:
        family = "firefox"
        version = _extract_version(ua, "Firefox/")
    elif "edg/" in ua_lower:
        family = "edge"
        version = _extract_version(ua, "Edg/")
    elif "samsungbrowser/" in ua_lower:
        family = "samsung"
        version = _extract_version(ua, "SamsungBrowser/")
    elif "crios/" in ua_lower:
        family = "chrome"
        version = _extract_version(ua, "CriOS/")
    elif "chrome/" in ua_lower and "safari/" in ua_lower:
        family = "chrome"
        version = _extract_version(ua, "Chrome/")
    elif "version/" in ua_lower and "safari/" in ua_lower:
        family = "safari"
        version = _extract_version(ua, "Version/")

    return family, platform, version


def _extract_version(ua: str, prefix: str) -> str:
    """Extract major version number after a prefix like 'Chrome/'."""
    idx = ua.find(prefix)
    if idx == -1:
        return ""
    start = idx + len(prefix)
    end = start
    while end < len(ua) and ua[end].isdigit():
        end += 1
    return ua[start:end]


def identify_guest(
    db: Session,
    *,
    token_from_cookie: str | None,
    fingerprint_hash: str,
    fingerprint_components: dict | None = None,
    ip_address: str,
    user_agent: str,
) -> IdentifyResult:
    """Resolve a guest's identity using cookie token and/or browser fingerprint.

    Returns an IdentifyResult with the guest_id, the action taken, and
    optionally a new token (when a cookie must be set/refreshed).
    """
    components_json = json.dumps(fingerprint_components) if fingerprint_components else None
    now = utcnow()
    masked_fp = mask_fingerprint(fingerprint_hash)

    # --- Flow 2: Cookie present ---
    if token_from_cookie:
        guest = db.query(Guest).filter(Guest.token == token_from_cookie).first()
        if guest:
            old_fp = guest.fingerprint_hash
            guest.last_seen_at = now
            guest.ip_address = ip_address
            guest.user_agent = user_agent
            if fingerprint_hash and fingerprint_hash != guest.fingerprint_hash:
                _logger.warning(
                    "guest.identify action=fingerprint_drift guest_id=%s old_fp=%s new_fp=%s",
                    guest.id,
                    mask_fingerprint(old_fp) if old_fp else "-",
                    masked_fp,
                )
                guest.fingerprint_hash = fingerprint_hash
                guest.fingerprint_components = components_json
            db.commit()
            _logger.info(
                "guest.identify action=cookie_hit guest_id=%s fp=%s source=cookie",
                guest.id,
                masked_fp,
            )
            return IdentifyResult(guest_id=guest.id, action="cookie_hit", token=None)

    # --- Flow 3: Reconciliation (no cookie, fingerprint on file) ---
    if fingerprint_hash:
        existing = (
            db.query(Guest)
            .filter(Guest.fingerprint_hash == fingerprint_hash)
            .order_by(Guest.last_seen_at.desc())
            .first()
        )
        if existing:
            confidence = _compute_confidence(existing.user_agent, user_agent)
            if confidence >= 0.7:
                existing.last_seen_at = now
                existing.ip_address = ip_address
                existing.user_agent = user_agent
                existing.fingerprint_components = components_json
                new_token = secrets.token_hex(32)
                existing.token = new_token
                db.commit()
                _logger.info(
                    "guest.identify action=reconcile guest_id=%s fp=%s"
                    " source=fingerprint confidence=%.2f",
                    existing.id,
                    masked_fp,
                    confidence,
                )
                return IdentifyResult(guest_id=existing.id, action="reconcile", token=new_token)
            else:
                _logger.warning(
                    "guest.identify action=reconcile_rejected fp=%s"
                    " reason=ua_mismatch existing_guest=%s confidence=%.2f",
                    masked_fp,
                    existing.id,
                    confidence,
                )

    # --- Flow 1: New guest ---
    new_token = secrets.token_hex(32)
    guest = Guest(
        token=new_token,
        fingerprint_hash=fingerprint_hash,
        fingerprint_components=components_json,
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=now,
        last_seen_at=now,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)

    _logger.info(
        "guest.identify action=create guest_id=%s fp=%s source=new",
        guest.id,
        masked_fp,
    )
    return IdentifyResult(guest_id=guest.id, action="create", token=new_token)
